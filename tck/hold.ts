// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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
import { AssertRecorder } from "./assert";
import { UnsupportedOperationError, type CsmsEnv } from "./driver";

/** Seconds between two attempts to close the window. */
export const HOLD_POLL_SECS = 5;

/** The default cap, in seconds, on how far past `holdSecs` a window stretches. */
export const DEFAULT_MAX_EXTRA_HOLD_SECS = 30;

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
let memoised: number | undefined;

/**
 * {@link maxExtraHoldSecs} against `process.env`, resolved once per process.
 *
 * Memoised because a mistyped value warns, and the warning belongs to the
 * setting rather than to each of the 47 scenarios that reads it -- 47
 * identical lines is how a real warning stops being read.
 */
export function resolvedMaxExtraHoldSecs(
  warn: (message: string) => void,
): number {
  memoised ??= maxExtraHoldSecs(process.env, warn);
  return memoised;
}

export function maxExtraHoldSecs(
  env: CsmsEnv,
  warn: (message: string) => void = () => {},
): number {
  const raw = env.OCPP_TCK_MAX_EXTRA_HOLD_SECS?.trim();
  if (!raw) return DEFAULT_MAX_EXTRA_HOLD_SECS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    warn(
      `OCPP_TCK_MAX_EXTRA_HOLD_SECS="${raw}" is not a non-negative number -- ` +
        `using the default ${DEFAULT_MAX_EXTRA_HOLD_SECS}s.`,
    );
    return DEFAULT_MAX_EXTRA_HOLD_SECS;
  }
  return n;
}

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
export function capReachedMessage(templateId: string, cap: number): string {
  return (
    `observation window for ${templateId} reached its +${cap}s cap with ` +
    "assertions still short -- reporting what is on the wire. If this is a " +
    "real finding the cap cost nothing; if it is not, the cap is the number " +
    "to raise (OCPP_TCK_MAX_EXTRA_HOLD_SECS)."
  );
}

export function heldMessage(
  templateId: string,
  holdSecs: number,
  extra: number,
): string {
  return (
    `held ${templateId} for ${holdSecs}+${extra}s -- assertions were still ` +
    "short at the floor"
  );
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
 * scenario whose answer arrived with the first attempt.
 *
 * `"impossible"` STOPS THE WINDOW WITHOUT RAISING, and the distinction is not
 * cosmetic. Raising from here would leave `runScenario` through the one `try`
 * whose `finally` only stops the container -- so the run would skip the write
 * of `results/<template-id>.log`, which is the only surviving record of the
 * wire once that container is removed. Stopping instead lets the run reach its
 * own assert pass, which raises the identical error with the log already on
 * disk. Same ERROR verdict, same message, the evidence kept.
 */
type Readiness = "satisfied" | "short" | "impossible";

async function assertionsSatisfiedNow<D>(
  spec: ScenarioSpec<D>,
  ctx: Omit<AssertContext<D>, "frames" | "lines" | "rec">,
  wire: WireSoFar,
  parseLog: (text: string) => AssertContext<D>["frames"],
): Promise<Readiness> {
  const lines = [...wire.lines];
  const rec = new AssertRecorder();
  try {
    await spec.assert({ ...ctx, frames: parseLog(lines.join("\n")), lines, rec });
  } catch (err) {
    return err instanceof UnsupportedOperationError ? "impossible" : "short";
  }
  return rec.failed === 0 ? "satisfied" : "short";
}

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
export async function extendObservationWindow<D>(
  spec: ScenarioSpec<D>,
  ctx: Omit<AssertContext<D>, "frames" | "lines" | "rec">,
  wire: WireSoFar,
  parseLog: (text: string) => AssertContext<D>["frames"],
  maxExtraSecs: number,
  sleep: (ms: number) => Promise<void>,
  onCapReached: (secs: number) => void = () => {},
): Promise<number> {
  if (maxExtraSecs <= 0) return 0;
  let extra = 0;
  for (;;) {
    if ((await assertionsSatisfiedNow(spec, ctx, wire, parseLog)) !== "short") {
      return extra;
    }
    if (extra >= maxExtraSecs) {
      onCapReached(maxExtraSecs);
      return extra;
    }
    const step = Math.min(HOLD_POLL_SECS, maxExtraSecs - extra);
    await sleep(step * 1000);
    extra += step;
  }
}
