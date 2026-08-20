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
/** That bound, applied. Exported because api-client.ts has a third failure
 *  message built from a body it already holds, and a `slice(0, 300)` there
 *  would be this number written down twice -- with nothing to notice when one
 *  of them moves. */
export declare function preview(text: string): string;
/**
 * The body of a response whose STATUS is already the finding.
 *
 * Best-effort on purpose: an error body that will not stream must not replace
 * the status with a different failure, so a read that fails yields a name for
 * what was there rather than throwing over the finding.
 *
 * NOT SHARED WITH THE OTHER DRIVER, and this is where that gets re-proposed.
 * `drivers/steve/ui-client.ts` holds the same two lines inline, and
 * `drivers/steve/api-client.ts` holds them WITHOUT the `.catch` -- the drift
 * this function exists to stop, live in the tree. Unifying is not a
 * simplification but a deliverable: `tests/generic-core.sh` forbids one driver
 * importing another, so it needs a core home, and a core module owes an
 * `exports` subpath before a third-party driver can reach it at all. Issue #83
 * is where the second consumer arrives; that is the moment to move it, not
 * this branch.
 */
export declare function errorBody(res: Response): Promise<string>;
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
export declare function readAnsweredBody(res: Response, what: string): Promise<{
    text: string;
    parsed: unknown;
}>;
