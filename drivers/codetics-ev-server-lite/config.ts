// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts -- every default this driver has, in one place.
 *
 * The values resolve to the names in drivers/codetics-ev-server-lite/compose.yaml,
 * so a stock `docker compose -f drivers/codetics-ev-server-lite/compose.yaml up -d
 * --build --wait` needs no environment at all. index.ts's envHelp is the
 * user-facing copy of this table.
 *
 * Two addresses for one CSMS, on purpose: the driver runs on the HOST and talks
 * to `localhost` through the published port, while the simulator runs in a
 * container on the compose network and talks to the service by name.
 *
 * The host port defaults to 8380 rather than to the container's 8080, because
 * every bundled stack shares one docker daemon and CitrineOS already publishes
 * 8080 on the host.
 */
import type { CsmsEnv } from "../../tck/driver";

export interface EvslConfig {
  /** Admin API base, no trailing slash, e.g. http://localhost:8380. */
  apiUrl: string;
  /** Tenant slug the admin account and every station belong to. It is also
   *  the second-to-last path segment of the OCPP endpoint. */
  tenant: string;
  /** The bootstrap administrator, created by the server on its first start
   *  from BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD. */
  email: string;
  password: string;
  /** OCPP WebSocket endpoint, without the trailing charge-point id. */
  wsBaseUrl: string;
  /** Docker network the simulator joins to reach the CSMS by name. */
  dockerNetwork: string;
  /** Stations `driver provision` registers. The prepare hook registers any
   *  other station it is handed, so this is the roster `verify` checks, not a
   *  limit on what a sweep may use. */
  stations: readonly string[];
  /** How long `execute()` waits for the CSMS to move a queued command to the
   *  station before declaring it never dispatched. */
  dispatchTimeoutMs: number;
}

/** The compose file's credentials. BOOTSTRAP_PASSWORD must be 16 to 128
 *  characters, or the server refuses to start. */
export const DEFAULT_EMAIL = "tck@example.com";
export const DEFAULT_PASSWORD = "open-ocpp-tck-admin-password";

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    throw new Error(
      `codetics-ev-server-lite: ${name} must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

export function defaultEvslConfig(env: CsmsEnv): EvslConfig {
  const tenant = env.EVSL_TENANT ?? "codetics";
  return {
    apiUrl: (env.EVSL_URL ?? "http://localhost:8380").replace(/\/+$/, ""),
    tenant,
    email: env.EVSL_EMAIL ?? DEFAULT_EMAIL,
    password: env.EVSL_PASSWORD ?? DEFAULT_PASSWORD,
    // Trailing slash on purpose: the simulator appends the charge point id as
    // the last path segment, and the server reads `/ocpp/{tenant}/{station}`.
    wsBaseUrl: env.EVSL_WS_URL ?? `ws://ev-server-lite:8080/ocpp/${tenant}/`,
    dockerNetwork: env.EVSL_NETWORK ?? "evsl_evsl-internal",
    stations: (env.EVSL_STATIONS ?? "CERTCP1,CERTCP2,CERTCP3")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
    dispatchTimeoutMs: positiveInt(
      "EVSL_DISPATCH_TIMEOUT_MS",
      env.EVSL_DISPATCH_TIMEOUT_MS,
      15_000,
    ),
  };
}
