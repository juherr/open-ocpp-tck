/**
 * records.ts -- what the CSMS believes happened, read over its REST API.
 *
 * EVtivity keeps a charging SESSION per transaction (`ses_…`), and three
 * identities meet in it: the OCPP transactionId (a global integer counter,
 * stored as a string), the station's OCPP identity, and the REST id of the
 * station (`sta_…`). The ref this driver hands out is the OCPP transactionId,
 * so it goes back into RemoteStopTransaction and SetChargingProfile untouched.
 * Measured at v0.1.51 (.context step 0, Q5):
 *
 *  - a station's sessions: `GET /v1/stations/{sta}/sessions` -- transactionId,
 *    status, endedAt, but no idTag and no stop reason;
 *  - one session in full: `GET /v1/sessions/{ses}` -- `token.idToken`,
 *    `stoppedReason`, `endedAt`;
 *  - a transaction by its OCPP id, with no station: `GET /v1/sessions?search=`,
 *    which matches the transactionId as a SUBSTRING (and station ids, and
 *    driver names) -- so the rows are filtered on an exact transactionId;
 *  - a tag's sessions: `GET /v1/tokens?search=` (substring, filtered exact)
 *    for the token id, then `GET /v1/tokens/{dtk}/sessions`, whose rows carry
 *    the station's OCPP identity as `stationName`.
 *
 * The projections are eventually consistent; step 0 saw every write on the
 * first poll, 40 ms after the command's answer.
 *
 * THE API CACHES ITS GETS, and that is the larger lag. EVtivity stores every
 * 200 JSON answer of a matching route in Redis, keyed by user, access scope
 * and full URL (packages/api/src/plugins/response-cache.ts, CACHE_RULES,
 * matched on the route template): `/v1/stations` and `/v1/sessions` lists
 * for 10 s, `/v1/stations/*` and `/v1/sessions/*` for 5 s, `/v1/tokens` for
 * 30 s. A write through the API invalidates its own resource's tag; an OCPP
 * event invalidates none of them (events.ts bumps only the dashboard's). So a
 * read repeats, for up to its TTL, whatever the same URL answered before the
 * station's last message. Per method:
 *
 *  - `waitForActiveTransaction`, `transactionCountForIdTag`: the tag's
 *    sessions come from `/v1/tokens/{dtk}/sessions`, which no rule matches
 *    (`/v1/tokens` is an exact rule) -- uncached. The token id before it is
 *    cached 30 s, harmlessly: tokens are only written through the API.
 *  - `latestTransaction`, `openSessions`: `/v1/stations/{sta}/sessions`, 5 s.
 *    No uncached route lists a station's sessions. The station's REST id
 *    (`/v1/stations?search=`, 10 s) only changes through the API.
 *  - `transactionIdTag`, `transactionStopTimestamp`, `transactionStopReason`:
 *    `/v1/sessions?search=` (10 s) then `/v1/sessions/{ses}` (5 s). No
 *    uncached route carries `stoppedReason`, so a stop read within 5 s of a
 *    read of the same session made while it was active can come back empty.
 *    `/v1/sessions` is also rate limited, 60 a minute keyed by user
 *    (sessions.ts), and every lane of a sweep logs in as the same admin. Each
 *    of the three lookups spends one, cache hits included: the limit is an
 *    onRequest hook, the cache a preHandler. A 429 there is a non-dispatch.
 *
 * `Omit<CsmsRecords, "reservations" | "deviceModel">`, each a declared gap:
 *
 *  - reservations: a raw `v16/ReserveNow` creates no reservation row. The
 *    `command.ReserveNow` projection only confirms or rolls back a hold that
 *    `POST /v1/reservations` made (packages/ocpp/src/server/
 *    reservation-projections.ts), so the id a scenario's ReserveNow carried
 *    cannot be read back, and TC_051 is NOT APPLICABLE (scope.ts, which also
 *    says why the managed route cannot carry the driver's ReserveNow).
 *  - deviceModel: OCPP 1.6 only.
 *
 * `chargingProfiles` resolves from profiles.ts, for the reason given there.
 */
import type { CsmsChargingProfileRecords, CsmsRecords } from "../../tck/driver";
import { type EvtivityApi } from "./api-client";
export declare class EvtivityRecords implements Omit<CsmsRecords, "reservations" | "deviceModel"> {
    private readonly api;
    constructor(api: EvtivityApi);
    private page;
    /** Every row of a paged list, following `page=` until `total` is reached. */
    private all;
    /** The REST id of a station, or undefined when there is none. */
    stationRestId(cpId: string): Promise<string | undefined>;
    /** The token id of an idTag, or undefined when there is none. */
    private tokenId;
    /** The sessions an idTag opened at one station. */
    private tagSessions;
    latestTransaction(cpId: string): Promise<string>;
    /** The REST ids of the station's still-active sessions. Not part of the
     *  contract: the prepare hook ends them. */
    openSessions(cpId: string): Promise<string[]>;
    waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs?: number): Promise<string>;
    /** One transaction by its OCPP id, or undefined -- for a ref that is not an
     *  id, and for an id no session carries. */
    private transaction;
    transactionIdTag(tx: string): Promise<string>;
    transactionStopTimestamp(tx: string): Promise<string>;
    transactionStopReason(tx: string): Promise<string>;
    transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
    readonly chargingProfiles: CsmsChargingProfileRecords;
}
