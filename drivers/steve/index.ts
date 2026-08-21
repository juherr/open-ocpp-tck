// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The SteVe driver.
 *
 * SteVe is the CSMS this harness was originally written against, which gives
 * this driver one job the other bundled one cannot do: if an operation cannot
 * be expressed here, the contract has drifted away from OCPP rather than
 * towards it. Its scope table claims every scenario, and a guard asserts that
 * -- the day it needs a NOT_APPLICABLE row, the generalization lost a
 * capability it used to have.
 *
 * That is a different question from the one drivers/citrineos/ answers, not a
 * lesser or greater one: this driver catches the harness losing something, the
 * other catches the core assuming something about SteVe. Neither is "the
 * reference".
 *
 * Why the manager UI and not the REST API
 * ---------------------------------------
 * Operations go through the manager UI on purpose, not for lack of a REST
 * client. SteVe's REST CancelReservation
 * (OcppOperationsService#cancelReservation -> #validateReservationId,
 * source-verified) checks the reservationId against
 * ReservationRepository#getActiveReservationIds(chargeBoxId) BEFORE dispatching
 * to the charge point, and returns 400 without putting anything on the wire for
 * an id the station does not have active. TC_052 exists precisely to check that
 * the CHARGE POINT answers Rejected to a made-up id, so the REST path cannot
 * drive it -- a permanent capability gap, not a flake. The manager-UI path
 * (Ocpp15Controller#postCancelReserv -> ChargePointServiceClient) has no such
 * pre-check and always reaches the charge point.
 *
 * That is a fact about SteVe, so it lives here. It used to live inside the
 * scenario, which constructed its own SteVe client mid-drive() and made one
 * vendored scenario unusable against any other CSMS.
 *
 * Where it has to run
 * -------------------
 * Transactions are observed over the WebAPI, which serves `stopReason`,
 * `stopTimestamp` and `ocppIdTag` and filters by charge point, idTag and
 * active-ness -- measured on the pinned image, and worth stating because an
 * earlier version of this file claimed the opposite and read all of it from
 * MariaDB. What REST genuinely cannot serve is reservation status and the
 * charging-profile registry: no such controller exists. Those two still come
 * from MariaDB through `docker exec` -- steve-community/steve#2074 and #2069
 * respectively, both under the #1000 "Meta - API Endpoint" umbrella.
 *
 * So this driver runs on the host that owns the SteVe containers, and reaches
 * the manager UI on the container network -- a deployment behind a
 * forward-auth proxy is unreachable from outside it, and its OCPP port may not
 * be published to the internet at all. The day those two tickets land, that
 * constraint goes with them.
 */
import {
  CSMS_OPERATION_16_ACTIONS,
  type CsmsCapabilities,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation16,
  type CsmsOperations16,
} from "../../tck/driver";
import { defaultApiConfig } from "./api-client";
import { cpSelect, toSteveForm } from "./forms";
import {
  provisionCommand,
  teardownCommand,
  verifyCommand,
} from "./provision";
import { SteveRecords } from "./records";
import { defaultSteveConfig, SteveUiOps, type SteveConfig } from "./ui-client";
import { STEVE_SCOPE } from "./scope";

function createOperations(cfg: SteveConfig): CsmsOperations16 {
  const ui = new SteveUiOps(cfg);
  return {
    async execute(cpId: string, op: CsmsOperation16): Promise<string> {
      const { opPath, fields } = toSteveForm(op);
      return ui.op(opPath, { chargePointSelectList: cpSelect(cpId), ...fields });
    },
  };
}

const CAPABILITIES: CsmsCapabilities = {
  // SteVe drives every operation the contract defines -- it is the CSMS the
  // scenarios were written against.
  operations16: new Set(CSMS_OPERATION_16_ACTIONS),
  reservations: true,
  chargingProfiles: true,
  // SteVe has connector statuses and no device model, so half of the
  // capability is there and half cannot be -- and half is not a capability.
  //
  // What actually keeps this off the wire is the scope table, which declares
  // every `cert201-` row NOT_APPLICABLE for the reason NO_OCPP_201 gives. The
  // stub behind this `false` is a backstop that only converts a throw from
  // `drive()`, and a device-model read can only happen in `assert()` -- see
  // the note on CsmsDeviceModelRecords. This is a declaration, not the
  // mechanism.
  deviceModel: false,
};

export const csmsDriver: CsmsDriverModule = {
  id: "steve",
  displayName: "SteVe",
  scope: STEVE_SCOPE,
  capabilities: CAPABILITIES,
  create(env: CsmsEnv): CsmsDriverParts {
    const cfg = defaultSteveConfig(env);
    // `env`, not process.env: the runner owns what a driver may read, and the
    // WebAPI credentials are now on the scenario path, not just provisioning's.
    const records = new SteveRecords(cfg, defaultApiConfig(cfg, env));
    return {
      operations16: createOperations(cfg),
      records,
      prepareStation: (cpId) => records.closeStaleTransaction(cpId),
      simTransport: async () => ({
        // SteVe's OCPP endpoint takes the charge point id as the last path
        // segment; the simulator appends it.
        wsUrl: env.SIM_WS_URL ?? `${cfg.wsBaseUrl}/`,
        appendCpIdToWsPath: true,
        network: env.SIM_NETWORK ?? cfg.dockerNetwork,
      }),
    };
  },
  // Bootstrap lives here rather than in the runner: what a CSMS needs before it
  // can be tested is a fact about that CSMS. drivers/steve/compose.yaml brings
  // the environment up; these put the fixtures in it.
  commands: {
    provision: provisionCommand,
    verify: verifyCommand,
    teardown: teardownCommand,
  },
  envHelp: [
    "STEVE_URL          manager UI base, e.g. http://steve:8180/steve/manager",
    "STEVE_WS_URL       OCPP endpoint, e.g. ws://steve:8180/steve/websocket/CentralSystemService",
    "STEVE_USER         manager UI user (default admin)",
    "STEVE_PASS         manager UI password",
    "STEVE_DB_CONTAINER MariaDB container name (default steve-db)",
    "STEVE_DB_USER      MariaDB user (default steve)",
    "STEVE_DB_PASS      MariaDB password",
    "STEVE_DB_NAME      MariaDB schema (default stevedb)",
    "STEVE_APP_CONTAINER SteVe container (default steve). Restarted once by",
    "                   provision, to enable the WebAPI.",
    "STEVE_NETWORK      docker network the simulator joins to reach SteVe",
    "",
    "WebAPI -- fixtures AND transaction observations, so scenarios need it too:",
    "STEVE_API_URL      WebAPI base (default: STEVE_URL with /manager -> /api/v1)",
    "STEVE_API_USER     WebAPI user (default: STEVE_USER)",
    "STEVE_API_PASS     WebAPI password (default ocpp-tck). Stored bcrypt-hashed in",
    "                   web_user.api_password, which is NOT the manager UI password.",
    "                   Set the same value here as when you provisioned.",
  ].join("\n"),
};
