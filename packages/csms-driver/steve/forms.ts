// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * forms.ts -- renders a neutral CsmsOperation16 into the fields SteVe's manager
 * UI forms expect.
 *
 * This mapping used to BE the contract: every scenario was written in these
 * field names, and every other CSMS driver had to parse its way back out of
 * them. Now it is what it always was -- one CSMS's serialisation, owned by the
 * driver for that CSMS.
 */
import type {
  ChargePointDetails,
  ChargePointRegistration,
  ChargePointSecurityProfile,
} from "../charge-points";
import {
  assertNever,
  type CsmsOperation16,
} from "../contracts";
import { decodeHtml } from "./html-form";

/**
 * SteVe's ReserveNow `expiry` and UpdateFirmware `retrieveDateTime` inputs
 * have no seconds field. Round UP, so any strictly-future instant formats to a
 * strictly-future minute: truncating can land in the already-past current
 * minute, which is why the old spec helper had to default to +90 seconds and
 * explain itself. The rounding lives here now, where the resolution limit is.
 */
export function steveLocalDateTime(d: Date): string {
  const up = new Date(Math.ceil(d.getTime() / 60_000) * 60_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${up.getUTCFullYear()}-${pad(up.getUTCMonth() + 1)}-${pad(up.getUTCDate())} ` +
    `${pad(up.getUTCHours())}:${pad(up.getUTCMinutes())}`
  );
}

/** The manager-UI select-list token for an OCPP 1.6J charge point. */
export function cpSelect(cpId: string): string {
  return `V_16_JSON;${cpId};-`;
}

/** SteVe's ChargingProfileForm purpose enum. */
export type SteveChargingProfilePurpose =
  | "CHARGE_POINT_MAX_PROFILE"
  | "TX_DEFAULT_PROFILE"
  | "TX_PROFILE";

export interface ChargingProfileFields {
  description: string;
  purpose: SteveChargingProfilePurpose;
  /** Watts, as the single schedule period's limit. */
  limitW: number;
}

/**
 * The `chargingProfiles/add` form, as the manager UI posts it.
 *
 * Lives here rather than at the call site for the same reason toSteveForm()
 * does: these field names -- including the indexed `schedulePeriods[N].*` that
 * the page builds in JavaScript -- are SteVe's serialisation, and a version
 * that renames one should break in a single place.
 *
 * `RELATIVE` avoids a startSchedule, which SteVe requires for `ABSOLUTE` and
 * which would age out of validity between runs.
 */
export function chargingProfileForm(
  profile: ChargingProfileFields,
): Record<string, string> {
  return {
    description: profile.description,
    stackLevel: "0",
    chargingProfilePurpose: profile.purpose,
    chargingProfileKind: "RELATIVE",
    recurrencyKind: "",
    chargingRateUnit: "W",
    "schedulePeriods[0].startPeriodInSeconds": "0",
    "schedulePeriods[0].powerLimit": String(profile.limitW),
    add: "Add",
  };
}

/**
 * The manager pages and form actions behind charge-point administration.
 * SteVe has no REST controller for charge points (steve-community/steve#2068),
 * so these are the only way in.
 */
export const STEVE_CHARGE_POINT_PAGES = {
  add: "chargepoints/add",
  addAction: "chargepoints/add/single",
  query: (cpId: string): string => `chargepoints/query?chargeBoxId=${encodeURIComponent(cpId)}`,
  details: (chargeBoxPk: number): string => `chargepoints/details/${chargeBoxPk}`,
  updateAction: "chargepoints/update",
  deleteAction: (chargeBoxPk: number): string => `chargepoints/delete/${chargeBoxPk}`,
} as const;

const REGISTRATION_STATUS: Readonly<Record<ChargePointRegistration, string>> = {
  Accepted: "ACCEPTED",
  Pending: "PENDING",
  Rejected: "REJECTED",
};

/** What a charge-point form is asked to change; an absent member is left as the page rendered it. */
export interface ChargePointFormChange {
  readonly chargeBoxId?: string;
  readonly registration?: ChargePointRegistration;
  /** `authPassword` empty leaves SteVe's stored password unchanged -- it is never a way to clear it. */
  readonly security?: { readonly profile: ChargePointSecurityProfile; readonly authPassword: string };
  /** `null` posts an empty description, which SteVe stores as none. */
  readonly description?: string | null;
}

/** Applies `change` to a charge-point form read off the add or details page. */
export function fillChargePointForm(fields: URLSearchParams, change: ChargePointFormChange): void {
  if (change.chargeBoxId !== undefined) fields.set("chargeBoxId", change.chargeBoxId);
  if (change.registration !== undefined) fields.set("registrationStatus", REGISTRATION_STATUS[change.registration]);
  if (change.security !== undefined) {
    fields.set("securityProfile", `Profile_${change.security.profile}`);
    fields.set("authPassword", change.security.authPassword);
  }
  if (change.description !== undefined) fields.set("description", change.description ?? "");
}

/** A description as SteVe stores what it was posted: trimmed, and empty as none. */
export function steveStoredDescription(description: string | null | undefined): string | undefined {
  return description?.trim() || undefined;
}

/**
 * A charge point as its details form renders it, or `undefined` when a
 * member reads as nothing this mapping knows -- a SteVe that renamed one.
 */
export function chargePointFromForm(fields: URLSearchParams): ChargePointDetails | undefined {
  const id = fields.get("chargeBoxId");
  const registration = (Object.keys(REGISTRATION_STATUS) as ChargePointRegistration[]).find(
    (status) => REGISTRATION_STATUS[status] === fields.get("registrationStatus"),
  );
  const profile = /^Profile_([0-3])$/.exec(fields.get("securityProfile") ?? "")?.[1];
  if (!id || registration === undefined || profile === undefined) return undefined;
  const description = steveStoredDescription(fields.get("description"));
  return {
    id,
    registration,
    security: { profile: Number(profile) as ChargePointSecurityProfile },
    ...(description === undefined ? {} : { description }),
  };
}

/**
 * The `chargeBoxPk` the list page links `cpId` to. Matched on the link text
 * EXACTLY: the query page filters with LIKE, so asking for `CP-1` also lists
 * `CP-10`.
 *
 * Compared RAW first: the pinned image's chargepoints.jsp writes
 * `${cp.chargeBoxId}` unescaped, and an id its validator accepts may look
 * like markup -- `CP&amp;01` is listed as `CP&amp;01`, which decoded is
 * another id. The decoded text is a fallback for a SteVe that escapes the
 * list, and is consulted only when no link matches raw.
 */
export function chargeBoxPkOf(listHtml: string, cpId: string): number | undefined {
  const links = [...listHtml.matchAll(/<a href="[^"]*\/chargepoints\/details\/(\d+)">([^<]*)<\/a>/g)];
  const link = links.find((candidate) => candidate[2] === cpId) ??
    links.find((candidate) => decodeHtml(candidate[2]) === cpId);
  return link === undefined ? undefined : Number(link[1]);
}

export function toSteveForm(op: CsmsOperation16): {
  opPath: string;
  fields: Record<string, string>;
} {
  const opPath = `v1.6/${op.action}`;
  switch (op.action) {
    case "Reset":
      return { opPath, fields: { resetType: op.type.toUpperCase() } };
    case "UnlockConnector":
      return { opPath, fields: { connectorId: String(op.connectorId) } };
    case "ClearCache":
    case "GetLocalListVersion":
      return { opPath, fields: {} };
    case "ChangeAvailability":
      return {
        opPath,
        fields: {
          connectorId: String(op.connectorId),
          availType: op.type.toUpperCase(),
        },
      };
    case "GetConfiguration":
      // The form field is a LIST. URLSearchParams.set would overwrite, so the
      // client appends one entry per key -- a multi-key request must not be
      // silently truncated to its last element.
      return {
        opPath,
        fields: op.keys?.length ? { confKeyList: op.keys.join(",") } : {},
      };
    case "ChangeConfiguration":
      // SteVe splits one configuration key across three inputs: a predefined
      // key goes in confKey, a free-form one in customConfKey, and keyType
      // says which. The scenarios only ever use predefined keys.
      return {
        opPath,
        fields: {
          keyType: "PREDEFINED",
          confKey: op.key,
          customConfKey: "",
          value: op.value,
        },
      };
    case "RemoteStartTransaction":
      return {
        opPath,
        fields: {
          connectorId:
            op.connectorId === undefined ? "" : String(op.connectorId),
          idTag: op.idTag,
          chargingProfilePk: op.chargingProfile ?? "",
        },
      };
    case "RemoteStopTransaction":
      return { opPath, fields: { transactionId: op.transaction } };
    case "TriggerMessage":
      return {
        opPath,
        fields: {
          triggerMessage: op.requestedMessage,
          connectorId:
            op.connectorId === undefined ? "" : String(op.connectorId),
        },
      };
    case "SetChargingProfile":
      return {
        opPath,
        fields: {
          chargingProfilePk: op.chargingProfile,
          connectorId: String(op.connectorId),
          transactionId: op.transaction ?? "",
        },
      };
    case "GetCompositeSchedule":
      return {
        opPath,
        fields: {
          connectorId: String(op.connectorId),
          durationInSeconds: String(op.duration),
          chargingRateUnit: op.chargingRateUnit ?? "",
        },
      };
    case "ClearChargingProfile":
      return {
        opPath,
        fields: { chargingProfilePk: op.chargingProfile ?? "" },
      };
    case "UpdateFirmware":
      return {
        opPath,
        fields: {
          location: op.location,
          retrieveDateTime: steveLocalDateTime(op.retrieveDate),
        },
      };
    case "GetDiagnostics":
      return { opPath, fields: { location: op.location } };
    case "SendLocalList":
      // The UI carries tag NAMES only. A scenario that relied on per-entry
      // status or expiryDate would be silently under-served, so this driver
      // states the limitation rather than pretending it applied them.
      return {
        opPath,
        fields: {
          listVersion: String(op.listVersion),
          updateType: op.updateType.toUpperCase(),
          addUpdateList: (op.localAuthorizationList ?? [])
            .map((entry) => entry.idTag)
            .join(","),
        },
      };
    case "ReserveNow":
      return {
        opPath,
        fields: {
          connectorId: String(op.connectorId),
          expiry: steveLocalDateTime(op.expiryDate),
          idTag: op.idTag,
        },
      };
    case "CancelReservation":
      return { opPath, fields: { reservationId: op.reservation } };
    default:
      return assertNever(op, "toSteveForm");
  }
}
