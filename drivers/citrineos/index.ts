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
 * `POST /ocpp/<version>/<module>/<action>` IS the way to put a Call on the
 * wire, and the request body IS the OCPP payload. That holds for both
 * protocols -- the version is a path segment, not a second API. The
 * interesting part is what the surface omits -- see requests.ts.
 *
 * Where the observations come from
 * ---------------------------------
 * The GraphQL data API, because CitrineOS's REST data endpoints expose none of
 * what the scenarios assert on: no latest transaction, no idTag on a
 * transaction, no stop reason, no count. records.ts documents the full search,
 * and why GraphQL is the vendor's own answer rather than a workaround -- their
 * shipped OCPI package, their operator UI and their e2e fixtures all write
 * Authorizations through it.
 *
 * The consequence is worth stating because it is the opposite of SteVe's: both
 * halves of this driver are HTTP, so it can be pointed at a CitrineOS nobody
 * on this host owns. Nothing here shells into a container.
 *
 * Versions
 * --------
 * Both CitrineOS lines are supported, selected by CITRINE_VARIANT and
 * defaulting to v2 -- drivers/citrineos/compose.yaml pins v2.0.0-beta1 by
 * digest, and compose.v1.yaml overrides it with v1.9.1. v1 costs the six
 * local-auth-list scenarios, whose 1.6 endpoints exist only from the v2 line,
 * and renames the OCPP connection column. See variant.ts.
 *
 * Protocols
 * ---------
 * This is the first driver to declare an OCPP 2.0.1 surface, and it declares
 * it for the v2 line only -- three operations, which is the whole vocabulary
 * the first `cert201-` slice needs. The 1.6 half is untouched by it: one
 * CitrineOS serves both protocols on one websocket endpoint, dispatching on
 * the negotiated subprotocol, so there is no second deployment, no second
 * client and nothing conditional in the transport.
 */
