// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * http.ts -- what both CitrineOS clients do with a response they already know
 * the CSMS answered.
 *
 * ONE RULE, ONE PLACE. The message API and the data API classify their
 * FAILURES differently -- one reads a status as proof that nothing went on the
 * wire, the other has an endpoint that reports a refusal with one -- and that
 * difference is real, so it stays at the call sites. What they must not differ
 * about is the half after the status has been accepted: from there the request
 * WAS answered, so whether it dispatched is unknown, every failure is a plain
 * `Error`, and none of them may be a {@link CsmsNotDispatchedError}. See that
 * class for why claiming one you did not observe is as wrong as missing one.
 *
 * It was two copies for one commit, and they were already drifting when they
 * were written: the body read sat inside the `fetch` try on one client and
 * outside it on the other, so the same stalled stream was a driver error here
 * and a raw abort naming nothing there.
 */

/** How much of a body a failure message carries. Enough to recognise a proxy
 *  page or a stack trace, short enough to read in a run log. */
const BODY_PREVIEW = 300;

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The body of a response whose STATUS is already the finding.
 *
 * Best-effort on purpose: an error body that will not stream must not replace
 * the status with a different failure, so a read that fails yields a name for
 * what was there rather than throwing over the finding.
 */
export async function errorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "<unreadable body>");
  return text.slice(0, BODY_PREVIEW);
}

/**
 * The body of a response the CSMS answered acceptably, read and parsed.
 *
 * `what` names the request -- a URL for the message API, an endpoint for the
 * data API -- and is what makes either failure below traceable to a call.
 *
 * Both throws are plain `Error`s, and that is the point of this function
 * existing rather than being inlined twice: a stalled stream and a body that
 * will not parse are the same case, and it is the case a driver must not claim
 * a non-dispatch for.
 */
export async function readAnsweredBody(
  res: Response,
  what: string,
): Promise<{ text: string; parsed: unknown }> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new Error(
      `${what} answered ${res.status} but its body could not be read: ${reason(err)}`,
    );
  }

  try {
    return { text, parsed: JSON.parse(text) as unknown };
  } catch {
    throw new Error(
      `${what} returned unparseable body: ${text.slice(0, BODY_PREVIEW)}`,
    );
  }
}
