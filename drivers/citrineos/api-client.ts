// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * api-client.ts -- CitrineOS's message API, which is a plain JSON POST.
 *
 * No authentication is sent, and that is not an omission. CitrineOS's shipped
 * `docker` app-env selects `LocalBypassAuthProvider`
 * (apps/ocpp-server/src/config/envs/docker.ts, util.authProvider.localByPass),
 * whose ApiAuthPlugin hook returns success for every request and synthesises an
 * admin principal -- it even logs a warning to that effect on startup. Adding a
 * header here would be theatre. A deployment that swapped in the OIDC provider
 * would need a real token, and that is a change to this file, not a setting.
 *
 * WHERE THE THROW LINE IS
 * -----------------------
 * The contract forbids throwing for an OCPP-level outcome: a `Rejected`
 * CALLRESULT, a CALLERROR, or silence are all normal returns, because every
 * scenario asserts on the simulator's captured wire log rather than on this
 * call. That is not the same as never throwing.
 *
 * CitrineOS answers HTTP 200 with `[{"success": false, "payload": "..."}]` for
 * several failures where NOTHING REACHED THE WIRE -- an unknown station id, a
 * `connectorId <= 0` on TriggerMessage, a schema rejection inside
 * sendLocalList's persistence step. Those are request failures wearing a 200,
 * and swallowing them would report a scenario as having driven an operation it
 * never drove. So `success: false` throws, and the payload travels with it.
 *
 * WHICH THROWS ARE NON-DISPATCHES
 * -------------------------------
 * `warnOpFailed` warns and continues on every error but
 * {@link CsmsNotDispatchedError}, which it lets out so the scenario ERRORs, and
 * the line between the two runs through this file. The rule here is one fact
 * about CitrineOS: IT ANSWERS 200 FOR EVERYTHING THAT REACHES ITS OCPP LAYER --
 * an Accepted, a Rejected, a CALLERROR, silence. So a non-2xx means nothing
 * went on the wire, whatever the status, and no per-status arbitration is
 * needed or would be honest.
 *
 * That includes 404, which is the one worth saying out loud, because it is also
 * what an action with no route looks like. It is NOT
 * `UnsupportedOperationError`: requests.ts already throws that for the actions
 * this driver knows are unrouted, BEFORE the request is built, and scope.ts
 * declares them where `check-driver` reads them offline. A 404 that survives
 * both is not a statement about an API surface -- it is evidence that the route
 * model or the deployment is wrong, and `UnsupportedOperationError` would file
 * that as NOT APPLICABLE at exit 0, turning a wrong CITRINE_API_URL into 47
 * scenarios that quietly never ran. Issue #80 settles this.
 *
 * The `success: false` confirmation above is a non-dispatch too, and the one
 * that wears a 200. It is the same statement its message has always made --
 * "was not dispatched" -- finally in the class the runner recognises. It is
 * also the widest of these: an unknown station id or a `connectorId <= 0` used
 * to WARN and carry on, and now ends the scenario.
 *
 * The other half is what stays a plain `Error`: a 2xx whose body stalls, one
 * that will not parse, one that is not a confirmation array. THE REQUEST WAS
 * ANSWERED in all three, so whether it dispatched is unknown -- and a driver may
 * not claim what it cannot tell. That half is what stops this being a blanket
 * conversion, and it is the half worth a guard.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../../tck/driver";
import type { CitrineConfig } from "./config";
import type { CitrineRequest } from "./requests";

const DEFAULT_TIMEOUT_MS = 15_000;

/** CitrineOS's IMessageConfirmation, as it comes back on the wire. */
interface MessageConfirmation {
  success?: boolean;
  payload?: unknown;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  // JSON.stringify returns undefined -- not the string "undefined" -- for
  // undefined, a function or a symbol. A confirmation carrying no payload is
  // exactly that case, and letting it through emptied the failure message of
  // its only detail. String() keeps a name for the thing that was there.
  return JSON.stringify(value) ?? String(value);
}

