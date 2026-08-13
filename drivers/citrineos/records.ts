// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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
import {
  type CsmsChargingProfileRecords,
  type CsmsRecords,
} from "../../tck/driver";
import { waitForCondition } from "../../tck/wait";
import type { CitrineConfig } from "./config";
import { CitrineGraphQL } from "./graphql-client";
import { stationColumn } from "./variant";
import { refByDescription } from "./profiles";

/**
 * The transaction fields the readers below need, selected together because one
 * round trip costs the same as three.
 *
 * It buys less than it looks: a scenario typically calls latestTransaction to
 * learn the ref and then two accessors on it, so the row is fetched three
 * times over. Caching it would be wrong rather than merely complex -- specs
 * capture a ref during drive() and read it back after the transaction has
 * stopped (see tck/specs/remotetrigger-smartcharging.ts), so a cached row
 * would answer the stop assertions with the pre-stop snapshot.
 */
const TRANSACTION_FIELDS = `
  id
  transactionId
  endTime
  stoppedReason
  Authorization { idToken }
  StopTransactions(order_by: { timestamp: desc }, limit: 1) {
    timestamp
    reason
    idTokenValue
  }
`;

interface TransactionRow {
  id: number;
  transactionId: string | null;
  endTime: string | null;
  stoppedReason: string | null;
  Authorization: { idToken: string | null } | null;
  StopTransactions: {
    timestamp: string | null;
    reason: string | null;
    idTokenValue: string | null;
  }[];
}

/**
 * `Omit<CsmsRecords, "reservations">` rather than `CsmsRecords`, and the Omit
 * is the declaration of the gap: `reservations` is a capability this CSMS does
 * not have for OCPP 1.6, so the runner substitutes tck/capabilities.ts's
 * throwing stub and the scenarios that need it report NOT APPLICABLE. Keeping
 * the rest of the interface checked is the point -- an `implements` dropped
 * altogether would stop catching a renamed method.
 */
export class CitrineRecords implements Omit<CsmsRecords, "reservations"> {
  private readonly gql: CitrineGraphQL;

  /** Every table below carries `tenantId`, and omitting it would read another
   *  tenant's rows as this tenant's. */
  private readonly tenant: number;

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
  private readonly station: string;

  constructor(cfg: CitrineConfig) {
    this.gql = new CitrineGraphQL(cfg);
    this.tenant = cfg.tenantId;
    this.station = stationColumn(cfg.variant);
  }

  /** `where` on a station's transactions, spelled once. */
  private stationFilter(cpId: string): Record<string, unknown> {
    return { [this.station]: { _eq: cpId }, tenantId: { _eq: this.tenant } };
  }

  private async newestTransaction(
    where: Record<string, unknown>,
  ): Promise<TransactionRow | undefined> {
    const data = await this.gql.query<{ Transactions: TransactionRow[] }>(
      `query Newest($where: Transactions_bool_exp!) {
         Transactions(where: $where, order_by: { id: desc }, limit: 1) {
           ${TRANSACTION_FIELDS}
         }
       }`,
      { where },
    );
    return data.Transactions[0];
  }

