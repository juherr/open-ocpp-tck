// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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

/**
 * What `waitForCondition` throws when the deadline passes.
 *
 * A type rather than a message, because a caller that wants to tell "the thing
 * never appeared" from "the query itself is broken" would otherwise have to
 * match on prose -- and the prose belongs to this file. `driver selftest` makes
 * exactly that distinction.
 */
export class WaitTimeoutError extends Error {
  readonly name = "WaitTimeoutError";
}

export async function waitForCondition<T>(
  check: () => Promise<T | undefined | null | false | "">,
  options: WaitForConditionOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const description = options.description ?? "condition";
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(
        `timed out after ${timeoutMs}ms waiting for: ${description}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