export class CitrineMessageApi {
  /**
   * The `fetch` seam exists so `tests/citrineos-transport-classification.ts`
   * can serve each failure above from a closure. Every branch this file
   * classifies needs a CSMS engineered to refuse a request a chosen way -- a
   * 503, a body that will not parse -- and neither bundled CSMS can be asked
   * for one.
   *
   * The default reads the global PER CALL rather than capturing it at
   * construction, so a driver built before something replaces `fetch` still
   * uses the replacement.
   */
  constructor(
    private readonly cfg: CitrineConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private url(req: CitrineRequest, cpId: string): string {
    const query = new URLSearchParams({
      identifier: cpId,
      tenantId: String(this.cfg.tenantId),
    });
    return `${this.cfg.apiUrl}/ocpp/${req.ocppVersion}/${req.module}/${req.action}?${query}`;
  }

  /**
   * Dispatches one operation and returns a receipt for the run log.
   *
   * The receipt is the confirmation array, serialised. Specs must not branch on
   * it -- it exists so that a human reading results/ can tell a dispatched
   * operation from one the CSMS quietly reshaped, which for GetConfiguration it
   * genuinely does (see the batching note below).
   */
  async send(cpId: string, req: CitrineRequest): Promise<string> {
    const url = this.url(req, cpId);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // JSON.stringify preserves insertion order, which requests.ts relies
        // on for SendLocalList -- see the key-order note there.
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CsmsNotDispatchedError(
        `citrineos: POST ${url}`,
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!res.ok) {
      // A 404 here is worth calling out by name, because it is what an
      // unrouted action looks like: CitrineOS skips route registration
      // entirely when no schema exists for the version, so an operation it
      // does not support is indistinguishable from a typo in the path unless
      // the message says so. The version is named because that is half the
      // question -- the same action is routed for one protocol and not the
      // other often enough that "which one did we ask for" is the first thing
      // a reader needs.
      const hint =
        res.status === 404
          ? ` -- no OCPP ${req.ocppVersion} route is registered for this action on this CitrineOS version`
          : "";
      // Best-effort, because the status is the finding and an error body that
      // will not stream must not replace it with a different failure.
      const body = await res.text().catch(() => "<unreadable body>");
      throw new CsmsNotDispatchedError(
        `citrineos: POST ${url}`,
        `returned ${res.status}${hint}: ${body.slice(0, 300)}`,
      );
    }

    // PAST THIS POINT THE REQUEST WAS ANSWERED, and every failure below is a
    // plain Error for that one reason. The body read is here rather than beside
    // the fetch because a 200 whose stream then stalls -- the timeout covers it
    // too -- is the same case as a body that will not parse: the CSMS began
    // answering, so whether it dispatched is unknown, and a driver may not
    // claim what it cannot tell.
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new Error(
        `citrineos: POST ${url} answered ${res.status} but its body could not ` +
          `be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `citrineos: POST ${url} returned unparseable body: ${text.slice(0, 300)}`,
      );
    }

    // One confirmation per identifier -- except GetConfiguration, which
    // CitrineOS splits into batches of GetConfigurationMaxKeys and confirms
    // once per batch. So "exactly one" is not a property to assert on.
    //
    // `null` and a bare scalar are both valid JSON and neither is a
    // confirmation. Wrapping them without checking made the success test below
    // read `.success` off them, so a null body crashed with a TypeError naming
    // no URL instead of reporting the response it could not understand.
    const confirmations: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const isConfirmation = (c: unknown): c is MessageConfirmation =>
      typeof c === "object" && c !== null;

    if (!confirmations.every(isConfirmation)) {
      throw new Error(
        `citrineos: POST ${url} returned a body that is not a confirmation array: ${text.slice(0, 300)}`,
      );
    }

    const refused = confirmations.filter((c) => c.success !== true);
    if (refused.length > 0) {
      // The one non-dispatch that wears a 200, and the only failure here whose
      // message names the operation rather than the URL -- the request reached
      // CitrineOS, so what a reader needs is which operation it refused to put
      // on the wire, not where it was posted.
      throw new CsmsNotDispatchedError(
        `citrineos: ${req.module}/${req.action} for ${cpId}`,
        refused.map((c) => describe(c.payload)).join("; "),
      );
    }

    return text.slice(0, 500);
  }
}
