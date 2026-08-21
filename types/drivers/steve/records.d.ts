/**
 * records.ts -- what SteVe believes happened.
 *
 * TWO CHANNELS, AND THE SPLIT IS NOT ARBITRARY: transactions come from the
 * WebAPI, reservations and the charging-profile registry from MariaDB through
 * `docker exec`, because SteVe has no controller for either (probed on the
 * pinned image: `/api/v1/reservations` and `/api/v1/chargingProfiles` answer
 * 403 -- no such route). So the SQL half of this file is exactly the list of
 * endpoints SteVe does not have, and each one that lands upstream deletes code
 * here rather than changing it. Both are open upstream, and each fallback
 * below names its own:
 *
 *   reservations       steve-community/steve#2074
 *   charging profiles  steve-community/steve#2069
 *
 * Both sit under the #1000 "Meta - API Endpoint" umbrella.
 *
 * An earlier version read everything from the database on the grounds that the
 * WebAPI "does not expose stop_reason". Measured against the pinned image, that
 * was wrong: `GET /api/v1/transactions` returns `stopReason`, `stopTimestamp`,
 * `ocppIdTag` and `id` on the `Transaction` DTO, filterable by `chargeBoxId`,
 * `ocppIdTag` and `type=ACTIVE`. Forty-four of the fifty-one record calls the
 * scenarios make were paying a process spawn each for state the CSMS was
 * willing to hand over on a socket.
 *
 * WHY THIS IS THE BETTER SOURCE, not merely the cheaper one: the database is
 * SteVe's private state, while the WebAPI is what an integrator can see. A
 * conformance claim that only holds when you can read the CSMS's own tables is
 * a weaker claim than one an integrator could reproduce. The database is kept
 * only where nothing else can answer.
 */
import { type CsmsChargingProfileRecords, type CsmsRecords, type CsmsReservationRecords } from "../../tck/driver";
import { type SteveApiConfig } from "./api-client";
import type { SteveConfig } from "./ui-client";
/**
 * Single-quoted SQL literal.
 *
 * Backslash is escaped as well as the quote, and the order matters -- doing the
 * quote first would then double the backslashes it just introduced. MariaDB
 * does not run with NO_BACKSLASH_ESCAPES by default, so a value ending in a
 * backslash escapes the closing quote and swallows the rest of the statement.
 *
 * Lives here because this module owns the only path to the database, so this is
 * the one place a caller can be given the guarantee driver-wide rather than
 * per-file.
 */
export declare function sqlLiteral(value: string): string;
/**
 * `Omit<CsmsRecords, "deviceModel">` rather than `CsmsRecords`, and the Omit is
 * the declaration of the gap: SteVe speaks OCPP 1.6 only, so it has connector
 * statuses and no device model to store them in a second time. The runner
 * substitutes tck/capabilities.ts's throwing stub and the scenarios that read
 * one report NOT APPLICABLE. Keeping the rest of the interface checked is the
 * point -- an `implements` dropped altogether would stop catching a renamed
 * method. The same shape drivers/citrineos/records.ts uses for `reservations`.
 */
export declare class SteveRecords implements Omit<CsmsRecords, "deviceModel"> {
    private readonly cfg;
    private readonly api;
    constructor(cfg: SteveConfig, apiCfg: SteveApiConfig);
    /** Runs SQL, returns stdout verbatim. The single path to the database. */
    private raw;
    /** Runs SQL, returns the first column of the first row ("" if no rows). */
    scalar(sql: string): Promise<string>;
    /**
     * Runs SQL, returns every row as its list of columns ([] if no rows).
     *
     * `mariadb -N -B` already emits one tab-separated row per line, so a caller
     * that needs several columns -- or several rows -- does not have to smuggle
     * them through a delimiter in a CONCAT and unpack them by hand. Each such
     * query is one process spawn, which is what makes the difference between
     * asking about twenty tags and asking twenty times.
     */
    rows(sql: string): Promise<string[][]>;
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
    /**
     * The transactions matching a filter. The single path to the WebAPI's
     * transaction registry, so no call site has to know the route or the
     * repeated-key convention its list filters use.
     */
    private transactions;
    /**
     * The newest of a filtered set, as the contract's `""`-when-absent string.
     *
     * The maximum is taken here rather than trusted from the response order:
     * SteVe's query form takes no sort parameter, so the order is the
     * repository's business and not a promise. The SQL this replaced said
     * `ORDER BY transaction_pk DESC LIMIT 1` out loud.
     */
    private static newest;
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
    /**
     * Closes any transaction left open by an interrupted run, so that
     * max_active_transaction_count does not block the next scenario. Idempotent.
     * A WRITE, hence a lifecycle hook and not part of CsmsRecords.
     *
     * `PATCH /transactions/{pk}/stop` is the endpoint for exactly this, and it
     * puts nothing on the wire: TransactionService#stop writes the stop row
     * itself with `eventActor = manual`, and returns early when the transaction
     * already carries a stop value (source-verified). Both matter here -- the
     * charge point that opened the stale transaction is, by definition, gone,
     * and this hook runs before every scenario.
     */
    closeStaleTransaction(cpId: string): Promise<void>;
    /** One transaction by primary key, or undefined. The three accessors below
     *  each read one field off it. */
    private transaction;
    transactionIdTag(tx: string): Promise<string>;
    transactionStopTimestamp(tx: string): Promise<string>;
    transactionStopReason(tx: string): Promise<string>;
    transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
    /**
     * Which of these idTags anything still refers to. Not part of the contract:
     * teardown needs it to avoid deleting a tag out from under a transaction or
     * a reservation, either of which cascades and takes the row's history with
     * it.
     *
     * ONE question, answered here rather than half here and half in the caller,
     * because the two halves travel by different channels for a reason that is
     * this module's to know and not teardown's: transactions come from the API,
     * reservations from SQL, since there is no reservation endpoint
     * ([steve-community/steve#2074]). When it lands, this method stops touching
     * the database and nothing above it changes.
     *
     * Both halves ask once for the whole set -- `ocppIdTag` is a list filter, so
     * the repeated key does the work a loop would have done -- and they ask
     * concurrently, since the SQL half pays a `docker exec` process spawn.
     */
    idTagsReferenced(idTags: readonly string[]): Promise<Set<string>>;
    /** SQL until [steve-community/steve#2074] exposes reservation resources. */
    readonly reservations: CsmsReservationRecords;
    /** SQL until [steve-community/steve#2069] exposes charging-profile CRUD. */
    readonly chargingProfiles: CsmsChargingProfileRecords;
}
