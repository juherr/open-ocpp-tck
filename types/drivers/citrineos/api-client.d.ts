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
 * The other half is what stays a plain `Error`: a 2xx whose body stalls, one
 * that will not parse, one that is not a confirmation array. THE REQUEST WAS
 * ANSWERED in all three, so whether it dispatched is unknown -- and a driver may
 * not claim what it cannot tell. That half is what stops this being a blanket
 * conversion, and it is the half worth a guard.
 */
import { type FetchLike } from "../../tck/driver";
import type { CitrineConfig } from "./config";
import type { CitrineRequest } from "./requests";
export declare class CitrineMessageApi {
    private readonly cfg;
    private readonly fetchImpl;
    /**
     * The `fetch` seam exists so an offline guard can serve each failure above
     * from a Map. Every branch this file classifies needs a CSMS engineered to
     * refuse a request a chosen way -- a 503, a body that will not parse -- and
     * neither bundled CSMS can be asked for one.
     *
     * The default reads the global PER CALL rather than capturing it at
     * construction, so a driver built before something replaces `fetch` still
     * uses the replacement.
     */
    constructor(cfg: CitrineConfig, fetchImpl?: FetchLike);
    private url;
    /**
     * Dispatches one operation and returns a receipt for the run log.
     *
     * The receipt is the confirmation array, serialised. Specs must not branch on
     * it -- it exists so that a human reading results/ can tell a dispatched
     * operation from one the CSMS quietly reshaped, which for GetConfiguration it
     * genuinely does (see the batching note below).
     */
    send(cpId: string, req: CitrineRequest): Promise<string>;
}
