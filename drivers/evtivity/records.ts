// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * records.ts -- what the CSMS believes happened, read over its REST API.
 *
 * EVtivity keeps a charging SESSION per transaction (`ses_…`), and three
 * identities meet in it: the OCPP transactionId (a global integer counter,
 * stored as a string), the station's OCPP identity, and the REST id of the
 * station (`sta_…`). The ref this driver hands out is the OCPP transactionId,
 * so it goes back into RemoteStopTransaction and SetChargingProfile untouched.
 * Measured at v0.1.51 (.context step 0, Q5):
 *
 *  - a station's sessions: `GET /v1/stations/{sta}/sessions` -- transactionId,
 *    status, endedAt, but no idTag and no stop reason;
 *  - one session in full: `GET /v1/sessions/{ses}` -- `token.idToken`,
 *    `stoppedReason`, `endedAt`;
 *  - a transaction by its OCPP id, with no station: `GET /v1/sessions?search=`,
 *    which matches the transactionId as a SUBSTRING (and station ids, and
 *    driver names) -- so the rows are filtered on an exact transactionId;
 *  - a tag's sessions: `GET /v1/tokens?search=` (substring, filtered exact)
 *    for the token id, then `GET /v1/tokens/{dtk}/sessions`, whose rows carry
 *    the station's OCPP identity as `stationName`.
 *
 * The projections are eventually consistent; step 0 saw every write on the
 * first poll, 40 ms after the command's answer.
 *
 * THE API CACHES ITS GETS, and that is the larger lag. EVtivity stores every
 * 200 JSON answer of a matching route in Redis, keyed by user, access scope
 * and full URL (packages/api/src/plugins/response-cache.ts, CACHE_RULES,
 * matched on the route template): `/v1/stations` and `/v1/sessions` lists
 * for 10 s, `/v1/stations/*` and `/v1/sessions/*` for 5 s, `/v1/tokens` for
 * 30 s. A write through the API invalidates its own resource's tag; an OCPP
 * event invalidates none of them (events.ts bumps only the dashboard's). So a
 * read repeats, for up to its TTL, whatever the same URL answered before the
 * station's last message. Per method:
 *
 *  - `waitForActiveTransaction`, `transactionCountForIdTag`: the tag's
 *    sessions come from `/v1/tokens/{dtk}/sessions`, which no rule matches
 *    (`/v1/tokens` is an exact rule) -- uncached. The token id before it is
 *    cached 30 s, harmlessly: tokens are only written through the API.
 *  - `latestTransaction`, `openSessions`: `/v1/stations/{sta}/sessions`, 5 s.
 *    No uncached route lists a station's sessions. The station's REST id
 *    (`/v1/stations?search=`, 10 s) only changes through the API.
 *  - `transactionIdTag`, `transactionStopTimestamp`, `transactionStopReason`:
 *    `/v1/sessions?search=` (10 s) then `/v1/sessions/{ses}` (5 s). No
 *    uncached route carries `stoppedReason`, so a stop read within 5 s of a
 *    read of the same session made while it was active can come back empty.
 *    `/v1/sessions` is also rate limited, 60 a minute keyed by user
 *    (sessions.ts), and every lane of a sweep logs in as the same admin. Each
 *    of the three lookups spends one, cache hits included: the limit is an
 *    onRequest hook, the cache a preHandler. A 429 there is a non-dispatch.
 *
 * `Omit<CsmsRecords, "reservations" | "deviceModel">`, each a declared gap:
 *
 *  - reservations: a raw `v16/ReserveNow` creates no reservation row. The
 *    `command.ReserveNow` projection only confirms or rolls back a hold that
 *    `POST /v1/reservations` made (packages/ocpp/src/server/
 *    reservation-projections.ts), so the id a scenario's ReserveNow carried
 *    cannot be read back, and TC_051 is NOT APPLICABLE (scope.ts, which also
 *    says why the managed route cannot carry the driver's ReserveNow).
 *  - deviceModel: OCPP 1.6 only.
 *
 * `chargingProfiles` resolves from profiles.ts, for the reason given there.
 */
import type { CsmsChargingProfileRecords, CsmsRecords } from "../../tck/driver";
import { waitForCondition } from "../../tck/wait";
import { preview, query, type EvtivityApi } from "./api-client";
import { refByDescription } from "./profiles";

/** Every list route answers this envelope. */
interface Page<T> {
  data: T[];
  total: number;
}

/** A row of a station's or a token's sessions. */
interface SessionRow {
  id: string;
  stationName?: string | null;
  transactionId: string | null;
  status: string;
}

/** `GET /v1/sessions/{ses}`, narrowed. */
interface SessionDetail {
  transactionId: string | null;
  endedAt: string | null;
  stoppedReason: string | null;
  token?: { idToken?: string | null } | null;
}

interface StationRow {
  id: string;
  stationId: string;
}

interface TokenRow {
  id: string;
  idToken: string;
}

/** The route's own maximum page size. */
const PAGE_LIMIT = 100;

/** The highest numeric transactionId among the rows, or `""`. The routes sort
 *  by row creation, newest first (`createdAt desc, id desc`,
 *  lib/sorts/session-list-sort.ts), so the first row would do too; taking the
 *  highest id -- a global counter, and the ref itself -- does not depend on a
 *  sort a query parameter can change. */
function newest(rows: readonly SessionRow[]): string {
  const ids = rows.flatMap((row) =>
    row.transactionId !== null && /^\d+$/.test(row.transactionId)
      ? [Number(row.transactionId)]
      : [],
  );
  return ids.length === 0 ? "" : String(Math.max(...ids));
}

export class EvtivityRecords implements Omit<CsmsRecords, "reservations" | "deviceModel"> {
  constructor(private readonly api: EvtivityApi) {}

  private async page<T>(path: string): Promise<Page<T>> {
    const page = await this.api.get<Page<T>>(path);
    if (!page || !Array.isArray(page.data) || typeof page.total !== "number") {
      throw new Error(
        `evtivity: GET ${path} returned a body that is not a page: ${preview(JSON.stringify(page), 300)}`,
      );
    }
    return page;
  }

  /** Every row of a paged list, following `page=` until `total` is reached. */
  private async all<T>(path: string, params: Readonly<Record<string, string | number>>): Promise<T[]> {
    const rows: T[] = [];
    for (let pageNo = 1; ; pageNo++) {
      const page = await this.page<T>(`${path}${query({ ...params, page: pageNo, limit: PAGE_LIMIT })}`);
      rows.push(...page.data);
      if (page.data.length === 0 || rows.length >= page.total) return rows;
    }
  }

  /** The REST id of a station, or undefined when there is none. */
  async stationRestId(cpId: string): Promise<string | undefined> {
    const page = await this.page<StationRow>(
      `/v1/stations${query({ search: cpId, limit: PAGE_LIMIT })}`,
    );
    return page.data.find((row) => row.stationId === cpId)?.id;
  }

  /** The token id of an idTag, or undefined when there is none. */
  private async tokenId(idTag: string): Promise<string | undefined> {
    const page = await this.page<TokenRow>(
      `/v1/tokens${query({ search: idTag, limit: PAGE_LIMIT })}`,
    );
    return page.data.find((row) => row.idToken === idTag)?.id;
  }

  /** The sessions an idTag opened at one station. */
  private async tagSessions(cpId: string, idTag: string): Promise<SessionRow[]> {
    const dtk = await this.tokenId(idTag);
    if (dtk === undefined) return [];
    const rows = await this.all<SessionRow>(`/v1/tokens/${dtk}/sessions`, {});
    return rows.filter((row) => row.stationName === cpId);
  }

  async latestTransaction(cpId: string): Promise<string> {
    const sta = await this.stationRestId(cpId);
    if (sta === undefined) return "";
    return newest(
      (await this.page<SessionRow>(`/v1/stations/${sta}/sessions${query({ limit: PAGE_LIMIT })}`))
        .data,
    );
  }

  /** The REST ids of the station's still-active sessions. Not part of the
   *  contract: the prepare hook ends them. */
  async openSessions(cpId: string): Promise<string[]> {
    const sta = await this.stationRestId(cpId);
    if (sta === undefined) return [];
    const rows = await this.all<SessionRow>(`/v1/stations/${sta}/sessions`, { status: "active" });
    return rows.map((row) => row.id);
  }

  async waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs = 15): Promise<string> {
    return waitForCondition(
      async () =>
        newest((await this.tagSessions(cpId, idTag)).filter((row) => row.status === "active")),
      {
        timeoutMs: timeoutSecs * 1000,
        intervalMs: 500,
        description: `active transaction on ${cpId} (idTag=${idTag})`,
      },
    );
  }

  /** One transaction by its OCPP id, or undefined -- for a ref that is not an
   *  id, and for an id no session carries. */
  private async transaction(tx: string): Promise<SessionDetail | undefined> {
    if (!/^\d+$/.test(tx)) return undefined;
    const rows = await this.all<SessionRow>("/v1/sessions", { search: tx });
    const row = rows.find((r) => r.transactionId === tx);
    if (row === undefined) return undefined;
    return (await this.api.get<SessionDetail>(`/v1/sessions/${row.id}`, [404])) ?? undefined;
  }

  async transactionIdTag(tx: string): Promise<string> {
    return (await this.transaction(tx))?.token?.idToken ?? "";
  }

  async transactionStopTimestamp(tx: string): Promise<string> {
    return (await this.transaction(tx))?.endedAt ?? "";
  }

  async transactionStopReason(tx: string): Promise<string> {
    return (await this.transaction(tx))?.stoppedReason ?? "";
  }

  async transactionCountForIdTag(cpId: string, idTag: string): Promise<string> {
    return String((await this.tagSessions(cpId, idTag)).length);
  }

  readonly chargingProfiles: CsmsChargingProfileRecords = {
    refByDescription: async (description: string) => refByDescription(description),
  };
}
