// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * readiness.ts -- does the CSMS answer the driver contract AT ALL, as a
 * bounded wait over one cheap read.
 *
 * WHAT THE GATE MEASURES. Every scenario's `assert()` reads its verdict out of
 * the `CsmsRecords` contract, and both bundled drivers route `prepareStation`
 * through
 * the same client. So "the record path answers" is not one property among
 * many: it is a precondition of every verdict a sweep produces. A sweep whose
 * record path is dead does not report a CSMS that failed conformance -- it
 * reports 80 rows that measured nothing, one container each. That is the shape
 * `preflight()` in main.ts exists to convert into a single refusal, stated in
 * its own words two hundred lines above where this is called: a per-scenario
 * complaint about a process-wide fact is one cause rendered as a table nobody
 * can act on.
 *
 * WHAT IT IS NOT, AND THIS IS THE PART WORTH READING BEFORE EXTENDING IT.
 * This is not a warm-up gate, and it does not fix a sweep whose middle goes
 * red. Issue #119 proposed exactly that -- "the first batch races the CSMS's
 * warm-up" -- and the artifact it cites says otherwise. In run 33983705032 the
 * sweep began at 18:21:29; the three scenarios that failed were the
 * forty-ninth, fiftieth and fifty-first it started, dispatched at 18:32:30 --
 * ELEVEN MINUTES in, against a CSMS whose captured log holds one boot, no
 * restart, and forty-eight scenarios' worth of traffic before them.
 *
 * The CSMS's own log then contradicts the class the failure was reported
 * under. Both requests that "never reached the CSMS" reached it: they are
 * logged arriving, being authenticated, and being AUTHORIZED at 18:32:35. What
 * follows is twenty-nine seconds in which that process logs nothing but two
 * websocket closes -- so it was demonstrably alive, and those two are the
 * runner's own 15s timeouts tearing the simulators down at 18:32:50 -- and
 * then, at 18:33:04, an identical request from the third lane travelling all
 * the way to the broker in five milliseconds. The third
 * lane had meanwhile failed to see its BootNotification.conf inside 30s. So:
 * one live stall, spanning the HTTP API and the websocket alike, on three
 * simultaneous station reconnects, eleven minutes into a healthy run.
 *
 * A gate that runs once before the first container cannot see that, delay it,
 * or prevent it. It would have passed instantly at 18:21:29 and changed
 * nothing about 18:32:35.
 *
 * So a reader arriving here to make this gate re-run per batch, or to widen it
 * until it catches that flake, is re-proposing a fix for a fault it is the
 * wrong shape for. The measurement is above; the fault needs its own issue.
 *
 * WHY THE RULE IS A MODULE OF ITS OWN, the same split `standing.ts` and
 * `classifyForeignSims` are. Reaching its branches through the CLI needs a
 * CSMS engineered a chosen way -- one that accepts a connection and never
 * answers, one whose driver declines a core method, one whose probe hangs
 * forever -- and each row would cost a container and a misconfiguration to
 * stage. Here the probe and the clock are arguments, so
 * `tests/csms-readiness-gate.ts` can assert the whole sequence offline,
 * including the ordering that matters: which rejections are waited on and
 * which are not.
 *
 * THE NUMBERS ARE NOT HERE. How long to believe in a CSMS that is not
 * answering is a policy about a deployment, and the runner owns it next to the
 * refusal it prints -- see CSMS_READY_TIMEOUT_MS in main.ts.
 */
import { CsmsNotDispatchedError } from "./driver";

/**
 * The clock the wait runs on, injected.
 *
 * TWO TIMERS AND NOT ONE, because they answer different questions and a guard
 * has to be able to fire one without the other: {@link pause} is the gap
 * between attempts, {@link deadline} is the bound on a single attempt that
 * keeps a probe which never settles from becoming a runner that never returns.
 * A fake keyed on the millisecond argument instead would collide the moment
 * the remaining budget happened to equal the interval, which it does on the
 * last attempt of any budget that is a whole multiple of it.
 */
export interface ReadinessClock {
  /** Milliseconds since an arbitrary epoch; only differences are read. */
  now(): number;
  /** Resolves after `ms` -- the gap between two attempts. */
  pause(ms: number): Promise<void>;
  /** Resolves after `ms` -- the bound on ONE attempt. Must never reject. */
  deadline(ms: number): Promise<void>;
}

export interface ReadinessOptions {
  /** Total budget for the whole gate, ms. */
  timeoutMs: number;
  /** Gap between attempts, ms. */
  intervalMs: number;
  clock: ReadinessClock;
}

