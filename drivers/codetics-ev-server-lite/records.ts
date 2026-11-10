// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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
import { waitForCondition } from "../../tck/wait";
import { query, type EvslApi } from "./api-client";
import { refByDescription } from "./profiles";

/** ChargingSessionResponse, narrowed to what the contract reads. Every member
 *  may be null -- an open transaction has no `stopped_at` -- and null reaches
 *  the assertions as `""`, the contract's "not set". */
interface SessionRow {
  id: number | null;
  station_id: string;
  token_uid: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

/** The page size a "newest" read asks for. The server sorts by `startedAt`, a
 *  timestamp the STATION supplies, so the newest row is taken by id from a
 *  page rather than trusted to be first. */
const NEWEST_WINDOW = 50;

function newest(rows: readonly SessionRow[]): string {
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  return ids.length === 0 ? "" : String(Math.max(...ids));
}

export class EvslRecords implements Omit<CsmsRecords, "reservations" | "deviceModel"> {
  constructor(private readonly api: EvslApi) {}

  private async page(
    filters: Readonly<Record<string, string | number | undefined>>,
  ): Promise<Page<SessionRow>> {
    const page = await this.api.get<Page<SessionRow>>(
      `/api/v1/transactions${query(filters)}`,
    );
    if (!page || !Array.isArray(page.items) || typeof page.total !== "number") {
      throw new Error(
        `codetics-ev-server-lite: GET /api/v1/transactions returned a body that is not a page: ${JSON.stringify(page)?.slice(0, 300)}`,
      );
    }
    return page;
  }

  async latestTransaction(cpId: string): Promise<string> {
    return newest((await this.page({ stationId: cpId, limit: NEWEST_WINDOW })).items);
  }

  /** The station's still-open transactions. Not part of the contract: the
   *  prepare hook closes them. */
  async openTransactions(cpId: string): Promise<string[]> {
    const page = await this.page({ stationId: cpId, status: "active", limit: NEWEST_WINDOW });
    return page.items
      .map((row) => row.id)
      .filter((id): id is number => typeof id === "number")
      .map(String);
  }

  async waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs = 15): Promise<string> {
    return waitForCondition(
      async () =>
        newest(
          (
            await this.page({
              stationId: cpId,
              tokenUid: idTag,
              status: "active",
              limit: NEWEST_WINDOW,
            })
          ).items,
        ),
      {
        timeoutMs: timeoutSecs * 1000,
        intervalMs: 1_000,
        description: `active transaction on ${cpId} (idTag=${idTag})`,
      },
    );
  }

  /** One transaction by id, or undefined -- for a ref that is not an id, and
   *  for an id the server answers 404 for. */
  private async transaction(tx: string): Promise<SessionRow | undefined> {
    if (!/^\d+$/.test(tx)) return undefined;
    const row = await this.api.get<SessionRow>(`/api/v1/transactions/${tx}`, [404]);
    return row ?? undefined;
  }

  async transactionIdTag(tx: string): Promise<string> {
    return (await this.transaction(tx))?.token_uid ?? "";
  }

  async transactionStopTimestamp(tx: string): Promise<string> {
    return (await this.transaction(tx))?.stopped_at ?? "";
  }

  async transactionStopReason(tx: string): Promise<string> {
    return (await this.transaction(tx))?.stop_reason ?? "";
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    return String((await this.page({ stationId: cpId, tokenUid: idTag, limit: 1 })).total);
  }

  readonly chargingProfiles: CsmsChargingProfileRecords = {
    refByDescription: async (description: string) => refByDescription(description),
  };
}
