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
export type ReadinessResult = {
    kind: "ready";
    attempts: number;
    detail: "";
} | {
    kind: "unavailable";
    attempts: number;
    detail: string;
} | {
    kind: "no-answer";
    attempts: number;
    detail: string;
};
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
export declare function waitsOn(err: unknown): boolean;
/**
 * Polls `probe` until the CSMS answers, the driver declines, or the budget
 * runs out.
 *
 * The result is a statement, never a throw: which of the three outcomes ends a
 * run is the runner's decision and it differs between them.
 */
export declare function awaitCsmsReady(probe: () => Promise<unknown>, options: ReadinessOptions): Promise<ReadinessResult>;
/** An error as one line, for a message a human reads once. */
export declare function describeError(err: unknown): string;
