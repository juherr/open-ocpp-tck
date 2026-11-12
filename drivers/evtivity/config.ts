// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts -- every default this driver has, in one place.
 *
 * The values resolve to the names in drivers/evtivity/compose.yaml, so a stock
 * `docker compose -f drivers/evtivity/compose.yaml up -d --wait` needs no
 * environment at all. index.ts's envHelp is the user-facing copy of this table.
 *
 * Two addresses for one CSMS, on purpose: the driver runs on the HOST and talks
 * to `localhost` through the API's published port, while the simulator runs in
 * a container on the compose network and talks to the `ocpp` service by name.
 * The OCPP port is not published at all.
 *
 * The host port defaults to 8480 because every bundled stack shares one docker
 * daemon: CitrineOS publishes 8080, SteVe 8180 and ev-server-lite 8380.
 */
import type { CsmsEnv } from "../../tck/driver";

export interface EvtivityConfig {
  /** REST API base, no trailing slash, e.g. http://localhost:8480. Every
   *  route this driver calls lives under `/v1`. */
  apiUrl: string;
  /** The administrator the seed creates (INITIAL_ADMIN_EMAIL / _PASSWORD). */
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
}

/** The compose file's seeded administrator, which are also the upstream
 *  seed's own defaults. */
export const DEFAULT_EMAIL = "admin@evtivity.local";
export const DEFAULT_PASSWORD = "admin123";

export function defaultEvtivityConfig(env: CsmsEnv): EvtivityConfig {
  return {
    apiUrl: (env.EVTIVITY_API_URL ?? "http://localhost:8480").replace(/\/+$/, ""),
    email: env.EVTIVITY_EMAIL ?? DEFAULT_EMAIL,
    password: env.EVTIVITY_PASSWORD ?? DEFAULT_PASSWORD,
    // Trailing slash on purpose: the simulator appends the charge point id as
    // the last path segment, and the server reads `/<stationId>` with no
    // prefix.
    wsBaseUrl: env.EVTIVITY_WS_URL ?? "ws://ocpp:7103/",
    dockerNetwork: env.EVTIVITY_NETWORK ?? "evtivity_evtivity-internal",
    stations: (env.EVTIVITY_STATIONS ?? "CERTCP1,CERTCP2,CERTCP3")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  };
}
