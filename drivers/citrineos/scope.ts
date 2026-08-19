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
 * ONE ROW IS DRIVABLE AND CURRENTLY RED, ON PURPOSE. `tck/scope.ts` forbids
 * demoting a row to NOT_APPLICABLE to make a red scenario go away, because
 * that converts a finding about the CSMS into a silence about the harness. It
 * is a finding against CitrineOS rather than a gap in this driver, it is named
 * in drivers/citrineos/README.md's gap table, and the red itself is declared in
 * expected.ts -- which is what lets a CI job stay blocking while carrying a
 * known finding. A TCK whose second driver reports 100% green is a TCK that has
 * stopped measuring.
 */
import type { ScopeEntry, ScopeTable } from "../../tck/scope";
import { BLOCKED_UNREACHABLE, FIRMWARE_STATUS_NOT_HANDLED } from "./expected";
import {
  CERT_201_SCENARIOS,
  NO_LOCAL_LIST,
  NO_OCPP_201_ON_V1,
  NO_RESERVATIONS,
  V1_LOCAL_LIST_SCENARIOS,
  type CitrineVariant,
} from "./variant";

/** The ordinary case: driven and green against the pinned image. */
const OBSERVED =
  "Driven green against the pinned CitrineOS image: the 1.6 message API " +
  "expresses the operation and Postgres answers the observation.";

const d = (reason: string) => ({ status: "DRIVABLE" as const, reason });
const c = (reason: string) => ({ status: "CONDITIONAL" as const, reason });
const na = (reason: string) => ({ status: "NOT_APPLICABLE" as const, reason });

