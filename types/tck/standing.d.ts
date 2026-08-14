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
export declare function isFailure(verdict: Verdict): boolean;
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
export declare function effectivelyFailed(verdict: Verdict, retryVerdict?: Verdict): boolean;
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
export type SweepStanding = "ok" | "expected-fail" | "unexpected-fail" | "unexpected-pass";
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
export declare function standingOf(verdict: Verdict, expected: ExpectedFailureEntry | undefined, retryVerdict?: Verdict): SweepStanding;
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
export declare function unexpectedPassDetail(verdict: Verdict, retryVerdict?: Verdict): string;
/**
 * Why a DECLARED scenario is nevertheless an unexpected failure: it errored.
 *
 * Separated from the ordinary failure report because the two need opposite
 * reactions. An undeclared failure is a finding to investigate and perhaps
 * declare; this one almost certainly leaves the declaration intact and points
 * at something new that stopped the scenario reaching the CSMS at all.
 */
export declare function declaredButErroredDetail(verdict: Verdict, retryVerdict?: Verdict): string;
