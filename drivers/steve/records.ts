// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
// PROVENANCE: derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/steve.ts
// (class SteveDb) @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified:
// implements the CSMS-neutral CsmsRecords contract, with reservations and charging
// profiles moved onto the optional capability sub-interfaces.
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
import {
  type CsmsChargingProfileRecords,
  type CsmsRecords,
  type CsmsReservationRecords,
} from "../../tck/driver";
import { waitForCondition } from "../../tck/wait";
import { SteveWebApi, type SteveApiConfig } from "./api-client";
import type { SteveConfig } from "./ui-client";

/**
 * SteVe's `Transaction` DTO, narrowed to the fields the contract needs.
 *
 * Every one is optional-by-absence rather than trusted: a still-open
 * transaction carries `stopTimestamp: null`, and a StopTransaction that named
 * no reason carries `stopReason: null`. Both must reach the assertions as `""`
 * -- the contract's "not set" -- and never as the string "null", which is
 * exactly the trap `nullSafe` guards on the SQL side.
 */
interface SteveTransaction {
  id: number;
  ocppIdTag: string | null;
  stopTimestamp: string | null;
  stopReason: string | null;
}

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
export function sqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export class SteveRecords implements CsmsRecords {
  private readonly api: SteveWebApi;

  constructor(
    private readonly cfg: SteveConfig,
    apiCfg: SteveApiConfig,
  ) {
    this.api = new SteveWebApi(apiCfg);
  }

  /** Runs SQL, returns stdout verbatim. The single path to the database. */
  private async raw(sql: string): Promise<string> {
    const proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        // `-e NAME` without a value forwards the variable from OUR environment,
        // which is the whole point: `-e NAME=VALUE` would put the password in
        // docker's own argv, where `ps` shows it to every user on the host.
        "-e",
        "MYSQL_PWD",
        this.cfg.dbContainer,
        "mariadb",
        "-N",
        "-B",
        `-u${this.cfg.dbUser}`,
        this.cfg.dbName,
        "-e",
        sql,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, MYSQL_PWD: this.cfg.dbPass },
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `SteVe db query failed (exit ${exitCode}): ${stderr.trim() || "<no stderr>"}`,
      );
    }
    return stdout;
  }

  /** Runs SQL, returns the first column of the first row ("" if no rows). */
  async scalar(sql: string): Promise<string> {
    return (await this.raw(sql)).split("\n")[0]?.trim() ?? "";
  }

  /**
   * Runs SQL, returns every row as its list of columns ([] if no rows).
   *
   * `mariadb -N -B` already emits one tab-separated row per line, so a caller
   * that needs several columns -- or several rows -- does not have to smuggle
   * them through a delimiter in a CONCAT and unpack them by hand. Each such
   * query is one process spawn, which is what makes the difference between
   * asking about twenty tags and asking twenty times.
   */
  async rows(sql: string): Promise<string[][]> {
    const raw = await this.raw(sql);
    return raw
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t"));
  }

  /**
   * scalar(), normalising a genuine SQL NULL to "".
   *
   * `mariadb -N -B` renders a SQL NULL as the literal four characters "NULL",
   * not an empty string. Without this, assertNonEmpty on a still-open
   * transaction's stop_timestamp would PASS -- "NULL" is non-empty -- and the
   * scenario would report a closed transaction that is still running. A
   * zero-row result already comes back as "" because MariaDB prints nothing.
   */
  private async nullSafe(sql: string): Promise<string> {
    const raw = await this.scalar(sql);
    return raw === "NULL" ? "" : raw;
  }

  /**
   * The transactions matching a filter. The single path to the WebAPI's
   * transaction registry, so no call site has to know the route or the
   * repeated-key convention its list filters use.
   */
  private async transactions(
    ...filters: readonly (readonly [string, string])[]
  ): Promise<SteveTransaction[]> {
    return this.api.getJson<SteveTransaction[]>("/transactions", filters);
  }

  /**
   * The newest of a filtered set, as the contract's `""`-when-absent string.
   *
   * The maximum is taken here rather than trusted from the response order:
   * SteVe's query form takes no sort parameter, so the order is the
   * repository's business and not a promise. The SQL this replaced said
   * `ORDER BY transaction_pk DESC LIMIT 1` out loud.
   */
  private static newest(rows: readonly SteveTransaction[]): string {
    return rows.length === 0 ? "" : String(Math.max(...rows.map((r) => r.id)));
  }

  async latestTransaction(cpId: string): Promise<string> {
    return SteveRecords.newest(await this.transactions(["chargeBoxId", cpId]));
  }

  /** Most recent still-open transaction. Not part of the contract: it exists
   *  for the stale-transaction cleanup below. */
  async latestOpenTransaction(cpId: string): Promise<string> {
    return SteveRecords.newest(
      await this.transactions(["chargeBoxId", cpId], ["type", "ACTIVE"]),
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
      async () =>
        SteveRecords.newest(
          await this.transactions(
            ["chargeBoxId", cpId],
            ["ocppIdTag", idTag],
            ["type", "ACTIVE"],
          ),
        ),
      {
        timeoutMs: timeoutSecs * 1000,
        intervalMs: 1_000,
        description: `active transaction on ${cpId} (id_tag=${idTag})`,
      },
    );
  }

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
  async closeStaleTransaction(cpId: string): Promise<void> {
    const pk = await this.latestOpenTransaction(cpId);
    if (!pk) return;
    await this.api.send("PATCH", `/transactions/${pk}/stop`);
  }

  /** One transaction by primary key, or undefined. The three accessors below
   *  each read one field off it. */
  private async transaction(tx: string): Promise<SteveTransaction | undefined> {
    return (await this.transactions(["transactionPk", tx]))[0];
  }

  async transactionIdTag(tx: string): Promise<string> {
    return (await this.transaction(tx))?.ocppIdTag ?? "";
  }

  async transactionStopTimestamp(tx: string): Promise<string> {
    return (await this.transaction(tx))?.stopTimestamp ?? "";
  }

  async transactionStopReason(tx: string): Promise<string> {
    return (await this.transaction(tx))?.stopReason ?? "";
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    const rows = await this.transactions(
      ["chargeBoxId", cpId],
      ["ocppIdTag", idTag],
    );
    return String(rows.length);
  }

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
  async idTagsReferenced(idTags: readonly string[]): Promise<Set<string>> {
    if (idTags.length === 0) return new Set();
    const [transactions, reservations] = await Promise.all([
      this.transactions(...idTags.map((t) => ["ocppIdTag", t] as const)),
      this.rows(
        `SELECT DISTINCT id_tag FROM reservation
          WHERE id_tag IN (${idTags.map(sqlLiteral).join(", ")});`,
      ),
    ]);
    return new Set([
      ...transactions.map((row) => row.ocppIdTag),
      ...reservations.map(([idTag]) => idTag),
    ].filter((tag): tag is string => !!tag));
  }

  /** SQL until [steve-community/steve#2074] exposes reservation resources. */
  readonly reservations: CsmsReservationRecords = {
    latest: (cpId: string) =>
      this.scalar(
        `SELECT r.reservation_pk FROM reservation r JOIN evse e ON e.evse_pk = r.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} ORDER BY r.reservation_pk DESC LIMIT 1;`,
      ),
    // The ref goes into the statement unquoted, as the primary key it is, so a
    // ref that is not a number has to stop here: `latest()` answers "" when the
    // station has no reservation, and a spec that passes that straight through
    // -- which is what a rejected ReserveNow produces -- would otherwise send
    // `reservation_pk=` and get a SQL syntax error where the contract promises
    // "". Found by `driver selftest`, which calls every method with an empty
    // ref for exactly this reason.
    status: (reservation: string) =>
      /^\d+$/.test(reservation)
        ? this.nullSafe(
            `SELECT status FROM reservation WHERE reservation_pk=${reservation};`,
          )
        : Promise.resolve(""),
  };

  /** SQL until [steve-community/steve#2069] exposes charging-profile CRUD. */
  readonly chargingProfiles: CsmsChargingProfileRecords = {
    refByDescription: (description: string) =>
      this.scalar(
        `SELECT charging_profile_pk FROM charging_profile WHERE description = ${sqlLiteral(description)} LIMIT 1;`,
      ),
  };
}
