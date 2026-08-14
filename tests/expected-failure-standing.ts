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
  standingOf,
  unexpectedPassDetail,
  type SweepStanding,
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
  { verdict: "ERROR", declared: true, expect: "unexpected-fail", because: "an ERROR never produced the answer the entry describes" },
  { verdict: "ERROR", retry: "ERROR", declared: true, expect: "unexpected-fail", because: "errored isolated too -- still not the declared failure" },
  { verdict: "FAIL", retry: "ERROR", declared: true, expect: "unexpected-fail", because: "the isolated retry is the arbiter, and it crashed" },
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

// The message an UNEXPECTED PASS carries decides whether a maintainer deletes
// a still-valid finding, so the two cases that are NOT evidence of a fix must
// not claim to be.
check(
  !unexpectedPassDetail("PARTIAL").includes("looks fixed"),
  "a PARTIAL now reads as evidence the finding is fixed; it is evidence of " +
    "nothing, because the check that caught it may be the one that SKIPPED.",
);
check(
  !unexpectedPassDetail("NOT APPLICABLE").includes("looks fixed"),
  "a NOT APPLICABLE now reads as evidence the finding is fixed; it means the " +
    "scenario never ran.",
);
check(
  unexpectedPassDetail("PASS").includes("looks fixed"),
  "an outright PASS no longer reads as evidence the finding is fixed, which " +
    "is the one case where it is.",
);

// The mirror of the three above. This message points the reader AWAY from the
// entry -- the declaration is probably intact and the crash is new -- so
// inverting it would send them to delete a finding that still holds, which is
// the same damage from the opposite direction.
check(
  declaredButErroredDetail("ERROR").includes("still good"),
  "a declared scenario that errored no longer reads as 'the entry is " +
    "probably still good', so the message now points at the declaration " +
    "rather than at the crash.",
);
check(
  declaredButErroredDetail("FAIL", "ERROR").includes("isolated retry"),
  "the FAIL-then-ERROR case no longer says where the ERROR came from, so a " +
    "reader cannot tell a crashing retry from a crashing lane.",
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
