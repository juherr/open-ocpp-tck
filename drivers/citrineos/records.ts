// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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
 * WHY NOT THE BUNDLED HASURA / GraphQL
 * ------------------------------------
 * CitrineOS's docker stack ships a Hasura sidecar that does expose all of it.
 * Three things decided against it, and the first one is NOT the metadata: yes,
 * Hasura tracks no table until metadata is applied and that metadata lives in
 * the CitrineOS repository, but its metadata API (`pg_track_table`) would let
 * `provision` track the eight tables itself, vendoring nothing.
 *
 *  1. IT WOULD NOT DECOUPLE US FROM THE SCHEMA. Hasura derives its field names
 *     from column names, so the v1.9.1 -> v2 rename of the OCPP connection
 *     column (see variant.ts) would have broken exactly these queries in
 *     exactly the same way. It is a different syntax for the same coupling,
 *     not an abstraction over it.
 *  2. HASURA IS PART OF THEIR DEV COMPOSE, NOT THEIR PRODUCT. Depending on it
 *     would mean testing "CitrineOS plus a particular sidecar", and a target
 *     deployment may well not run one. Postgres is definitionally present.
 *  3. It costs another pinned image, another published port, and another
 *     authentication story.
 *
 * The one thing it would genuinely buy is remote testability -- GraphQL is
 * plain HTTP, whereas the transport below needs `docker exec` and therefore a
 * driver running on the host that owns the containers, the same cost
 * drivers/steve/records.ts pays and documents. That trade becomes worth making
 * the day someone needs to point this driver at a CitrineOS they do not own,
 * and when it does, `raw()` below is the only thing that has to change.
 *
 * MEASURED COST OF THIS TRANSPORT: ~350 ms per query, dominated by the
 * `docker exec` process spawn. Worth knowing before optimising the wrong
 * thing -- the cheap fix is a persistent psql session fed on stdin, not a
 * different database API.
 */