/** The question every driven 2.0.1 row shares, worded once. */
const RESET_201 =
  "Expressible: CitrineOS binds Reset to the Configuration module's 2.0.1 " +
  "MessageApi, so this driver POSTs /ocpp/2.0.1/configuration/reset the same " +
  "way it POSTs the 1.6 path. What no run has answered yet is whether the " +
  "pinned v2.0.0-beta1 image dispatches it to a station it accepted through " +
  "allowUnknownChargingStations, whose EVSEs and device model are not " +
  "provisioned -- or refuses it before anything reaches the wire, which is " +
  "the shape several of its 1.6 refusals take.";

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
  // DRIVABLE AND CURRENTLY RED. The row stays DRIVABLE because demoting it
  // would hide a finding (see tck/scope.ts); the red itself is declared in
  // expected.ts, which is what lets CI report the other 46 scenarios without
  // muting the job. The mechanism is stated there and imported here so the two
  // cannot drift.
  "cert16-tc023-3-authorize-blocked": d(
    `${BLOCKED_UNREACHABLE} Expressible and driven: the driver sends the ` +
      "Authorize request the scenario asks for and reads the answer back. " +
      "What comes " +
      "back is Invalid where OCPP 1.6 requires Blocked, which is a finding " +
      "against CitrineOS rather than a gap in this driver -- declared in " +
      "expected.ts.",
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
  // ALL THREE ROWS ARE RED, AND THAT IS THE POINT. The mechanism sentence is
  // FIRMWARE_STATUS_NOT_HANDLED in expected.ts, where all three
  // expected-failure rows also live -- these scenarios are DRIVABLE and fail,
  // which is a finding about CitrineOS, not a reason to demote a scope row.
  //
  // They used to be green: the scenarios asserted only the statuses the CHARGE
  // POINT sent, never the CSMS's answer, so every CALLERROR passed unnoticed.
  // That was a gap in the SCENARIOS, not evidence about CitrineOS. Closing it
  // (issue #11, assertAllAnswered) turned a documented blind spot into a
  // measured finding: every other check in all three still passes, and the
  // single failure in each is the CALLERROR.
  "cert16-tc044-1-firmware-update": d(
    `${FIRMWARE_STATUS_NOT_HANDLED} Drivable, and RED on that obligation ` +
      "alone: the full Downloading -> Downloaded -> Installing -> Installed " +
      "train is asserted and passes. It also used to flake " +
      "in the parallel pass of every recorded run, on a timing property of the " +
      "SCENARIO rather than a CitrineOS limitation: retrieveDate was +90s " +
      "against a 115s hold, leaving ~25s for the status train. The spec now " +
      "asks for +15s, so the train has the whole window; see " +
      "tck/specs/firmware.ts.",
  ),
  "cert16-tc044-2-firmware-download-failed": d(
    `${FIRMWARE_STATUS_NOT_HANDLED} Drivable, and RED on that obligation ` +
      "alone -- the Downloading -> DownloadFailed train and both never-reached " +
      "negatives still pass. It was also the FLAKIEST scenario here on the " +
      "thinnest timing margin of all: retrieveDate was +90s against a 110s " +
      "hold, leaving ~20s. The spec now asks for +15s. " +
      "THE 1006 THIS ROW USED TO CALL UNEXPLAINED HAS AN ANSWER, AND IT IS " +
      "NOT THE CHARGE POINT: the CitrineOS process dies on an unhandled " +
      "promise rejection -- SequelizeForeignKeyConstraintError on " +
      "OCPPMessages_requestMessageId_fkey, thrown from " +
      "WebhookDispatcher.dispatchMessageReceived while persisting a message -- " +
      "and compose's `restart: unless-stopped` brings it straight back. From " +
      "the charge point's side that is exactly a 1006 followed by a reconnect " +
      "and a reboot. Observed 21 restarts over one 26h session and 2 more " +
      "inside a single sequential sweep. What is still NOT established is the " +
      "old suspicion that the CALLERROR causes it: the violated key is " +
      "requestMessageId, which fits 'the unhandled request was never " +
      "persisted, a later response references it', but that chain has not " +
      "been proven. The right next step is a CitrineOS issue for the " +
      "unhandled rejection, which is a crash whatever triggers it.",
  ),
  "cert16-tc044-3-firmware-install-failed": d(
    `${FIRMWARE_STATUS_NOT_HANDLED} The cleanest demonstration of what issue ` +
      "#11 was about: " +
      "10 of its 11 checks pass -- every status in the Downloading -> " +
      "Downloaded -> Installing -> InstallationFailed train, both ordering " +
      "checks, the Installed-never-reached negative, and the Boot/Status " +
      "notification answers -- and the single failure is that all four " +
      "FirmwareStatusNotification.req drew a NotSupported CALLERROR. Nothing " +
      "about the scenario changed except that it now looks at the answer.",
  ),
  "cert16-tc045-1-get-diagnostics": d(
    "Driven green. Unlike UpdateFirmware, GetDiagnostics does have a 1.6 " +
      "response handler, and DiagnosticsStatusNotification has a 1.6 request " +
      "handler -- so nothing here is answered with a CALLERROR.",
  ),

  // --- OCPP 2.0.1 ----------------------------------------------------------
  // THE FIRST CONDITIONAL ROWS IN THIS REPOSITORY, and the status is the
  // honest one rather than a placeholder. Every other row here says "driven
  // green against the pinned image" because it was; these five have never been
  // through a sweep, and DRIVABLE would assert a measurement nobody took. Each
  // reason therefore states the question the first live run must answer, which
  // is what tck/scope.ts asks a CONDITIONAL row for.
  //
  // Two of them are DRIVABLE all the same, and the difference is not
  // confidence: they drive no CSMS operation at all, so there is nothing about
  // this driver's API left to be conditional on.
  "cert201-tcb01-cold-boot": d(
    "Nothing to express: the scenario drives no CSMS operation, and the " +
      "transport already reaches a 2.0.1 station on this CSMS -- one endpoint " +
      "advertising ocpp2.1, ocpp2.0.1 and ocpp1.6, with the boot accepted and " +
      "routed against the 2.0.1 schemas " +
      "(github.com/juherr/open-ocpp-tck/issues/57).",
  ),
  "cert201-tcf20-heartbeat": d(
    "Nothing to express either: the heartbeat is sent by the charge point on " +
      "request and the CSMS's answer is the measurement. Observed answered on " +
      "the pinned image in the same run as the boot above.",
  ),
  "cert201-tcb20-reset-accepted": c(RESET_201),
  "cert201-tcb21-reset-scheduled": c(
    `${RESET_201} This one asks a second question first: whether a 2.0.1 ` +
      "transaction can be started at all against a station whose device model " +
      "is not provisioned, since without one there is nothing for OnIdle to " +
      "wait for and the answer comes back Accepted rather than Scheduled. " +
      "That gap was assigned to issue #58 by issue #57's closing comment, section A; it is not this driver's.",
  ),
  "cert201-tcb22-reset-rejected": c(
    `${RESET_201} And whether an evseId the station does not have survives ` +
      "the CSMS: CitrineOS may hold its own view of the station's EVSEs and " +
      "refuse to dispatch, which would be a finding about the CSMS rather " +
      "than about the charge point's answer -- but the two are only " +
      "distinguishable from a run.",
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
 * error, at the same moment it is written. `check-driver` also catches it --
 * CI runs it for both lines, `check:driver:citrineos-v1` being the v1 one --
 * but only after a commit, and only for the table that names the typo.
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
 *
 * A third edit since: the five OCPP 2.0.1 rows are demoted whatever they say
 * on v2. They are the one group the inherit-then-edit shape gets wrong in BOTH
 * directions -- a DRIVABLE one would come through as "expressible on v1.9.1
 * and driven identically", which is the opposite of true, and a CONDITIONAL
 * one would come through untouched, asking a question of a line this driver
 * declares no 2.0.1 surface for at all.
 */
function v1Scope(): ScopeTable {
  const table: Record<string, ScopeEntry> = {};
  for (const [id, entry] of Object.entries(V2_SCOPE)) {
    table[id] = entry.status === "DRIVABLE" ? d(V1_KNOWN) : entry;
  }
  for (const id of V1_LOCAL_LIST) {
    table[id] = na(NO_LOCAL_LIST);
  }
  // Last, so it overrides both passes above rather than being overridden.
  for (const id of CERT_201_SCENARIOS) {
    table[id] = na(NO_OCPP_201_ON_V1);
  }
  return table;
}

/** The scope table for a declared variant. See variant.ts. */
export function citrineosScope(variant: CitrineVariant): ScopeTable {
  return variant === "v2" ? V2_SCOPE : v1Scope();
}
