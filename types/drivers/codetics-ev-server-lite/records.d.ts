/**
 * records.ts -- what the CSMS believes happened, read over its admin API.
 *
 * Transactions come from `GET /api/v1/transactions`
 * (controllers/sessions/ChargingSessionController.kt), a page
 * `{items, total}` of snake_case rows filterable by `stationId`, `tokenUid`
 * and `status` -- which accepts `active` or `completed` and answers 400 to
 * anything else. A row's `id` is the transactionId the server handed the
 * station in StartTransaction.conf, so the ref this driver hands out IS the
 * OCPP id and needs no translation on the way back into an operation.
 *
 * `Omit<CsmsRecords, "reservations" | "deviceModel">`, and each omission is a
 * declared gap rather than a forgotten one:
 *
 *  - reservations: the server has no reservation entity. ReserveNow and
 *    CancelReservation exist only as raw commands, and the command list it
 *    serves (`GET /api/v1/commands`) carries no request payload, so not even
 *    the id a ReserveNow carried can be read back. `latest()` cannot answer
 *    with the `unverifiable` sentinel either: TC_051 feeds its result straight
 *    into CancelReservation, and a sentinel in a request body is the one use
 *    unverifiable.ts forbids. Absent, the runner substitutes a stub that
 *    throws UnsupportedOperationError, and TC_051 is NOT APPLICABLE -- which
 *    scope.ts says up front.
 *  - deviceModel: OCPP 1.6 only.
 *
 * `chargingProfiles` resolves from profiles.ts, for the reason given there.
 */
import type { CsmsChargingProfileRecords, CsmsRecords } from "../../tck/driver";
import { type EvslApi } from "./api-client";
export declare class EvslRecords implements Omit<CsmsRecords, "reservations" | "deviceModel"> {
    private readonly api;
    constructor(api: EvslApi);
    private page;
    /** The newest page of the station's open transactions, for one idTag when
     *  given. `query()` drops an absent `tokenUid`. */
    private active;
    latestTransaction(cpId: string): Promise<string>;
    /** The station's still-open transactions. Not part of the contract: the
     *  prepare hook closes them. */
    openTransactions(cpId: string): Promise<string[]>;
    waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs?: number): Promise<string>;
    /** One transaction by id, or undefined -- for a ref that is not an id, and
     *  for an id the server answers 404 for. */
    private transaction;
    transactionIdTag(tx: string): Promise<string>;
    transactionStopTimestamp(tx: string): Promise<string>;
    transactionStopReason(tx: string): Promise<string>;
    transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
    readonly chargingProfiles: CsmsChargingProfileRecords;
}
