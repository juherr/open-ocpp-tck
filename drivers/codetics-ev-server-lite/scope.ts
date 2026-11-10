// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scope.ts -- what this CSMS can drive, one row per OCPP 1.6 scenario.
 *
 * The server speaks OCPP 1.6J only (its WebSocket handler advertises the
 * `ocpp1.6` subprotocol and nothing else), and index.ts declares
 * `protocols: ["OCPP-1.6J"]`, so every `cert201-` scenario is NOT APPLICABLE
 * through that declaration and needs no row here -- tck/scope.ts's rule.
 *
 * Every status below is read off what the admin API can EXPRESS at the pinned
 * commit, not off a run: the first live sweep is what turns a DRIVABLE row
 * green or red, and a red one goes to expected.ts with its evidence, never
 * back here as a demotion. The two exceptions are the rows that were
 * CONDITIONAL until the 2026-11-10 sweep answered their question; each says
 * what was measured. Every operation travels one route,
 * `POST /api/v1/stations/{id}/commands`, which forwards the OCPP payload this
 * driver builds; every record comes from `GET /api/v1/transactions`.
 */
import type { ScopeTable } from "../../tck/scope";
import { GET_CONFIGURATION_KEYS_UNSUPPORTED } from "./requests";

const OBSERVED =
  "Station-initiated: the scenario drives no operation and asserts on the " +
  "wire, plus the transaction record GET /api/v1/transactions serves.";

const COMMAND =
  "POST /api/v1/stations/{id}/commands queues the OCPP request this driver " +
  "builds, and its dispatcher sends the payload verbatim; records come from " +
  "GET /api/v1/transactions.";

const AUTHORIZE =
  "Station-initiated Authorize against a tag `driver provision` seeds through " +
  "POST /api/v1/tokens: absent for Invalid, `expiresAt` in the past for " +
  "Expired, `enabled: false` for Blocked (OcppService#permit).";

const LOCAL_LIST =
  "POST /api/v1/stations/{id}/commands accepts the 1.6 local-list requests " +
  "as raw commands; the server keeps no local list of its own, which these " +
  "scenarios do not read.";

const RESERVE =
  "POST /api/v1/stations/{id}/commands accepts ReserveNow and " +
  "CancelReservation as raw commands; ReserveNow's required reservationId is " +
  "allocated by this driver, since the server has no reservation entity.";

const SMART_CHARGING =
  "POST /api/v1/stations/{id}/commands carries the profile inline; the " +
  "server has no profile registry or description field, so the profiles are " +
  "this driver's fixture table (profiles.ts) and the ref is the wire " +
  "chargingProfileId.";

const FIRMWARE =
  "POST /api/v1/stations/{id}/commands accepts UpdateFirmware and " +
  "GetDiagnostics with ISO-8601 dates (OcppValidation checks them parse).";

const d = (reason: string) => ({ status: "DRIVABLE" as const, reason });

export const EVSL_SCOPE: ScopeTable = {
  // --- Core ----------------------------------------------------------------
  "cert16-tc001-cold-boot": d(OBSERVED),
  "cert16-tc003-charging-plugin-first": d(OBSERVED),
  "cert16-tc004-charging-id-first": d(OBSERVED),
  "cert16-tc005-ev-side-disconnect": d(OBSERVED),
  "cert16-tc013-hard-reset": d(COMMAND),
  "cert16-tc014-soft-reset": d(COMMAND),
  "cert16-tc017-unlock-occupied": d(COMMAND),
  "cert16-tc018-unlock-failure": d(COMMAND),
  "cert16-tc019-get-configuration-all": d(
    `${COMMAND} The every-key request is an empty command payload. Measured ` +
      "2026-11-10: on a station that had already booted, the trace holds " +
      "exactly one received GetConfiguration, the driven one. CAVEAT, which " +
      "is why this row was CONDITIONAL: the server queues an unsolicited " +
      "every-key GetConfiguration on a station's FIRST BootNotification " +
      "(StationConfigurationService#booted), and this scenario accepts any " +
      "received every-key request -- so run first on a freshly provisioned " +
      "station it no longer checks the PAYLOAD the driver sent, and its " +
      "response checks may read the answer to the server's request. A " +
      "request that is never dispatched still turns the row red: execute() " +
      "throws CsmsNotDispatchedError and drive() is awaited. README.md's " +
      "\"Caveats\" section has the evidence.",
  ),
  "cert16-tc019-get-configuration-key": {
    status: "NOT_APPLICABLE",
    reason: GET_CONFIGURATION_KEYS_UNSUPPORTED,
  },
  "cert16-tc021-change-configuration": d(
    `${COMMAND} Only SecurityProfile and AuthorizationKey are refused by the ` +
      "endpoint, and this scenario changes neither.",
  ),
  "cert16-tc024-lock-failure": d(OBSERVED),
  "cert16-tc031-unlock-unknown-connector": d(COMMAND),
  "cert16-tc061-clear-cache": d(COMMAND),
  "cert16-tc064-data-transfer": d(
    "Station-initiated DataTransfer; the server answers from the station's " +
      "dataTransferVendors (UnknownVendorId otherwise), and the scenario does " +
      "not assert which.",
  ),

  // --- Local auth list -----------------------------------------------------
  "cert16-tc042-1-get-local-list-version-not-supported": d(LOCAL_LIST),
  "cert16-tc042-2-get-local-list-version-empty": d(LOCAL_LIST),
  "cert16-tc043-1-send-local-list-not-supported": d(LOCAL_LIST),
  "cert16-tc043-3-send-local-list-failed": d(LOCAL_LIST),
  "cert16-tc043-4-send-local-list-full": d(LOCAL_LIST),
  "cert16-tc043-5-send-local-list-differential": d(
    `${LOCAL_LIST} This scenario asserts the member ORDER of the received ` +
      'SendLocalList (`"listVersion":2,"localAuthorizationList":[{"idTag":"CERT-TAG-2"`), ' +
      "and the payload is stored as JSON and re-serialised before dispatch. " +
      "Measured 2026-11-10: the station received " +
      '`{"listVersion":2,"localAuthorizationList":[{"idTag":"CERT-TAG-2"}],' +
      '"updateType":"Differential"}`, the order requests.ts builds.',
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
      "No reservation entity: the server keeps no reservation record, and " +
      "GET /api/v1/commands -- the only place a ReserveNow is recorded -- " +
      "serves no request payload, so the id this scenario must read back and " +
      "cancel is unreadable (records.reservations is absent).",
  },
  "cert16-tc052-cancel-reservation-rejected": d(
    `${RESERVE} No server-side check of the id, so the made-up one reaches the station.`,
  ),
  "cert16-tc053-reserved-connector-parent-idtag": {
    status: "NOT_APPLICABLE",
    reason:
      "No token can carry a parent: the charging-token entity has no parent " +
      "or group field (models/entities/ChargingTokenEntity.kt), nor does " +
      "POST /api/v1/tokens's body (models/tokens/ChargingTokenInput.kt), so " +
      "CERT053-RES and CERT053-CHILD cannot be seeded as one group and no " +
      "Authorize.conf can name CERT053-GRP.",
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
