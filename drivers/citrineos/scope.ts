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

/** What the first sweep answered for every driven 2.0.1 row, worded once. */
const RESET_201 =
  "Driven green against the pinned CitrineOS image. The question these rows " +
  "were opened on is answered: v2.0.0-beta1 DOES dispatch a 2.0.1 Reset to a " +
  "station it accepted through allowUnknownChargingStations, whose EVSEs and " +
  "device model are not provisioned -- it does not refuse it before the wire, " +
  "which is the shape several of its 1.6 refusals take.";

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
  // SendLocalList endpoints do not exist at v1.9.1. compose.yaml pins a v2
  // prerelease for exactly these six rows; README.md documents what pinning
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
      "NOT THE CHARGE POINT: the CitrineOS process died on an unhandled " +
      "promise rejection -- SequelizeForeignKeyConstraintError on " +
      "OCPPMessages_requestMessageId_fkey, thrown from " +
      "WebhookDispatcher.dispatchMessageReceived while persisting a message -- " +
      "and compose's `restart: unless-stopped` brought it straight back. From " +
      "the charge point's side that is exactly a 1006 followed by a reconnect " +
      "and a reboot. Observed 21 restarts over one 26h session and 2 more " +
      "inside a single sequential sweep. THE CHAIN IS NOW ESTABLISHED, and " +
      "not by us: citrineos-core#830 states the mechanism and fixes it. The " +
      "correlation trigger ran entirely BEFORE INSERT, and its CALL branch " +
      "back-fills an already-stored response with `requestMessageId = NEW.id` " +
      "on a row Postgres has not inserted yet -- so every CALL persisted " +
      "after its own response violated that key. The old suspicion had the " +
      "right shape and the wrong direction: it is not that the request was " +
      "never persisted, it is that it was persisted second. The pinned image " +
      "is v2.0.0-beta3, which carries the fix, so this 1006 is history on the " +
      "digest this driver runs against -- and the crash it rode is not: a " +
      "failed audit insert still escapes, because citrineos-core#846 sits on " +
      "`next` only. Tracking that port to `main` is what is owed here, not a " +
      "new issue.",
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
  // MEASURED 2026-08-19, the first sweep that ran them, which is why none of
  // these says CONDITIONAL any more. They were written that way -- each row
  // stating the question the first live run must answer, because DRIVABLE
  // would have asserted a measurement nobody had taken -- and the run answered
  // it. Four are green. The fifth is DRIVABLE and red, and its row says why
  // that is a finding against neither this driver nor the CSMS.
  "cert201-tcb01-cold-boot": d(
    "Driven green. No CSMS operation to express, and the transport reaches a " +
      "2.0.1 station unchanged: one endpoint advertising ocpp2.1, ocpp2.0.1 " +
      "and ocpp1.6, with the boot accepted and routed against the 2.0.1 " +
      "schemas. What it does need from this driver is the device-model read " +
      "back -- the scenario asserts that each status the station reported was " +
      "RECORDED, which nothing on the wire can say -- and the rows that make " +
      "that answerable are written by provision and by prepareStation. " +
      "Issue #86.",
  ),
  // WHAT THIS ROW USED TO SAY, kept because it is the shape of the mistake and
  // not a typo: "nothing to express either -- the heartbeat is sent by the
  // charge point on request". That was true of the scenario and false of the
  // case. TC_F_20 is Trigger Message, its one tool validation is the CSMS
  // sending TriggerMessage, and this row declared a scenario that never asked
  // this driver for anything. A scope row can only be as right as the scenario
  // it describes.
  "cert201-tcf20-heartbeat": d(
    "Driven green. TriggerMessage routes through Configuration on the 2.0.1 " +
      "path exactly as its 1.6 namesake does, and requestedMessage reaches " +
      "the wire as the driver spelled it.",
  ),
  // THE TWO ROWS #63 PREDICTED WOULD NEED A DEVICE MODEL, and the prediction
  // was wrong in a way worth keeping written down. It read #57 §A's four
  // StatusNotificationService warnings -- real, and still open -- as covering
  // variable traffic too. It does not: GetVariables is CSMS-INITIATED, so the
  // device model that answers it is the STATION's. The pinned simulator has
  // one, a 12-entry component/variable map onto OCPP 1.6 configuration keys in
  // its own sources, and CitrineOS reads its own device model here only for
  // `bytesPerMessage` and `itemsPerMessage`, both of which fall back when it is
  // empty. Measured 2026-08-21 against an unprovisioned device model: both
  // green.
  "cert201-tcb06-get-variables": d(
    "Driven green. v2.0.0-beta1 forwards a single-entry getVariableData " +
      "intact -- component and variable reach the wire as the driver spelled " +
      "them, and the station answers Accepted -- against a station whose " +
      "EVSEs and device model CitrineOS never provisioned.",
  ),
  "cert201-tcb09-set-variables": d(
    "Driven green, one member further than the row above: attributeValue " +
      "survives as the STRING 2.0.1 requires whatever the variable's declared " +
      "type, so the CSMS does not re-type it on the way out, and the write is " +
      "answered Accepted.",
  ),
  "cert201-tcb20-reset-accepted": d(RESET_201),
  // THE ONE ROW HERE WHOSE ANSWER DEPENDS ON STATION STATE, and the state now
  // holds. It did not until #75: the station sends its 2.0.1 Authorize idToken
  // with type ISO14443 -- the type is a literal in the pinned simulator image,
  // not a setting -- and CitrineOS validates the idToken VALUE against that
  // type's format (8 or 14 hex characters) before any lookup, so every `CERT…`
  // fixture was rejected on its shape alone and
  // answered with a CALLERROR. No Authorize, no TransactionEvent, nothing for
  // OnIdle to defer to, and `Accepted` came back -- correct of the station and
  // correct of a CSMS that dispatched faithfully, which is why the scenario
  // reported its precondition unexercised instead of filing a non-conformance.
  // provision.ts now seeds an ISO14443-shaped tag typed ISO14443, which the
  // 2.0.1 lookup needs BOTH of: it matches the pair where the 1.6 handler
  // matches the idToken alone. Note this was never the device-model gap this
  // row predicted before it was first run.
  "cert201-tcb21-reset-scheduled": d(
    `${RESET_201} This row adds what the others cannot ask, and it answered ` +
      "too: with a transaction running the reset comes back Scheduled rather " +
      "than Accepted, and the TransactionEvent that makes the deferral " +
      "meaningful is answered -- the only 2.0.1 transaction traffic this suite " +
      "puts to this CSMS, and until now never exercised.",
  ),
  "cert201-tcb22-reset-rejected": d(
    `${RESET_201} And an evseId the station does not have survives the CSMS ` +
      "intact: the 2.0.1 ResetRequest schema constrains it no further, and " +
      "nothing validates it against the station's own EVSEs before dispatch.",
  ),

  // --- OCPP 2.0.1, NOT YET MEASURED ---------------------------------------
  // CONDITIONAL for the reason the seven rows above were CONDITIONAL until
  // 2026-08-19: they are expressible -- three of the four ask this driver for
  // nothing at all, and the fourth asks for a TriggerMessage it already
  // dispatches for TC_F_20 -- but whether the CSMS emits the message each case
  // needs is unknown until a live run. DRIVABLE here would assert a
  // measurement nobody has taken, which is the one thing tck/scope.ts's rules
  // say a row may not do. Each reason below states the question the first
  // sweep must answer; the sweep on the pull request that adds them is what
  // answers it.
  //
  // NO FEATURE IDENTIFIER on any of them, and that is the rule rather than an
  // omission: an identifier names the feature a CONDITIONAL case hangs on, and
  // all four are mandatory cases with no conditional feature behind them. What
  // is unknown is this deployment's behaviour, which is prose.
  "cert201-tcc02-authorize-invalid": c(
    "Does the 2.0.1 Authorize handler answer an idToken it has no row for " +
      "with idTokenInfo.status Invalid or Unknown? Nothing to express -- the " +
      "station presents the token -- and the answer is not obvious from the " +
      "1.6 side: that handler reaches its status mapper only through the " +
      "Accepted branch and defaults everything else to Invalid, while the " +
      "2.0.1 handler matches the (idToken, type) PAIR, so a token absent from " +
      "Authorizations and a token stored under another type look the same to " +
      "it. Either value satisfies the case; a CALLERROR does not, and that is " +
      "the outcome to watch for, because it is what an idToken failing the " +
      "ISO14443 format check produces.",
  ),
  "cert201-tce10-start-authorized": c(
    "Does the CSMS answer a Started TransactionEvent carrying an idToken it " +
      "just accepted on an Authorize with the same Accepted verdict? Nothing " +
      "to express again, and this is the only 2.0.1 transaction traffic in " +
      "this suite besides cert201-tcb21's -- which established that the " +
      "provisioned ISO14443 tag reaches an Accepted Authorize, and stopped " +
      "there. What is untested is the second verdict: a CSMS that accepts a " +
      "token and then declines the transaction started on it fails this case " +
      "and no row above would notice.",
  ),
  "cert201-tcf27-trigger-not-implemented": c(
    "Two questions, and the second is the case's. Does requestedMessage " +
      "FirmwareStatusNotification reach the wire unchanged -- TC_F_20 " +
      "established that Heartbeat does, and a value this CSMS cannot act on " +
      "itself is a different path through the same endpoint. And does the " +
      "CSMS go on serving the station after a TriggerMessageResponse of " +
      "NotImplemented, which the scenario measures as an ordinary Heartbeat " +
      "answered afterwards.",
  ),
  "cert201-tcj01-clock-aligned-meter-values": c(
    "Does the CSMS answer a bare MeterValuesRequest from a station with no " +
      "transaction running? Nothing to express, and the reason it is a real " +
      "question is issue #86's shape: the 2.0.1 handlers here have answered a " +
      "request, logged a warning and stored nothing before. This scenario " +
      "does not read the CSMS back -- unlike cert201-tcb01, there is no " +
      "device-model row a meter reading lands in that this driver can look up " +
      "-- so what it reports is the wire obligation alone, three times over.",
  ),

  // --- OCPP 2.0.1 ChangeAvailability, NOT YET MEASURED --------------------
  // CONDITIONAL for the block above's reason, and these six are the first
  // 2.0.1 rows where what is unknown is THIS DRIVER'S OWN ROUTE as well as the
  // CSMS's behaviour. `configuration/changeAvailability` was read off an
  // @AsMessageEndpoint decorator on the v2 line, which is what variant.ts
  // requires before an action may be declared routed -- and a decorator that
  // exists says the endpoint is bound, not that a request through it reaches
  // the wire intact. DRIVABLE would assert a measurement nobody has taken.
  //
  // ONE QUESTION IS SHARED BY ALL SIX and is the reason this block is worth
  // reading as a block: does `evse` survive the CSMS as an OBJECT? Every
  // other 2.0.1 operation this driver dispatches carries scalars, and the
  // three addressing scopes these cases are about are spelled by which members
  // of a nested object are present. A CSMS that flattened it, defaulted it, or
  // dropped it turns the station-wide request into the EVSE-scoped one and
  // back; TC_B_22 established that a scalar `evseId` reaches the wire
  // untouched, and that says nothing about a nested one.
  //
  // NO FEATURE IDENTIFIER, by the rule the block above states: six mandatory
  // cases with no conditional feature behind them.
  "cert201-tcg03-evse-inoperative": c(
    "Does an evse object carrying only `id` reach the wire with only `id`? " +
      "This row is also the first whose request is sent by a FIXTURE rather " +
      "than by the scenario -- tck/states-201.ts's `Unavailable` -- so it " +
      "additionally answers whether a CSMS-initiated Reusable State works " +
      "against this deployment at all. And whether the station's resulting " +
      "StatusNotification is answered, which issue #86's shape makes a real " +
      "question for 2.0.1 handlers here.",
  ),
  "cert201-tcg04-evse-operative": c(
    "The row above's question with the other operationalStatus, and one " +
      "more: two ChangeAvailability requests reach this station in one " +
      "scenario, so it is also where a CSMS that coalesced or reordered them " +
      "would show. Nothing in this suite has put two of one 2.0.1 operation " +
      "to this CSMS before.",
  ),
  "cert201-tcg05-station-inoperative": c(
    "Does an OMITTED evse stay omitted? This is the row where a CSMS that " +
      "helpfully fills in a default -- evse id 0, or an empty object -- turns " +
      "a station-wide request into something else, and the schema would not " +
      "stop it: `evse` is optional and `additionalProperties` is true. The " +
      "station answers a different question depending on which arrives.",
  ),
  "cert201-tcg06-station-operative": c(
    "The row above's question with the other operationalStatus, sent twice " +
      "in one scenario for TC_G_04's reason. Nothing here is expressible only " +
      "if the omission holds, which is why this row and that one are opened " +
      "on the same fact from two directions.",
  ),
  "cert201-tcg07-connector-inoperative": c(
    "Does `evse.connectorId` reach the wire at all? It is the only member " +
      "distinguishing this case from TC_G_03 -- the pinned station ignores it, " +
      "so the answer is visible ONLY in the request the CSMS sent, and a CSMS " +
      "that dropped it would make these two scenarios one measurement " +
      "reported twice. That is what this row is open on and what the first " +
      "sweep settles.",
  ),
  "cert201-tcg08-connector-operative": c(
    "The row above's question with the other operationalStatus, sent twice " +
      "in one scenario. Same measurement, same member, and its answer is " +
      "what says whether the connector-scoped pair are two cases here or one.",
  ),

  // --- OCPP 2.0.1 Smart Charging, NOT YET MEASURED ------------------------
  // CONDITIONAL for the block above's reason, and these nine are the first
  // 2.0.1 rows where the CSMS is not a pass-through at all: the SmartCharging
  // endpoints VALIDATE BEFORE THEY DISPATCH. A dozen of Part 2's K01 rules are
  // checked in the CSMS, and a request that fails one is answered HTTP 200
  // with `success: false` and puts NOTHING on the websocket -- so the failure
  // mode these rows are open on is not a reshaped request, it is no request at
  // all with an empty frame log to read it from. Every rule was read in the
  // pinned image's sources and every scenario is written against it; whether
  // that reading is complete is what the first sweep answers.
  //
  // TWO QUESTIONS ARE SHARED BY ALL NINE. Does a request survive that
  // validation -- which is a question about our profiles rather than about the
  // CSMS, and the one a red run here is likeliest to be about. And does a
  // profile survive the CSMS as a STRUCTURE: `ChangeAvailability` established
  // that a nested `evse` object of two scalars reaches the wire, and a
  // charging profile is an object carrying an array of objects carrying an
  // array of objects, which is a different claim.
  //
  // NO FEATURE IDENTIFIER on any of them, by the rule the blocks above state:
  // mandatory cases with no conditional feature behind them. Smart Charging is
  // a certification profile rather than a feature this scope table can hang a
  // row on.
  "cert201-tck01-set-tx-default-profile": c(
    "Does a whole ChargingProfileType reach the wire unaltered -- purpose, " +
      "kind, stack level, identifier, the schedule's unit and duration, the " +
      "period's limit, and the validity window? This row is the widest single " +
      "payload this driver has ever put to this CSMS, and the window is the " +
      "half with a known way to go wrong: the endpoint compares validFrom and " +
      "validTo against its OWN clock before dispatch, so a container whose " +
      "time has drifted from the runner's refuses a request this scenario " +
      "back-dated by a minute precisely to survive that.",
  ),
  "cert201-tck03-set-station-max-profile": c(
    "Does the pair (ChargingStationMaxProfile, evseId 0) survive together? " +
      "The endpoint refuses that purpose at any other EVSE and the station " +
      "rejects it on arrival, so the two ends agree -- which means a CSMS " +
      "that moved the scope produces a Rejected rather than a reshaped " +
      "request, and this row is where that is told from a dispatch failure.",
  ),
  "cert201-tck04-replace-profile": c(
    "Does a second profile under one identifier reach the wire at all? This " +
      "is the most delicate row of the nine and the reason is a CSMS rule " +
      "rather than a wire one: a profile whose station, stack level, purpose " +
      "and EVSE an ACTIVE one already holds is refused unless its validTo is " +
      "strictly later. The scenario's two windows ascend by a minute, which " +
      "also makes a re-run against a database that still holds the first " +
      "run's profile pass -- and whether an accepted SetChargingProfile " +
      "leaves the first profile active by the time the second is sent is a " +
      "race this deployment runs through a GetChargingProfiles of its own.",
  ),
  "cert201-tck10-set-default-profile-all-evses": c(
    "The row above's structure with the scope the case is about: does " +
      "evseId 0 stay 0 for a TxDefaultProfile? For this request 0 means every " +
      "EVSE rather than the station's own cap, so a CSMS that helpfully " +
      "resolved it to a real EVSE has sent TC_K_01's request, and nothing but " +
      "that one member tells the two apart.",
  ),
  "cert201-tck19-set-recurring-profile": c(
    "Do recurrencyKind and the schedule's duration both survive? The pinned " +
      "station REJECTS a Recurring profile carrying no recurrencyKind, so a " +
      "CSMS that dropped the member turns this row red at the station rather " +
      "than at an assertion -- which is a distinction this row is open on, " +
      "because a Rejected status and a missing member are two different " +
      "findings and only one of them is the CSMS's.",
  ),
  "cert201-tck43-composite-schedule-evse": c(
    "Does a GetCompositeSchedule for a named EVSE reach the wire? It is the " +
      "one endpoint here that reads the DEVICE MODEL before dispatching -- it " +
      "resolves the EVSE with a null connectorId, which is the row " +
      "provision.ts started writing for exactly this -- so a red run is as " +
      "likely to be about the fixture as about the CSMS, and telling those " +
      "apart is what the first sweep buys. The rate unit is asked for as " +
      "watts because a deployment declaring a RateUnit member list refuses " +
      "anything outside it, silently.",
  ),
  "cert201-tck44-composite-schedule-station": c(
    "The row above's question at evseId 0, where the CSMS skips the EVSE " +
      "lookup entirely -- so the pair is also how a fixture problem is told " +
      "from a routing one: this row green beside that one red is the device " +
      "model, both red is the endpoint.",
  ),
  "cert201-tck60-set-tx-profile": c(
    "Does a TxProfile naming a running transaction reach the wire, and does " +
      "the identifier survive as the STRING the station minted? Three things " +
      "have to hold at once and none of them has been measured: the CSMS " +
      "finds the transaction by that string, it finds an EVSE row with a null " +
      "connectorId, and no active profile already holds this stack level " +
      "against that transaction. It is also the only 2.0.1 transaction " +
      "traffic in this suite besides cert201-tcb21's and cert201-tce10's.",
  ),
  "cert201-tck70-stack-profiles": c(
    "Do two profiles at two stack levels both reach the wire? Nothing here " +
      "is expressible only if they do -- the two requests are independent -- " +
      "so what this row is open on is the negative: a CSMS that coalesced " +
      "them, or refused the second because it read two profiles at one EVSE " +
      "as a conflict, is the finding, and TC_K_04 is the row that says the " +
      "same CSMS accepts a replacement.",
  ),
  // --- OCPP 2.0.1 GetChargingProfiles, NOT YET MEASURED -------------------
  // CONDITIONAL for the block above's reason, and these seven carry ONE
  // question none of the nine above had: every one of them installs a profile
  // and then asks for it back, so a red row here is either the setup, the
  // query or the station -- three causes where the block above has two. The
  // per-row text below is what each one is open on beyond that.
  //
  // AND ONE FACT THAT IS THIS DEPLOYMENT'S ALONE. An accepted
  // SetChargingProfile makes this CSMS send a GetChargingProfiles OF ITS OWN,
  // so every scenario here puts two requests of the action under test on the
  // wire and only one is the case. The scenarios select theirs by requestId
  // rather than by position, and a run where the CSMS's generated identifier
  // collides with a scenario's is a FAIL naming the count -- deliberately, so
  // that a collision cannot quietly move which request was measured.
  "cert201-tck29-profiles-in-transaction": c(
    "Does a query scoped to the charging station itself survive with its " +
      "evseId 0 intact, while a transaction is running? Two things could go " +
      "wrong invisibly: a CSMS that dropped the member has asked about every " +
      "EVSE instead, which is a different case, and a CSMS that resolved 0 to " +
      "a real EVSE has asked TC_K_30's question. The transaction is the " +
      "case's precondition rather than the query's subject, so the fixture " +
      "failing costs the premise and not the request -- the row above " +
      "cert201-tcb21 states that rule.",
  ),
  "cert201-tck30-profiles-evse": c(
    "Does a criterion that narrows NOTHING reach the wire as the four-value " +
      "list the scenario sent? This CSMS refuses an empty criterion before " +
      "dispatch -- at least one of purpose, stack level or limit source must " +
      "be present -- so the whole enumeration is how a request says 'all of " +
      "them' here, and whether that list survives re-ordered, truncated or " +
      "collapsed to CSO is what this row is open on. Collapsed to CSO is " +
      "TC_K_34's request.",
  ),
  "cert201-tck32-profiles-by-id": c(
    "Does an OMITTED evseId stay omitted? This is the only scenario in the " +
      "suite that asks about every EVSE, and the only way to say so is by " +
      "absence -- 0 means the charging station itself. It is also the one " +
      "criterion this CSMS requires to travel alone: an identifier beside a " +
      "purpose, a stack level or a limit source is refused before dispatch, " +
      "so a CSMS that helpfully added one has produced an empty frame log " +
      "rather than a reshaped request.",
  ),
  "cert201-tck33-profiles-by-stack-level": c(
    "Does a stackLevel-only criterion reach the wire with exactly that one " +
      "member? The three narrowing rows -- this, TC_K_35 and TC_K_36 -- " +
      "differ in nothing else on the wire, so a CSMS that added a member " +
      "of its own has sent one of the others' requests. Note the CSMS's own " +
      "gate is truthiness-based, so a stack level of 0 would be refused " +
      "before dispatch; the scenario uses its own non-zero level.",
  ),
  "cert201-tck34-profiles-by-limit-source": c(
    "Does a one-value chargingLimitSource survive, and is CSO the value both " +
      "ends agree on? The CSMS stamps CSO on every profile it installs and " +
      "the station short-circuits to NoProfiles for any list without it, so " +
      "the value is not the case's choice -- what this row measures is that " +
      "the list arrives with one element rather than four (TC_K_30's " +
      "request) and with an evseId rather than none (the CSMS's own " +
      "unprompted query, which carries this same one-value list).",
  ),
  "cert201-tck35-profiles-by-purpose": c(
    "TC_K_33's question on the other axis: does a purpose-only criterion " +
      "reach the wire with exactly that one member? The station maps the " +
      "purpose through a table that does not know " +
      "ChargingStationExternalConstraints, so a CSMS that substituted a " +
      "purpose is answered NoProfiles rather than with a reshaped report -- " +
      "which is why the status is asserted beside the request.",
  ),
  "cert201-tck36-profiles-by-purpose-stack": c(
    "Do TWO criterion members travel together? This is the row the pair " +
      "above is a control for: both members present is this case, either one " +
      "alone is one of theirs, and nothing else on the wire tells the three " +
      "apart. A CSMS that dropped a member it did not understand is the " +
      "finding, and it is invisible to any check that only looks for the " +
      "members it was told to expect.",
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

/** The same annotation for the same reason, over the other id list v1Scope()
 *  demotes. Both lists are written in variant.ts against a table declared
 *  here, so both need the round trip back through `keyof` to be checked at
 *  all -- and this is the one whose own note in variant.ts records that a row
 *  it fails to name is inherited silently. */
const CERT_201: readonly (keyof typeof V2_SCOPE)[] = CERT_201_SCENARIOS;

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
 * A third edit since: every OCPP 2.0.1 row is demoted whatever it says on v2.
 * They are the one group the inherit-then-edit shape gets wrong in BOTH
 * directions -- a DRIVABLE one would come through as "expressible on v1.9.1
 * and driven identically", which is the opposite of true, and a CONDITIONAL
 * one would come through untouched, asking a question of a line this driver
 * declares no 2.0.1 surface for at all. Which rows those are is
 * CERT_201_SCENARIOS' to say, and the count belongs in neither file.
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
  for (const id of CERT_201) {
    table[id] = na(NO_OCPP_201_ON_V1);
  }
  return table;
}

/** The scope table for a declared variant. See variant.ts. */
export function citrineosScope(variant: CitrineVariant): ScopeTable {
  return variant === "v2" ? V2_SCOPE : v1Scope();
}
