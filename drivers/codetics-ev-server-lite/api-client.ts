// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * api-client.ts -- the one HTTP surface this driver uses: the server's admin
 * REST API under `/api/v1`.
 *
 * WHAT THE SERVER ASKS OF A CLIENT, source-verified at the pinned commit
 * (security/SecurityConfiguration.kt, security/AuthController.kt):
 *
 *  - a bearer token from `POST /api/v1/auth/app/signin {tenant,email,password}`,
 *    answered as `{token, expires_at, user}`;
 *  - CSRF on EVERY mutating request, signin included, bearer or not. The
 *    repository is `CookieCsrfTokenRepository` with the plain (non-XOR) request
 *    handler, so the token `GET /api/v1/auth/csrf` returns is sent back twice:
 *    as the `XSRF-TOKEN` cookie and in the header that response names.
 *
 * ONE LOGIN PER PROCESS, AND THE REASON IS A LIMIT RATHER THAN A COURTESY.
 * AccountService#login counts every attempt, good or bad, against
 * `login:<tenant>:<email>` -- ten per fifteen minutes -- and the counter lives
 * in the server's database, so only a restart clears it. Three sweep lanes,
 * the readiness gate and `driver selftest` each calling `create()` would
 * otherwise spend that budget in one run. So the session is cached at module
 * level, keyed by server and account, and shared by every client in the
 * process, in-flight attempt included.
 *
 * ONLY A REFUSED SIGNIN IS CACHED. The counter is incremented by
 * `POST /api/v1/auth/app/signin` alone (AccountService#login is the one caller
 * of RateLimiter#check on this path), and it counts before anything else in
 * login can fail. A signin answered 401 (bad credentials) or 429 (the limit)
 * was counted and is deterministic: a retry gets the same answer and spends
 * more budget. A 403 never reaches login -- the security chain's
 * access-denied handler sends it, i.e. the CSRF pair was refused -- and is
 * kept because the same pair would be refused again, not because it was
 * counted. Those three are kept for the life of the process. Every other
 * failure is dropped from the cache and the next call tries again: a `fetch`
 * that threw (the readiness gate waiting for a CSMS still booting), any answer
 * to the uncounted `GET /api/v1/auth/csrf`, a 2xx without a token, and a
 * signin 5xx -- which WAS counted, and is retried anyway because it is the
 * server's transient fault, and keeping it would fail every later lane and
 * scenario for one bad moment.
 *
 * FAILURE CLASSES. A request `fetch` could not complete, and one the server
 * answered with a non-2xx status, are both {@link CsmsNotDispatchedError}: for
 * every call this driver makes, a refused HTTP request is one whose effect --
 * a queued command, a seeded fixture, a read -- did not happen, so nothing it
 * would have caused went on the wire. A 2xx whose body cannot be read is a
 * plain `Error`: the request was answered, and whether it took effect is
 * exactly what is unknown.
 *
 * GUARDED OFFLINE by tests/codetics-ev-server-lite-dispatch.ts, through the
 * `fetch` seam below: the login cache's two branches, and this classification
 * as requests.ts's dispatch wait reaches it.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../../tck/driver";
import type { EvslConfig } from "./config";

const REQUEST_TIMEOUT_MS = 15_000;
const BODY_PREVIEW = 300;

interface Session {
  token: string;
  csrf: string;
  csrfHeader: string;
}

/** Keyed by server and account. See the header for why it is process-wide. */
const sessions = new Map<string, Promise<Session>>();

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function bodyPreview(res: Response): Promise<string> {
  return (await res.text().catch(() => "<unreadable body>")).slice(0, BODY_PREVIEW);
}

/** The value of one cookie among a response's `Set-Cookie` headers, or
 *  undefined. Only the CSRF cookie is ever read, so this is not a jar. */
function setCookie(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (pair !== undefined && eq > 0 && pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

/** The signin statuses a retry would only repeat: bad credentials (401) and
 *  the limit itself (429), both counted, and a refused CSRF pair (403), which
 *  is not. See the header. */
const KEPT_REFUSALS: readonly number[] = [401, 403, 429];

/** A signin refused with one of {@link KEPT_REFUSALS}. The one login
 *  failure the session cache keeps; see the header. */
class SigninRefused extends CsmsNotDispatchedError {}

export interface ApiResponse {
  status: number;
  parsed: unknown;
}

export class EvslApi {
  /** `fetchImpl` is the {@link FetchLike} seam. The default resolves the
   *  global per call rather than capturing it, as the contract asks. */
  constructor(
    private readonly cfg: EvslConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    const url = `${this.cfg.apiUrl}${path}`;
    try {
      return await this.fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        // JSON.stringify keeps insertion order, and the server forwards a
        // command payload's members in the order it received them -- which
        // requests.ts relies on for SendLocalList.
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CsmsNotDispatchedError(`codetics-ev-server-lite: ${method} ${url}`, reason(err));
    }
  }

  private sessionKey(): string {
    return `${this.cfg.apiUrl}|${this.cfg.tenant}|${this.cfg.email}`;
  }

  /** The cached session, logging in on first use. */
  private session(): Promise<Session> {
    const key = this.sessionKey();
    let pending = sessions.get(key);
    if (pending === undefined) {
      pending = this.login();
      sessions.set(key, pending);
      pending.catch((err: unknown) => {
        if (!(err instanceof SigninRefused) && sessions.get(key) === pending) {
          sessions.delete(key);
        }
      });
    }
    return pending;
  }

  private async login(): Promise<Session> {
    const csrfRes = await this.send("GET", "/api/v1/auth/csrf", {}, undefined);
    if (!csrfRes.ok) {
      throw new CsmsNotDispatchedError(
        "codetics-ev-server-lite: GET /api/v1/auth/csrf",
        `returned ${csrfRes.status}: ${await bodyPreview(csrfRes)}`,
      );
    }
    const csrfBody = (await csrfRes.json().catch(() => null)) as {
      token?: unknown;
      headerName?: unknown;
    } | null;
    const csrf =
      setCookie(csrfRes, "XSRF-TOKEN") ??
      (typeof csrfBody?.token === "string" ? csrfBody.token : undefined);
    const csrfHeader =
      typeof csrfBody?.headerName === "string" ? csrfBody.headerName : "X-XSRF-TOKEN";
    if (csrf === undefined) {
      throw new Error(
        "codetics-ev-server-lite: GET /api/v1/auth/csrf answered without a token",
      );
    }

    const what = "codetics-ev-server-lite: POST /api/v1/auth/app/signin";
    const res = await this.send(
      "POST",
      "/api/v1/auth/app/signin",
      { cookie: `XSRF-TOKEN=${csrf}`, [csrfHeader]: csrf },
      { tenant: this.cfg.tenant, email: this.cfg.email, password: this.cfg.password },
    );
    if (KEPT_REFUSALS.includes(res.status)) {
      throw new SigninRefused(
        what,
        `returned ${res.status} for ${this.cfg.email} on tenant ${this.cfg.tenant}` +
          " -- the server counts every attempt against a limit of ten per" +
          " fifteen minutes, so this process will not try again" +
          `: ${await bodyPreview(res)}`,
      );
    }
    if (!res.ok) {
      throw new CsmsNotDispatchedError(
        what,
        `returned ${res.status} for ${this.cfg.email} on tenant ${this.cfg.tenant}` +
          `: ${await bodyPreview(res)}`,
      );
    }
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || body.token === "") {
      throw new Error(`${what} answered ${res.status} without a token`);
    }
    return { token: body.token, csrf: setCookie(res, "XSRF-TOKEN") ?? csrf, csrfHeader };
  }

  /**
   * One authenticated request. `body` present makes it a mutation, which
   * carries the CSRF pair. `allow` lists the non-2xx statuses the caller
   * handles itself -- a 404 that means "no such record", a 409 that means
   * "already there" -- and returns rather than throws for.
   */
  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    allow: readonly number[] = [],
  ): Promise<ApiResponse> {
    const session = await this.session();
    const mutating = method !== "GET";
    const res = await this.send(
      method,
      path,
      {
        authorization: `Bearer ${session.token}`,
        ...(mutating
          ? { cookie: `XSRF-TOKEN=${session.csrf}`, [session.csrfHeader]: session.csrf }
          : {}),
      },
      mutating ? (body ?? {}) : undefined,
    );
    const rotated = setCookie(res, "XSRF-TOKEN");
    if (rotated !== undefined) session.csrf = rotated;

    const what = `codetics-ev-server-lite: ${method} ${path}`;
    if (!res.ok && !allow.includes(res.status)) {
      throw new CsmsNotDispatchedError(
        what,
        `returned ${res.status}: ${await bodyPreview(res)}`,
      );
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new Error(`${what} answered ${res.status} but its body could not be read: ${reason(err)}`);
    }
    if (!res.ok || text === "") return { status: res.status, parsed: null };
    try {
      return { status: res.status, parsed: JSON.parse(text) as unknown };
    } catch {
      throw new Error(`${what} returned unparseable body: ${text.slice(0, BODY_PREVIEW)}`);
    }
  }

  async get<T>(path: string, allow: readonly number[] = []): Promise<T | null> {
    return (await this.request("GET", path, undefined, allow)).parsed as T | null;
  }
}

/** `?a=1&b=2` from the members that are set, or `""`. */
export function query(params: Readonly<Record<string, string | number | undefined>>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)]))}`;
}
