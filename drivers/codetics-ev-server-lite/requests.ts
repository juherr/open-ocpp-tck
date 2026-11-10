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
 *   TIMED_OUT            the server's 60 s deadline passed while the command
 *                        was ACTIVE, i.e. QUEUED or SENT. The wait returns at
 *                        SENT, so a TIMED_OUT it sees is one whose SENT it never
 *                        observed: no evidence of a CALL
 *   CANCELLED            withdrawn while QUEUED (StationSecurityService only
 *                        cancels a queued row) -- never sent
 *   QUEUED past our wait the station is not connected
 *
 * Those last four are {@link CsmsNotDispatchedError}: nothing shows the request
 * became an OCPP CALL, which is that class's claim exactly. So is a refusal of
 * the POST itself, since nothing was queued.
 *
 * WHAT IS NOT A NON-DISPATCH: anything that goes wrong AFTER the POST was
 * accepted, other than the states above. The command is queued server-side by
 * then, and a poll that cannot read it -- a refused read, a body that is not a
 * list, a command that never shows in the list -- knows nothing about whether
 * the dispatcher took it. The wait retries such a read until its deadline and
 * then throws a plain `Error`; claiming a non-dispatch there would file a
 * failure of our read as a fact about the CSMS's wire.
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
  return { action: op.action, payload: toPayload(op) };
}

/** The OCPP 1.6 request body for one operation. The command's action is the
 *  operation's own, so no arm spells it a second time. */
function toPayload(op: CsmsOperation16): Record<string, unknown> {
  switch (op.action) {
    case "Reset":
      return { type: op.type };

    case "UnlockConnector":
      return { connectorId: op.connectorId };

    case "ClearCache":
      return {};

    case "ChangeAvailability":
      return { connectorId: op.connectorId, type: op.type };

    case "GetConfiguration":
      if (op.keys !== undefined && op.keys.length > 0) {
        throw new UnsupportedOperationError(
          "GetConfiguration",
          GET_CONFIGURATION_KEYS_UNSUPPORTED,
        );
      }
      return {};

    case "ChangeConfiguration":
      return { key: op.key, value: op.value };

    case "RemoteStartTransaction":
      // `undefined` starts without a profile; `""` is a lookup that found none,
      // which profileFor() refuses rather than quietly sending no profile.
      return body({
        connectorId: op.connectorId,
        idTag: op.idTag,
        chargingProfile:
          op.chargingProfile === undefined ? undefined : profileFor(op.chargingProfile),
      });

    case "RemoteStopTransaction":
      return { transactionId: transactionId(op.transaction, op.action) };

    case "TriggerMessage":
      return body({ requestedMessage: op.requestedMessage, connectorId: op.connectorId });

    case "SetChargingProfile": {
      const profile = profileFor(op.chargingProfile);
      // A TxProfile is scoped by carrying the transactionId INSIDE the
      // profile. An empty ref sends it unscoped, which is closer to what was
      // asked than not sending it; the scenario's assertions judge the rest.
      const scoped =
        op.transaction === undefined || op.transaction === ""
          ? profile
          : { ...profile, transactionId: transactionId(op.transaction, op.action) };
      return { connectorId: op.connectorId, csChargingProfiles: scoped };
    }

    case "GetCompositeSchedule":
      return body({
        connectorId: op.connectorId,
        duration: op.duration,
        chargingRateUnit: op.chargingRateUnit,
      });

    case "ClearChargingProfile":
      // Every member is optional and an omitted one is a wildcard, so an empty
      // ref must not become an absent id: that would clear everything.
      return body({
        id:
          op.chargingProfile === undefined
            ? undefined
            : profileFor(op.chargingProfile).chargingProfileId,
        connectorId: op.connectorId,
        chargingProfilePurpose: op.purpose,
        stackLevel: op.stackLevel,
      });

    case "UpdateFirmware":
      return body({
        location: op.location,
        retrieveDate: op.retrieveDate.toISOString(),
        retries: op.retries,
        retryInterval: op.retryInterval,
      });

    case "GetDiagnostics":
      return body({
        location: op.location,
        retries: op.retries,
        retryInterval: op.retryInterval,
        startTime: op.startTime?.toISOString(),
        stopTime: op.stopTime?.toISOString(),
      });

    case "GetLocalListVersion":
      return {};

    case "SendLocalList":
      // KEY ORDER IS DELIBERATE: TC_043.5 asserts
      // /"listVersion":2,"localAuthorizationList":\[\{"idTag":"CERT-TAG-2"/ on
      // the station's raw received line, and the server keeps the order it was
      // given. An entry with no status carries no idTagInfo at all, which in a
      // Differential update means "remove this tag".
      return body({
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
      });

    case "ReserveNow":
      return body({
        connectorId: op.connectorId,
        expiryDate: op.expiryDate.toISOString(),
        idTag: op.idTag,
        parentIdTag: op.parentIdTag,
        reservationId:
          op.reservation === undefined
            ? allocateReservationId()
            : reservationId(op.reservation, op.action),
      });

    case "CancelReservation":
      return { reservationId: reservationId(op.reservation, op.action) };

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
  for (;;) {
    // The tenant's last 100 commands, newest first: a command queued a moment
    // ago is near the top, and one that scrolled out is reported as unseen.
    // A read that fails is retried until the deadline: see the header for why
    // it is never a non-dispatch.
    let row: CommandRow | undefined;
    let readFailure: string | undefined;
    try {
      const rows = await api.get<unknown>("/api/v1/commands");
      if (Array.isArray(rows)) {
        row = (rows as (CommandRow | null)[]).find((r) => r?.id === id) ?? undefined;
      } else {
        readFailure = `GET /api/v1/commands answered something that is not a list: ${JSON.stringify(rows)?.slice(0, 200)}`;
      }
    } catch (err) {
      readFailure = err instanceof Error ? err.message : String(err);
    }
    if (row) {
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
          throw new CsmsNotDispatchedError(
            what,
            "TIMED_OUT with no SENT observed: nothing shows the CALL was written",
          );
        case "CANCELLED":
          throw new CsmsNotDispatchedError(what, "CANCELLED while still QUEUED");
        case "QUEUED":
          break;
        default:
          throw new Error(`${what}: unknown command state ${JSON.stringify(row.state)}`);
      }
    }
    if (Date.now() >= deadline) {
      // Giving up does not withdraw the command. At the pinned commit the
      // server has no way to cancel one (CommandController exposes GET only),
      // so a command abandoned QUEUED stays queued until the server's own 60 s
      // deadline and may still reach the station -- during the NEXT scenario on
      // this cpId, whose wire log would then carry a CALL it never asked for.
      const abandoned =
        "; it may still be queued server-side, cannot be cancelled, and may " +
        "still reach the station during a later scenario on this cpId";
      if (readFailure !== undefined) {
        throw new Error(
          `${what}: accepted, but its state could not be read for ${timeoutMs} ms` +
            ` -- last read: ${readFailure}${abandoned}`,
        );
      }
      if (!row) {
        throw new Error(
          `${what}: accepted, but not among the last 100 commands after ${timeoutMs} ms` +
            abandoned,
        );
      }
      throw new CsmsNotDispatchedError(
        what,
        `still QUEUED after ${timeoutMs} ms -- is the station connected?${abandoned}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
