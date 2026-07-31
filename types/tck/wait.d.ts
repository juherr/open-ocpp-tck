/**
 * wait.ts -- poll an async predicate until it is truthy, or give up loudly.
 *
 * Rejecting on timeout rather than returning a falsy value is deliberate, and
 * it is inherited from the bash harness this was ported from: there,
 * wait_for_condition killed the whole run. Letting the rejection propagate out
 * of a spec's drive() reproduces that.
 *
 * The alternative -- returning "" and letting the caller carry on -- is worse
 * than it looks: the empty value flows into an assertion, the assertion fails
 * for the wrong reason, and the report blames the CSMS for a gate that never
 * opened.
 */
export interface WaitForConditionOptions {
    /** Total time budget, ms (default 15000). */
    timeoutMs?: number;
    /** Delay between polls, ms (default 1000). */
    intervalMs?: number;
    /** Included in the timeout error message. */
    description?: string;
}
export declare function waitForCondition<T>(check: () => Promise<T | undefined | null | false | "">, options?: WaitForConditionOptions): Promise<T>;
