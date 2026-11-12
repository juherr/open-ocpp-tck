// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * api-client.ts -- the REST client records.ts, provision.ts and the prepare
 * hook use: EVtivity's API under `/v1`, behind a bearer token.
 *
 * NOT THE COMMAND CLIENT. Operations go through `createEvtivityCsmsDriver`
 * from `@ovarilo/csms-drivers` (index.ts), whose client only posts commands
 * and is not exported. So this one exists for the reads and the fixture
 * writes -- GET, POST, PATCH, DELETE -- and it has a LOGIN CACHE OF ITS OWN:
 * a process that both dispatches and reads logs in twice, once per cache, and
 * a wrong password is refused twice, which spends the account's sign-in
 * backoff twice as fast. README.md states it for the user. Sharing the
 * library's cache would mean reaching into a module it does not export.
 *
 * WHAT THE SERVER ASKS OF A CLIENT, source-verified at v0.1.51
 * (packages/api/src/routes/users.ts, `/auth/login`):
 *
 *  - `POST /v1/auth/login {email, password}`, answered `{token, user, role}`;
 *    the token is a JWT that lives one hour;
 *  - `authorization: Bearer <token>` on every other call. No CSRF, no cookie.
 *
 * THE LOGIN RULES ARE THE LIBRARY'S, at 0.0.3, so the two caches cannot
 * disagree about what a refusal means:
 *
 *  - ONE LOGIN PER PROCESS. The route is rate limited (AUTH_RATE_LIMIT_MAX,
 *    30 per minute by default) and every refused password counts toward the
 *    account's sign-in backoff, so three sweep lanes, the readiness gate and
 *    `driver selftest` each logging in would spend a budget for nothing. The
 *    session is cached at module level, in-flight attempt included, keyed by
 *    server, account and a SHA-256 digest of the password -- never the
 *    password itself -- so a wrong password never borrows a session a right
 *    one opened, and a refusal kept for one does not block a corrected one.
 *  - A TOKEN OUTLIVED. The JWT's `exp` coming within {@link EXPIRY_MARGIN_MS}
 *    replaces the token before use. A request answered 401 drops the session,
 *    logs in once more and is sent again, once -- but only once the session
 *    is {@link RENEW_MIN_AGE_MS} old, since every renewal is a login and a
 *    401 the server keeps sending would otherwise spend one per request.
 *  - WHICH LOGIN FAILURES ARE KEPT. A 401 (INVALID_CREDENTIALS: a retry gets
 *    the same answer and feeds the backoff), a 403 (an MFA policy the account
 *    cannot meet) and a 200 `{mustResetPassword: true}` are kept for
 *    {@link KEPT_REFUSAL_MS}. Every other failure is forgotten and the next
 *    call tries again: a `fetch` that threw or timed out (the readiness gate
 *    waiting for an API still booting), a 429, a 5xx, a 2xx without a token.
 *
 * Kept or forgotten, every login failure is a {@link CsmsNotDispatchedError}:
 * nothing was asked of the server, and `warnOpFailed` lets only that class
 * out (issue #77). So what the cache keeps is a flag on the error, never its
 * class.
 *
 * FAILURE CLASSES. A request that could not CONNECT, or that our own timeout
 * aborted after it left, is {@link CsmsNotDispatchedError}. For `request()`, a
 * non-2xx is one too, as for every bundled driver: a refused read or fixture
 * write is one whose effect did not happen. A 2xx whose body cannot be read
 * is neither that nor an empty result: a plain error, since a write took
 * effect and a read would otherwise report a record as absent.
 *
 * GUARDED OFFLINE by tests/evtivity-adapter.ts, through the `fetch` seam.
 */
import { createHash } from "node:crypto";
import { CsmsNotDispatchedError, type FetchLike } from "../../tck/driver";
import type { EvtivityConfig } from "./config";

/** REST reads and fixture writes, and the login. */
const REQUEST_TIMEOUT_MS = 15_000;
/** A token this close to its `exp` is replaced before use. */
const EXPIRY_MARGIN_MS = 60_000;
/** The age from which a 401 may renew a session: at most one login a minute
 *  out of a rate limit of thirty. See the header. */
const RENEW_MIN_AGE_MS = 60_000;
/** How long a kept login refusal is kept. See the header. */
const KEPT_REFUSAL_MS = 15 * 60_000;
const BODY_PREVIEW = 300;

interface Session {
  token: string;
  /** Epoch ms, or Infinity when the token carries no readable `exp`. */
  expiresAt: number;
  /** From when a 401 may renew this session. See the header. */
  renewableAt: number;
}

/** Keyed by server, account and password digest. See the header for why it
 *  is process-wide. */
const sessions = new Map<string, Promise<Session>>();
/** When each kept login refusal in {@link sessions} was received. */
const refusedAt = new Map<string, number>();

/** An error's message, or the thrown value as a string. */
export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The first `max` characters of a text quoted in a failure message. */
export function preview(text: string, max = BODY_PREVIEW): string {
  return text?.slice(0, max);
}

/** Login refusals a retry would only repeat. See the header. */
const KEPT_REFUSALS: readonly number[] = [401, 403];

/**
 * A login that produced no token. Always a non-dispatch: it fails before any
 * command is sent, so a scenario that warned and went on would assert about a
 * station nobody asked. Whether the session cache keeps it is the `kept` flag,
 * not the class -- every login failure shares the class; see the header.
 */
class LoginFailed extends CsmsNotDispatchedError {
  constructor(
    operation: string,
    reason: string,
    readonly kept: boolean,
  ) {
    super(operation, reason);
  }
}

/** A `fetch` rejection by our own timeout, after the request may have left. */
function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException || err instanceof Error) &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