  async latestTransaction(cpId: string): Promise<string> {
    const row = await this.newestTransaction(this.stationFilter(cpId));
    return row === undefined ? "" : String(row.id);
  }

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
  async waitForActiveTransaction(
    cpId: string,
    idTag: string,
    timeoutSecs = 15,
  ): Promise<string> {
    return waitForCondition(
      async () => {
        const row = await this.newestTransaction({
          ...this.stationFilter(cpId),
          isActive: { _eq: true },
          Authorization: { idToken: { _eq: idTag } },
        });
        return row === undefined ? "" : String(row.id);
      },
      {
        timeoutMs: timeoutSecs * 1000,
        intervalMs: 1_000,
        description: `active transaction on ${cpId} (idToken=${idTag})`,
      },
    );
  }

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
  async ocppTransactionId(ref: string): Promise<number> {
    if (ref === "") {
      throw new Error(
        "citrineos: no transaction to reference -- the scenario's own lookup came back empty",
      );
    }
    const row = await this.byRef(ref);
    const raw = row?.transactionId ?? "";
    if (!/^\d+$/.test(raw)) {
      throw new Error(
        `citrineos: transaction ${ref} has no numeric OCPP transactionId (got ${JSON.stringify(raw)})`,
      );
    }
    return Number(raw);
  }

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
  async prepareStation(cpId: string): Promise<void> {
    const station = this.stationFilter(cpId);
    const now = new Date().toISOString();

    // The station predicate comes from stationFilter for all three tables, so
    // the variant-dependent column name is interpolated in exactly one place
    // in this file. Only the `where` TYPES differ, which GraphQL requires
    // spelled per table.
    const open = await this.gql.query<{
      Transactions: { id: number; endTime: string | null; stoppedReason: string | null }[];
      LocalListVersions: { id: number }[];
      SendLocalLists: { id: number }[];
    }>(
      `query Residue($open: Transactions_bool_exp!, $versions: LocalListVersions_bool_exp!, $sends: SendLocalLists_bool_exp!) {
         Transactions(where: $open) { id endTime stoppedReason }
         LocalListVersions(where: $versions) { id }
         SendLocalLists(where: $sends) { id }
       }`,
      {
        open: { ...station, isActive: { _eq: true } },
        versions: station,
        sends: station,
      },
    );

    for (const row of open.Transactions) {
      await this.gql.query(
        `mutation Close($id: Int!, $set: Transactions_set_input!) {
           update_Transactions(where: { id: { _eq: $id } }, _set: $set) { affected_rows }
         }`,
        {
          id: row.id,
          set: {
            isActive: false,
            endTime: row.endTime ?? now,
            stoppedReason: row.stoppedReason ?? "Local",
            updatedAt: now,
          },
        },
      );
    }

    // Join rows before their parents: both carry a foreign key, and neither
    // side cascades.
    const versionIds = open.LocalListVersions.map((r) => r.id);
    const sendIds = open.SendLocalLists.map((r) => r.id);
    // The common case is a station that never received a SendLocalList, and
    // four deletes matching nothing is still a round trip.
    if (versionIds.length === 0 && sendIds.length === 0) return;
    await this.gql.query(
      `mutation ClearLocalList($versionIds: [Int!]!, $sendIds: [Int!]!) {
         delete_LocalListVersionAuthorizations(where: { localListVersionId: { _in: $versionIds } }) { affected_rows }
         delete_SendLocalListAuthorizations(where: { sendLocalListId: { _in: $sendIds } }) { affected_rows }
         delete_SendLocalLists(where: { id: { _in: $sendIds } }) { affected_rows }
         delete_LocalListVersions(where: { id: { _in: $versionIds } }) { affected_rows }
       }`,
      { versionIds, sendIds },
    );
  }

  /**
   * One transaction by ref, with everything the three readers below need.
   *
   * `StopTransactions` is ordered and limited rather than assumed unique:
   * nothing constrains it to one row per transaction, and a charge point that
   * retries StopTransaction gets a second one. Latest wins, which is the
   * report the station stands by.
   */
  private async byRef(tx: string): Promise<TransactionRow | undefined> {
    if (tx === "" || !/^\d+$/.test(tx)) return undefined;
    return this.newestTransaction({
      id: { _eq: Number(tx) },
      tenantId: { _eq: this.tenant },
    });
  }

  async transactionIdTag(tx: string): Promise<string> {
    const row = await this.byRef(tx);
    return (
      row?.Authorization?.idToken ??
      row?.StopTransactions[0]?.idTokenValue ??
      ""
    );
  }

  /**
   * StopTransactions.timestamp first, Transactions.endTime second.
   *
   * The order is not arbitrary: the first is the instant the CHARGE POINT
   * reported, straight off the wire, and the second is CitrineOS's own summary
   * -- which is also what prepareStation above writes. Preferring the wire
   * value means a scenario that asserts a transaction closed is answered by the
   * charge point wherever the charge point answered.
   */
  async transactionStopTimestamp(tx: string): Promise<string> {
    const row = await this.byRef(tx);
    return row?.StopTransactions[0]?.timestamp ?? row?.endTime ?? "";
  }

  async transactionStopReason(tx: string): Promise<string> {
    const row = await this.byRef(tx);
    return row?.StopTransactions[0]?.reason ?? row?.stoppedReason ?? "";
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    const data = await this.gql.query<{
      Transactions_aggregate: { aggregate: { count: number } };
    }>(
      `query CountForTag($where: Transactions_bool_exp!) {
         Transactions_aggregate(where: $where) { aggregate { count } }
       }`,
      {
        where: {
          ...this.stationFilter(cpId),
          Authorization: { idToken: { _eq: idTag } },
        },
      },
    );
    return String(data.Transactions_aggregate.aggregate.count);
  }

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

  readonly chargingProfiles: CsmsChargingProfileRecords = {
    // Resolved from this driver's own fixture catalogue, not from the CSMS.
    // profiles.ts explains why CitrineOS has nothing to look this up in.
    refByDescription: async (description: string) => refByDescription(description),
  };
}