import {
  type CsmsChargingProfileRecords,
  type CsmsRecords,
} from "../../tck/driver";
import { waitForCondition } from "../../tck/wait";
import type { CitrineConfig } from "./config";
import { stationColumn } from "./variant";
import { refByDescription } from "./profiles";

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
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
  /** `AND "tenantId" = n`, spelled once. Every table below carries the column,
   *  and omitting it would read another tenant's rows as this tenant's. */
  private readonly tenant: string;

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
  private readonly station: string;

  constructor(private readonly cfg: CitrineConfig) {
    this.tenant = String(cfg.tenantId);
    this.station = `"${stationColumn(cfg.variant)}"`;
  }

  /** Runs SQL, returns stdout verbatim. The single path to the database. */
  private async raw(sql: string): Promise<string> {
    const proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        // `-e NAME` without a value forwards the variable from OUR environment.
        // `-e NAME=VALUE` would put the password in docker's own argv, where
        // `ps` shows it to every user on the host.
        "-e",
        "PGPASSWORD",
        this.cfg.dbContainer,
        "psql",
        // -q quiet, -t tuples only, -A unaligned, -X skip ~/.psqlrc.
        // -X is load-bearing twice over: it pins standard_conforming_strings
        // for sqlLiteral above, and it pins the NULL rendering to the default
        // empty string, which nullSafe's absence below depends on.
        "-qtAX",
        // Tab, so a multi-column row can be split without smuggling a
        // delimiter through a concatenation. Postgres's unaligned default is
        // '|', which appears in ordinary text far more often than a tab does.
        "-F",
        "\t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        this.cfg.dbUser,
        "-d",
        this.cfg.dbName,
        "-c",
        sql,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PGPASSWORD: this.cfg.dbPass },
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `citrineos db query failed (exit ${exitCode}): ${stderr.trim() || "<no stderr>"}`,
      );
    }
    return stdout;
  }

  /**
   * Runs SQL, returns the first column of the first row ("" if no rows).
   *
   * There is no `nullSafe` counterpart to SteVe's here, and that is a fact
   * about psql rather than an omission: `-t -A` renders a SQL NULL as the
   * empty string, so an unset stop timestamp already arrives as the "" that
   * assertNonEmpty must fail on. MariaDB prints the four characters "NULL",
   * which is why the other driver needs the extra step.
   */
  async scalar(sql: string): Promise<string> {
    return (await this.raw(sql)).split("\n")[0]?.trim() ?? "";
  }

  /** Runs SQL, returns every row as its list of columns ([] if no rows). */
  async rows(sql: string): Promise<string[][]> {
    return (await this.raw(sql))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t"));
  }

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
  private static readonly TX_AUTH_JOIN =
    'FROM "Transactions" t JOIN "Authorizations" a ON a.id = t."authorizationId"';

  async latestTransaction(cpId: string): Promise<string> {
    return this.scalar(
      `SELECT t.id FROM "Transactions" t
       WHERE ${this.station} = ${sqlLiteral(cpId)} AND t."tenantId" = ${this.tenant}
       ORDER BY t.id DESC LIMIT 1;`,
    );
  }

  /**
   * Binds a scenario's later assertions to the transaction ITS OWN drive()
   * created. latestTransaction() takes the newest row regardless of tag or
   * state, which on a reused charge point can pick up a stale closed
   * transaction from an earlier run instead of the racing in-progress one.
   */
  async waitForActiveTransaction(
    cpId: string,
    idTag: string,
    timeoutSecs = 15,
  ): Promise<string> {
    return waitForCondition(
      () =>
        this.scalar(
          `SELECT t.id ${CitrineRecords.TX_AUTH_JOIN}
           WHERE ${this.station} = ${sqlLiteral(cpId)} AND t."tenantId" = ${this.tenant}
             AND a."idToken" = ${sqlLiteral(idTag)} AND t."isActive" IS TRUE
           ORDER BY t.id DESC LIMIT 1;`,
        ),
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
    const raw = await this.scalar(
      `SELECT t."transactionId" FROM "Transactions" t
       WHERE t.id = ${sqlLiteral(ref)}::int AND t."tenantId" = ${this.tenant};`,
    );
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
  async prepareStation(cpId: string): Promise<void> {
    const cp = sqlLiteral(cpId);
    const t = this.tenant;
    await this.scalar(
      [
        `UPDATE "Transactions" SET "isActive" = false,
                "endTime" = COALESCE("endTime", NOW()),
                "stoppedReason" = COALESCE("stoppedReason", 'Local'),
                "updatedAt" = NOW()
         WHERE ${this.station} = ${cp} AND "tenantId" = ${t} AND "isActive" IS TRUE;`,
        // Join rows before their parents: both carry a foreign key.
        `DELETE FROM "LocalListVersionAuthorizations" WHERE "localListVersionId" IN
           (SELECT id FROM "LocalListVersions" WHERE ${this.station} = ${cp} AND "tenantId" = ${t});`,
        `DELETE FROM "SendLocalListAuthorizations" WHERE "sendLocalListId" IN
           (SELECT id FROM "SendLocalLists" WHERE ${this.station} = ${cp} AND "tenantId" = ${t});`,
        `DELETE FROM "SendLocalLists" WHERE ${this.station} = ${cp} AND "tenantId" = ${t};`,
        `DELETE FROM "LocalListVersions" WHERE ${this.station} = ${cp} AND "tenantId" = ${t};`,
      ].join("\n"),
    );
  }

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
  private txScalar(tx: string, expr: string): Promise<string> {
    if (tx === "") return Promise.resolve("");
    return this.scalar(
      `SELECT ${expr}
       FROM "Transactions" t
       LEFT JOIN "Authorizations" a ON a.id = t."authorizationId"
       LEFT JOIN "StopTransactions" st ON st."transactionDatabaseId" = t.id
       WHERE t.id = ${sqlLiteral(tx)}::int AND t."tenantId" = ${this.tenant}
       ORDER BY st."timestamp" DESC NULLS LAST
       LIMIT 1;`,
    );
  }

  async transactionIdTag(tx: string): Promise<string> {
    return this.txScalar(tx, 'COALESCE(a."idToken", st."idTokenValue")');
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
    return this.txScalar(tx, 'COALESCE(st."timestamp", t."endTime")');
  }

  async transactionStopReason(tx: string): Promise<string> {
    return this.txScalar(tx, 'COALESCE(st."reason", t."stoppedReason")');
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    return this.scalar(
      `SELECT COUNT(*) ${CitrineRecords.TX_AUTH_JOIN}
       WHERE ${this.station} = ${sqlLiteral(cpId)} AND t."tenantId" = ${this.tenant}
         AND a."idToken" = ${sqlLiteral(idTag)};`,
    );
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
    // Resolved from this driver's own fixture catalogue, not from the database.
    // profiles.ts explains why CitrineOS has nothing to look this up in.
    refByDescription: async (description: string) => refByDescription(description),
  };
}
