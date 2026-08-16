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
 */
import type { AssertContext, ScenarioSpec } from "./spec-types";
/** The environment this module reads. `process.env`-shaped, and passed in so
 *  the guard can hand it a table row instead of mutating the process. */
export type HoldEnv = Record<string, string | undefined>;
/** Seconds between two attempts to close the window. */
export declare const HOLD_POLL_SECS = 5;
/** The default cap, in seconds, on how far past `holdSecs` a window stretches. */
export declare const DEFAULT_MAX_EXTRA_HOLD_SECS = 30;
/**
 * How far past `holdSecs` the observation window may stretch, in seconds.
 *
 * `OCPP_TCK_MAX_EXTRA_HOLD_SECS` overrides it, and 0 restores the fixed window
 * exactly -- the setting to reach for when a sweep's timing is itself what is
 * being measured.
 *
 * A FLAT number rather than a multiple of `holdSecs`, because what is being
 * waited for is a CSMS finishing a write, and that has no reason to scale with
 * how long a scenario happens to take. It also keeps the worst case
 * arithmetic: a scenario that will fail whatever happens costs this much extra
 * and no more.
 *
 * A value that is not a non-negative number WARNS AND FALLS BACK rather than
 * throwing. Every other knob here degrades to a default, and a sweep is a
 * twelve-minute investment to lose to a typo in an environment variable -- but
 * silence would let that typo read as "the extension is off", so it says so.
 */
export declare function maxExtraHoldSecs(env: HoldEnv, warn?: (message: string) => void): number;
/** What {@link extendObservationWindow} needs of the simulator: the lines
 *  captured so far. Narrower than `SimProcess` on purpose -- this module can
 *  only read the wire, and the type says so. */
export interface WireSoFar {
    readonly lines: readonly string[];
}
/**
 * Would `assert()` pass right now?
 *
 * A THROWAWAY recorder, and the answer is discarded with it: this decides only
 * whether to keep the wire open. The run's real verdict comes from the single
 * pass the runner makes after the simulator has stopped.
 *
 * RUNNING THE SPEC'S OWN ASSERTIONS is what lets the window learn what the
 * scenario is waiting for without any spec saying so -- and the specs are
 * pinned (`tests/spec-invariants.sh`), so a design that needed them to declare
 * it would have moved two committed artifacts to fix a timing bug.
 *
 * Safe to run repeatedly, and that is a property of the contract rather than of
 * today's specs: `AssertContext` carries no `csms` handle, so an assertion can
 * only read -- frames, lines, and `CsmsRecords`, which is documented read-only.
 * The one blocking call in that interface, `waitForActiveTransaction`, is
 * reachable only from `drive()`.
 *
 * A THROW COUNTS AS NOT SATISFIED: an assertion reaching for a row that is not
 * there yet is exactly the state worth waiting through, and the final pass is
 * the one whose error, if any, becomes the scenario's ERROR verdict.
 *
 * WITH ONE EXCEPTION, and it is the difference between "not yet" and "never".
 * `UnsupportedOperationError` is a driver answering that the CSMS cannot do
 * this at all -- `withCapabilityStubs` raises it for an absent reservation or
 * charging-profile registry -- and no amount of waiting turns that into a
 * capability. Treating it like a late row would spend the entire cap on a
 * scenario whose answer arrived with the first attempt, and then report the
 * same error anyway.
 */
export declare function assertionsSatisfiedNow<D>(spec: ScenarioSpec<D>, ctx: Omit<AssertContext<D>, "frames" | "lines" | "rec">, wire: WireSoFar, parseLog: (text: string) => AssertContext<D>["frames"]): Promise<boolean>;
/**
 * Hold the wire open past `holdSecs` while the scenario is still short of
 * something, up to a cap. Returns the seconds actually added.
 *
 * `holdSecs` KEEPS ITS MEANING as the floor: the runner sleeps it in full
 * before calling this, every spec's tuned timing is preserved, and a scenario
 * whose assertions all pass at the floor adds NOTHING -- byte for byte the
 * behaviour that shipped before this module, and the reason a green sweep does
 * not get slower.
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
