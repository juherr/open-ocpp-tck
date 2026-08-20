// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
// PROVENANCE: derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/steve.ts
// @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: reduced to the
// manager-UI client and its config; the driver contract it used to declare now lives
// in the CSMS-neutral core.
/**
 * ui-client.ts -- SteVe's manager UI, driven exactly as a browser would drive
 * it: log in, read the CSRF token out of the operation page, POST the form.
 *
 * This is the transport of last resort and the transport of record. SteVe's
 * REST API pre-validates some operations server-side and never puts them on
 * the wire; the UI path does not, which matters for any scenario whose point
 * is that the CHARGE POINT produces the answer.
 */
import { CsmsNotDispatchedError } from "../../tck/driver";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface SteveConfig {
  /** e.g. http://steve:8180/steve/manager (container-internal: the
   *  public host is behind a forward-auth proxy this client cannot pass). */
  baseUrl: string;
  username: string;
  password: string;
  /** docker container name running SteVe's MariaDB (e.g. steve-db-1). */
  dbContainer: string;
  dbUser: string;
  dbPass: string;
  dbName: string;
  /** docker container running the SteVe application. Deployment, not
   *  transport: only `provision` uses it, to restart the process once so it
   *  picks up the WebAPI credential it just wrote. It sits beside dbContainer
   *  because that is what it is -- a container name -- and not on the API
   *  config, which would make every scenario resolve a variable it never uses. */
  appContainer: string;
  /** OCPP WebSocket endpoint, without the trailing charge-point id. */
  wsBaseUrl: string;
  /** Docker network the simulator must join to reach SteVe by container name. */
  dockerNetwork: string;
}

export function defaultSteveConfig(
  env: NodeJS.ProcessEnv = process.env,
): SteveConfig {
  const appPort = env.STEVE_APP_HOST_PORT ?? "8180";
  return {
    baseUrl: env.STEVE_URL ?? `http://steve:${appPort}/steve/manager`,
    username: env.STEVE_USER ?? "admin",
    password: env.STEVE_PASS ?? "1234",
    dbContainer: env.STEVE_DB_CONTAINER ?? "steve-db",
    dbUser: env.STEVE_DB_USER ?? "steve",
    dbPass: env.STEVE_DB_PASS ?? "changeme",
    dbName: env.STEVE_DB_NAME ?? "stevedb",
    appContainer: env.STEVE_APP_CONTAINER ?? "steve",
    wsBaseUrl:
      env.STEVE_WS_URL ?? "ws://steve:8180/steve/websocket/CentralSystemService",
    dockerNetwork: env.STEVE_NETWORK ?? "steve_steve-internal",
  };
}


/**
 * The subset of `fetch` this client uses.
 *
 * A seam, not a policy. Every request below goes through it so that
 * `tests/steve-ui-session-race.ts` can hand this class a fake SteVe: the
 * property that matters here is how concurrent callers interleave, and against
 * a real server that is a 45%-of-the-time event nobody can reproduce on
 * demand. The default is the global, resolved per call rather than captured,
 * on the same default-parameter principle as {@link defaultSteveConfig}.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const CSRF_RE = /name="_csrf"\s+value="([^"]*)"/;

function extractCsrf(html: string): string {
  const match = CSRF_RE.exec(html);
  if (!match) {
    throw new Error(
      "steve: could not find _csrf token in response body (login may have failed)",
    );
  }
  return match[1];
}

/**
 * SteVe manager-UI client: login, CSRF, form POST -- one cookie jar per
 * instance. It is SteVe-specific and cannot drive any other CSMS.
 *
 * Two callers, each with an instance and therefore a session of its own: the
 * operations path (index.ts) and provisioning (provision.ts, which posts the
 * charging-profile form -- the one manager form with no REST equivalent, since
 * SteVe exposes REST controllers for OCPP tags, transactions and operations
 * but none for stored charging profiles).
 *
 * ONE SESSION, SHARED BY EVERY LANE, AND THEREFORE LOCKED. `tck/main.ts` loads
 * the driver once per process, so the operations instance is a singleton that
 * every parallel lane posts through, and `postForm` is a read-modify-write over
 * `cookies`: it may log in (clearing the jar), then GET a page for a CSRF
 * token, then POST it back. Interleave two of those and a lane spends a token
 * against a session that replaced its own, which Spring answers 403 -- so the
 * operation never reaches the wire and the scenario reports failures about a
 * charge point nobody asked. That was issue #77, at 45% of sweeps.
 *
 * REJECTED, having been measured: one instance per lane. It is the obvious way
 * to delete the lock, and it costs a login per lane and gives up the single
 * session this class exists to hold -- while fixing nothing the lock does not,
 * since provisioning posts through the same method. Serialising also survives
 * the part that is easy to get wrong: what rotates on SteVe is the SESSION, not
 * the token. Spring Security's default `HttpSessionCsrfTokenRepository` keeps
 * one token per session and never rotates it per request; the default
 * `XorCsrfTokenRequestAttributeHandler` re-masks it on every render, so the
 * string in the HTML changes each GET while unmasking to the same token. Only
 * `login()` moves the session, via `changeSessionId`. A fix aimed at the token
 * would have addressed the illusion.
 */
export class SteveUiOps {
  private cookies = new Map<string, string>();

