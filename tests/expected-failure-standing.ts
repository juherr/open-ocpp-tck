// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * expected-failure-standing.ts -- the exit-code rule, whole, offline.
 *
 * THE PROPERTY: a scenario's standing is a total function of three things --
 * the verdict, the isolated retry's verdict if there was one, and whether the
 * driver declared the scenario expected-failing. Every row of that table is
 * asserted here, including the ones that decide whether a CI job is honest.
 *
 * WHY IT IS A GUARD AND NOT A SWEEP. Reaching these rows through the runner
 * means a docker image, a live CSMS and about ten minutes, and reaching them
 * ON PURPOSE means engineering a CSMS that fails a chosen scenario a chosen
 * way -- which nobody will do for a rule that is one `||` away from being
 * wrong in a direction that turns a red build green. `tck/standing.ts` exists
 * as a separate module so this file can be a table.
 *
 * WHY IT IS TYPESCRIPT, like tests/driver-env-scope.ts: the rule is not
 * reachable through the CLI without running a scenario, which is the whole
 * point above.
 *
 * THE ROW THAT MATTERS MOST is `declared + ERROR`. An expected-failure entry
 * says what a CSMS ANSWERS; an ERROR is the scenario never getting an answer,
 * so excusing it would let a container that refuses to boot pass as the
 * documented finding -- exactly the blindness the whole mechanism replaced.
 *
 * THE RETRY'S ADJUDICATION is the second table: whether an isolated retry was
 * a flake, a confirmation, or INCONCLUSIVE because the CSMS never accepted its
 * BootNotification. An inconclusive retry is recorded as an ERROR, so the
 * first table decides its standing -- and the composed rows below hold that it
 * still ends the build, declared or not, rather than reading "confirmed" or
 * being excused as the declared finding (#141).
 */
import type { ExpectedFailureEntry } from "../tck/expected";
import {
  adjudicateRetry,
  declaredButErroredDetail,
  effectivelyFailed,
  endsTheBuild,
  RETRY_ADJUDICATIONS,
  standingOf,
  unexpectedPassDetail,
  unexpectedPassKind,
  type RetryAdjudication,
  type SweepStanding,
  type UnexpectedPassKind,
  type Verdict,
} from "../tck/standing";

const failures: string[] = [];

const DECLARED: ExpectedFailureEntry = {
  reason: "the CSMS answers X where the spec requires Y",
  finding: "acme/acme#1",
};

interface Row {
  verdict: Verdict;
  retry?: Verdict;
  declared: boolean;
  expect: SweepStanding;
  /** Why this row is what it is -- printed when it breaks, so a failure names
   *  the rule rather than the coordinates. */
  because: string;
}

const TABLE: Row[] = [
  // --- nothing declared: the original rule, unchanged --------------------
  { verdict: "PASS", declared: false, expect: "ok", because: "a pass is a pass" },
  { verdict: "PARTIAL", declared: false, expect: "ok", because: "a check that could not be evaluated is not a defect" },
  { verdict: "NOT APPLICABLE", declared: false, expect: "ok", because: "out of scope for this CSMS" },
  { verdict: "FAIL", declared: false, expect: "unexpected-fail", because: "an undeclared failure is the thing a TCK exists to report" },
  { verdict: "ERROR", declared: false, expect: "unexpected-fail", because: "an undeclared error is equally a failure" },

  // --- declared, and it failed as declared -------------------------------
  { verdict: "FAIL", declared: true, expect: "expected-fail", because: "the declared finding reproduced" },
  { verdict: "FAIL", retry: "FAIL", declared: true, expect: "expected-fail", because: "it reproduced isolated too, which is the strongest form" },

  // --- declared, and it ERRORED: a declaration excuses an answer, not a
  //     crash. These four rows are the finding this guard was written for.
  { verdict: "ERROR", declared: true, expect: "declared-but-errored", because: "an ERROR never produced the answer the entry describes" },
  { verdict: "ERROR", retry: "ERROR", declared: true, expect: "declared-but-errored", because: "errored isolated too -- still not the declared failure" },
  { verdict: "FAIL", retry: "ERROR", declared: true, expect: "declared-but-errored", because: "the isolated retry is the arbiter, and it crashed" },
  { verdict: "ERROR", retry: "FAIL", declared: true, expect: "expected-fail", because: "the isolated retry is the arbiter: the parallel ERROR was the lane, and isolated it reproduced the declared failure" },

  // --- declared, and it did NOT fail: the half that lets the list shrink --
  { verdict: "PASS", declared: true, expect: "unexpected-pass", because: "the finding looks fixed, so the entry must be deleted or re-worded" },
  { verdict: "PARTIAL", declared: true, expect: "unexpected-pass", because: "a declared row that stopped being measurable is not a declared row that still holds" },
  { verdict: "NOT APPLICABLE", declared: true, expect: "unexpected-pass", because: "the scope table and the list contradict each other" },
  { verdict: "FAIL", retry: "PASS", declared: true, expect: "unexpected-pass", because: "there is no 'expected flaky' -- passing any way at all is an entry to look at" },
  { verdict: "ERROR", retry: "PASS", declared: true, expect: "unexpected-pass", because: "same, from the ERROR side" },
];

for (const row of TABLE) {
  const got = standingOf(
    row.verdict,
    row.declared ? DECLARED : undefined,
    row.retry,
  );
  const label =
    `${row.declared ? "declared" : "undeclared"} ${row.verdict}` +
    (row.retry ? ` -> retry ${row.retry}` : "");
  if (got !== row.expect) {
    failures.push(
      `${label}: expected "${row.expect}", got "${got}" -- ${row.because}.`,
    );
  }
}

// The two rules the table above is built on, asserted directly so a break says
// WHICH one moved rather than listing every row that depended on it.
check(
  effectivelyFailed("FAIL") && !effectivelyFailed("FAIL", "PASS"),
  "a parallel failure that passes its isolated retry is no longer a flake.",
);
check(
  !effectivelyFailed("PASS") && !effectivelyFailed("PARTIAL"),
  "a non-failure verdict is now treated as a failure.",
);

// Which STANDINGS end the build, asserted against the union rather than
// against a disjunction retyped at the call site. A sixth standing that
// nobody classifies shows up here.
const ALL_STANDINGS: SweepStanding[] = [
  "ok",
  "expected-fail",
  "unexpected-fail",
  "declared-but-errored",
  "unexpected-pass",
];
const SHOULD_END_BUILD = new Set<SweepStanding>([
  "unexpected-fail",
  "declared-but-errored",
  "unexpected-pass",
]);
for (const standing of ALL_STANDINGS) {
  check(
    endsTheBuild(standing) === SHOULD_END_BUILD.has(standing),
    `endsTheBuild("${standing}") is now ${endsTheBuild(standing)} -- only an ` +
      "unexcused failure, a declared crash and a declared pass end the build.",
  );
}

// WHICH KIND of unexpected pass, as a value table.
//
// This replaces three assertions that grepped the MESSAGES for "looks fixed".
// They were both brittle and blind, and the blindness was demonstrated rather
// than suspected: rewording the PARTIAL branch to "the finding looks resolved"
// -- the maintainer-misleading defect the assertions existed to catch --
// left them green, because the token they matched had moved. The kind is what
// the rule actually computes, so it is what can be pinned.
const KINDS: { verdict: Verdict; retry?: Verdict; kind: UnexpectedPassKind; because: string }[] = [
  { verdict: "PASS", kind: "fixed", because: "the one case that IS evidence the CSMS was fixed" },
  { verdict: "PARTIAL", kind: "degraded", because: "a check was SKIPPED, so nothing was measured either way" },
  { verdict: "NOT APPLICABLE", kind: "never-ran", because: "the scope table and the list contradict each other" },
  { verdict: "FAIL", retry: "PASS", kind: "flaky", because: "failed in a lane, passed isolated" },
  { verdict: "ERROR", retry: "PASS", kind: "flaky", because: "same, from the ERROR side" },
];
for (const row of KINDS) {
  const got = unexpectedPassKind(row.verdict, row.retry);
  check(
    got === row.kind,
    `unexpectedPassKind(${row.verdict}${row.retry ? ` -> ${row.retry}` : ""}) ` +
      `is "${got}", expected "${row.kind}" -- ${row.because}.`,
  );
}

// The four messages must stay tellable apart. This is the one PROSE property
// worth pinning: it does not name a phrase, so any reword survives it, while a
// copy-paste that makes two kinds read alike does not. Beyond this, whether a
// sentence MEANS what it should is a review concern -- no string match decides
// it, and pretending otherwise is what the deleted assertions did.
const MESSAGES = KINDS.map((row) => unexpectedPassDetail(row.verdict, row.retry));
check(
  new Set(MESSAGES).size === new Set(KINDS.map((r) => r.kind)).size,
  "two unexpected-pass kinds now render the same sentence, so a reader cannot " +
    "tell which evidence they are looking at.",
);
check(
  unexpectedPassDetail("PASS") !== declaredButErroredDetail("ERROR"),
  "an unexpected pass and a declared crash now read alike, and they call for " +
    "opposite actions -- delete the entry versus keep it and chase the crash.",
);
// The retry half of the same message, pinned the same way: vary ONLY the
// isolated retry's verdict and the sentence must vary with it. Stated as a
// difference rather than as a substring, so any reword survives while a branch
// that stops reporting the retry at all does not.
//
// This gap was found by tools/mutate.sh on its first real use: replacing that
// branch outright left the guard green, because the distinctness check above
// compares the NO-retry form and never reaches it.
check(
  declaredButErroredDetail("ERROR", "FAIL") !==
    declaredButErroredDetail("ERROR", "ERROR"),
  "the declared-but-errored message no longer varies with the isolated " +
    "retry's verdict, so it cannot say whether the crash was the lane or the " +
    "scenario.",
);

// WHAT AN ISOLATED RETRY SAYS about the parallel failure, as a value table.
//
// The input the verdict cannot carry is whether the retry's boot gate opened:
// a retry against a CSMS that never accepted its BootNotification fails every
// check that needed the CSMS, and those FAILs are about the CSMS's absence,
// not about the case. `undefined` is a run that threw before reaching the gate
// (the container never started) -- not this rule's to reclassify.
const ADJUDICATIONS: {
  verdict: Verdict;
  bootGateOpened: boolean | undefined;
  adjudication: RetryAdjudication;
  recorded: Verdict;
  because: string;
}[] = [
  { verdict: "FAIL", bootGateOpened: true, adjudication: "confirmed", recorded: "FAIL", because: "the CSMS answered and the case failed again with no lane contending" },
  { verdict: "ERROR", bootGateOpened: true, adjudication: "confirmed", recorded: "ERROR", because: "a crash after a healthy boot is a crash, as before" },
  { verdict: "FAIL", bootGateOpened: false, adjudication: "inconclusive", recorded: "ERROR", because: "checks against a CSMS that never accepted the boot measure its absence -- ERROR is 'never got an answer'" },
  { verdict: "ERROR", bootGateOpened: false, adjudication: "inconclusive", recorded: "ERROR", because: "same, when the absent CSMS made the run throw" },
  { verdict: "PASS", bootGateOpened: false, adjudication: "flake", recorded: "PASS", because: "a pass after a late boot is still a pass -- real flake evidence" },
  { verdict: "PARTIAL", bootGateOpened: false, adjudication: "flake", recorded: "PARTIAL", because: "a non-failure retry is a flake whatever the gate did" },
  { verdict: "FAIL", bootGateOpened: undefined, adjudication: "confirmed", recorded: "FAIL", because: "a run that never reached the gate keeps today's reading" },
];
for (const row of ADJUDICATIONS) {
  const got = adjudicateRetry(row.verdict, row.bootGateOpened);
  check(
    got.adjudication === row.adjudication && got.verdict === row.recorded,
    `adjudicateRetry(${row.verdict}, bootGateOpened=${row.bootGateOpened}) is ` +
      `${got.adjudication}/${got.verdict}, expected ${row.adjudication}/${row.recorded} -- ${row.because}.`,
  );
}
// Every adjudication the list names is one a row produces, so a fourth member
// added to RETRY_ADJUDICATIONS without a branch -- or a branch deleted -- shows.
for (const adjudication of RETRY_ADJUDICATIONS) {
  check(
    ADJUDICATIONS.some((row) => row.adjudication === adjudication),
    `no row adjudicates a retry "${adjudication}".`,
  );
}
// "It still fails, saying so": the inconclusive retry's RECORDED verdict fed
// through the exit-code rule. Undeclared it is an unexpected failure; declared
// it must not be excused as the documented finding, because the CSMS never
// gave the answer that finding describes.
const inconclusive = adjudicateRetry("FAIL", false).verdict;
for (const [declared, expect] of [
  [false, "unexpected-fail"],
  [true, "declared-but-errored"],
] as const) {
  const standing = standingOf("FAIL", declared ? DECLARED : undefined, inconclusive);
  check(
    standing === expect && endsTheBuild(standing),
    `${declared ? "declared" : "undeclared"} FAIL with an inconclusive retry ` +
      `stands "${standing}", expected "${expect}" ending the build -- a run that ` +
      "lost its CSMS is not a passing run, and not the declared finding either.",
  );
}

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

if (failures.length > 0) {
  process.stderr.write("FAIL: the exit-code rule does not hold.\n");
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `Exit-code rule holds across all ${TABLE.length} verdict/retry/declaration ` +
    `combinations and ${ADJUDICATIONS.length} retry adjudications (a ` +
    "declaration excuses an answer, never a crash, and never a scenario that " +
    "stopped failing; a retry that lost its CSMS confirms nothing).\n",
);
