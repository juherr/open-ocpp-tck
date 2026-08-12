/**
 * records.ts -- what CitrineOS believes happened, read straight from Postgres.
 *
 * The message API is write-only in practice. CitrineOS's REST data endpoints
 * cover boot config, tariffs, certificates, the router's websocket plumbing and
 * exactly one transaction lookup -- by explicit `transactionId`, which a
 * scenario does not know. There is no "latest transaction for this station",
 * no idTag on a transaction, no stop reason, no count, and no Authorization
 * CRUD at all. Every `@AsDataEndpoint` in the repository was read to establish
 * that, not sampled.
 *
 * THE BUNDLED HASURA / GraphQL, AND A CLAIM THIS FILE USED TO MAKE
 * ---------------------------------------------------------------
 * CitrineOS's docker stack ships a Hasura sidecar that does expose all of it.
 * This header used to give three reasons for not using it. The second one --
 * "Hasura is part of their dev compose, not their product" -- IS FALSE, and it
 * was the load-bearing one. Measured against citrineos-core:
 *
 *  - `packages/ocpi-base` is a shipped server-side package, and it creates
 *    Authorizations with `insert_Authorizations_one`, a Hasura mutation
 *    (`src/graphql/queries/token.queries.ts`). Not a REST data endpoint.
 *  - `apps/operator-ui` does the same for the UI's own CRUD.
 *  - Their e2e suite seeds fixtures through it too, with a `GraphQLClient`
 *    posting to `hasuraUrl` (`tests/e2e/fixtures/api-client.ts`).
 *  - Their compose starts `graphql-engine` UNGATED, while putting the operator
 *    UI and the OCPI server behind `profiles:`.
 *
 * So GraphQL is the sanctioned data path for first-party code, not a developer
 * convenience. The remaining two reasons stand and are worth keeping:
 *
 *  1. IT WOULD NOT DECOUPLE US FROM THE SCHEMA. Hasura derives its field names
 *     from column names, so the v1.9.1 -> v2 rename of the OCPP connection
 *     column (see variant.ts) would have broken exactly these queries in
 *     exactly the same way. It is a different syntax for the same coupling,
 *     not an abstraction over it.
 *  2. It costs another pinned image, another published port, and another
 *     authentication story.
 *
 * What it buys is remote testability -- GraphQL is plain HTTP, whereas the
 * transport below needs `docker exec` and therefore a driver running on the
 * host that owns the containers, the same cost drivers/steve/records.ts pays
 * and documents. With the false objection removed, that trade is now worth
 * making, and `raw()` below is the seam it goes through.
 *
 * MEASURED COST OF THIS TRANSPORT: ~350 ms per query, dominated by the
 * `docker exec` process spawn. Worth knowing before optimising the wrong
 * thing -- the cheap fix is a persistent psql session fed on stdin, not a
 * different database API.
 */
import { type CsmsChargingProfileRecords, type CsmsRecords } from "../../tck/driver";
import type { CitrineConfig } from "./config";
/**
 * Single-quoted SQL literal, for PostgreSQL.
 *
 * Only the quote is doubled, and unlike the MariaDB sibling in
 * drivers/steve/records.ts the backslash is deliberately left alone:
 * PostgreSQL has had `standard_conforming_strings = on` by default since 9.1,
 * so a backslash inside `'...'` is an ordinary character. Escaping it would
 * corrupt any value containing one. `psql -X` below is what keeps that true --
 * it skips ~/.psqlrc, so no local file can turn the setting off underneath us.
 */
export declare function sqlLiteral(value: string): string;
/**
 * `Omit<CsmsRecords, "reservations">` rather than `CsmsRecords`, and the Omit
 * is the declaration of the gap: `reservations` is a capability this CSMS does
 * not have for OCPP 1.6, so the runner substitutes tck/capabilities.ts's
 * throwing stub and the scenarios that need it report NOT APPLICABLE. Keeping
 * the rest of the interface checked is the point -- an `implements` dropped
 * altogether would stop catching a renamed method.
 */