  /** Tail of the queue of `postForm` calls. Never rejects -- see serialise(). */
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly cfg: SteveConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  /**
   * Run `work` after every call already queued, and before every later one.
   *
   * A promise chain rather than a dependency: this package has no runtime
   * dependencies, and `tck/main.ts` memoises its driver with the same
   * `promise ??=` shape. The caller's failure is the caller's -- `run` rejects
   * for whoever owns it, while the chain itself is left resolved, because a
   * rejected `gate` would fail every lane queued behind the first one to
   * stumble.
   */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const run = this.gate.then(work);
    this.gate = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorbSetCookie(res: Response): void {
    const values =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    for (const raw of values) {
      const pair = raw.split(";", 1)[0] ?? "";
      const idx = pair.indexOf("=");
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
  }

  async isLoggedIn(): Promise<boolean> {
    if (this.cookies.size === 0) return false;
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/home`, {
      redirect: "manual",
      headers: { cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    return res.status === 200;
  }

  async login(): Promise<void> {
    this.cookies.clear();

    let res = await this.fetchImpl(`${this.cfg.baseUrl}/signin`, {
      redirect: "manual",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    this.absorbSetCookie(res);
    const csrf = extractCsrf(await res.text());

    const form = new URLSearchParams({
      username: this.cfg.username,
      password: this.cfg.password,
      _csrf: csrf,
    });
    res = await this.fetchImpl(`${this.cfg.baseUrl}/signin`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: this.cookieHeader(),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    this.absorbSetCookie(res);

    // Check, rather than assume. An unchecked signin is why issue #77 read as
    // "could not find _csrf token in response body" from a GET three steps
    // later: the failure that mattered had already happened and said nothing.
    const signin = `${this.cfg.baseUrl}/signin`;
    if (res.status >= 400) {
      throw new CsmsNotDispatchedError(
        signin,
        `signin was answered ${res.status}; nothing this client posts will be ` +
          "accepted until it holds an authenticated session",
      );
    }
    // Spring's form login redirects to loginPage + "?error" on bad credentials,
    // which is a 302 like success and leaves an unauthenticated session behind.
    // Matched narrowly, on both halves: a success redirect that merely passed
    // through this path would otherwise break every run rather than the one
    // that is actually misconfigured.
    const location = res.headers.get("location") ?? "";
    if (/\/signin\b/.test(location) && /[?&]error\b/.test(location)) {
      throw new CsmsNotDispatchedError(
        signin,
        `signin bounced back to ${location} -- STEVE_USER/STEVE_PASS were refused`,
      );
    }
  }

  /**
   * NOT SERIALISED, and neither are isLoggedIn() or login(). They are reachable
   * only from postFormExclusive(), which already holds the gate, so locking
   * them here would deadlock on the first call. The invariant is therefore
   * "postForm is the only entry point": anything new that calls these directly
   * from outside puts the session race back, and no guard can see it happen,
   * because a second entry point is not a wrong answer -- it is a second door.
   */
  async ensureLogin(): Promise<void> {
    if (await this.isLoggedIn()) return;
    await this.login();
  }

  /**
   * GET a manager page for its CSRF token, then POST the form back to the same
   * path. Returns the redirect `Location`, which is how SteVe signals success;
   * throws when there is none, because a 200 here means the form came back with
   * validation errors rather than being accepted.
   *
   * `path` is relative to the manager base, so it spans more than operations:
   * provisioning posts to `chargingProfiles/add` through this same method,
   * which is the point of it being separate from op().
   *
   * Serialised against every other call on this instance, login included: the
   * three steps below are one read-modify-write over the cookie jar, and the
   * class comment says what interleaving two of them costs.
   */
  async postForm(
    path: string,
    fields: Record<string, string>,
  ): Promise<string> {
    return this.serialise(() => this.postFormExclusive(path, fields));
  }

  /** {@link postForm}'s body, which assumes it already holds the lock. Nothing
   *  reachable from here may call postForm again: the gate is not reentrant. */
  private async postFormExclusive(
    path: string,
    fields: Record<string, string>,
  ): Promise<string> {
    await this.ensureLogin();

    let res = await this.fetchImpl(`${this.cfg.baseUrl}/${path}`, {
      redirect: "manual",
      headers: { cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    this.absorbSetCookie(res);
    const csrf = extractCsrf(await res.text());

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("_csrf", csrf);

    res = await this.fetchImpl(`${this.cfg.baseUrl}/${path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: this.cookieHeader(),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    this.absorbSetCookie(res);

    const location = res.headers.get("location");
    if (!location) {
      const body = await res.text().catch(() => "<unreadable body>");
      const detail = `status ${res.status}: ${body.slice(0, 300)}`;
      // 4xx is the transport refusing the request -- it never became an OCPP
      // CALL, so nothing downstream can be a finding about the CSMS. Anything
      // else with no Location is SteVe answering: the form came back carrying
      // validation errors, which IS a finding about the CSMS.
      if (res.status >= 400) {
        throw new CsmsNotDispatchedError(path, detail);
      }
      throw new Error(
        `steve postForm: no redirect Location header for ${path} (${detail})`,
      );
    }
    return location;
  }

  /**
   * steve_op OP_PATH FIELDS equivalent. POSTs one CSMS operation,
   * form-encoded, exactly like the manager UI would. Returns the redirect
   * `Location` on success (SteVe 302s to /operations/tasks/<id>); throws on
   * failure (missing CSRF token or no redirect).
   */
  async op(opPath: string, fields: Record<string, string>): Promise<string> {
    return this.postForm(`operations/${opPath}`, fields);
  }
}
