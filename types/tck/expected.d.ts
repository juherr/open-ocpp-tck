/**
 * expected.ts -- the TYPE of a driver's expected-failure list, and the drift
 * checks that keep it honest. The DATA lives in each driver
 * (drivers/<id>/expected.ts): which scenarios a CSMS gets wrong is a fact about
 * that CSMS, not about this harness.
 *
 * WHY THIS IS NOT A SCOPE STATUS. {@link ./scope} answers "can this CSMS drive
 * the scenario at all?", and its rules forbid demoting a row to
 * NOT_APPLICABLE to make a red scenario go away -- that converts a finding
 * about the CSMS into a silence about the harness. This file answers the other
 * question: the scenario IS drivable, it runs, it prints FAIL, and we already
 * know why. The row stays DRIVABLE; only the exit code changes.
 *
 * WHAT IT REPLACES. Before it, the only vocabulary for "we know this one is
 * red" was `continue-on-error` on the whole CI job -- job-granular where the
 * intent is scenario-granular. A broken compose file, a failed provisioning
 * step and a regression from one failure to twenty were all as green as the
 * finding the job was muted for, so the job could not report the one thing it
 * existed to report: every OTHER scenario.
 *
 * THE LIST HAS TO BE ABLE TO SHRINK, or it is just a quieter mute. So an
 * expected failure that PASSES is itself a failure -- reported as
 * UNEXPECTED PASS, with a non-zero exit -- which is how a row gets deleted
 * when upstream fixes the defect, instead of outliving it.
 *
 * WHAT AN ENTRY DOES NOT EXCUSE: a crash. It says what a CSMS *answers* --
 * its `reason` cites a handler, a status mapping, a field that comes back
 * wrong -- and a scenario that ERRORs never got an answer to be wrong about.
 * So a declared scenario that errors still fails the sweep, and is reported
 * separately from an ordinary failure because the entry is probably still good
 * and the crash is the new thing. The rule is {@link ./standing}'s
 * `standingOf`, and `tests/expected-failure-standing.ts` asserts the table.
 *
 * RULES FOR A DRIVER AUTHOR EDITING ITS LIST
 *  - `reason` names the mechanism, cited, the way a scope row's does. "Fails
 *    on this CSMS" is not a reason; it is the observation being explained.
 *  - `finding` says where the finding is written down -- an upstream issue, or
 *    the row of the driver README's gap table that carries the evidence. A
 *    known-red with nowhere to read about it is a claim nobody can review, and
 *    it is the shape this list rots into if the field is optional.
 *  - NEVER add a row to quiet a flake. A scenario that sometimes passes has a
 *    timing bug, and the fix is the scenario. There is deliberately no
 *    "expected flaky" status here: it would re-create the job-level mute one
 *    scenario at a time.
 */
import type { ScopeTable } from "./scope";
export interface ExpectedFailureEntry {
    /** The mechanism, cited. Not "known red" -- WHY it is red. */
    reason: string;
    /**
     * Where the finding is recorded: an upstream issue URL, or the driver
     * README's gap-table row. Required, and checked non-empty by
     * `ocpp-tck check-driver`.
     */
    finding: string;
}
/** One entry per scenario `templateId` this CSMS is known to fail. */
export type ExpectedFailureTable = Readonly<Record<string, ExpectedFailureEntry>>;
export declare function expectedFailureFor(table: ExpectedFailureTable | undefined, templateId: string): ExpectedFailureEntry | undefined;
/**
 * Everything about a list that can be established WITHOUT running anything.
 *
 * Four kinds, and each is a way the list stops meaning what it says:
 *
 * `stale` -- an id nobody registers. Usually a rename, and it silently stops
 * excusing anything; the scenario it was written for now fails the build under
 * its new name, which at least is loud. The reverse of the same rename is not:
 * a row kept under the OLD id while the scenario is fixed under the new one
 * never gets the UNEXPECTED PASS that would delete it.
 *
 * `notApplicable` -- the scope table says the scenario never runs on this
 * CSMS, and this list says it runs and fails. Both cannot be true. Left
 * unchecked it is the quiet way a driver ends up with a row that can never
 * fire and can never be cleaned up, because the only thing that deletes a row
 * is the scenario passing, and a scenario that never starts never passes.
 *
 * `reasonless` / `findingless` -- see the rules in this file's header.
 *
 * What it deliberately CANNOT check is whether the scenario actually fails.
 * Only a sweep knows that, and it is the sweep that reports UNEXPECTED PASS.
 */
export declare function expectedFailureCoverage(table: ExpectedFailureTable, scope: ScopeTable | undefined, registeredTemplateIds: readonly string[]): {
    stale: string[];
    notApplicable: string[];
    reasonless: string[];
    findingless: string[];
};
