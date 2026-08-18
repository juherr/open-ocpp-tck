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
/**
 * The same five, enumerable -- for the readers that have to recognise a verdict
 * in text rather than receive one. `results/summary.md` renders the verdict into
 * a cell that may carry free prose after it, so every tool that mines that table
 * needs the list to match a prefix against.
 *
 * Here rather than in each of them, for the reason this file gives about every
 * other rule it holds: written twice they would drift, and a tool that disagreed
 * with the sweep which wrote the table is the worst place for it. Annotating it
 * `readonly Verdict[]` is what makes that mechanical -- measured, not supposed:
 * renaming `FAIL` in the union above fails the typecheck ON THIS LITERAL, so the
 * list cannot fall out of step with the type, and every consumer then follows
 * the rename by holding no copy of its own. A list spelled out in a shell script
 * or an awk program has neither half of that.
 */
export declare const VERDICTS: readonly Verdict[];
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
 * `declared-but-errored` is the fifth, and it earns a member of its own rather
 * than hiding inside `unexpected-fail`: README.md and CONTRIBUTING.md both name
 * it, the sweep reports it on its own line, and the reaction it calls for is
 * the opposite one -- keep the entry, chase the crash. Expressed as
 * "`unexpected-fail` AND a declaration is present" it was a conjunct living in
 * a filter, so two call sites asking the same-looking question ten lines apart
 * quietly got different sets.
 */
export type SweepStanding = "ok" | "unexpected-fail" | DeclaredStanding;
/**
 * The standings that imply the driver declared this scenario. Split out so the
 * implication is a type rather than a sentence: a helper that filters outcomes
 * by one of these can promise the declaration is there, and the compiler
 * checks the promise instead of a reader checking a comment.
 */
export type DeclaredStanding = "expected-fail" | "declared-but-errored" | "unexpected-pass";
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
 * | yes      | yes                | ERROR  | declared-but-errored |
 * | yes      | no                 | any    | unexpected-pass |
 */
export declare function standingOf(verdict: Verdict, expected: ExpectedFailureEntry | undefined, retryVerdict?: Verdict): SweepStanding;
/** The standings that make the process exit non-zero. Exported so no caller
 *  has to rebuild the disjunction and forget a member -- which is exactly what
 *  happened while `declared-but-errored` was hiding inside `unexpected-fail`. */
export declare function endsTheBuild(standing: SweepStanding): boolean;
/**
 * WHICH KIND of unexpected pass, as a value rather than as prose.
 *
 * `standingOf` collapses four genuinely different situations onto one
 * `unexpected-pass`, and only ONE of them is evidence that the CSMS was fixed.
 * Since the action the report implies is DELETING A RECORDED FINDING, that
 * distinction is the load-bearing part -- so it is computed here, from the
 * same two inputs, and {@link unexpectedPassDetail} is a rendering of it.
 *
 * Splitting it out is what lets a guard assert the distinction as a table.
 * Asserting the SENTENCES instead was tried and does not work: a guard that
 * greps for "looks fixed" passes happily when the degraded case is reworded to
 * say "looks resolved", which is the very defect it was meant to catch.
 */
export type UnexpectedPassKind = "fixed" | "degraded" | "never-ran" | "flaky";
export declare function unexpectedPassKind(verdict: Verdict, retryVerdict?: Verdict): UnexpectedPassKind;
/**
 * Why an unexpected pass is one, in the words a reader needs to tell a fix
 * from a flake from a contradiction from an unmeasured run -- without reading
 * this file.
 *
 * A rendering of {@link unexpectedPassKind}, and nothing more: the decision is
 * there, where it can be checked; the prose is here, where it cannot.
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