import {
  CSMS_OPERATION_16_ACTIONS,
  CSMS_OPERATION_201_ACTIONS,
  type CsmsCapabilities,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation16,
  type CsmsOperation201,
  type CsmsOperations16,
  type CsmsOperations201,
} from "../../tck/driver";
import { CitrineMessageApi } from "./api-client";
import { defaultCitrineConfig } from "./config";
import {
  CitrineProvisioner,
  provisionCommand,
  teardownCommand,
  verifyCommand,
} from "./provision";
import { citrineosExpectedFailures } from "./expected";
import { CitrineRecords } from "./records";
import { toCitrineRequest, toCitrineRequest201 } from "./requests";
import { citrineosScope } from "./scope";
import {
  resolveVariant,
  speaksOcpp201,
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
 * A function of the environment, not a module-scope constant: which line this
 * driver is pointed at decides the answer, and `scope` and `capabilities` are
 * read by check-driver and by the pre-flight without ever calling create() --
 * which is what lets both run with no credentials and no server.
 * CITRINE_VARIANT is a declaration, not a credential, so reading it here keeps
 * that promise. The runner hands the same env to create(), so the table and
 * the requests cannot describe different servers.
 */
function capabilitiesFor(variant: CitrineVariant): CsmsCapabilities {
  const unrouted = unroutedActions(variant);
  return {
    operations16: new Set(
      CSMS_OPERATION_16_ACTIONS.filter((action) => !unrouted.has(action)),
    ),
    // ALL THREE OR NONE, and the line decides which. On v2 the three 2.0.1
    // routes are the whole vocabulary, so there is nothing to subtract. On v1
    // the declaration is ABSENT rather than empty, which is the contract's way
    // of saying "this driver, pointed here, does not speak OCPP 2.0.1" -- and
    // that is the honest answer: the 2.0.1 surface has never been measured
    // against the v1.9.1 image, and an empty set would claim it had been and
    // found nothing.
    ...(speaksOcpp201(variant)
      ? { operations201: new Set(CSMS_OPERATION_201_ACTIONS) }
      : {}),
    // No reservation capability at all, which is structural rather than a gap
    // in this driver: with nothing able to SEND a 1.6 ReserveNow, the
    // Reservations table never gets a row for 1.6 to have an opinion about.
    reservations: false,
    chargingProfiles: true,
    // Tied to the SAME line predicate as the vocabulary above, and for a
    // concrete reason rather than by association: the reader joins
    // `VariableAttributes` and `Connectors` on `ocppConnectionName`, which is
    // the column variant.ts says v1.9.1 spells `stationId`. Declaring it on v1
    // would be claiming a query nobody has run against a schema that names its
    // station differently.
    deviceModel: speaksOcpp201(variant),
  };
}

function createOperations(
  variant: CitrineVariant,
  api: CitrineMessageApi,
  records: CitrineRecords,
): CsmsOperations16 {
  return {
    async execute(cpId: string, op: CsmsOperation16): Promise<string> {
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

/**
 * The 2.0.1 half, and it shares the api client rather than getting one of its
 * own: the message API is one HTTP surface with a version segment in the path,
 * so a second client would be a second copy of the timeout, the confirmation
 * parsing and the `success: false` rule for no gain.
 *
 * No `records` and no `variant`, which is the whole difference from the
 * function above: nothing in the 2.0.1 vocabulary carries an opaque ref to
 * resolve, and the v1 line reaches this through nothing at all -- `create`
 * omits the part, so the runner substitutes its throwing stub and the scenario
 * lands NOT APPLICABLE.
 */
function createOperations201(api: CitrineMessageApi): CsmsOperations201 {
  return {
    async execute(cpId: string, op: CsmsOperation201): Promise<string> {
      return api.send(cpId, toCitrineRequest201(op));
    },
  };
}

export const csmsDriver: CsmsDriverModule = {
  id: "citrineos",
  displayName: "CitrineOS",
  scope: (env) => citrineosScope(resolveVariant(env)),
  capabilities: (env) => capabilitiesFor(resolveVariant(env)),
  // A function of the environment for the same reason the two above are: which
  // line this driver is pointed at decides which defects it meets. See
  // expected.ts for why the v1 list is empty rather than sixteen rows long.
  expectedFailures: (env) => citrineosExpectedFailures(resolveVariant(env)),
  create(env: CsmsEnv): CsmsDriverParts {
    const cfg = defaultCitrineConfig(env);
    const records = new CitrineRecords(cfg);
    const api = new CitrineMessageApi(cfg);
    return {
      operations16: createOperations(cfg.variant, api, records),
      // Present exactly when `capabilities.operations201` is declared, and the
      // two read the same variant: a driver whose capability set claims a
      // protocol its parts cannot drive would report the gap only at runtime,
      // after a container had started.
      ...(speaksOcpp201(cfg.variant)
        ? { operations201: createOperations201(api) }
        : {}),
      records,
      // TWO WRITES, AND THE SECOND IS NOT RESIDUE-CLEARING. The first closes
      // what a previous scenario left open; the second puts the EVSE and the
      // connector a 2.0.1 StatusNotification needs in place. It is here rather
      // than in `driver provision` because this is the only point in the
      // contract where a driver is handed a charge point id, and those rows
      // hang off a charging station row -- see the note on
      // ensureStationTopology. The log is a no-op: a hook that runs before
      // every scenario has nothing to announce, and `driver provision` is where
      // the fixture speaks.
      prepareStation: async (cpId) => {
        await records.prepareStation(cpId);
        await new CitrineProvisioner(cfg, () => {}).ensureStationTopology(cpId);
      },
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
    "CITRINE_GRAPHQL_URL data API base (default http://localhost:8090). The",
    "                    graphql-engine sidecar; records and fixtures go through it.",
    "CITRINE_HASURA_SECRET x-hasura-admin-secret, when the target sets one.",
    "                    Unset by default, matching upstream's own compose.",
    "CITRINE_NETWORK     docker network the simulator joins to reach CitrineOS",
    "                    (default citrineos_citrineos-internal)",
  ].join("\n"),
};
