// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scope.ts -- what CitrineOS can drive, and what it demonstrably cannot.
 *
 * This is the first table in the repository with NOT_APPLICABLE rows, which is
 * the point of having a second driver at all: SteVe's table claims every
 * scenario because the scenarios were written against SteVe, so until now the
 * machinery that reports a scenario as out of scope had never fired.
 *
 * Every status below was settled by a real sweep against the pinned image, not
 * by reading sources -- 44 + 3 scenarios, 2026-08-11; VENDOR.md carries the
 * numbers. The seven NOT_APPLICABLE rows were predicted from the sources first
 * and then confirmed against a running container, whose /docs/json advertises
 * 18 `/ocpp/1.6/` paths with neither `reserveNow` nor `cancelReservation`
 * among them.
 *
 * TWO ROWS ARE DRIVABLE AND CURRENTLY RED, ON PURPOSE. `tck/scope.ts` forbids
 * demoting a row to NOT_APPLICABLE to make a red scenario go away, because
 * that converts a finding about the CSMS into a silence about the harness.
 * Both are findings against CitrineOS rather than gaps in this driver, and
 * both are named in drivers/citrineos/README.md's gap table. A TCK whose
 * second driver reports 100% green is a TCK that has stopped measuring.
 */
import type { ScopeEntry, ScopeTable } from "../../tck/scope";
import {
  NO_LOCAL_LIST,
  NO_RESERVATIONS,
  V1_LOCAL_LIST_SCENARIOS,
  type CitrineVariant,
} from "./variant";

/** The ordinary case: driven and green against the pinned image. */
const OBSERVED =
  "Driven green against the pinned CitrineOS image: the 1.6 message API " +
  "expresses the operation and Postgres answers the observation.";

const d = (reason: string) => ({ status: "DRIVABLE" as const, reason });
const na = (reason: string) => ({ status: "NOT_APPLICABLE" as const, reason });

