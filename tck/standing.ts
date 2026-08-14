// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * standing.ts -- the exit-code rule, as a pure function of one scenario's
 * verdicts and what the driver declared about it.
 *
 * WHY IT HAS ITS OWN MODULE. It is the whole load-bearing decision of the
 * expected-failure mechanism -- the thing that says a red CI job means
 * something -- and inside the runner it was reachable only by starting a
 * container and driving a live CSMS. Here it is a total function over five
 * verdicts and one optional retry, so `tests/expected-failure-standing.ts`
 * can assert the entire truth table offline, including the rows a sweep would
 * take a docker image and ten minutes to reach once each.
 *
 * It names no CSMS and imports nothing but the declaration type, which is what
 * keeps it on the core side of the boundary tests/generic-core.sh enforces.
 */
import type { ExpectedFailureEntry } from "./expected";

/** Verdict for one scenario. PASS/FAIL/ERROR keep their upstream meaning.
 *
 *  The distinction that matters below is FAIL vs ERROR: FAIL is an assertion
 *  that ran and disagreed with the CSMS, ERROR is the scenario never getting
 *  that far. */
export type Verdict = "PASS" | "PARTIAL" | "FAIL" | "ERROR" | "NOT APPLICABLE";

/** The two verdicts that count as a failure. Whether one ends the process
 *  non-zero is {@link standingOf}'s answer, not this one's. */
export function isFailure(verdict: Verdict): boolean {
  return verdict === "FAIL" || verdict === "ERROR";
}

/**
 * The verdict to believe when a scenario ran twice.
 *
 * The isolated retry is the arbiter, and that is the existing doctrine rather
 * than a new rule: parallel lanes are not isolated from each other, the runner
 * says so on every parallel sweep, and the retry exists precisely to re-run a
 * failure with nothing else contending. So a scenario that ERRORed under
 * contention and FAILed cleanly on its own is a FAIL -- the ERROR was the
 * lane, not the CSMS.
 */
function decisiveVerdict(verdict: Verdict, retryVerdict?: Verdict): Verdict {
  return retryVerdict ?? verdict;
}

/**
 * Did this scenario really fail -- after the isolated retry has had its say?
 *
 * ONE definition, deliberately, because there are several consumers: the exit
 * code, the flake count, and the comparison against the driver's
 * expected-failure list. Written twice they would drift, and the drift would
 * be silent in the worst possible place -- a row excused by one rule and
 * counted by the other.
 *
 * A parallel-lane FAIL/ERROR that did not fail its isolated retry is a flake,
 * not a failure.
 */
export function effectivelyFailed(
  verdict: Verdict,
  retryVerdict?: Verdict,
): boolean {
  if (!isFailure(verdict)) return false;
  return retryVerdict === undefined || isFailure(retryVerdict);
}

/**
 * How an outcome lands against what the driver declared. This -- not the
 * verdict -- is what the exit code reads.
 *
 * `expected-fail` is the point of the list: a finding already written down is
 * not news, and excusing it one scenario at a time is what lets the other 46
 * be reported at all.
 *
 * `unexpected-pass` is what keeps the list from becoming the job-level mute it
 * replaced. It fires on a declared scenario that did NOT effectively fail,
 * which includes the case where it failed in parallel and passed its isolated
 * retry -- there is no "expected flaky", so an entry that passes any way at
 * all is an entry to look at.
 *
 * `unexpected-fail` covers BOTH an undeclared failure and a declared scenario
 * that ERRORed. See {@link standingOf} for why the second belongs here.
 */
export type SweepStanding =
  | "ok"
  | "expected-fail"
  | "unexpected-fail"
  | "unexpected-pass";

