// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import type { SteveUiConfig } from "../../packages/csms-driver/steve/ui-client";

/** TCK deployment settings; only the UI subset belongs to the reusable factory. */
export interface SteveConfig extends SteveUiConfig {
  dbContainer: string;
  dbUser: string;
  dbPass: string;
  dbName: string;
  appContainer: string;
  wsBaseUrl: string;
  dockerNetwork: string;
}

export function defaultSteveConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
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
    wsBaseUrl: env.STEVE_WS_URL ?? "ws://steve:8180/steve/websocket/CentralSystemService",
    dockerNetwork: env.STEVE_NETWORK ?? "steve_steve-internal",
  };
}