export declare class CitrineRecords implements Omit<CsmsRecords, "reservations"> {
    private readonly cfg;
    /** `AND "tenantId" = n`, spelled once. Every table below carries the column,
     *  and omitting it would read another tenant's rows as this tenant's. */
    private readonly tenant;
    /**
     * The quoted column holding the OCPP connection name, for the declared
     * variant -- `"ocppConnectionName"` on v2, `"stationId"` on v1.9.1. See
     * variant.ts for why this is declared rather than detected, and for the trap
     * that makes `stationId`'s mere presence useless as a discriminator.
     *
     * Unqualified. Every call site below is either single-table or joins only
     * `Authorizations`, which carries neither name, so it cannot be ambiguous --
     * and if a future schema made it so, Postgres would raise "column reference
     * is ambiguous" rather than pick one silently.
     */
    private readonly station;
    constructor(cfg: CitrineConfig);
    /** Runs SQL, returns stdout verbatim. The single path to the database. */
    private raw;
    /**
     * Runs SQL, returns the first column of the first row ("" if no rows).
     *
     * There is no `nullSafe` counterpart to SteVe's here, and that is a fact
     * about psql rather than an omission: `-t -A` renders a SQL NULL as the
     * empty string, so an unset stop timestamp already arrives as the "" that
     * assertNonEmpty must fail on. MariaDB prints the four characters "NULL",
     * which is why the other driver needs the extra step.
     */
    scalar(sql: string): Promise<string>;
    /** Runs SQL, returns every row as its list of columns ([] if no rows). */
    rows(sql: string): Promise<string[][]>;
    /**
     * The transaction joined to the Authorization it was started with.
     *
     * The join is sound for an OPEN transaction, not only a closed one:
     * createTransactionByStartTransaction looks the Authorization up by
     * `idToken = request.idTag` and stores its id on the row at creation time
     * (packages/core/src/dal/layers/sequelize/repository/TransactionEvent.ts).
     * It stores NULL for an unknown tag, which is why every use below is a LEFT
     * JOIN or an explicit inner join on a tag the fixtures provide.
     */
    private static readonly TX_AUTH_JOIN;
    latestTransaction(cpId: string): Promise<string>;
    /**
     * Binds a scenario's later assertions to the transaction ITS OWN drive()
     * created. latestTransaction() takes the newest row regardless of tag or
     * state, which on a reused charge point can pick up a stale closed
     * transaction from an earlier run instead of the racing in-progress one.
     */
    waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs?: number): Promise<string>;
    /**
     * The OCPP integer transactionId behind a ref.
     *
     * Not part of CsmsRecords: it is the translation `requests.ts` needs to turn
     * this driver's row key into the number RemoteStopTransaction and a TxProfile
     * put on the wire. CitrineOS mints it from a per-station sequence, so it is
     * neither the primary key nor globally unique -- assuming the two were the
     * same number, as they happen to be in SteVe, would stop a transaction that
     * belongs to a different station.
     */
    ocppTransactionId(ref: string): Promise<number>;
    /**
     * Returns one charge point to the state a scenario may assume, before its
     * container starts. Idempotent, and a WRITE -- hence a lifecycle hook rather
     * than part of CsmsRecords. One `docker exec`, because psql runs a
     * semicolon-separated script in a single implicit transaction.
     *
     * Two pieces of per-station residue, both of which a previous scenario in
     * the same sweep can leave behind on a charge point id the pool then hands
     * to the next one:
     *
     * 1. AN OPEN TRANSACTION. Same job as SteVe's closeStaleTransaction. It
     *    writes the summary columns on `Transactions` and deliberately does NOT
     *    fabricate a `StopTransactions` row: that table holds what the charge
     *    point actually sent, and inventing an entry would put a StopTransaction
     *    that never happened in front of anyone reading the database afterwards.
     *    `endTime` is CitrineOS's own bookkeeping, and setting it is true --
     *    this driver did end the transaction.
     *
     * 2. THE LOCAL AUTHORISATION LIST VERSION, which is the non-obvious one.
     *    LocalAuthListService rejects a SendLocalList whose listVersion is not
     *    strictly greater than the station's stored versionNumber, throwing
     *    before anything reaches the wire. Four scenarios send listVersion 1, so
     *    the second of them to land on a given charge point would be refused by
     *    the CSMS -- and would look exactly like a charge point that ignored the
     *    request. Clearing the row restores "this station has no local list",
     *    which is what every one of those scenarios assumes.
     */
    prepareStation(cpId: string): Promise<void>;
    /**
     * One column off the transaction row, joined to what the charge point sent.
     *
     * The three public readers below differ only in that expression, so the
     * guard, the joins and the tenant-scoped WHERE live here once -- a fix to any
     * of them would otherwise have to land in three places.
     *
     * ORDER BY + LIMIT because nothing constrains "StopTransactions" to one row
     * per transaction: a charge point that retries StopTransaction gets a second
     * one, and scalar() would then read whichever row the planner happened to
     * emit first. Latest wins, which is the report the station stands by.
     */
    private txScalar;
    transactionIdTag(tx: string): Promise<string>;
    /**
     * StopTransactions.timestamp first, Transactions.endTime second.
     *
     * The order is not arbitrary: the first is the instant the CHARGE POINT
     * reported, straight off the wire, and the second is CitrineOS's own summary
     * -- which is also what prepareStation above writes. Preferring the wire
     * value means a scenario that asserts a transaction closed is answered by the
     * charge point wherever the charge point answered.
     */
    transactionStopTimestamp(tx: string): Promise<string>;
    transactionStopReason(tx: string): Promise<string>;
    transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
    /**
     * Deliberately absent: `reservations`.
     *
     * The runner substitutes tck/capabilities.ts's throwing stub, so the
     * scenarios read identically and the absence surfaces as NOT APPLICABLE. It
     * is structural rather than an unverifiable() sentinel because CitrineOS
     * cannot SEND ReserveNow over OCPP 1.6 at all (see requests.ts), so there is
     * never a reservation to have an opinion about -- the `Reservations` table
     * exists but nothing for 1.6 ever writes it.
     */
    readonly chargingProfiles: CsmsChargingProfileRecords;
}