/**
 * A DECLARATION EXCUSES AN ANSWER, NEVER A CRASH.
 *
 * An expected-failure entry says what a CSMS *replies* -- its `reason` cites a
 * handler, a status mapping, a field that comes back wrong. A scenario that
 * ERRORs never got a reply to be wrong about: the container did not start, a
 * bounded wait gave up, the driver threw. Treating that as the declared
 * failure is how a job goes green on a breakage of a completely different
 * nature from the one it documents -- which is the `continue-on-error`
 * blindness this whole mechanism replaced, narrowed to one scenario but just
 * as blind to the KIND of failure.
 *
 * So `expected-fail` needs the decisive verdict to be exactly FAIL. A declared
 * scenario that errors is an ordinary unexpected failure, and the report says
 * that its declaration is probably still good and the crash is the new thing.
 *
 * The full table, with `d` = decisive verdict ({@link decisiveVerdict}):
 *
 * | declared | effectively failed | d      | standing        |
 * |----------|--------------------|--------|-----------------|
 * | no       | no                 | any    | ok              |
 * | no       | yes                | any    | unexpected-fail |
 * | yes      | yes                | FAIL   | expected-fail   |
 * | yes      | yes                | ERROR  | unexpected-fail |
 * | yes      | no                 | any    | unexpected-pass |
 */
export function standingOf(
  verdict: Verdict,
  expected: ExpectedFailureEntry | undefined,
  retryVerdict?: Verdict,
): SweepStanding {
  const failed = effectivelyFailed(verdict, retryVerdict);
  if (expected === undefined) {
    return failed ? "unexpected-fail" : "ok";
  }
  if (failed) {
    return decisiveVerdict(verdict, retryVerdict) === "FAIL"
      ? "expected-fail"
      : "unexpected-fail";
  }
  // Everything else is an unexpected pass, INCLUDING NOT APPLICABLE. That one
  // is not merely theoretical: check-driver rejects an id declared both ways,
  // but only for a driver that has been checked, and the runtime
  // UnsupportedOperationError escape produces the same contradiction after the
  // fact, when no offline check can have seen it. It is surfaced rather than
  // tolerated because "it never ran" is not "it was fixed" --
  // unexpectedPassDetail() is where the difference gets said.
  return "unexpected-pass";
}

/**
 * Why an unexpected pass is one, in the words a reader needs to tell a fix
 * from a flake from a contradiction from an unmeasured run -- without reading
 * this file.
 *
 * The wording carries real weight, because the action it implies is DELETING A
 * RECORDED FINDING. Only one of the cases below is actually evidence that the
 * CSMS was fixed; saying so for the others would talk a maintainer into
 * throwing away a finding that still holds.
 */
export function unexpectedPassDetail(
  verdict: Verdict,
  retryVerdict?: Verdict,
): string {
  if (verdict === "NOT APPLICABLE") {
    return (
      "it never ran (NOT APPLICABLE) -- the scope table and the " +
      "expected-failure list contradict each other, so the contradiction is " +
      "what to fix, and deleting the entry may be the wrong half"
    );
  }
  if (verdict === "PARTIAL") {
    return (
      "it came back PARTIAL -- at least one check was SKIPPED because the " +
      "driver could not evaluate it, so this is NOT evidence that the finding " +
      "is fixed; find out which check degraded before deleting the entry"
    );
  }
  if (retryVerdict !== undefined && isFailure(verdict)) {
    return (
      `it failed in the parallel lane and ${retryVerdict} on its isolated ` +
      "retry -- either upstream fixed it, or the scenario is flaky and the " +
      "flake is the bug to fix"
    );
  }
  return `it came back ${verdict} outright -- the finding looks fixed`;
}

/**
 * Why a DECLARED scenario is nevertheless an unexpected failure: it errored.
 *
 * Separated from the ordinary failure report because the two need opposite
 * reactions. An undeclared failure is a finding to investigate and perhaps
 * declare; this one almost certainly leaves the declaration intact and points
 * at something new that stopped the scenario reaching the CSMS at all.
 */
export function declaredButErroredDetail(
  verdict: Verdict,
  retryVerdict?: Verdict,
): string {
  const where =
    retryVerdict === undefined
      ? `it came back ${verdict}`
      : `it came back ${verdict} and ${retryVerdict} on its isolated retry`;
  return (
    `${where} -- an expected-failure entry excuses what a CSMS ANSWERS, and ` +
    "an ERROR is the scenario never getting an answer. The declaration is " +
    "probably still good; the crash is the new thing"
  );
}