// `satisfies` rather than `: ScopeTable`, so the keys stay literal and
// V1_LOCAL_LIST below can be typed against them.
const V2_SCOPE = {
  // --- Reservation: the whole capability is absent for OCPP 1.6 -----------
  "cert16-reservation-basic": na(NO_RESERVATIONS),
  "cert16-tc048-1-reserve-now-faulted": na(NO_RESERVATIONS),
  "cert16-tc048-2-reserve-now-occupied": na(NO_RESERVATIONS),
  "cert16-tc048-3-reserve-now-unavailable": na(NO_RESERVATIONS),
  "cert16-tc048-4-reserve-now-rejected": na(NO_RESERVATIONS),
  "cert16-tc051-cancel-reservation": na(NO_RESERVATIONS),
  "cert16-tc052-cancel-reservation-rejected": na(NO_RESERVATIONS),

  // --- Core ----------------------------------------------------------------
  "cert16-tc001-cold-boot": d(OBSERVED),
  "cert16-tc003-charging-plugin-first": d(
    "Driven green. StartTransaction needs a Connectors row matching the OCPP " +
      "connectorId -- createTransactionByStartTransaction throws without one " +
      "-- and CitrineOS auto-commissions it from the StatusNotification the " +
      "charge point sends first.",
  ),
  "cert16-tc004-charging-id-first": d(OBSERVED),
  "cert16-tc005-ev-side-disconnect": d(OBSERVED),
  "cert16-tc013-hard-reset": d(OBSERVED),
  "cert16-tc014-soft-reset": d(OBSERVED),
  "cert16-tc021-change-configuration": d(OBSERVED),
  "cert16-tc024-lock-failure": d(OBSERVED),
  "cert16-tc061-clear-cache": d(OBSERVED),
  "cert16-tc064-data-transfer": d(OBSERVED),

  // --- GetConfiguration ----------------------------------------------------
  // The batching worry did not materialise: CitrineOS splits a request into
  // batches of the station's stored GetConfigurationMaxKeys, but an
  // unprovisioned station has no such value and the request stays one
  // GetConfiguration on the wire, which is what the scenarios assert.
  "cert16-tc019-get-configuration-all": d(OBSERVED),
  "cert16-tc019-get-configuration-key": d(OBSERVED),

  // --- UnlockConnector -----------------------------------------------------
  // CitrineOS ships no 1.6 response handler for UnlockConnector, so the
  // CallResult is answered with a NotSupported CALLERROR. Harmless here, and
  // measured rather than assumed: the scenarios assert on the simulator's wire
  // log, and the charge point carries on.
  "cert16-tc017-unlock-occupied": d(OBSERVED),
  "cert16-tc018-unlock-failure": d(OBSERVED),
  "cert16-tc031-unlock-unknown-connector": d(OBSERVED),

  // --- Authorize outcomes --------------------------------------------------
  "cert16-tc023-1-authorize-invalid": d(OBSERVED),
  "cert16-tc023-2-authorize-expired": d(
    "Driven green. The fixture is provisioned as status Accepted with a past " +
      "cacheExpiryDateTime, because AuthorizeRequestOcpp16Handler consults the " +
      "expiry only inside its Accepted branch -- a row stored as Expired would " +
      "answer Invalid.",
  ),
  "cert16-tc023-3-authorize-blocked": d(
    "DRIVABLE AND CURRENTLY RED, deliberately: CitrineOS answers " +
      '{"idTagInfo":{"status":"Invalid"}} where the scenario requires Blocked ' +
      "(observed 3 runs out of 3). AuthorizeRequestOcpp16Handler reaches its " +
      "status mapper only through the `status === Accepted` branch, so a stored " +
      "Blocked falls through to the default Invalid; the only route to a real " +
      "Blocked is an IAuthorizer, and container.ts registers " +
      "`authorizers: asValue([])` with no setting that changes it. This is a " +
      "finding against CitrineOS, not a gap in this driver -- demoting it to " +
      "NOT_APPLICABLE would hide it. See tck/scope.ts.",
  ),

  // --- RemoteTrigger -------------------------------------------------------
  "cert16-tc010-remote-start": d(OBSERVED),
  "cert16-tc011-remote-start-stop": d(OBSERVED),
  "cert16-tc012-remote-stop": d(OBSERVED),
  "cert16-tc026-remote-start-rejected": d(OBSERVED),
  "cert16-tc028-remote-stop-rejected": d(
    "Driven green, including waitForActiveTransaction: CitrineOS populates " +
      "Transactions.authorizationId at creation time, so an OPEN transaction " +
      "resolves to its idTag through the Authorizations join.",
  ),
  "cert16-tc054-trigger-message": d(OBSERVED),
  "cert16-tc055-trigger-message-rejected": d(OBSERVED),

  // --- SmartCharging -------------------------------------------------------
  // The charging profiles are this driver's own catalogue rather than CSMS
  // records (see profiles.ts), and the sweep confirms the consequence that
  // mattered: the simulator logs `Applied charging profile #56`, so the ref
  // really is the chargingProfileId that reached the wire.
  "cert16-tc056-central-smart-charging-txdefault": d(OBSERVED),
  "cert16-tc057-central-smart-charging-txprofile": d(
    "Driven green, including the TxProfile's transactionId, which this driver " +
      "resolves from Transactions.transactionId rather than from the row key -- " +
      "CitrineOS mints the two independently.",
  ),
  "cert16-tc059-remote-start-with-profile": d(OBSERVED),
  "cert16-tc066-get-composite-schedule": d(
    'Driven green, including the "limit":11000 assertion on the returned ' +
      "composite schedule -- so profiles.ts's inline schedule reaches the " +
      "charge point intact.",
  ),
  "cert16-tc067-clear-charging-profile": d(OBSERVED),

  // --- LocalAuthListManagement --------------------------------------------
  // Drivable only from the v2 line: the 1.6 GetLocalListVersion and
  // SendLocalList endpoints do not exist at v1.9.1. compose.yaml pins
  // v2.0.0-beta1 for exactly these six rows; README.md documents what pinning
  // v1.9.1 instead would cost.
  "cert16-tc042-1-get-local-list-version-not-supported": d(OBSERVED),
  "cert16-tc042-2-get-local-list-version-empty": d(OBSERVED),
  "cert16-tc043-1-send-local-list-not-supported": d(
    "Driven green. LocalAuthListService refuses a listVersion not strictly " +
      "greater than the station's stored one, before anything reaches the wire; " +
      "prepareStation clears that row per run, which is what lets four " +
      "scenarios all send listVersion 1 to the same charge point id.",
  ),
  "cert16-tc043-3-send-local-list-failed": d(OBSERVED),
  "cert16-tc043-4-send-local-list-full": d(OBSERVED),
  "cert16-tc043-5-send-local-list-differential": d(
    "Driven green, including the wire-byte assertion on " +
      '`"listVersion":2,"localAuthorizationList":[{"idTag":...` -- so CitrineOS ' +
      "forwards this driver's JSON key order unchanged. See requests.ts.",
  ),

  // --- FirmwareManagement --------------------------------------------------
  // CitrineOS registers no 1.6 request handler for FirmwareStatusNotification
  // and answers every one with a NotSupported CALLERROR -- 9 of them across the
  // three TC_044 logs, and the only CALLERROR the CSMS sends anywhere in the
  // captured suite.
  //
  // TWO OF THESE ROWS ARE GREEN AND MUST NOT BE READ AS "CONFORMANT". OCA
  // TC_044_{1,2,3}_CSMS put steps 4 and 6 on the Central System: "The Central
  // responds with a FirmwareStatusNotification.conf". A CALLERROR is not that
  // conf, so CitrineOS does not do what those test cases require. Our scenarios
  // pass anyway because they assert only on the statuses the CHARGE POINT sent,
  // never on the CSMS's answer to them. That is a gap in the SCENARIOS, not
  // evidence about CitrineOS -- see drivers/citrineos/README.md.
  "cert16-tc044-1-firmware-update": d(
    "Driven green. It used to flake in the parallel pass of every recorded " +
      "run, on a timing property of the SCENARIO rather than a CitrineOS " +
      "limitation: retrieveDate was +90s against a 115s hold, leaving ~25s for " +
      "the status train. The spec now asks for +15s, so the train has the " +
      "whole window; see tck/specs/firmware.ts.",
  ),
  "cert16-tc044-2-firmware-download-failed": d(
    "Driven green. It was the FLAKIEST scenario here -- 1 pass in 3 runs, " +
      "failing even its isolated retry -- on the thinnest margin of all: " +
      "retrieveDate was +90s against a 110s hold, leaving ~20s. The spec now " +
      "asks for +15s and the scenario has been green since, flakes included. " +
      "ONE OBSERVATION FROM THOSE FAILURES IS UNEXPLAINED AND WORTH KEEPING: " +
      "the socket dropped (1006) just after CitrineOS's NotSupported " +
      "CALLERROR, costing a reconnect and a reboot that lose the firmware " +
      "state. Which side closed it was never established -- the obvious " +
      "suspect is that CALLERROR, and it is wrong, because TC_044.1 and " +
      "TC_044.3 take four of them each without disconnecting. If this ever " +
      "recurs, start there; do not cite it as a CitrineOS defect until it is " +
      "established.",
  ),
  "cert16-tc044-3-firmware-install-failed": d(OBSERVED),
  "cert16-tc045-1-get-diagnostics": d(
    "Driven green. Unlike UpdateFirmware, GetDiagnostics does have a 1.6 " +
      "response handler, and DiagnosticsStatusNotification has a 1.6 request " +
      "handler -- so nothing here is answered with a CALLERROR.",
  ),
} satisfies ScopeTable;