/** The parsed JSON of a text, or undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The `exp` of a JWT, in epoch ms, or Infinity when it cannot be read. */
function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

export interface RawResponse {
  status: number;
  /** The body as text; `""` when it could not be read. */
  text: string;
  /** Why the body could not be read, when it could not: `request()` refuses
   *  a 2xx answered so, rather than read it as an empty result. */
  unreadable?: string;
}

export interface ApiResponse {
  status: number;
  parsed: unknown;
}

export class EvtivityApi {
  /** `fetchImpl` is the {@link FetchLike} seam. The default resolves the
   *  global per call rather than capturing it, as the contract asks. */
  constructor(
    readonly cfg: EvtivityConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
  ): Promise<RawResponse> {
    const url = `${this.cfg.apiUrl}${path}`;
    const what = `evtivity: ${method} ${url}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // A timeout is filed with the requests that never connected: the
      // request left, but nothing shows it became an OCPP CALL, and the
      // contract (CsmsNotDispatchedError) claims exactly that.
      const why = isAbort(err)
        ? `timed out after ${timeoutMs} ms: the request left, and whether the ` +
          `server acted on it is unknown (${reason(err)})`
        : reason(err);
      throw new CsmsNotDispatchedError(what, why);
    }
    try {
      return { status: res.status, text: await res.text() };
    } catch (err) {
      return { status: res.status, text: "", unreadable: reason(err) };
    }
  }

  /** Server, account and a digest of the password -- never the password
   *  itself. See the header. */
  private sessionKey(): string {
    const digest = createHash("sha256").update(this.cfg.password).digest("hex");
    return `${this.cfg.apiUrl}|${this.cfg.email}|${digest}`;
  }

  /** The cached session and the cache entry it came from, logging in on
   *  first use, when it runs out, and once a kept refusal has expired. */
  private async session(): Promise<{ session: Session; entry: Promise<Session> }> {
    const key = this.sessionKey();
    const refused = refusedAt.get(key);
    if (refused !== undefined && Date.now() - refused >= KEPT_REFUSAL_MS) {
      this.forget(sessions.get(key));
    }
    const cached = sessions.get(key);
    if (cached !== undefined) {
      const session = await cached;
      if (session.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return { session, entry: cached };
      this.forget(cached);
      return this.session();
    }
    const pending = this.login();
    sessions.set(key, pending);
    pending.catch((err: unknown) => {
      if (sessions.get(key) !== pending) return;
      if (err instanceof LoginFailed && err.kept) refusedAt.set(key, Date.now());
      else sessions.delete(key);
    });
    return { session: await pending, entry: pending };
  }

  /** Drops a cache entry, unless a newer one already replaced it. */
  private forget(entry: Promise<Session> | undefined): void {
    const key = this.sessionKey();
    if (entry !== undefined && sessions.get(key) === entry) {
      sessions.delete(key);
      refusedAt.delete(key);
    }
  }

  private async login(): Promise<Session> {
    const what = "evtivity: POST /v1/auth/login";
    const res = await this.send(
      "POST",
      "/v1/auth/login",
      {},
      { email: this.cfg.email, password: this.cfg.password },
      REQUEST_TIMEOUT_MS,
    );
    if (KEPT_REFUSALS.includes(res.status)) {
      throw new LoginFailed(
        what,
        `returned ${res.status} for ${this.cfg.email}` +
          " -- every refused password counts toward the account's sign-in" +
          ` backoff, so this process will not try again for fifteen minutes:` +
          ` ${preview(res.text)}`,
        true,
      );
    }
    if (res.status < 200 || res.status > 299) {
      throw new CsmsNotDispatchedError(
        what,
        `returned ${res.status} for ${this.cfg.email}: ${preview(res.text)}`,
      );
    }
    const body = parseJson(res.text) as { token?: unknown; mustResetPassword?: unknown } | undefined;
    if (body?.mustResetPassword === true) {
      throw new LoginFailed(
        what,
        `${this.cfg.email} must reset its password before it can sign ` +
          "in (seed it with INITIAL_ADMIN_MUST_RESET_PASSWORD=false); this " +
          "process will not try again for fifteen minutes",
        true,
      );
    }
    if (typeof body?.token !== "string" || body.token === "") {
      throw new LoginFailed(
        what,
        `answered ${res.status} without a token: ${preview(res.text)}`,
        false,
      );
    }
    return {
      token: body.token,
      expiresAt: expiryOf(body.token),
      renewableAt: Date.now() + RENEW_MIN_AGE_MS,
    };
  }

  /** One send under the cached session, with the session it used. */
  private async authenticated(
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ res: RawResponse; entry: Promise<Session>; session: Session }> {
    const { session, entry } = await this.session();
    const res = await this.send(
      method,
      path,
      { authorization: `Bearer ${session.token}` },
      method === "GET" || method === "DELETE" ? undefined : (body ?? {}),
      REQUEST_TIMEOUT_MS,
    );
    return { res, entry, session };
  }

  /**
   * One authenticated request, raw: the caller reads the status. A 401
   * renews the session and is sent once more, but only once that session is
   * old enough; see the header.
   */
  async raw(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<RawResponse> {
    const first = await this.authenticated(method, path, body);
    if (first.res.status !== 401 || Date.now() < first.session.renewableAt) return first.res;
    this.forget(first.entry);
    return (await this.authenticated(method, path, body)).res;
  }

  /**
   * One REST request. A non-2xx is a {@link CsmsNotDispatchedError}, except the
   * statuses `allow` lists -- a 404 that means "no such record", a 409 that
   * means "already there" -- which return with `parsed: null`.
   */
  async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    allow: readonly number[] = [],
  ): Promise<ApiResponse> {
    const res = await this.raw(method, path, body);
    const what = `evtivity: ${method} ${path}`;
    const ok = res.status >= 200 && res.status <= 299;
    if (!ok && !allow.includes(res.status)) {
      throw new CsmsNotDispatchedError(what, `returned ${res.status}: ${preview(res.text)}`);
    }
    if (ok && res.unreadable !== undefined) {
      // Not a non-dispatch: the server answered 2xx, so a write took effect.
      // Nor an empty result: a read would report a record as absent.
      throw new Error(`${what} returned ${res.status} and its body could not be read: ${res.unreadable}`);
    }
    if (!ok || res.text === "") return { status: res.status, parsed: null };
    try {
      return { status: res.status, parsed: JSON.parse(res.text) as unknown };
    } catch {
      throw new Error(`${what} returned unparseable body: ${preview(res.text)}`);
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
