// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * A CSMS driver module that reaches no CSMS, for tests/csms-server.ts: the
 * daemon loads it through `CSMS_DRIVER` exactly as it loads a real one.
 *
 * It records what it was asked in `calls`, which the guard reads through the
 * same module instance the driver registry imported. `ChangeConfiguration` is
 * refused with a message carrying `FAKE_CSMS_PASS`, which is how the guard
 * checks that a credential from the environment never leaves the daemon.
 * Its charge-point store is enough of the admin surface to provision a
 * station and read it back.
 */
import {
  ChargePointAlreadyExistsError,
  UnsupportedOperationError,
  type ChargePointDetails,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation16,
} from "../../tck/driver";

export const calls: { cpId: string; op: CsmsOperation16 }[] = [];
export const closed: string[] = [];
const stations = new Map<string, ChargePointDetails>();

export const csmsDriver: CsmsDriverModule = {
  id: "fake",
  displayName: "Fake CSMS",
  protocols: ["OCPP-1.6J"],
  capabilities: {
    operations16: new Set(["Reset", "ChangeConfiguration"]),
    reservations: false,
    chargingProfiles: false,
    deviceModel: false,
    chargePoints: { securityProfiles: new Set([0]) },
  },
  create(env: CsmsEnv): CsmsDriverParts {
    return {
      operations16: {
        async execute(cpId, op) {
          calls.push({ cpId, op });
          if (op.action === "ChangeConfiguration") {
            throw new Error(`fake CSMS refused the login for password ${env.FAKE_CSMS_PASS}`);
          }
          return "receipt-that-must-not-leak";
        },
      },
      chargePoints: {
        async create(definition) {
          if (stations.has(definition.id)) throw new ChargePointAlreadyExistsError(definition.id);
          stations.set(definition.id, {
            id: definition.id,
            registration: definition.registration ?? "Accepted",
            security: { profile: definition.security?.profile ?? 0 },
          });
        },
        async get(cpId) {
          return stations.get(cpId) ?? null;
        },
        async update() {
          throw new UnsupportedOperationError("update", "the fake CSMS only creates");
        },
        async delete(cpId) {
          stations.delete(cpId);
        },
      },
      records: {
        latestTransaction: unsupported,
        transactionIdTag: unsupported,
        transactionStopTimestamp: unsupported,
        transactionStopReason: unsupported,
        transactionCountForIdTag: unsupported,
        waitForActiveTransaction: unsupported,
      },
      async close() {
        closed.push("closed");
      },
    };
  },
};

async function unsupported(): Promise<never> {
  throw new UnsupportedOperationError("records", "the fake CSMS keeps none");
}
