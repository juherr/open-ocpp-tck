/**
 * records.ts -- what CitrineOS believes happened, read through its data API.
 *
 * THE REST SURFACE CANNOT ANSWER THIS. CitrineOS's `@AsDataEndpoint` routes
 * cover boot config, tariffs, certificates, the router's websocket plumbing
 * and exactly one transaction lookup -- `GET /data/transactions/transaction`,
 * which requires the `transactionId` a scenario is trying to discover (it
 * answers 400 without it) and returns `authorizationId` rather than the idTag,
 * with no route resolving it. There is no "latest transaction for this
 * station", no stop reason, no count, and no Authorization CRUD. Every route
 * was probed on the pinned image, not sampled.
 *
 * SO THE DATA API HERE IS HASURA, and that is the vendor's own answer rather
 * than a workaround. Measured against citrineos-core:
 *
 *  - `packages/ocpi-base`, a shipped server-side package, creates
 *    Authorizations with `insert_Authorizations_one`
 *    (`src/graphql/queries/token.queries.ts`).
 *  - `apps/operator-ui` uses the same mutations for its own CRUD.
 *  - Their e2e suite seeds fixtures through a `GraphQLClient` posting to
 *    `hasuraUrl` (`tests/e2e/fixtures/api-client.ts`), and mints transactions
 *    with `insert_Transactions_one`.
 *  - Their compose starts `graphql-engine` ungated while gating the operator
 *    UI and the OCPI server behind `profiles:`.
 *
 * WHAT IT COSTS, stated because the earlier `docker exec psql` transport was
 * chosen partly to avoid it: another pinned image and another published port
 * (compose.yaml), and no insulation from the schema -- Hasura derives its
 * field names from column names, so the v1.9.1 -> v2 rename of the OCPP
 * connection column (variant.ts) breaks these queries exactly as it broke the
 * SQL. It is a different syntax for the same coupling.
 *
 * WHAT IT BUYS: this driver no longer shells into a container, so it can be
 * pointed at a CitrineOS nobody on this host owns -- and a query costs an HTTP
 * round trip rather than the ~350 ms process spawn a `docker exec` paid.
 */
import { type CsmsChargingProfileRecords, type CsmsDeviceModelRecords, type CsmsRecords } from "../../tck/driver";
import type { CitrineConfig } from "./config";
/**
 * Two names are omitted from the `implements`, and each omission is a
 * declaration rather than a shortcut.
 *
 * `reservations` is a capability this CSMS does not have for OCPP 1.6 at all,
 * so it is absent on every line. `deviceModel` is absent only on v1.9.1, which
 * is why it is a property assigned in the constructor instead of a field --
 * see its own note. Keeping the rest of the interface checked is the point: an
 * `implements` dropped altogether would stop catching a renamed method.
 */
