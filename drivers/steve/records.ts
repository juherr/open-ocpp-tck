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

export class SteveRecords implements CsmsRecords {
  constructor(private readonly cfg: SteveConfig) {}

  /** Runs SQL, returns the first column of the first row ("" if no rows). */
  async scalar(sql: string): Promise<string> {
    const proc = Bun.spawn(
      [
        "docker",
        "exec",
        "-i",
        // The password travels in the environment, never in argv: `docker exec`
        // arguments are visible in `ps` to every user on the host.
        "-e",
        `MYSQL_PWD=${this.cfg.dbPass}`,
        this.cfg.dbContainer,
        "mariadb",
        "-N",
        "-B",
        `-u${this.cfg.dbUser}`,
        this.cfg.dbName,
        "-e",
        sql,
      ],
      { stdout: "pipe", stderr: "pipe" },
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
    return stdout.split("\n")[0]?.trim() ?? "";
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
      `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = '${cpId}' ORDER BY t.transaction_pk DESC LIMIT 1;`,
    );
  }

  /** Most recent still-open transaction. Not part of the contract: it exists
   *  for the stale-transaction cleanup below. */
  async latestOpenTransaction(cpId: string): Promise<string> {
    return this.scalar(
      `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = '${cpId}' AND t.stop_timestamp IS NULL ORDER BY t.transaction_pk DESC LIMIT 1;`,
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
          `SELECT t.transaction_pk FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = '${cpId}' AND t.id_tag = '${idTag}' AND t.stop_timestamp IS NULL ORDER BY t.transaction_pk DESC LIMIT 1;`,
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
      `SELECT COUNT(*) FROM transaction t JOIN evse e ON e.evse_pk = t.evse_pk WHERE e.charge_box_id = '${cpId}' AND t.id_tag = '${idTag}';`,
    );
  }

  readonly reservations: CsmsReservationRecords = {
    latest: (cpId: string) =>
      this.scalar(
        `SELECT r.reservation_pk FROM reservation r JOIN evse e ON e.evse_pk = r.evse_pk WHERE e.charge_box_id = '${cpId}' ORDER BY r.reservation_pk DESC LIMIT 1;`,
      ),
    status: (reservation: string) =>
      this.nullSafe(
        `SELECT status FROM reservation WHERE reservation_pk=${reservation};`,
      ),
  };

  readonly chargingProfiles: CsmsChargingProfileRecords = {
    refByDescription: (description: string) =>
      this.scalar(
        `SELECT charging_profile_pk FROM charging_profile WHERE description = '${description}' LIMIT 1;`,
      ),
  };
}
