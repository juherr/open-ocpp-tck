// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
// PROVENANCE: derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/steve.ts
// (class SteveDb) @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified:
// implements the CSMS-neutral CsmsRecords contract, with reservations and charging
// profiles moved onto the optional capability sub-interfaces.
/**
 * records.ts -- what SteVe believes happened, read straight from its MariaDB.
 *
 * SteVe's REST API does not expose stop_reason, reservation status or the
 * charging-profile registry, so the scenarios that assert on those can only be
 * answered from the database. The queries shell out through `docker exec`,
 * which means this driver has to run where that container is.
 */
import {
  type CsmsChargingProfileRecords,
  type CsmsRecords,
  type CsmsReservationRecords,
} from "../../tck/driver";
import { waitForCondition } from "../../tck/wait";
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
export function sqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export class SteveRecords implements CsmsRecords {
  constructor(private readonly cfg: SteveConfig) {}

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

  async latestTransaction(cpId: string): Promise<string> {
    return this.scalar(
      `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} ORDER BY t.transaction_pk DESC LIMIT 1;`,
    );
  }

  /** Most recent still-open transaction. Not part of the contract: it exists
   *  for the stale-transaction cleanup below. */
  async latestOpenTransaction(cpId: string): Promise<string> {
    return this.scalar(
      `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} AND t.stop_timestamp IS NULL ORDER BY t.transaction_pk DESC LIMIT 1;`,
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
          `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} AND t.id_tag = ${sqlLiteral(idTag)} AND t.stop_timestamp IS NULL ORDER BY t.transaction_pk DESC LIMIT 1;`,
        ),
      {
        timeoutMs: timeoutSecs * 1000,
        intervalMs: 1_000,
        description: `active transaction on ${cpId} (id_tag=${idTag})`,
      },
    );
  }

  /** Closes any transaction left open by an interrupted run, so that
   *  max_active_transaction_count does not block the next scenario.
   *  Idempotent. A WRITE, hence a lifecycle hook and not part of CsmsRecords. */
  async closeStaleTransaction(cpId: string): Promise<void> {
    const pk = await this.latestOpenTransaction(cpId);
    if (!pk) return;
    await this.scalar(
      `INSERT INTO transaction_stop (transaction_pk, event_timestamp, event_actor, stop_timestamp, stop_value, stop_reason) VALUES (${pk}, NOW(), 'manual', NOW(), '0', 'Local');`,
    );
  }

  async transactionIdTag(tx: string): Promise<string> {
    return this.nullSafe(
      `SELECT id_tag FROM transaction WHERE transaction_pk=${tx};`,
    );
  }

  async transactionStopTimestamp(tx: string): Promise<string> {
    return this.nullSafe(
      `SELECT stop_timestamp FROM transaction WHERE transaction_pk=${tx};`,
    );
  }

  async transactionStopReason(tx: string): Promise<string> {
    return this.nullSafe(
      `SELECT stop_reason FROM transaction WHERE transaction_pk=${tx};`,
    );
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    return this.scalar(
      `SELECT COUNT(*) FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} AND t.id_tag = ${sqlLiteral(idTag)};`,
    );
  }

  readonly reservations: CsmsReservationRecords = {
    latest: (cpId: string) =>
      this.scalar(
        `SELECT r.reservation_pk FROM reservation r JOIN evse e ON e.evse_pk = r.evse_pk WHERE e.charge_box_id = ${sqlLiteral(cpId)} ORDER BY r.reservation_pk DESC LIMIT 1;`,
      ),
    status: (reservation: string) =>
      this.nullSafe(
        `SELECT status FROM reservation WHERE reservation_pk=${reservation};`,
      ),
  };

  readonly chargingProfiles: CsmsChargingProfileRecords = {
    refByDescription: (description: string) =>
      this.scalar(
        `SELECT charging_profile_pk FROM charging_profile WHERE description = ${sqlLiteral(description)} LIMIT 1;`,
      ),
  };
}
