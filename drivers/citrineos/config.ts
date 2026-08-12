// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts -- every default this driver has, in one place.
 *
 * The values below resolve to the names in drivers/citrineos/compose.yaml, so
 * a stock `docker compose -f drivers/citrineos/compose.yaml up -d --wait`
 * needs no environment at all. Renaming anything there means passing the
 * matching CITRINE_* variable by hand; index.ts's envHelp is the user-facing
 * copy of this table.
 *
 * Note the asymmetry between the HTTP bases and `wsBaseUrl`, which is not an
 * oversight: the driver runs on the HOST and so talks to `localhost`, while
 * the simulator runs in a container on the compose network and talks to
 * `citrine`. One CSMS, two addresses, because two different processes are
 * doing the addressing.
 *
 * There is no database block here any more. Everything this driver reads or
 * seeds goes over HTTP -- the message API for operations, the GraphQL data API
 * for records and fixtures -- so it no longer needs a container to exec into,
 * and can be pointed at a CitrineOS nobody on this host owns.
 */
import type { CsmsEnv } from "../../tck/driver";
import { resolveVariant, type CitrineVariant } from "./variant";

export interface CitrineConfig {
  /** Which CitrineOS line the target runs. Everything version-specific is
   *  derived from it rather than stored beside it -- see variant.ts. */
  variant: CitrineVariant;
  /** Message-API base, no trailing slash, e.g. http://localhost:8080 */
  apiUrl: string;
  /** Every message-API call carries it; CitrineOS's DEFAULT_TENANT_ID is 1. */
  tenantId: number;
  /** GraphQL data API base, no trailing slash, e.g. http://localhost:8090.
   *  Hasura, which CitrineOS's own compose runs ungated and whose mutations
   *  its shipped OCPI package uses -- see records.ts. */
  graphqlUrl: string;
  /** `x-hasura-admin-secret`, when the target sets one. Upstream's compose and
   *  ours do not, so it is empty by default and the header is then omitted
   *  rather than sent blank. */
  adminSecret: string;
  /** OCPP WebSocket endpoint, without the trailing charge-point id. */
  wsBaseUrl: string;
  /** Docker network the simulator must join to reach CitrineOS by name. */
  dockerNetwork: string;
}

/**
 * Parses CITRINE_TENANT_ID strictly.
 *
 * `Number.parseInt("1x")` is 1, and a tenant id silently truncated from a typo
 * points every operation at a tenant whose rows this driver then reads as
 * absent -- which surfaces as a dozen scenarios failing on empty records
 * rather than as the configuration error it is.
 */
function tenantId(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `citrineos: CITRINE_TENANT_ID must be a decimal integer, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

export function defaultCitrineConfig(env: CsmsEnv): CitrineConfig {
  return {
    variant: resolveVariant(env),
    apiUrl: (env.CITRINE_API_URL ?? "http://localhost:8080").replace(/\/+$/, ""),
    tenantId: tenantId(env.CITRINE_TENANT_ID),
    graphqlUrl: (env.CITRINE_GRAPHQL_URL ?? "http://localhost:8090").replace(
      /\/+$/,
      "",
    ),
    adminSecret: env.CITRINE_HASURA_SECRET ?? "",
    // Trailing slash on purpose: the simulator appends the charge point id as
    // the last path segment, and getClientIdFromUrl takes exactly that.
    wsBaseUrl: env.CITRINE_WS_URL ?? "ws://citrine:8081/",
    dockerNetwork: env.CITRINE_NETWORK ?? "citrineos_citrineos-internal",
  };
}
