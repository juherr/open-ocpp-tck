/**
 * records.ts -- what SteVe believes happened, read straight from its MariaDB.
 *
 * SteVe's REST API does not expose stop_reason, reservation status or the
 * charging-profile registry, so the scenarios that assert on those can only be
 * answered from the database. The queries shell out through `docker exec`,
 * which means this driver has to run where that container is.
 */
import { type CsmsChargingProfileRecords, type CsmsRecords, type CsmsReservationRecords } from "../../tck/driver";
import type { SteveConfig } from "./ui-client";
export declare class SteveRecords implements CsmsRecords {
    private readonly cfg;
    constructor(cfg: SteveConfig);
    /** Runs SQL, returns the first column of the first row ("" if no rows). */
    scalar(sql: string): Promise<string>;
    /**
     * scalar(), normalising a genuine SQL NULL to "".
     *
     * `mariadb -N -B` renders a SQL NULL as the literal four characters "NULL",
     * not an empty string. Without this, assertNonEmpty on a still-open
     * transaction's stop_timestamp would PASS -- "NULL" is non-empty -- and the
     * scenario would report a closed transaction that is still running. A
     * zero-row result already comes back as "" because MariaDB prints nothing.
     */
    private nullSafe;
    latestTransaction(cpId: string): Promise<string>;
    /** Most recent still-open transaction. Not part of the contract: it exists
     *  for the stale-transaction cleanup below. */
    latestOpenTransaction(cpId: string): Promise<string>;
    /**
     * Binds a scenario's later assertions to the transaction ITS OWN drive()
     * created. latestTransaction() takes the newest row regardless of tag or
     * state, which on a reused charge point can pick up a stale closed
     * transaction from an earlier run instead of the racing in-progress one.
     */
    waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs?: number): Promise<string>;
    /** Closes any transaction left open by an interrupted run, so that
     *  max_active_transaction_count does not block the next scenario.
     *  Idempotent. A WRITE, hence a lifecycle hook and not part of CsmsRecords. */
    closeStaleTransaction(cpId: string): Promise<void>;
    transactionIdTag(tx: string): Promise<string>;
    transactionStopTimestamp(tx: string): Promise<string>;
    transactionStopReason(tx: string): Promise<string>;
    transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
    readonly reservations: CsmsReservationRecords;
    readonly chargingProfiles: CsmsChargingProfileRecords;
}