/**
 * What the gate concluded.
 *
 * THREE OUTCOMES AND NOT TWO. `unavailable` is the one that is easy to leave
 * out and is the reason the gate can be enabled for every driver at all: the
 * contract's optional halves are declared by omission, a driver is entitled to
 * decline a method, and a driver whose `create()` demands a credential the
 * operator has not set must not have that turned into a refusal by a check
 * that exists to be cheap. `unavailable` says the gate learned nothing and the
 * run proceeds exactly as it would have without it.
 */
export type ReadinessResult =
  | { kind: "ready"; attempts: number; detail: "" }
  | { kind: "unavailable"; attempts: number; detail: string }
  | { kind: "no-answer"; attempts: number; detail: string };

/**
 * Which rejections the gate is willing to WAIT on.
 *
 * Exactly one: {@link CsmsNotDispatchedError}, which is the class both bundled
 * drivers reserve for "this request got no answer" -- a refused connection, a
 * transport timeout, a non-2xx. It is the only rejection that a later attempt
 * could plausibly answer differently, so it is the only one worth spending the
 * budget on.
 *
 * EVERYTHING ELSE IS `unavailable`, AND THAT IS THE SAME LINE `op-warn.ts`
 * DRAWS, read from the other side. There, `CsmsNotDispatchedError` is the one
 * class that escapes and everything else warns; here it is the one class that
 * waits and everything else stops the gate. A driver that declines the probe
 * throws `UnsupportedOperationError`, a driver whose `create()` cannot build a
 * client throws whatever it likes, and a CSMS that answered something the
 * driver could not read throws a plain `Error` -- in all three the CSMS is
 * either reachable or unreachable for a reason waiting will not change, and
 * the gate has no business judging it. Judging it would make this a second,
 * weaker conformance check running before the real one.
 */
export function waitsOn(err: unknown): boolean {
  return err instanceof CsmsNotDispatchedError;
}

/** One attempt's answer, before the gate decides what to do with it. */
type Attempt =
  | { kind: "answered" }
  | { kind: "failed"; error: unknown }
  | { kind: "deadline" };

/**
 * Runs `probe` once, abandoned if it outlives `budgetMs`.
 *
 * ABANDONED RATHER THAN CANCELLED, because the contract gives no method an
 * AbortSignal and inventing one for this would be a contract change in service
 * of a preflight. The rejection of an abandoned probe is swallowed so that a
 * driver whose client eventually times out does not take the process down with
 * an unhandled rejection several seconds after the gate has already reported.
 */
async function attemptOnce(
  probe: () => Promise<unknown>,
  budgetMs: number,
  clock: ReadinessClock,
): Promise<Attempt> {
  const running = probe().then(
    (): Attempt => ({ kind: "answered" }),
    (error: unknown): Attempt => ({ kind: "failed", error }),
  );
  // `running` folds the rejection into a value, so it never rejects itself:
  // that is what makes losing the race harmless. A `Promise.race` over the raw
  // `probe()` would leave a rejection nobody is listening to once the deadline
  // has won -- reported as an unhandled rejection seconds after the gate has
  // already said its piece, and blamed on whatever was running by then.
  return await Promise.race([
    running,
    clock.deadline(budgetMs).then((): Attempt => ({ kind: "deadline" })),
  ]);
}

/**
 * Polls `probe` until the CSMS answers, the driver declines, or the budget
 * runs out.
 *
 * The result is a statement, never a throw: which of the three outcomes ends a
 * run is the runner's decision and it differs between them.
 */
export async function awaitCsmsReady(
  probe: () => Promise<unknown>,
  options: ReadinessOptions,
): Promise<ReadinessResult> {
  const { timeoutMs, intervalMs, clock } = options;
  const started = clock.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const remaining = timeoutMs - (clock.now() - started);
    const attempt = await attemptOnce(probe, remaining, clock);
    if (attempt.kind === "answered") {
      return { kind: "ready", attempts, detail: "" };
    }
    if (attempt.kind === "deadline") {
      return {
        kind: "no-answer",
        attempts,
        detail: `the probe did not settle within the remaining ${remaining}ms`,
      };
    }
    const detail = describeError(attempt.error);
    if (!waitsOn(attempt.error)) {
      return { kind: "unavailable", attempts, detail };
    }
    // The check is "is there room for another attempt AFTER the gap", not "is
    // the budget spent": sleeping the gap and then probing past the deadline
    // would report a bound the gate does not keep.
    if (clock.now() - started + intervalMs >= timeoutMs) {
      return { kind: "no-answer", attempts, detail };
    }
    await clock.pause(intervalMs);
  }
}

/** An error as one line, for a message a human reads once. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
