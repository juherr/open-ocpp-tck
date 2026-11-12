// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scope.ts -- what EVtivity can drive, one row per OCPP 1.6 scenario.
 *
 * EVtivity also serves OCPP 2.0.1, but this driver declares
 * `protocols: ["OCPP-1.6J"]` (index.ts), so every `cert201-` scenario is NOT
 * APPLICABLE through that declaration and needs no row here -- tck/scope.ts's
 * rule.
 *
 * Every status below is read off what the REST API can EXPRESS at v0.1.51 and
 * off the step 0 spike, not off a sweep: the first live sweep is what turns a
 * DRIVABLE row green or red, and a red one goes to expected.ts with its
 * evidence, never back here as a demotion. Every operation travels its own
 * route, `POST /v1/ocpp/commands/v16/{Action}`, which forwards the OCPP payload
 * this driver builds and answers with the station's response; every record
 * comes from the session routes (records.ts).
 */
import type { ScopeTable } from "../../tck/scope";

const OBSERVED =
  "Station-initiated: the scenario drives no operation and asserts on the " +
  "wire, plus the session record the REST API serves.";

const COMMAND =
  "POST /v1/ocpp/commands/v16/{Action} sends the OCPP request this driver " +
  "builds and answers with the station's response; records come from the " +
  "session routes.";

const AUTHORIZE =
  "Station-initiated Authorize against a tag `driver provision` seeds through " +
  "POST /v1/tokens: absent for Invalid, `expiresAt` in the past for Expired, " +
  "`isActive: false` for Blocked (authorize-token.ts, isExpired / isBlocked).";

const LOCAL_LIST =
  "POST /v1/ocpp/commands/v16/{GetLocalListVersion,SendLocalList} send the " +
  "1.6 local-list requests as given; these scenarios read only the wire.";

const RESERVE =
  "POST /v1/ocpp/commands/v16/{ReserveNow,CancelReservation} send the raw " +
  "requests; ReserveNow's required reservationId is allocated by the library's driver.";

const SMART_CHARGING =
  "POST /v1/ocpp/commands/v16/{SetChargingProfile,ClearChargingProfile," +
  "GetCompositeSchedule} carry the profile inline, so the profiles are this " +
  "driver's fixture table (profiles.ts) and the ref is the wire " +
  "chargingProfileId. The route refuses a profile id at or below the " +
  "station's SmartChargingCtrlr.MaxExternalConstraintsId (400 " +
  "CHARGING_PROFILE_ID_RESERVED), a 2.x device-model variable a 1.6 station " +
  "never reports, so ids 56 and 57 pass.";

const FIRMWARE =
  "POST /v1/ocpp/commands/v16/{UpdateFirmware,GetDiagnostics} take ISO-8601 " +
  "dates as strings.";

const d = (reason: string) => ({ status: "DRIVABLE" as const, reason });