/**
 * Still DRIVABLE, and deliberately not demoted: the driver expresses every one
 * of these operations against v1.9.1 exactly as it does against v2. What fails
 * is the CSMS, on a defect that is upstream issue citrineos/citrineos#160 --
 * the Connector model requires non-null evseId / evseTypeConnectorId, so a 1.6
 * StatusNotification from an ad-hoc station cannot create a Connectors row, and
 * without one every StartTransaction is answered Invalid with transactionId 0.
 * Measured: 3 ChargingStations, 0 Connectors, 0 Transactions after a full
 * sweep. The issue was closed 2026-05-19, after v1.9.1 shipped on 2026-04-29,
 * and the fix is in the v2 line only.
 *
 * Demoting these to NOT_APPLICABLE would convert a reproducible CSMS defect
 * into silence about the harness, which tck/scope.ts forbids. VENDOR.md carries
 * the run.
 */
const V1_KNOWN =
  "Expressible on v1.9.1 and driven identically to v2. Scenarios that need a " +
  "transaction fail on that line through upstream citrineos/citrineos#160: no " +
  "Connectors row can be created for an ad-hoc 1.6 station, so StartTransaction " +
  "is answered Invalid. Fixed in the v2 line -- use CITRINE_VARIANT=v2.";

/**
 * The ids variant.ts demotes, restated as keys of V2_SCOPE.
 *
 * The annotation is the whole point: it makes a typo in that list a build
 * error. `check-driver` would also catch it, but only when run with
 * CITRINE_VARIANT=v1, and CI runs the v2 table.
 */
const V1_LOCAL_LIST: readonly (keyof typeof V2_SCOPE)[] =
  V1_LOCAL_LIST_SCENARIOS;

/**
 * The v1.9.1 table, derived from V2_SCOPE rather than written out again.
 *
 * Two edits, and the second one matters more than it looks. The six
 * local-auth-list rows become NOT_APPLICABLE, from the id list in variant.ts so
 * the table and `unroutedActions` cannot disagree. And EVERY INHERITED REASON
 * IS REPLACED, because V2_SCOPE's reasons say "driven green against the pinned
 * image" and that measurement was taken on v2 -- carrying the sentence over
 * would make this table assert a run that never happened on this line.
 *
 * The v1.9.1 line has a defect that most of the suite depends on, so a blanket
 * "driven green" would be wrong twice over. See V1_KNOWN.
 */
function v1Scope(): ScopeTable {
  const table: Record<string, ScopeEntry> = {};
  for (const [id, entry] of Object.entries(V2_SCOPE)) {
    table[id] = entry.status === "DRIVABLE" ? d(V1_KNOWN) : entry;
  }
  for (const id of V1_LOCAL_LIST) {
    table[id] = na(NO_LOCAL_LIST);
  }
  return table;
}

/** The scope table for a declared variant. See variant.ts. */
export function citrineosScope(variant: CitrineVariant): ScopeTable {
  return variant === "v2" ? V2_SCOPE : v1Scope();
}
