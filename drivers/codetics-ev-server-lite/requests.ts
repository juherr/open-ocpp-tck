// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * requests.ts -- the OCPP 1.6 vocabulary as this CSMS's generic command
 * endpoint takes it, and the wait that turns "queued" into "dispatched".
 *
 * ONE ROUTE FOR EVERY OPERATION. `POST /api/v1/stations/{id}/commands`
 * accepts `{action, payload}` where `payload` IS the OCPP request body: the
 * server validates it (ocpp/OcppValidation.kt, `serverInitiated = true`),
 * stores it, and its dispatcher sends it verbatim as the CALL's payload. So
 * each arm below builds the OCPP 1.6 payload itself, with members spelled as
 * the specification spells them.
 *
 * WHAT THE VALIDATOR REFUSES THAT OCPP ALLOWS, which is why two arms throw
 * rather than build:
 *
 *  - GetConfiguration with a key list. Its `textLimits` table checks a member
 *    called `key` on EVERY action as a string of 1 to 50 characters, and in
 *    GetConfiguration.req `key` is an array -- so any key list is answered 400
 *    and never queued. Only "every key" (an empty payload) is expressible.
 *  - ReserveNow without a reservation id. `reservationId` is required, and the
 *    server has no reservation entity to allocate one from, so this driver
 *    allocates it.
 *
 * DISPATCH, NOT COMPLETION. `execute()` resolves once the command has left
 * `QUEUED`: the dispatcher runs every second and moves at most ten queued
 * commands per connected station to `SENT` as it writes the CALL. The answer is
 * the scenario's business, read off the simulator's wire log; a station's
 * Rejected is a normal return. What the states mean, from ocpp/OcppCommandQueue.kt:
 *
 *   SENT, SUCCEEDED      the CALL was written to the station's socket
 *   FAILED with a result the station answered with a CALLERROR -- dispatched
 *   FAILED, no result    the socket write itself threw -- never dispatched
 *   TIMED_OUT, CANCELLED never sent (the server's own deadline is 60 s)
 *   QUEUED past our wait the station is not connected
 *
 * The last three are {@link CsmsNotDispatchedError}: nothing shows the request
 * became an OCPP CALL, which is that class's claim exactly.
 */
import {
  assertNever,
  CsmsNotDispatchedError,
  UnsupportedOperationError,
  type CsmsOperation16,
} from "../../tck/driver";
import type { EvslApi } from "./api-client";
import { profileByRef, type CsChargingProfile } from "./profiles";

export interface Command {
  action: string;
  payload: Record<string, unknown>;
}

/** A row of `GET /api/v1/commands` (CommandResponse, snake_case). */
interface CommandRow {
  id: string;
  station_id: string;
  action: string;
  state: string;
  result: unknown;
}

const POLL_INTERVAL_MS = 250;

/** Drops the members that are `undefined`, so an absent optional field is
 *  omitted on the wire rather than sent as null. */
function body(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

function profileFor(ref: string): CsChargingProfile {
  const profile = profileByRef(ref);
  if (!profile) {
    // Not UnsupportedOperationError: the CSMS can express this. An unknown
    // ref means profiles.ts and the scenario disagree about a name, which is a
    // fault here, and filing it as a capability gap would file it against the
    // CSMS.
    throw new Error(
      `codetics-ev-server-lite: no charging profile for ref ${JSON.stringify(ref)} ` +
        "in profiles.ts",
    );
  }
  return profile;
}

/** The OCPP transactionId behind a ref. The server's transaction `id` IS the
 *  OCPP transactionId it handed the station, so there is nothing to resolve --
 *  only a ref that is not one to refuse, rather than send it as 0 or NaN. */
function transactionId(ref: string, action: string): number {
  if (!/^\d+$/.test(ref)) {
    throw new Error(
      `codetics-ev-server-lite: ${action} needs an OCPP transaction id, got ` +
        `${JSON.stringify(ref)} -- the scenario's own transaction lookup came back empty`,
    );
  }
  return Number(ref);
}

/** Integer reservation id from a ref; same refusal as {@link transactionId}. */
function reservationId(ref: string, action: string): number {
  if (!/^\d+$/.test(ref)) {
    throw new Error(
      `codetics-ev-server-lite: ${action} needs an integer reservation id, got ${JSON.stringify(ref)}`,
    );
  }
  return Number(ref);
}

/**
 * Reservation ids this process allocates. Seeded from the clock so two
 * processes driving the same station are unlikely to reuse one, and kept under
 * 2^31 because the validator requires a non-negative int.
 */
let nextReservationId = Math.floor(Date.now() / 1000) % 1_000_000_000;

export function allocateReservationId(): number {
  nextReservationId = (nextReservationId + 1) % 2_000_000_000;
  return nextReservationId;
}

/** The `{action, payload}` the command endpoint takes for one operation. */
export function toCommand(op: CsmsOperation16): Command {
  switch (op.action) {
    case "Reset":
      return { action: "Reset", payload: { type: op.type } };

    case "UnlockConnector":
      return { action: "UnlockConnector", payload: { connectorId: op.connectorId } };

    case "ClearCache":
      return { action: "ClearCache", payload: {} };

    case "ChangeAvailability":
      return {
        action: "ChangeAvailability",
        payload: { connectorId: op.connectorId, type: op.type },
      };

    case "GetConfiguration":
      if (op.keys !== undefined && op.keys.length > 0) {
        throw new UnsupportedOperationError(
          "GetConfiguration",
          GET_CONFIGURATION_KEYS_UNSUPPORTED,
        );
      }
      return { action: "GetConfiguration", payload: {} };

    case "ChangeConfiguration":
      return {
        action: "ChangeConfiguration",
        payload: { key: op.key, value: op.value },
      };

    case "RemoteStartTransaction":
      // `undefined` starts without a profile; `""` is a lookup that found none,
      // which profileFor() refuses rather than quietly sending no profile.
      return {
        action: "RemoteStartTransaction",
        payload: body({
          connectorId: op.connectorId,
          idTag: op.idTag,
          chargingProfile:
            op.chargingProfile === undefined ? undefined : profileFor(op.chargingProfile),
        }),
      };

    case "RemoteStopTransaction":
      return {
        action: "RemoteStopTransaction",
        payload: { transactionId: transactionId(op.transaction, op.action) },
      };

    case "TriggerMessage":
      return {
        action: "TriggerMessage",
        payload: body({ requestedMessage: op.requestedMessage, connectorId: op.connectorId }),
      };

    case "SetChargingProfile": {
      const profile = profileFor(op.chargingProfile);
      // A TxProfile is scoped by carrying the transactionId INSIDE the
      // profile. An empty ref sends it unscoped, which is closer to what was
      // asked than not sending it; the scenario's assertions judge the rest.
      const scoped =
        op.transaction === undefined || op.transaction === ""
          ? profile
          : { ...profile, transactionId: transactionId(op.transaction, op.action) };
      return {
        action: "SetChargingProfile",
        payload: { connectorId: op.connectorId, csChargingProfiles: scoped },
      };
    }

    case "GetCompositeSchedule":
      return {
        action: "GetCompositeSchedule",
        payload: body({
          connectorId: op.connectorId,
          duration: op.duration,
          chargingRateUnit: op.chargingRateUnit,
        }),
      };

    case "ClearChargingProfile":
      // Every member is optional and an omitted one is a wildcard, so an empty
      // ref must not become an absent id: that would clear everything.
      return {
        action: "ClearChargingProfile",
        payload: body({
          id:
            op.chargingProfile === undefined
              ? undefined
              : profileFor(op.chargingProfile).chargingProfileId,
          connectorId: op.connectorId,
          chargingProfilePurpose: op.purpose,
          stackLevel: op.stackLevel,
        }),
      };

    case "UpdateFirmware":
      return {
        action: "UpdateFirmware",
        payload: body({
          location: op.location,
          retrieveDate: op.retrieveDate.toISOString(),
          retries: op.retries,
          retryInterval: op.retryInterval,
        }),
      };

    case "GetDiagnostics":
      return {
        action: "GetDiagnostics",
        payload: body({
          location: op.location,
          retries: op.retries,
          retryInterval: op.retryInterval,
          startTime: op.startTime?.toISOString(),
          stopTime: op.stopTime?.toISOString(),
        }),
      };

    case "GetLocalListVersion":
      return { action: "GetLocalListVersion", payload: {} };

    case "SendLocalList":
      // KEY ORDER IS DELIBERATE: TC_043.5 asserts
      // /"listVersion":2,"localAuthorizationList":\[\{"idTag":"CERT-TAG-2"/ on
      // the station's raw received line, and the server keeps the order it was
      // given. An entry with no status carries no idTagInfo at all, which in a
      // Differential update means "remove this tag".
      return {
        action: "SendLocalList",
        payload: body({
          listVersion: op.listVersion,
          localAuthorizationList: (op.localAuthorizationList ?? []).map((entry) =>
            body({
              idTag: entry.idTag,
              idTagInfo:
                entry.status === undefined
                  ? undefined
                  : body({
                      status: entry.status,
                      expiryDate: entry.expiryDate?.toISOString(),
                      parentIdTag: entry.parentIdTag,
                    }),
            }),
          ),
          updateType: op.updateType,
        }),
      };

    case "ReserveNow":
      return {
        action: "ReserveNow",
        payload: body({
          connectorId: op.connectorId,
          expiryDate: op.expiryDate.toISOString(),
          idTag: op.idTag,
          parentIdTag: op.parentIdTag,
          reservationId:
            op.reservation === undefined
              ? allocateReservationId()
              : reservationId(op.reservation, op.action),
        }),
      };

    case "CancelReservation":
      return {
        action: "CancelReservation",
        payload: { reservationId: reservationId(op.reservation, op.action) },
      };

    default:
      return assertNever(op, "codetics-ev-server-lite.execute");
  }
}

/** Why a GetConfiguration key list cannot be queued. Shared with scope.ts so
 *  the refusal and the scope row say the same thing. */
export const GET_CONFIGURATION_KEYS_UNSUPPORTED =
  "POST /api/v1/stations/{id}/commands validates every payload's `key` member " +
  "as a string of 1-50 characters (OcppValidation.textLimits), and " +
  "GetConfiguration.req's `key` is an array, so a key list is refused with 400 " +
  "and never queued; only the every-key request is expressible";

/**
 * Queues one command and waits for the dispatcher to take it. Returns the
 * command row, serialised, as the receipt for the run log.
 */
export async function dispatch(
  api: EvslApi,
  cpId: string,
  command: Command,
  timeoutMs: number,
): Promise<string> {
  const path = `/api/v1/stations/${encodeURIComponent(cpId)}/commands`;
  const receipt = (await api.request("POST", path, command)).parsed as {
    id?: unknown;
  } | null;
  if (typeof receipt?.id !== "string") {
    throw new Error(
      `codetics-ev-server-lite: POST ${path} answered without a command id: ${JSON.stringify(receipt)}`,
    );
  }
  const id = receipt.id;
  const what = `codetics-ev-server-lite: ${command.action} for ${cpId} (command ${id})`;

  const deadline = Date.now() + timeoutMs;
  let last = "QUEUED";
  for (;;) {
    // The tenant's last 100 commands, newest first: a command queued a moment
    // ago is near the top, and one that scrolled out is reported as unseen.
    const rows = (await api.get<CommandRow[]>("/api/v1/commands")) ?? [];
    const row = Array.isArray(rows) ? rows.find((r) => r?.id === id) : undefined;
    if (row) {
      last = row.state;
      switch (row.state) {
        case "SENT":
        case "SUCCEEDED":
          return JSON.stringify(row).slice(0, 500);
        case "FAILED":
          if (row.result !== null && row.result !== undefined) {
            return JSON.stringify(row).slice(0, 500);
          }
          throw new CsmsNotDispatchedError(
            what,
            "FAILED with no result: the server could not write the CALL to the station's socket",
          );
        case "TIMED_OUT":
        case "CANCELLED":
          throw new CsmsNotDispatchedError(what, `${row.state} before it was sent`);
        case "QUEUED":
          break;
        default:
          throw new Error(`${what}: unknown command state ${JSON.stringify(row.state)}`);
      }
    }
    if (Date.now() >= deadline) {
      throw new CsmsNotDispatchedError(
        what,
        row
          ? `still ${last} after ${timeoutMs} ms -- is the station connected?`
          : `not among the last 100 commands after ${timeoutMs} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