export const EVTIVITY_SCOPE: ScopeTable = {
  // --- Core ----------------------------------------------------------------
  "cert16-tc001-cold-boot": d(OBSERVED),
  "cert16-tc003-charging-plugin-first": d(OBSERVED),
  "cert16-tc004-charging-id-first": d(OBSERVED),
  "cert16-tc005-ev-side-disconnect": d(OBSERVED),
  "cert16-tc013-hard-reset": d(COMMAND),
  "cert16-tc014-soft-reset": d(
    `${COMMAND} A Reset queued for an offline station would replay into a ` +
      "later scenario on the same cp id; compose.yaml seeds " +
      "ocpp.offlineCommandTtlHours=0 so a queued command expires at once.",
  ),
  "cert16-tc017-unlock-occupied": d(COMMAND),
  "cert16-tc018-unlock-failure": d(COMMAND),
  "cert16-tc019-get-configuration-all": d(
    `${COMMAND} The every-key request is sent as \`{}\` (key omitted), ` +
      "observed on the wire in step 0. EVtivity sends no GetConfiguration of " +
      "its own after a 1.6 boot.",
  ),
  "cert16-tc019-get-configuration-key": d(
    `${COMMAND} The route takes \`key\` as a list of strings and forwards it.`,
  ),
  "cert16-tc021-change-configuration": d(
    `${COMMAND} EVtivity pushes four ChangeConfiguration requests of its own ` +
      "after a station's first boot (MeterValueSampleInterval=60 first), once " +
      "per station per ten minutes; the scenario selects its own request by " +
      "key and value, so the push cannot stand for it.",
  ),
  "cert16-tc024-lock-failure": d(OBSERVED),
  "cert16-tc031-unlock-unknown-connector": d(COMMAND),
  "cert16-tc061-clear-cache": d(COMMAND),
  "cert16-spec48-start-transaction-busy-connector": d(OBSERVED),
  "cert16-tc064-data-transfer": d(
    "Station-initiated DataTransfer; the scenario asserts the request it sent " +
      "and that it was answered, not the CSMS's status.",
  ),

  // --- Local auth list -----------------------------------------------------
  "cert16-tc042-1-get-local-list-version-not-supported": d(LOCAL_LIST),
  "cert16-tc042-2-get-local-list-version-empty": d(LOCAL_LIST),
  "cert16-tc043-1-send-local-list-not-supported": d(LOCAL_LIST),
  "cert16-tc043-3-send-local-list-failed": d(LOCAL_LIST),
  "cert16-tc043-4-send-local-list-full": d(LOCAL_LIST),
  "cert16-tc043-5-send-local-list-differential": d(
    `${LOCAL_LIST} This scenario asserts the member ORDER of the received ` +
      'SendLocalList (`"listVersion":2,"localAuthorizationList":[{"idTag":"CERT-TAG-2"`); ' +
      "the library's mapper builds that order and the route forwards the parsed body.",
  ),

  // --- Reservation ---------------------------------------------------------
  "cert16-reservation-basic": d(RESERVE),
  "cert16-tc048-1-reserve-now-faulted": d(RESERVE),
  "cert16-tc048-2-reserve-now-occupied": d(RESERVE),
  "cert16-tc048-3-reserve-now-unavailable": d(RESERVE),
  "cert16-tc048-4-reserve-now-rejected": d(RESERVE),
  "cert16-tc051-cancel-reservation": {
    status: "NOT_APPLICABLE",
    reason:
      "The driver's ReserveNow goes through the raw v16/ReserveNow route, which " +
      "creates no reservation record (the command.ReserveNow projection only " +
      "confirms or rolls back a hold POST /v1/reservations made, " +
      "reservation-projections.ts), so the id to cancel cannot be read back. " +
      "The managed POST /v1/reservations does record one, but cannot serve the " +
      "same ReserveNow arm: it refuses before sending when the connector is " +
      "not Available (409 EVSE_IN_USE; reservation.activeSessionCheckHours, 3 " +
      "by default, makes the check apply to an immediate hold), which turns " +
      "TC_048.1-3 into non-dispatches; it carries no idTag of its own, only " +
      "the token bound to a driver, and a driver may reserve only with a " +
      "default payment method, which provision creates none of (otherwise it " +
      "sends `operator`); and it allocates the reservation id itself. " +
      "execute() cannot tell TC_051 from TC_048, so the arm stays raw.",
  },
  "cert16-tc052-cancel-reservation-rejected": d(
    `${RESERVE} The raw route does not check the id against a record, so the ` +
      "made-up one reaches the station.",
  ),
  "cert16-tc053-reserved-connector-parent-idtag": {
    status: "NOT_APPLICABLE",
    reason:
      "No 1.6 Authorize.conf can name a parent: idTagInfoFor " +
      "(packages/ocpp/src/handlers/v1_6/id-tag-info.ts) sets status and " +
      "expiryDate only, and POST /v1/tokens has no parent or group field, so " +
      "CERT053-CHILD can never be answered with parentIdTag CERT053-GRP.",
  },

  // --- Remote trigger / remote control -------------------------------------
  "cert16-tc010-remote-start": d(COMMAND),
  "cert16-tc011-remote-start-stop": d(COMMAND),
  "cert16-tc012-remote-stop": d(COMMAND),
  "cert16-tc026-remote-start-rejected": d(COMMAND),
  "cert16-tc028-remote-stop-rejected": d(COMMAND),
  "cert16-tc054-trigger-message": d(COMMAND),
  "cert16-tc055-trigger-message-rejected": d(COMMAND),

  // --- Smart charging ------------------------------------------------------
  "cert16-tc056-central-smart-charging-txdefault": d(SMART_CHARGING),
  "cert16-tc057-central-smart-charging-txprofile": d(SMART_CHARGING),
  "cert16-tc059-remote-start-with-profile": d(SMART_CHARGING),
  "cert16-tc066-get-composite-schedule": d(SMART_CHARGING),
  "cert16-tc067-clear-charging-profile": d(SMART_CHARGING),

  // --- Firmware ------------------------------------------------------------
  "cert16-tc044-1-firmware-update": d(FIRMWARE),
  "cert16-tc044-2-firmware-download-failed": d(FIRMWARE),
  "cert16-tc044-3-firmware-install-failed": d(FIRMWARE),
  "cert16-tc045-1-get-diagnostics": d(FIRMWARE),

  // --- Authorize -----------------------------------------------------------
  "cert16-tc023-1-authorize-invalid": d(AUTHORIZE),
  "cert16-tc023-2-authorize-expired": d(AUTHORIZE),
  "cert16-tc023-3-authorize-blocked": d(AUTHORIZE),
};
