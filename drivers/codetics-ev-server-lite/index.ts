// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The Codetics ev-server-lite driver: an OCPP 1.6J-only CSMS with a REST admin
 * API, built from source by compose.yaml at a pinned upstream commit.
 *
 * Everything goes over that API -- operations through one generic command
 * endpoint, records through the transaction list -- so the driver needs no
 * container to exec into and can be pointed at a server nobody on this host
 * owns. README.md has the run recipe and the gap table; requests.ts says what
 * "dispatched" means here, records.ts what the server cannot be asked.
 *
 * `create()` builds a client and does no I/O. The first call that needs the
 * server logs in, once per process -- see api-client.ts for why that is a
 * limit rather than a nicety.
 */
import {
  CSMS_OPERATION_16_ACTIONS,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation16,
} from "../../tck/driver";
import { EvslApi } from "./api-client";
import { defaultEvslConfig } from "./config";
import { EVSL_EXPECTED_FAILURES } from "./expected";
import { ensureStation, provisionCommand, teardownCommand, verifyCommand } from "./provision";
import { EvslRecords } from "./records";
import { dispatch, toCommand } from "./requests";
import { EVSL_SCOPE } from "./scope";

export const csmsDriver: CsmsDriverModule = {
  id: "codetics-ev-server-lite",
  displayName: "Codetics ev-server-lite",
  protocols: ["OCPP-1.6J"],
  scope: EVSL_SCOPE,
  capabilities: {
    // Every action is routed: the command endpoint takes them all, and the one
    // shape it refuses -- a GetConfiguration key list -- is a refusal of one
    // operation's argument, made in requests.ts and declared in scope.ts.
    operations16: new Set(CSMS_OPERATION_16_ACTIONS),
    reservations: false,
    chargingProfiles: true,
    deviceModel: false,
  },
  expectedFailures: EVSL_EXPECTED_FAILURES,
  create(env: CsmsEnv): CsmsDriverParts {
    const cfg = defaultEvslConfig(env);
    const api = new EvslApi(cfg);
    const records = new EvslRecords(api);
    return {
      operations16: {
        execute: (cpId: string, op: CsmsOperation16) =>
          dispatch(api, cpId, toCommand(op), cfg.dispatchTimeoutMs),
      },
      records,
      // Two writes. The station must be registered on profile 0 before the
      // simulator dials it, or the handshake is refused with 401; and a
      // transaction an interrupted run left open is closed in the database
      // only -- `soft-stop` puts nothing on the wire, which is the point, since
      // the station that opened it is gone.
      prepareStation: async (cpId) => {
        await ensureStation(api, cpId);
        for (const tx of await records.openTransactions(cpId)) {
          await api.request("POST", `/api/v1/transactions/${tx}/soft-stop`);
        }
      },
      simTransport: async () => ({
        wsUrl: env.SIM_WS_URL ?? cfg.wsBaseUrl,
        appendCpIdToWsPath: true,
        network: env.SIM_NETWORK ?? cfg.dockerNetwork,
      }),
    };
  },
  // drivers/codetics-ev-server-lite/compose.yaml brings the server up; these
  // put the fixtures in it.
  commands: {
    provision: provisionCommand,
    verify: verifyCommand,
    teardown: teardownCommand,
  },
  envHelp: [
    "EVSL_URL          admin API base (default http://localhost:8380)",
    "EVSL_WS_URL       OCPP endpoint, id appended",
    "                  (default ws://ev-server-lite:8080/ocpp/<EVSL_TENANT>/)",
    "EVSL_TENANT       tenant slug (default codetics, compose's BOOTSTRAP_TENANT)",
    "EVSL_EMAIL        bootstrap admin e-mail (compose's BOOTSTRAP_EMAIL)",
    "EVSL_PASSWORD     bootstrap admin password, 16-128 characters",
    "                  (compose's BOOTSTRAP_PASSWORD). Login is limited to ten",
    "                  attempts per fifteen minutes, counted by the server until",
    "                  it restarts; the driver logs in once per process.",
    "EVSL_NETWORK      docker network the simulator joins (default evsl_evsl-internal)",
    "EVSL_STATIONS     stations `driver provision` registers and `verify` checks",
    "                  (default CERTCP1,CERTCP2,CERTCP3). Scenarios register any",
    "                  other station they are run on.",
    "EVSL_DISPATCH_TIMEOUT_MS  how long an operation may stay queued before it",
    "                  is reported as never dispatched (default 15000)",
  ].join("\n"),
};
