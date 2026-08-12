// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * api-client.ts -- SteVe's WebAPI, the one channel that is neither a form post
 * nor a database connection.
 *
 * It exists as its own module because two callers need it for opposite
 * reasons: `provision.ts` WRITES fixtures through it, and `records.ts` READS
 * what the CSMS believes happened. Before this file, the client lived inside
 * the provisioner and observations had no choice but to shell out to MariaDB.
 *
 * WHAT IT CAN REACH. Exactly `ocppTags`, `transactions` and `operations` --
 * confirmed by probing the pinned image, where `chargePoints`, `reservations`
 * and `chargingProfiles` all answer 403 because no such controller exists.
 * That is why the SQL channel does not go away: it is now, precisely, the list
 * of endpoints SteVe does not have. See VENDOR.md.
 *
 * AUTHENTICATION is HTTP Basic against `web_user.api_password`, a bcrypt
 * column distinct from the UI password and NULL until something writes it --
 * which is `provision.ts`'s job, not this file's. A caller that gets 401 here
 * has not provisioned; the message says so.
 */
import type { SteveConfig } from "./ui-client";

const HTTP_TIMEOUT_MS = 15_000;

export interface SteveApiConfig {
  /** e.g. http://localhost:8180/steve/api/v1 */
  baseUrl: string;
  username: string;
  password: string;
}

export function defaultApiConfig(
  cfg: SteveConfig,
  env: NodeJS.ProcessEnv = process.env,
): SteveApiConfig {
  return {
    baseUrl:
      env.STEVE_API_URL ?? cfg.baseUrl.replace(/\/manager\/?$/, "/api/v1"),
    username: env.STEVE_API_USER ?? cfg.username,
    password: env.STEVE_API_PASS ?? "ocpp-tck",
  };
}

/**
 * Query parameters as a LIST OF PAIRS, not a record: SteVe's query forms take
 * repeated keys for their list filters (`chargeBoxId` and `ocppIdTag` are
 * `List<String>` on QueryForm), and a record would silently cap each filter at
 * one value.
 */
export type QueryParams = readonly (readonly [string, string])[];

export class SteveWebApi {
  /** Encoded once. Rebuilding it per request would put a base64 of the
   *  credentials inside the one-second poll loop in records.ts. */
  private readonly authorization: string;

  constructor(private readonly cfg: SteveApiConfig) {
    this.authorization = `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`;
  }

  /** GET, decoded. The shape is the caller's to declare: this module knows the
   *  transport, `records.ts` and `provision.ts` know the payloads. */
  async getJson<T>(path: string, params: QueryParams = []): Promise<T> {
    const res = await this.request("GET", path, { params, allowed: [200] });
    return (await res.json()) as T;
  }

  /**
   * A write. `allowed` defaults to the pair SteVe actually answers with -- 200
   * from a controller returning a value, 204 from a `void` one -- and 201
   * because POST /ocppTags may answer either.
   *
   * The failure description is derived from the request rather than passed in,
   * which is the point of having this at all: three call sites used to spell
   * out "DELETE /ocppTags/${pk}" beside the very call that said it, and a
   * hand-written label is one refactor away from describing a different route.
   */
  async send(
    method: string,
    path: string,
    opts: { body?: unknown; allowed?: readonly number[] } = {},
  ): Promise<Response> {
    return this.request(method, path, {
      allowed: opts.allowed ?? [200, 201, 204],
      init: {
        method,
        ...(opts.body === undefined
          ? {}
          : { body: JSON.stringify(opts.body) }),
      },
    });
  }

  /** Whether the WebAPI answers with the configured credentials. A probe, so a
   *  rejection is an answer ("no") rather than a failure. */
  async reachable(): Promise<boolean> {
    try {
      return (await this.raw("/ocppTags", {})).status === 200;
    } catch {
      return false;
    }
  }

  /**
   * One request, checked. The single place that decides what an unacceptable
   * status looks like, so the body-truncation and the message shape cannot
   * drift per call site.
   */
  private async request(
    method: string,
    path: string,
    opts: { params?: QueryParams; allowed: readonly number[]; init?: RequestInit },
  ): Promise<Response> {
    const res = await this.raw(path, opts.init ?? {}, opts.params);
    if (opts.allowed.includes(res.status)) return res;
    const what = `${method} ${path}`;
    throw new Error(
      res.status === 401 || res.status === 403
        ? `steve api: ${what} returned ${res.status}. WebAPI access is off until ` +
          `web_user.api_password is set -- run \`ocpp-tck driver provision\` first.`
        : `steve api: ${what} returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }

  private async raw(
    path: string,
    init: RequestInit,
    params: QueryParams = [],
  ): Promise<Response> {
    const query = new URLSearchParams(params as [string, string][]).toString();
    return fetch(`${this.cfg.baseUrl}${path}${query ? `?${query}` : ""}`, {
      ...init,
      headers: {
        authorization: this.authorization,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }
}