export declare class CitrineRecords implements Omit<CsmsRecords, "reservations" | "deviceModel"> {
    private readonly gql;
    /** Every table below carries `tenantId`, and omitting it would read another
     *  tenant's rows as this tenant's. */
    private readonly tenant;
    /**
     * The column holding the OCPP connection name for the declared variant --
     * `ocppConnectionName` on v2, `stationId` on v1.9.1. See variant.ts for why
     * this is declared rather than detected, and for the trap that makes
     * `stationId`'s mere presence useless as a discriminator.
     *
     * It is interpolated into the GraphQL document rather than passed as a
     * variable because GraphQL has no way to parameterise a field name -- the
     * same reason the SQL interpolated it into a WHERE clause. The value comes
     * from variant.ts's closed union, never from input.
     */
    private readonly station;
    constructor(cfg: CitrineConfig);
    /** `where` on a station's transactions, spelled once. */
    private stationFilter;
    private newestTransaction;
    latestTransaction(cpId: string): Promise<string>;
    /**
     * Binds a scenario's later assertions to the transaction ITS OWN drive()
     * created. latestTransaction() takes the newest row regardless of tag or
     * state, which on a reused charge point can pick up a stale closed
     * transaction from an earlier run instead of the racing in-progress one.
     *
     * The idToken filter goes through the `Authorization` relationship, which is
     * the join the SQL spelled out. It is sound for an OPEN transaction, not
     * only a closed one: createTransactionByStartTransaction looks the
     * Authorization up by `idToken = request.idTag` and stores its id on the row
     * at creation time (TransactionEvent.ts), storing NULL for an unknown tag.
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
     * than part of CsmsRecords.
     *
     * Two pieces of per-station residue, both of which a previous scenario in
     * the same sweep can leave behind on a charge point id the pool then hands
     * to the next one:
     *
     * 1. AN OPEN TRANSACTION. It writes the summary columns on `Transactions`
     *    and deliberately does NOT fabricate a `StopTransactions` row: that
     *    table holds what the charge point actually sent, and inventing an entry
     *    would put a StopTransaction that never happened in front of anyone
     *    reading the database afterwards. `endTime` is CitrineOS's own
     *    bookkeeping, and setting it is true -- this driver did end it.
     *
     *    The SQL used COALESCE to leave an already-set endTime alone; GraphQL has
     *    no such expression, so the rows are read first and each is updated with
     *    the value it should keep. There is normally at most one.
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
     * One transaction by ref, with everything the three readers below need.
     *
     * `StopTransactions` is ordered and limited rather than assumed unique:
     * nothing constrains it to one row per transaction, and a charge point that
     * retries StopTransaction gets a second one. Latest wins, which is the
     * report the station stands by.
     */
    private byRef;
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
    /**
     * What the CSMS did with a 2.0.1 StatusNotification, which the wire cannot
     * say. device-model.ts holds the two conditions these two reads correspond
     * to, and provision.ts writes the rows that satisfy them.
     *
     * THE TWO READS DO NOT ADDRESS THE CONNECTOR THE SAME WAY, and the asymmetry
     * is measured rather than stylistic.
     *
     * `connectorStatus` walks `Connectors.Evse.evseTypeId`, which is what makes
     * its `evseId` argument load-bearing instead of decorative: a connector id is
     * unique per station, so filtering on it alone would answer the same for
     * every EVSE and quietly turn a three-argument method into a two-argument
     * one.
     *
     * `availabilityState` does NOT walk `Component.EvseType`, which is the join
     * the CSMS's own handler filters on and therefore the obvious one to use. It
     * cannot: `findOrCreateEvseAndComponent` in the pinned image repoints a
     * component's EVSE type through `evse.connectorId ? … : null`, and `0` is
     * falsy, so the moment the STATION-SCOPE status is filed the component that
     * holds it points at an EVSE type with a null connector. The row is there and
     * correct; only that join stops leading to it. So the component is addressed
     * the way this driver provisioned it -- by name and instance, both from
     * device-model.ts, which owns that spelling for the writer too.
     *
     * The relationships both queries do use are declared in graphql-client.ts,
     * spelled out so a rename upstream fails with the name in the message.
     */
    /**
     * PRESENT EXACTLY WHEN `capabilities.deviceModel` SAYS SO, and assigned in
     * the constructor rather than declared, because the two must not be able to
     * disagree.
     *
     * They did. The capability was `speaksOcpp201(variant)` while this reader was
     * unconditional, and substitution keys off the PARTS -- so on the v1 line the
     * printed capability said `false` and the runner would still have handed a
     * spec queries that name a column v1.9.1 does not have. Unreachable only
     * because a third restatement, the scope table, marks every `cert201-` row
     * NOT_APPLICABLE there. Omission is the mechanism the contract already has
     * for "not on this line"; the boolean is now derived from it rather than
     * claimed beside it.
     */
    readonly deviceModel?: CsmsDeviceModelRecords;
    private readonly deviceModelReader;
}
