/**
 * hold.ts -- how long the runner watches the wire after drive() is done.
 *
 * `drive()` can wait for a condition (`waitForCondition`, wait.ts); `assert()`
 * never could. It read a log captured over a window fixed before the run
 * started, so a CSMS frame -- or a CSMS database write -- landing after that
 * window closed failed the scenario AS A CONFORMANCE FINDING, indistinguishable
 * from a CSMS that never produced it at all.
 *
 * Measured across 41 archived sweeps before this module existed: five scenarios
 * did that repeatedly, the worst in 16 runs out of 21, and every one of them
 * failed exactly the same count of checks every time. The isolated retry
 * adjudicated all of them as non-failures, which is the runner already saying,
 * in its own vocabulary, that the window and not the CSMS was the variable.
 *
 * A MODULE OF ITS OWN, like standing.ts and for the same reason: what it
 * decides is unreachable from the CLI. Exercising it through `ocpp-tck run`
 * would cost a container, a CSMS, and a CSMS engineered to answer late --
 * where the rule itself is a table, and `tests/observation-window.ts` reads it
 * as one.
 *
 * TRIED AND REJECTED: reusing `waitForCondition` (wait.ts) for the loop below.
 * It is the most predictable review comment on this file, so here is the
 * measurement rather than the argument again. Three of its properties are
 * wrong here and each is deliberate over there: it THROWS on exhaustion, where
 * reaching the cap is a normal outcome this runner reports and continues past;
 * it reads `Date.now()` and calls `setTimeout` itself, where the whole premise
 * of the guard is a fake clock; and it returns the predicate's value, where
 * the runner needs the elapsed seconds it stores and prints. Generalising
 * `waitForCondition` to cover both would widen `WaitForConditionOptions`,
 * which `tck/index.ts` publishes to driver authors, for about ten lines of
 * shared `for(;;)`. What is left in common is the shape of a loop, not a rule.
 */
import type { AssertContext, ScenarioSpec } from "./spec-types";
import { type CsmsEnv } from "./driver";
/** Seconds between two attempts to close the window. */
export declare const HOLD_POLL_SECS = 5;
/** The default cap, in seconds, on how far past `holdSecs` a window stretches. */
export declare const DEFAULT_MAX_EXTRA_HOLD_SECS = 30;
/**
 * {@link maxExtraHoldSecs} against `process.env`, resolved once per process.
 *
 * Memoised because a mistyped value warns, and the warning belongs to the
 * setting rather than to each of the 47 scenarios that reads it -- 47
 * identical lines is how a real warning stops being read.
 */
export declare function resolvedMaxExtraHoldSecs(warn: (message: string) => void): number;
export declare function maxExtraHoldSecs(env: CsmsEnv, warn?: (message: string) => void): number;
/** What {@link extendObservationWindow} needs of the simulator: the lines
 *  captured so far. Narrower than `SimProcess` on purpose -- this module can
 *  only read the wire, and the type says so. */
export interface WireSoFar {
    readonly lines: readonly string[];
}
/**
 * What the runner prints when a window closes at its cap, and when one closed
 * late.
 *
 * HERE RATHER THAN AT THE CALL SITE, which is `tck/main.ts` -- a vendored
 * `upstream-patched` file whose diff against upstream every re-pin re-records
 * and every reviewer re-reads. `tck/standing.ts` already sets this shape:
 * `unexpectedPassDetail` and `declaredButErroredDetail` keep the prose beside
 * the rule it explains, and the runner just calls them.
 */
export declare function capReachedMessage(templateId: string, cap: number): string;
export declare function heldMessage(templateId: string, holdSecs: number, extra: number): string;
/**
 * Hold the wire open past `holdSecs` while the scenario is still short of
 * something, up to a cap. Returns the seconds actually added.
 *
 * `holdSecs` KEEPS ITS MEANING as the floor: the runner sleeps it in full
 * before calling this, every spec's tuned timing is preserved, and a scenario
 * whose assertions all pass at the floor adds NO WAITING -- the reason a green
 * sweep does not get slower on the clock.
 *
 * IT DOES ADD WORK, and "adds nothing" was the wrong word for it. Every
 * scenario now runs `assert()` once more than it used to, and a struggling one
 * runs it up to eight times. `records` is driver-supplied, so those are real
 * queries against the CSMS: 35 of them across the 17 scenarios whose
 * assertions read the database, on a sweep where nothing extends. On a driver
 * whose records go through `docker exec` that is ~1-2% of a sweep's wall
 * clock; on one that goes over HTTP it is less. Measured, stated, and accepted
 * -- but a green sweep that got slower is not evidence against this module,
 * and the guard counts sleeps, so it cannot see this.
 *
 * A NEGATIVE ASSERTION CANNOT BE WEAKENED HERE. The window only ever grows, so
 * "no StartTransaction was sent" gets longer to observe a violation and never
 * less. The honest converse, which is a change and not a regression: if some
 * OTHER check is still failing at the floor and a violating frame arrives
 * during the extension, the scenario now goes red where it used to go green.
 * That is a violation this suite was missing, and it cannot reach a scenario
 * that was already green at the floor, because that one never extends.
 */
export declare function extendObservationWindow<D>(spec: ScenarioSpec<D>, ctx: Omit<AssertContext<D>, "frames" | "lines" | "rec">, wire: WireSoFar, parseLog: (text: string) => AssertContext<D>["frames"], maxExtraSecs: number, sleep: (ms: number) => Promise<void>, onCapReached?: (secs: number) => void): Promise<number>;
