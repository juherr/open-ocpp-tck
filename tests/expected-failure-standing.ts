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
 */
import type { ExpectedFailureEntry } from "../tck/expected";
import {
  declaredButErroredDetail,
  effectivelyFailed,
  endsTheBuild,
  standingOf,
  unexpectedPassDetail,
  unexpectedPassKind,
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
    "combinations (a declaration excuses an answer, never a crash, and never " +
    "a scenario that stopped failing).\n",
);
