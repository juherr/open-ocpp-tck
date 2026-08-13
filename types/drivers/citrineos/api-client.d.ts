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
 */
import type { CitrineConfig } from "./config";
import type { CitrineRequest } from "./requests";
export declare class CitrineMessageApi {
    private readonly cfg;
    constructor(cfg: CitrineConfig);
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
