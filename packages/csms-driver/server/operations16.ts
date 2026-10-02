// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The daemon's OCPP 1.6 operation routes: one path per `CsmsOperation16`
 * action, and the decoder from a request body to that action's arm.
 *
 * The paths are a SPELLING of the existing vocabulary, not a second one: the
 * table is keyed by the action, so it cannot name an operation the contract
 * does not have, and the compiler refuses it until a new action has a path.
 * Four are the issue's shortened names (`reset`, `unlock`, `remote-start`,
 * `remote-stop`); the rest are the action in kebab case.
 */
import {
  assertNever,
  type AuthorizationStatus,
  type AvailabilityType,
  type ChargingProfilePurpose,
  type ChargingRateUnit,
  type CsmsOperation16,
  type CsmsOperation16Action,
  type LocalAuthorizationEntry,
  type MessageTrigger,
  type ResetType16,
  type UpdateType,
} from "../contracts";
import { literals, ObjectReader, present } from "./decode";

export const OPERATION_16_PATHS: Readonly<Record<CsmsOperation16Action, string>> = {
  Reset: "reset",
  UnlockConnector: "unlock",
  ClearCache: "clear-cache",
  ChangeAvailability: "change-availability",
  GetConfiguration: "get-configuration",
  ChangeConfiguration: "change-configuration",
  RemoteStartTransaction: "remote-start",
  RemoteStopTransaction: "remote-stop",
  TriggerMessage: "trigger-message",
  SetChargingProfile: "set-charging-profile",
  GetCompositeSchedule: "get-composite-schedule",
  ClearChargingProfile: "clear-charging-profile",
  UpdateFirmware: "update-firmware",
  GetDiagnostics: "get-diagnostics",
  GetLocalListVersion: "get-local-list-version",
  SendLocalList: "send-local-list",
  ReserveNow: "reserve-now",
  CancelReservation: "cancel-reservation",
};

const ACTION_BY_PATH: ReadonlyMap<string, CsmsOperation16Action> = new Map(
  (Object.entries(OPERATION_16_PATHS) as [CsmsOperation16Action, string][]).map(([action, path]) => [path, action]),
);

/** The action a path names, or `undefined` for a path no action has. */
export function operation16ForPath(path: string): CsmsOperation16Action | undefined {
  return ACTION_BY_PATH.get(path);
}

const RESET_TYPES = literals<ResetType16>({ Hard: true, Soft: true });
const AVAILABILITY_TYPES = literals<AvailabilityType>({ Operative: true, Inoperative: true });
const UPDATE_TYPES = literals<UpdateType>({ Full: true, Differential: true });
const RATE_UNITS = literals<ChargingRateUnit>({ A: true, W: true });
const PROFILE_PURPOSES = literals<ChargingProfilePurpose>({
  ChargePointMaxProfile: true,
  TxDefaultProfile: true,
  TxProfile: true,
});
const MESSAGE_TRIGGERS = literals<MessageTrigger>({
  BootNotification: true,
  DiagnosticsStatusNotification: true,
  FirmwareStatusNotification: true,
  Heartbeat: true,
  MeterValues: true,
  StatusNotification: true,
});
const AUTHORIZATION_STATUSES = literals<AuthorizationStatus>({
  Accepted: true,
  Blocked: true,
  Expired: true,
  Invalid: true,
  ConcurrentTx: true,
});

function authorizationEntry(r: ObjectReader): LocalAuthorizationEntry {
  return present({
    idTag: r.string("idTag"),
    status: r.optOneOf("status", AUTHORIZATION_STATUSES),
    expiryDate: r.optDate("expiryDate"),
    parentIdTag: r.optString("parentIdTag"),
  });
}

/** The arm of `CsmsOperation16` a body describes for `action`. Throws `InvalidInputError`. */
export function decodeOperation16(action: CsmsOperation16Action, body: unknown): CsmsOperation16 {
  const r = new ObjectReader(body, "body");
  const op = arm(action, r);
  r.done();
  return op;
}

function arm(action: CsmsOperation16Action, r: ObjectReader): CsmsOperation16 {
  switch (action) {
    case "Reset":
      return { action, type: r.oneOf("type", RESET_TYPES) };
    case "UnlockConnector":
      return { action, connectorId: r.int("connectorId") };
    case "ClearCache":
      return { action };
    case "ChangeAvailability":
      return { action, connectorId: r.int("connectorId"), type: r.oneOf("type", AVAILABILITY_TYPES) };
    case "GetConfiguration":
      return present({ action, keys: r.optStrings("keys") });
    case "ChangeConfiguration":
      return { action, key: r.string("key"), value: r.string("value") };
    case "RemoteStartTransaction":
      return present({
        action,
        idTag: r.string("idTag"),
        connectorId: r.optInt("connectorId"),
        chargingProfile: r.optString("chargingProfile"),
      });
    case "RemoteStopTransaction":
      return { action, transaction: r.string("transaction") };
    case "TriggerMessage":
      return present({
        action,
        requestedMessage: r.oneOf("requestedMessage", MESSAGE_TRIGGERS),
        connectorId: r.optInt("connectorId"),
      });
    case "SetChargingProfile":
      return present({
        action,
        connectorId: r.int("connectorId"),
        chargingProfile: r.string("chargingProfile"),
        transaction: r.optString("transaction"),
      });
    case "GetCompositeSchedule":
      return present({
        action,
        connectorId: r.int("connectorId"),
        duration: r.int("duration"),
        chargingRateUnit: r.optOneOf("chargingRateUnit", RATE_UNITS),
      });
    case "ClearChargingProfile":
      return present({
        action,
        chargingProfile: r.optString("chargingProfile"),
        connectorId: r.optInt("connectorId"),
        purpose: r.optOneOf("purpose", PROFILE_PURPOSES),
        stackLevel: r.optInt("stackLevel"),
      });
    case "UpdateFirmware":
      return present({
        action,
        location: r.string("location"),
        retrieveDate: r.date("retrieveDate"),
        retries: r.optInt("retries"),
        retryInterval: r.optInt("retryInterval"),
      });
    case "GetDiagnostics":
      return present({
        action,
        location: r.string("location"),
        startTime: r.optDate("startTime"),
        stopTime: r.optDate("stopTime"),
        retries: r.optInt("retries"),
        retryInterval: r.optInt("retryInterval"),
      });
    case "GetLocalListVersion":
      return { action };
    case "SendLocalList":
      return present({
        action,
        listVersion: r.int("listVersion"),
        updateType: r.oneOf("updateType", UPDATE_TYPES),
        localAuthorizationList: r.optObjects("localAuthorizationList", authorizationEntry),
      });
    case "ReserveNow":
      return present({
        action,
        connectorId: r.int("connectorId"),
        idTag: r.string("idTag"),
        expiryDate: r.date("expiryDate"),
        parentIdTag: r.optString("parentIdTag"),
        reservation: r.optString("reservation"),
      });
    case "CancelReservation":
      return { action, reservation: r.string("reservation") };
    default:
      return assertNever(action, "csms-server decodeOperation16");
  }
}
