// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The CitrineOS driver.
 *
 * CitrineOS (LF Energy / S44) is the second CSMS this harness drives, and the
 * first one the scenarios were not written against. That is its job here: an
 * abstraction with one implementation is neutral by assertion, and this driver
 * is how the assertion gets tested. It reports the answer honestly -- seven
 * scenarios are NOT_APPLICABLE because CitrineOS's OCPP 1.6 surface is smaller
 * than SteVe's, and scope.ts names the missing endpoint for each.
 *
 * Why the JSON message API
 * ------------------------
 * Unlike SteVe, there is no choice to justify: CitrineOS generates its
 * outbound surface from the OCPP schemas themselves, so
 * `POST /ocpp/1.6/<module>/<action>` IS the way to put a Call on the wire, and
 * the request body IS the OCPP payload. The interesting part is what the
 * surface omits -- see requests.ts.
 *
 * Where the observations come from, and where this has to run
 * -----------------------------------------------------------
 * Postgres, through `docker exec`, because CitrineOS's REST data endpoints
 * expose none of what the scenarios assert on: no latest transaction, no idTag
 * on a transaction, no stop reason, no count. records.ts documents the full
 * search and why the bundled Hasura sidecar was not used instead. The
 * consequence is the same as SteVe's: this driver runs on the host that owns
 * the containers, so a remote CitrineOS is out of reach for the record half
 * even though the operation half would work over HTTP.
 *
 * Versions
 * --------
 * Both CitrineOS lines are supported, selected by CITRINE_VARIANT and
 * defaulting to v2 -- drivers/citrineos/compose.yaml pins v2.0.0-beta1 by
 * digest, and compose.v1.yaml overrides it with v1.9.1. v1 costs the six
 * local-auth-list scenarios, whose 1.6 endpoints exist only from the v2 line,
 * and renames the OCPP connection column. See variant.ts.
 */
import {
  CSMS_OPERATION_ACTIONS,
  type CsmsCapabilities,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation,
  type CsmsOperationAction,
  type CsmsOperations,
} from "../../tck/driver";
import { CitrineMessageApi } from "./api-client";
import { defaultCitrineConfig } from "./config";
import {
  provisionCommand,
  teardownCommand,
  verifyCommand,
} from "./provision";
import { CitrineRecords } from "./records";
import { toCitrineRequest } from "./requests";
import { citrineosScope } from "./scope";
import {
  resolveVariant,
  unroutedActions,
  type CitrineVariant,
} from "./variant";

/**
 * What the 1.6 message API does not route, for the declared variant --
 * confirmed against both running images: v2.0.0-beta1's /docs/json advertises
 * 18 `/ocpp/1.6/` paths and v1.9.1's advertises 16, with `reserveNow` and
 * `cancelReservation` absent from both.
 *
 * Declared by subtraction from the contract's own list rather than by
 * enumerating the supported ones, so that an operation added to the contract
 * lands here as supported-and-unimplemented -- which `requests.ts`'s
 * `assertNever` turns into a compile error -- instead of being silently
 * dropped from the declaration and never noticed.
 *
 * Read at MODULE load, not in create(): `scope` and `capabilities` are read by
 * check-driver and by the pre-flight without ever calling create(), which is
 * what lets both run with no credentials and no server. CITRINE_VARIANT is a
 * declaration, not a credential, so reading it here keeps that promise.
 */
const VARIANT = resolveVariant(process.env);
const UNROUTED: ReadonlyMap<CsmsOperationAction, string> = unroutedActions(VARIANT);

const CAPABILITIES: CsmsCapabilities = {
  operations: new Set(
    CSMS_OPERATION_ACTIONS.filter((action) => !UNROUTED.has(action)),
  ),
  // No reservation capability at all, which is structural rather than a gap in
  // this driver: with nothing able to SEND a 1.6 ReserveNow, the Reservations
  // table never gets a row for 1.6 to have an opinion about.
  reservations: false,
  chargingProfiles: true,
};

function createOperations(
  variant: CitrineVariant,
  api: CitrineMessageApi,
  records: CitrineRecords,
): CsmsOperations {
  return {
    async execute(cpId: string, op: CsmsOperation): Promise<string> {
      // Refs are resolved here rather than inside the mapper so that the
      // mapper stays a pure function of the operation plus one narrow lookup,
      // and so the database round-trip only happens for the two operations
      // that genuinely need it.
      const request = await toCitrineRequest(
        op,
        { ocppTransactionId: (ref) => records.ocppTransactionId(ref) },
        variant,
      );
      return api.send(cpId, request);
    },
  };
}

export const csmsDriver: CsmsDriverModule = {
  id: "citrineos",
  displayName: "CitrineOS",
  scope: citrineosScope(VARIANT),
  capabilities: CAPABILITIES,
  create(env: CsmsEnv): CsmsDriverParts {
    const cfg = defaultCitrineConfig(env);
    // VARIANT above came from process.env at module load, because `scope` and
    // `capabilities` are read without ever calling create(). This resolves it
    // again from the env the runner passes, and the two are only guaranteed to
    // agree because tck/main.ts passes process.env. A caller passing a
    // synthetic CsmsEnv would otherwise get a scope table describing one
    // server while every request targeted the other -- silently. One
    // comparison converts that into a sentence.
    if (cfg.variant !== VARIANT) {
      throw new Error(
        `citrineos: CITRINE_VARIANT is ${cfg.variant} in the environment passed to ` +
          `create(), but ${VARIANT} when the module was loaded, so the scope table ` +
          "and the requests would describe different servers.",
      );
    }
    const records = new CitrineRecords(cfg);
    return {
      operations: createOperations(cfg.variant, new CitrineMessageApi(cfg), records),
      records,
      prepareStation: (cpId) => records.prepareStation(cpId),
      simTransport: async () => ({
        // CitrineOS takes the charge point id as the LAST path segment
        // (getClientIdFromUrl in WebsocketNetworkConnection.ts), and port 8081
        // is security profile 0, so no basic auth travels with it.
        wsUrl: env.SIM_WS_URL ?? cfg.wsBaseUrl,
        appendCpIdToWsPath: true,
        network: env.SIM_NETWORK ?? cfg.dockerNetwork,
      }),
    };
  },
  // Bootstrap lives here rather than in the runner: what a CSMS needs before
  // it can be tested is a fact about that CSMS. drivers/citrineos/compose.yaml
  // brings the environment up; these put the fixtures in it.
  commands: {
    provision: provisionCommand,
    verify: verifyCommand,
    teardown: teardownCommand,
  },
  envHelp: [
    "CITRINE_VARIANT     v2 (default) or v1. v1 targets the v1.9.1 line: it names",
    "                    the station column stationId and routes no 1.6 local",
    "                    auth list, so 6 scenarios become NOT APPLICABLE.",
    "CITRINE_API_URL     message API base (default http://localhost:8080).",
    "                    No credentials: the shipped docker app-env selects",
    "                    LocalBypassAuthProvider, which accepts every request.",
    "CITRINE_WS_URL      OCPP endpoint, id appended (default ws://citrine:8081/)",
    "CITRINE_TENANT_ID   tenant every call carries (default 1)",
    "CITRINE_DB_CONTAINER Postgres container name (default citrine-db)",
    "CITRINE_DB_USER     Postgres user (default citrine)",
    "CITRINE_DB_PASS     Postgres password (default citrine)",
    "CITRINE_DB_NAME     Postgres database (default citrine)",
    "CITRINE_NETWORK     docker network the simulator joins to reach CitrineOS",
    "                    (default citrineos_citrineos-internal)",
  ].join("\n"),
};
