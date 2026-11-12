// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The EVtivity driver: an independent TypeScript CSMS (Fastify, Postgres,
 * Redis), driven here over OCPP 1.6J, from its published images pinned by
 * compose.yaml.
 *
 * Everything goes over its REST API -- operations through one synchronous
 * route per 1.6 action, records through the session routes -- so the driver
 * needs no container to exec into and can be pointed at a server nobody on
 * this host owns. README.md has the run recipe and the deviations.
 *
 * An ADAPTER over `createEvtivityCsmsDriver` from `@ovarilo/csms-drivers`,
 * as the SteVe and CitrineOS drivers are over theirs. The library owns the
 * operations and the command surface: the payloads, and what each command
 * answer means for the wire -- its own tests hold that. This driver owns what
 * a TCK run adds on top: records.ts (what the API cannot be asked), the
 * prepare hook, the simulator transport, provisioning, scope and expected
 * failures, and the charging-profile catalogue the library reads refs from.
 *
 * `create()` builds both clients and does no I/O. The first call that needs
 * the server logs in, once per process and per client -- api-client.ts says
 * why there are two.
 */
import {
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
} from "../../tck/driver";
import { createEvtivityCsmsDriver, EVTIVITY_CAPABILITIES } from "@ovarilo/csms-drivers";
import { EvtivityApi } from "./api-client";
import { defaultEvtivityConfig } from "./config";
import { EVTIVITY_EXPECTED_FAILURES } from "./expected";
import {
  endLeftoverSessions,
  ensureStation,
  provisionCommand,
  teardownCommand,
  verifyCommand,
} from "./provision";
import { profileByRef } from "./profiles";
import { EvtivityRecords } from "./records";
import { EVTIVITY_SCOPE } from "./scope";

export const csmsDriver: CsmsDriverModule = {
  id: "evtivity",
  displayName: "EVtivity",
  protocols: ["OCPP-1.6J"],
  scope: EVTIVITY_SCOPE,
  capabilities: {
    ...EVTIVITY_CAPABILITIES,
    reservations: false,
    chargingProfiles: true,
    deviceModel: false,
  },
  expectedFailures: EVTIVITY_EXPECTED_FAILURES,
  create(env: CsmsEnv): CsmsDriverParts {
    const cfg = defaultEvtivityConfig(env);
    const api = new EvtivityApi(cfg);
    const records = new EvtivityRecords(api);
    const csms = createEvtivityCsmsDriver({
      config: { apiUrl: cfg.apiUrl, email: cfg.email, password: cfg.password },
      // SetChargingProfile, ClearChargingProfile and a RemoteStartTransaction's
      // TxProfile carry a ref, resolved in the catalogue records.ts reads too.
      refs: { chargingProfileByRef: profileByRef },
    });
    return {
      operations16: csms.operations16,
      // Declared by EVTIVITY_CAPABILITIES, so returned: the daemon serves it.
      commands: csms.commands,
      records,
      // Two writes. The station must exist, and not be blocked, before the
      // simulator dials it: a blocked one is Rejected at boot. And a session
      // an interrupted run left active is ended -- EVtivity answers the next
      // Authorize or StartTransaction of that tag ConcurrentTx while it is
      // (authorize-token.ts). `POST /v1/sessions/{ses}/end` ends it without
      // the station, which is the point, since the station that opened it is
      // gone; while the station is still connected it refuses, and the
      // session is left alone with a warning (endLeftoverSessions).
      prepareStation: async (cpId) => {
        await ensureStation(api, cpId);
        await endLeftoverSessions(api, cpId, await records.openSessions(cpId));
      },
      simTransport: async () => ({
        wsUrl: env.SIM_WS_URL ?? cfg.wsBaseUrl,
        appendCpIdToWsPath: true,
        network: env.SIM_NETWORK ?? cfg.dockerNetwork,
      }),
    };
  },
  // drivers/evtivity/compose.yaml brings the server up; these put the
  // fixtures in it.
  commands: {
    provision: provisionCommand,
    verify: verifyCommand,
    teardown: teardownCommand,
  },
  envHelp: [
    "EVTIVITY_API_URL   REST API base (default http://localhost:8480)",
    "EVTIVITY_WS_URL    OCPP endpoint, id appended (default ws://ocpp:7103/)",
    "EVTIVITY_EMAIL     seeded admin e-mail (default admin@evtivity.local)",
    "EVTIVITY_PASSWORD  seeded admin password (default admin123). Every refused",
    "                   password counts toward the account's sign-in backoff;",
    "                   the driver logs in once per process and client",
    "                   (two: commands and reads), so a wrong one is refused twice.",
    "EVTIVITY_NETWORK   docker network the simulator joins",
    "                   (default evtivity_evtivity-internal)",
    "EVTIVITY_STATIONS  stations `driver provision` registers and `verify` checks",
    "                   (default CERTCP1,CERTCP2,CERTCP3). Scenarios register any",
    "                   other station they are run on.",
  ].join("\n"),
};
