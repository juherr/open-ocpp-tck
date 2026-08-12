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
 * Two callers: the operations path (index.ts) and provisioning
 * (provision.ts), which posts the charging-profile form through the same
 * session rather than opening a second one.
 */
export class SteveUiOps {
  private cookies = new Map<string, string>();

  constructor(private readonly cfg: SteveConfig) {}

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
    const res = await fetch(`${this.cfg.baseUrl}/home`, {
      redirect: "manual",
      headers: { cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    return res.status === 200;
  }

  async login(): Promise<void> {
    this.cookies.clear();

    let res = await fetch(`${this.cfg.baseUrl}/signin`, {
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
    res = await fetch(`${this.cfg.baseUrl}/signin`, {
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
  }

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
   */
  async postForm(
    path: string,
    fields: Record<string, string>,
  ): Promise<string> {
    await this.ensureLogin();

    let res = await fetch(`${this.cfg.baseUrl}/${path}`, {
      redirect: "manual",
      headers: { cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    this.absorbSetCookie(res);
    const csrf = extractCsrf(await res.text());

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("_csrf", csrf);

    res = await fetch(`${this.cfg.baseUrl}/${path}`, {
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
      throw new Error(
        `steve postForm: no redirect Location header for ${path} (status ${res.status}): ${body.slice(0, 300)}`,
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
