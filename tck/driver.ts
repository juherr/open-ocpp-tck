// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * driver.ts -- THE CSMS DRIVER CONTRACT.
 *
 * Every scenario spec in specs/ is written against this file and nothing else.
 * A driver (drivers/<id>/) implements it; the core never learns which CSMS it
 * is driving, and a driver never learns which scenario is driving it.
 *
 * WHY THE OPERATION VOCABULARY IS SHAPED LIKE OCPP AND NOT LIKE A CSMS
 * -------------------------------------------------------------------
 * The contract this replaces was `op(opPath: string, fields: Record<string,
 * string>)`, where the keys were literally the input names of SteVe's manager
 * UI forms: `chargePointSelectList`, `confKey`, `keyType`, `availType`,
 * `chargingProfilePk`, `retrieveDateTime`. That is not a contract, it is one
 * CSMS's HTML serialised -- and every other driver paid to undo it. The second
 * driver written against it carried roughly 340 lines whose only job was to
 * reverse the encoding, and `ChangeAvailability`, which no spec drives, had to
 * accept four plausible spellings of its own field name because no call site
 * pinned it. A driver guessing at four spellings is the contract failing at its
 * one job.
 *
 * The vocabulary below is derived from the OCPP 1.6 request payloads instead:
 * `Reset.type`, `ReserveNow.expiryDate`, `SendLocalList.updateType` are named
 * and typed as the specification names and types them. That is the only
 * vocabulary two independent CSMSs are guaranteed to share, and it is already
 * the vocabulary the assertions are written in -- they match on the wire frame.
 *
 * Three consequences worth stating, because each replaces a runtime failure
 * with a compile-time one:
 *
 *  - There is no in-band `""` sentinel anywhere in this union. Absence is `?:`.
 *    Previously `chargingProfilePk: ""`, `transactionId: ""` and
 *    `connectorId: ""` each meant "absent", and every driver had to learn that
 *    independently.
 *  - `switch (op.action)` plus `assertNever` makes adding an operation to this
 *    union a COMPILE ERROR in every driver that has not handled it. Before,
 *    a new upstream operation was discovered at runtime, mid-campaign, against
 *    a third party's acceptance environment.
 *  - Numbers are numbers and instants are `Date`s. Formatting an instant into
 *    whatever a particular CSMS's API wants is that driver's problem, which is
 *    where it belongs.
 *
 * THREE THINGS A DRIVER MAY NOT DO
 * --------------------------------
 *  1. Throw for an OCPP-level outcome. `execute()` resolves as soon as the
 *     CSMS has ACCEPTED or DISPATCHED the operation. A `Rejected` CALLRESULT, a
 *     CALLERROR, or no response at all are NORMAL returns: every spec asserts
 *     on the simulator's own captured wire log, never on this call's result.
 *     Throw only for a genuine transport or request failure -- bad auth, a
 *     malformed request, an HTTP error.
 *  2. Invent an observation it cannot make. See {@link CsmsRecords}.
 *  3. Branch on a scenario id. A driver that wants per-scenario behaviour is
 *     describing a capability gap; declare it in the driver's scope table.
 */

import type { ExpectedFailureTable } from "./expected";
import type { ScopeTable } from "./scope";

// ---------------------------------------------------------------------------
// Opaque CSMS-side handles
//
// These are NOT OCPP values. They name a thing the CSMS owns -- SteVe's
// `transaction_pk`, another CSMS's session uuid, some REST resource id. A spec
// obtains one from CsmsRecords and hands it back to execute(); it never parses one,
// and never constructs one except from a literal a scenario deliberately makes
// up (TC_052's nonexistent reservation "99999").
//
// String aliases rather than branded types, on purpose: the specs stay
// readable, and a brand would force every driver to cast on the way out to
// prevent a confusion that cannot arise -- each of the three appears in
// exactly one operation field.
//
// The empty string means "the CSMS has no such record" and is the only in-band
// value with meaning. Anything else is opaque.
// ---------------------------------------------------------------------------

/** A CSMS-side transaction / charging-session handle. `""` = none. */
export type TransactionRef = string;
/** A CSMS-side reservation handle. `""` = none. */
export type ReservationRef = string;
/** A CSMS-side charging-profile handle. `""` = none. */
export type ChargingProfileRef = string;

// ---------------------------------------------------------------------------
// OCPP 1.6 enumerations. Spelled exactly as the specification spells them on
// the wire, because that is what the assertions match on (e.g. a spec checks
// /"Reset".*"type":"Hard"/ against the captured frame).
// ---------------------------------------------------------------------------

export type ResetType16 = "Hard" | "Soft";
export type AvailabilityType = "Operative" | "Inoperative";
export type UpdateType = "Full" | "Differential";
export type ChargingRateUnit = "A" | "W";
export type ChargingProfilePurpose =
  | "ChargePointMaxProfile"
  | "TxDefaultProfile"
  | "TxProfile";
export type MessageTrigger =
  | "BootNotification"
  | "DiagnosticsStatusNotification"
  | "FirmwareStatusNotification"
  | "Heartbeat"
  | "MeterValues"
  | "StatusNotification";
export type AuthorizationStatus =
  | "Accepted"
  | "Blocked"
  | "Expired"
  | "Invalid"
  | "ConcurrentTx";

/**
 * One `AuthorizationData` entry of a SendLocalList payload.
 *
 * A CSMS whose local-list API carries only tag NAMES -- SteVe's manager UI
 * does -- honours `idTag` and must DOCUMENT in its driver that it ignores the
 * rest. It must not silently pretend it applied `status` or `expiryDate`:
 * a scenario asserting on the resulting list would then pass for a reason that
 * never happened.
 */
export interface LocalAuthorizationEntry {
  idTag: string;
  status?: AuthorizationStatus;
  expiryDate?: Date;
  parentIdTag?: string;
}

// ---------------------------------------------------------------------------
// The OCPP 1.6 operation vocabulary -- 18 members. Compulsory: every driver
// switches on it. The opt-in 2.0.1 one is further down.
// ---------------------------------------------------------------------------

export type CsmsOperation16 =
  // --- Core -----------------------------------------------------------------
  | { action: "Reset"; type: ResetType16 }
  | { action: "UnlockConnector"; connectorId: number }
  | { action: "ClearCache" }
  | { action: "ChangeAvailability"; connectorId: number; type: AvailabilityType }
  | {
      action: "GetConfiguration";
      /** Absent = every key. A CSMS that can only ask for all keys throws
       *  {@link UnsupportedOperationError} when this is present and non-empty,
       *  rather than silently widening the request. */
      keys?: string[];
    }
  | { action: "ChangeConfiguration"; key: string; value: string }
  | {
      action: "RemoteStartTransaction";
      idTag: string;
      /** Absent = let the charge point choose the connector. */
      connectorId?: number;
      /** Absent = start without a charging profile. Present means the profile
       *  must travel INSIDE RemoteStartTransaction.req -- that is what the
       *  scenario asserts on the wire, so a CSMS that can only apply it out of
       *  band must throw rather than apply it another way. */
      chargingProfile?: ChargingProfileRef;
    }
  | { action: "RemoteStopTransaction"; transaction: TransactionRef }
  // --- RemoteTrigger --------------------------------------------------------
  | {
      action: "TriggerMessage";
      requestedMessage: MessageTrigger;
      /** Absent = station-wide, i.e. no connectorId on the wire. */
      connectorId?: number;
    }
  // --- SmartCharging --------------------------------------------------------
  | {
      action: "SetChargingProfile";
      connectorId: number;
      chargingProfile: ChargingProfileRef;
      /** Present = scoped to this running transaction (TxProfile). */
      transaction?: TransactionRef;
    }
  | {
      action: "GetCompositeSchedule";
      connectorId: number;
      /** Seconds. */
      duration: number;
      chargingRateUnit?: ChargingRateUnit;
    }
  | {
      action: "ClearChargingProfile";
      chargingProfile?: ChargingProfileRef;
      connectorId?: number;
      purpose?: ChargingProfilePurpose;
      stackLevel?: number;
    }
  // --- FirmwareManagement ---------------------------------------------------
  | {
      action: "UpdateFirmware";
      location: string;
      /** An absolute instant. A CSMS whose API takes a minute-resolution local
       *  string formats it ITSELF, and rounds UP to the next whole minute so
       *  that any strictly-future instant stays strictly future -- truncating
       *  can land in the already-past current minute. */
      retrieveDate: Date;
      retries?: number;
      /** Seconds. */
      retryInterval?: number;
    }
  | {
      action: "GetDiagnostics";
      location: string;
      startTime?: Date;
      stopTime?: Date;
      retries?: number;
      retryInterval?: number;
    }
  // --- LocalAuthListManagement ---------------------------------------------
  | { action: "GetLocalListVersion" }
  | {
      action: "SendLocalList";
      listVersion: number;
      updateType: UpdateType;
      /** Absent = an empty list. A Full update with no entries clears it. */
      localAuthorizationList?: LocalAuthorizationEntry[];
    }
  // --- Reservation ----------------------------------------------------------
  | {
      action: "ReserveNow";
      connectorId: number;
      idTag: string;
      expiryDate: Date;
      parentIdTag?: string;
      /** Absent = let the CSMS allocate the reservation id. */
      reservation?: ReservationRef;
    }
  | { action: "CancelReservation"; reservation: ReservationRef };

export type CsmsOperation16Action = CsmsOperation16["action"];

// `as const satisfies readonly CsmsOperation16Action[]` -- what the first of
// the two lists below used to say -- rejects a name that is NOT an action, and
// accepts one that MISSES an action. That is the same one-directional hole
// tck/standing.ts records above its own list, with the measurement: deleting a
// member type-checked clean. There the fix is to derive the type FROM the
// list, which is not available here, because CsmsOperation16Action is derived
// from the union's arms and the list is the second copy.
//
// And nothing else covers the hole, because everything that could is computed
// FROM the list. A driver declaring it whole -- `new Set(...)` -- claims less
// than it meant to; a driver filtering it loses the same name a second way;
// and check-driver's "not declared" warning is derived from it too. A missing
// name is invisible from every direction at once, including the one direction
// that exists to print it.
//
// Closed in the compiler rather than in a guard, because the compiler already
// decides the other half and a shell guard would be re-deciding from outside
// what tsc knows from inside. Three details, each load-bearing:
//   - CURRIED because TypeScript has no partial type-argument inference.
//     `everyOneOf<U, T>(list)` with `T` defaulted stops inferring and the
//     emitted declaration degrades from the tuple to `readonly U[]`.
//   - `[U] extends [T[number]]` is BRACKETED to stop the naked type parameter
//     distributing.
//   - the false branch is a BARE template literal rather than an array of one,
//     so the whole list mismatches ONCE and the diagnostic names what is
//     missing -- "Argument of type 'string[]' is not assignable to parameter
//     of type '"this list omits GetVariables"'" -- instead of repeating itself
//     per element.
//
// The flattening a reviewer reaches for first is `as const satisfies` plus a
// `type Missing = Exclude<...>` alias. It was tried: tsc reports
// "'Missing' is declared but never used" under this repo's noUnusedLocals, and
// exporting the alias to silence that publishes a `never` into the API that
// can never go red.
function everyOneOf<U extends string>() {
  return <const T extends readonly U[]>(
    list: [U] extends [T[number]]
      ? T
      : `this list omits ${Exclude<U, T[number]>}`,
  ): T => list as T;
}

/** Every action name, for capability declarations and run reporting. */
export const CSMS_OPERATION_16_ACTIONS = everyOneOf<CsmsOperation16Action>()([
  "Reset",
  "UnlockConnector",
  "ClearCache",
  "ChangeAvailability",
  "GetConfiguration",
  "ChangeConfiguration",
  "RemoteStartTransaction",
  "RemoteStopTransaction",
  "TriggerMessage",
  "SetChargingProfile",
  "GetCompositeSchedule",
  "ClearChargingProfile",
  "UpdateFirmware",
  "GetDiagnostics",
  "GetLocalListVersion",
  "SendLocalList",
  "ReserveNow",
  "CancelReservation",
]);

// ---------------------------------------------------------------------------
// The OCPP 2.0.1 operation vocabulary -- OPT-IN. The count is the note
// below's to state; a second spelling of it here is one that goes stale.
//
// A SECOND CLOSED UNION, not a widening of the one above, and the reason is
// the mechanism rather than taste. `assertNever` makes every arm of
// `CsmsOperation16` compulsory in every driver that switches on it -- which is
// the property worth having, and exactly why adding 2.0.1 arms there is not
// available: it would fire in every existing driver, third-party ones
// included, on an upgrade they did not ask for. A 1.6-only driver would have
// no way to decline. The mechanism that protects us would be the mechanism
// that breaks everyone.
//
// So: a driver that speaks only OCPP 1.6 implements nothing here and compiles
// untouched. Exhaustiveness is preserved WITHIN each union, because each
// driver's switch still covers one closed set. Issue #25 argues the two
// alternatives -- widening, and a version-parameterised
// `CsmsOperations16<V>` -- and rejects both; that argument is not re-run here.
//
// WHY FOUR AND NOT ELEVEN. OCA-201-SELECTION.md's first slice was seven
// certification cases, and CASES ARE NOT OPERATION KINDS -- the distinction is
// the whole of this note. SIX of the seven are CSMS-INITIATED: TC_B_20,
// TC_B_21 and TC_B_22 all drive Reset, TC_B_06 and TC_B_09 drive GetVariables
// and SetVariables, and TC_F_20 -- "Trigger message - Heartbeat" -- drives
// TriggerMessage. Between them those six spell FOUR kinds of operation, which
// is what this union counts. TC_B_01 is a BootNotification observed on the
// wire rather than driven, so it needs no arm at all. "As few as the first
// slice needs" is that file's number, not this file's judgement.
//
// THE FOURTH ARM IS A CORRECTION, and it is left visible because the mistake
// is the one this note is most likely to repeat. This union shipped with three
// arms and the sentence above said TC_F_20 was "Heartbeat, observed on the wire
// rather than driven". It is not: the case's only tool validation is the CSMS
// sending a TriggerMessageRequest, and the scenario that claimed it drove a
// heartbeat from the station instead. The claim was read off the case's TITLE,
// which names the message the station is made to send, where the reference
// organises a case by which side is under test -- the same correction
// OCA-201-SELECTION.md records against the six candidate messages the milestone
// was scoped from. Nothing could contradict it until the cases were read:
// tests/oca-201-operations.sh is the direction that now would.
//
// AND WHY FOUR IS NOT THE FINAL ANSWER. That page's rule now selects 147 cases
// rather than seven, and tck/specs/OCA-201-OPERATIONS.txt measures what they
// ask for: TWENTY kinds of operation, over 90 cases that drive one and 57 that
// drive none. So this union grows, once per operation a tranche buys. What
// does NOT change is
// how: the count comes from the cases selected, and a case that only observes
// charge-point-initiated traffic still needs no arm here. Adding the rest of
// the 2.0.1 messages because they exist is the mistake "three, not eighteen"
// was written against, and it reads the same whichever direction the number
// moves in.
//
// THE FIFTH ARM WAS THE FIRST BOUGHT THAT WAY, and it arrived the way the rule
// above says one should: by a measurement rather than by a shopping list.
// tck/specs/OCA-201-OPERATIONS.txt puts ChangeAvailability first among the
// tranches -- nine of the selected cases need it and no other operation -- and
// reading those nine in Part 6 found SIX writable against the pinned image.
// The other three ask for a station-side event that image hard-codes (issue
// #114), so they stay declined with that reason in their slice rows rather
// than with this arm's absence. One operation, six cases; the tranche is what
// makes that trade legible before the code is written.
//
// THE SIXTH AND SEVENTH ARE THE SAME MOVE ONE TRANCHE UP, and they are bought
// together because the table says to. `SetChargingProfile` is the LARGEST
// tranche the measurement found -- thirteen cases need it -- and
// `GetCompositeSchedule` is two cases that need nothing else; both are Smart
// Charging, both address an EVSE the same way, and a driver wiring one has the
// module and the addressing for the other. Reading the fifteen in Part 6 found
// NINE writable: seven Set and both Get. Of the four that are not, two want an
// operation this pair does not contain and two are blocked by the pinned
// simulator -- one needs an RPC-level `NotSupported` its 2.0.1 dispatcher never
// raises, the other a continued `ReportChargingProfiles` its payload literal
// cannot set `tbc` on. Their slice rows now say THAT, because "no charging
// profile operation exists" stopped being true here.
//
// THE EIGHTH IS THE HEAD OF THE TABLE AGAIN, and it is bought alone where the
// pair above was bought together. `GetChargingProfiles` is what
// tck/specs/OCA-201-OPERATIONS.txt puts first once the Smart Charging pair is
// spent -- eight cases need it -- and nothing else on that table shares its
// module the way `GetCompositeSchedule` shared `SetChargingProfile`'s, so
// there is no second verb whose wiring is already paid for. Reading the eight
// in Part 6 found SEVEN writable; the eighth is `TC_K_31`, which was already
// declined on the pinned simulator's `ReportChargingProfiles` payload literal
// rather than on this verb, and stays declined for that reason.
//
// AND EVERY ONE OF THE SEVEN NEEDS A PROFILE INSTALLED FIRST, which is a fact
// about this arm's cases rather than about the arm. A station with nothing
// stored answers `NoProfiles`, so each scenario sends a `SetChargingProfile`
// before the request it is about -- the first time one 2.0.1 case needs two
// arms of this union, and the reason the pair above had to land first.
//
// THE NINTH CLOSES SMART CHARGING, and it is the first arm bought for a block
// rather than for a head count. `ClearChargingProfile` completes three cases --
// TC_K_05, TC_K_06 and TC_K_08 -- where six of the eight verbs still unbought
// carry more. It goes first anyway because those three are the LAST three of
// the twenty-one Smart Charging cases the rule selects that no simulator
// limitation blocks: after it the block is 19 of 21, and the two left over
// (TC_K_15, TC_K_31) are declined on the pinned station's payload builder
// rather than on this union. Finishing a block is worth more than two cases of
// a block nobody has started, because a block finished is a claim that can be
// made about a CSMS.
//
// AND IT IS THE FIRST ARM WHOSE CASES MEASURE A REFUSAL. TC_K_08 clears a
// profile that was never installed, and the station is expected to answer
// `Unknown` -- the only negative answer anywhere in the Smart Charging block.
// Every other case here reads `Accepted`, which means every other case here
// would also pass against a CSMS that said `Accepted` to anything.
// ---------------------------------------------------------------------------

/** OCPP 2.0.1 `ResetEnumType`. Not OCPP 1.6's Hard/Soft -- see the note on
 *  the `Reset` arm below. */
export type ResetType201 = "Immediate" | "OnIdle";

/**
 * OCPP 2.0.1 `MessageTriggerEnumType`, whole.
 *
 * COMPLETE WHERE THE UNION BELOW IS MINIMAL, and the two rules do not conflict
 * because they are about different things. "As few as the slice needs" prices
 * an operation and an optional member: each costs a driver a switch arm or a
 * field to translate, and each can be added later for nothing. An enum value
 * costs neither -- a driver passes it through -- and adding one LATER is the
 * breaking direction for a driver that switches on it exhaustively. So the
 * eleven are here because widening is the expensive move, not because a
 * scenario reaches them; {@link MessageTrigger} carries OCPP 1.6's six on the
 * same terms.
 */
export type MessageTrigger201 =
  | "BootNotification"
  | "FirmwareStatusNotification"
  | "Heartbeat"
  | "LogStatusNotification"
  | "MeterValues"
  | "PublishFirmwareStatusNotification"
  | "SignChargingStationCertificate"
  | "SignCombinedCertificate"
  | "SignV2GCertificate"
  | "StatusNotification"
  | "TransactionEvent";

// NOT BUILT, here because here is where they get added -- every OPTIONAL
// member of the five requests below EXCEPT the ones a slice reached:
// `ComponentType`'s `instance` and `evse`, `VariableType`'s `instance`,
// `GetVariableDataType`'s and `SetVariableDataType`'s `attributeType`,
// `TriggerMessageRequest`'s `evse`, and the `AttributeEnumType` the second of
// those needs.
//
// `EVSEType` LEFT THIS LIST the way `ResetRequest`'s `evseId` did, and the
// entry is rewritten rather than deleted so the rule stays visible: it is here
// under {@link Evse201} because `ChangeAvailabilityRequest` cannot address an
// EVSE or a connector without it, and three of the six cases that arm was
// written for are exactly the addressing modes it spells. `TriggerMessage`'s
// `evse` is still absent, and now for a reason with nothing to do with the
// type existing: no case in the writable slice scopes a trigger to an EVSE.
//
// The section header above applies "as few as the first slice needs" to the
// operation count. This is the same rule one level down, applied to every
// optional member rather than to the ones that looked speculative -- a rule
// kept for five members out of six is not a rule. None of those left is
// reachable from what the slice does: TC_B_06 and TC_B_09 are "read one
// variable" and "write one variable", and `attributeType` is what TC_B_07
// varies, a case OCA-201-SELECTION.md puts OUTSIDE the slice as conditional on
// C-45.
//
// It holds for a reason the array note below does not share. Widening
// `variables` from one to many later would BREAK a driver's switch; adding an
// optional member breaks nothing. So each of these arrives with the scenario
// that needs it, priced at zero -- which is exactly how `ResetRequest`'s
// `evseId` left this list. It is not a member somebody thought would be handy:
// addressing an EVSE the station does not have is the only way this simulator
// answers a Reset `Rejected` at all, so without it one of the three mandatory
// Reset cases has no request to make. Arriving that way is the rule working,
// not an exception to it.
//
// What none of them can arrive with is a guess. Being half-right ships a
// published `.d.ts` that nobody can subtract from.

/**
 * OCPP 2.0.1 `EVSEType` -- how a request addresses part of a station.
 *
 * NESTED, AND THAT IS THE WHOLE POINT rather than a transcription of the
 * schema. 2.0.1 has no flat `evseId` member on this request: `id` names the
 * EVSE, and `connectorId` INSIDE the same object narrows it to one connector.
 * So the three addressing modes a request can be in are told apart by which of
 * these two are present -- whole station (no `evse` at all), one EVSE (`evse`
 * with `id` alone), one connector (`evse` with both) -- and a driver flattening
 * them into a single number makes the first and third indistinguishable on the
 * wire. Two of the six ChangeAvailability cases differ from two others in
 * NOTHING ELSE, so the flat spelling would have made them duplicates that both
 * pass.
 *
 * `ResetRequest`'s own `evseId` is a different member and stays flat, because
 * that is what its schema carries: 2.0.1 does not address a connector for a
 * reset.
 */
export interface Evse201 {
  id: number;
  connectorId?: number;
}

/** OCPP 2.0.1 `ComponentType` -- half of a device-model address. */
export interface Component201 {
  name: string;
}

/** OCPP 2.0.1 `VariableType` -- the other half of a device-model address. */
export interface Variable201 {
  name: string;
}

/** OCPP 2.0.1 `GetVariableDataType`. */
export interface GetVariableData201 {
  component: Component201;
  variable: Variable201;
}

/** OCPP 2.0.1 `SetVariableDataType`. */
export interface SetVariableData201 {
  component: Component201;
  variable: Variable201;
  /** Always a string on the wire, whatever the variable's declared data type:
   *  2.0.1 carries values as text and the device model says how to read them.
   *  A driver must not "helpfully" send a number. */
  attributeValue: string;
}

/** OCPP 2.0.1 `ChargingProfilePurposeEnumType`, whole. NOT
 *  {@link ChargingProfilePurpose}: 1.6 spells the station-wide purpose
 *  `ChargePointMaxProfile` and has no external-constraints value at all. */
export type ChargingProfilePurpose201 =
  | "ChargingStationExternalConstraints"
  | "ChargingStationMaxProfile"
  | "TxDefaultProfile"
  | "TxProfile";

/** OCPP 2.0.1 `ChargingProfileKindEnumType`. */
export type ChargingProfileKind201 = "Absolute" | "Recurring" | "Relative";

/** OCPP 2.0.1 `RecurrencyKindEnumType`. */
export type RecurrencyKind201 = "Daily" | "Weekly";

// TRIED AND REJECTED, here because here is where it gets re-proposed: aliasing
// this to {@link ChargingRateUnit}, or declaring one shared type both
// protocols import. It is the FIRST 2.0.1/1.6 homonym whose values are
// identical -- `"W" | "A"` on both wires -- so the three notes below, which all
// argue from the two protocols DISAGREEING, say nothing about it and a reader
// who has understood them will offer this merge as the obvious one they left
// undone. It is still declined, for three reasons that do not need a
// disagreement:
//
//   1. AGREEING TODAY IS A MEASUREMENT, NOT A RULE. `ChargingRateUnitType` and
//      `ChargingRateUnitEnumType` are two enumerations in two separately
//      maintained specifications; neither owes the other its members. A value
//      added to one -- and 2.1 is already editing this corner -- would, through
//      an alias, silently widen the OTHER protocol's contract for every driver
//      that switches on it exhaustively, which is exactly the failure the
//      `MessageTrigger201` note prices as "the breaking direction".
//   2. AN EXCEPTION COSTS MORE THAN THE LINE IT SAVES. The arms below establish
//      one regime for this file: two protocols, two closed vocabularies, no
//      shared core. One aliased type makes that a rule with an exception, and
//      the next reader has to check PER TYPE which regime applies rather than
//      knowing it from the file. The saving is one declaration.
//   3. THE AGREEMENT IS NOT USABLE ANYWAY. 1.6 carries the unit once per
//      `csChargingProfiles`; 2.0.1 carries it inside each `chargingSchedule`,
//      of which a profile may have three. A driver cannot pass a value from one
//      vocabulary to the other without deciding which schedule it belongs to,
//      so the shared type would be shared by nothing that runs.
//
// `//` rather than a doc comment, by the rule the `Reset` arm states: an
// internal decision, not something a driver author is shipped.
/** OCPP 2.0.1 `ChargingRateUnitEnumType`. */
export type ChargingRateUnit201 = "W" | "A";

/** OCPP 2.0.1 `ChargingSchedulePeriodType`. */
export interface ChargingSchedulePeriod201 {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
  phaseToUse?: number;
}

/**
 * OCPP 2.0.1 `ChargingScheduleType`.
 *
 * `id` IS REQUIRED AND HAS NO 1.6 COUNTERPART. 1.6's chargingSchedule is
 * anonymous -- it is identified by the profile that carries it -- where 2.0.1
 * gives every schedule its own identifier, because a profile may carry up to
 * three and `GetCompositeSchedule` and `NotifyEVChargingSchedule` name one.
 *
 * `startSchedule` is optional in the schema and NOT optional in practice for
 * the two kinds this suite sends: 2.0.1 requires it for `Absolute` and
 * `Recurring` and forbids it for `Relative`. That is a rule about the pair, so
 * it is not expressible in this type without splitting the profile into three,
 * and it is stated here rather than enforced.
 */
export interface ChargingSchedule201 {
  id: number;
  chargingRateUnit: ChargingRateUnit201;
  /** 1..N on the wire, and the first period's `startPeriod` must be 0. */
  chargingSchedulePeriod: [
    ChargingSchedulePeriod201,
    ...ChargingSchedulePeriod201[],
  ];
  startSchedule?: Date;
  duration?: number;
  minChargingRate?: number;
}

/**
 * OCPP 2.0.1 `ChargingProfileType` -- the profile itself, INLINE.
 *
 * NOT A {@link ChargingProfileRef}, and the difference is the protocol's
 * rather than this contract's. OCPP 1.6's `SetChargingProfile` is driven here
 * through an opaque CSMS-side handle because 1.6 CSMSs keep a profile registry
 * a scenario has to name a row of; 2.0.1 carries the whole profile in the
 * request, so there is nothing to look up and a ref would be a key into a
 * table no 2.0.1 driver has to have.
 *
 * `chargingSchedule` is a tuple of one to three because that is what the
 * schema says, and the bound is worth keeping: a driver that forwards the
 * array verbatim is forwarding something already known to be well-sized.
 */
export interface ChargingProfile201 {
  id: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurpose201;
  chargingProfileKind: ChargingProfileKind201;
  chargingSchedule:
    | [ChargingSchedule201]
    | [ChargingSchedule201, ChargingSchedule201]
    | [ChargingSchedule201, ChargingSchedule201, ChargingSchedule201];
  recurrencyKind?: RecurrencyKind201;
  validFrom?: Date;
  validTo?: Date;
  /** A STRING in 2.0.1, where 1.6's transactionId is a number -- 2.0.1 lets
   *  the STATION mint the identifier, so it is text on the wire. Only a
   *  `TxProfile` may carry it. */
  transactionId?: string;
}

/**
 * OCPP 2.0.1 `ChargingLimitSourceEnumType`, whole.
 *
 * WHO SET THE LIMIT, which is a thing 1.6 has no vocabulary for at all -- there
 * is no homonym here to argue about, so this type needs none of the notes the
 * four above carry. `CSO` is the charging station operator, i.e. the CSMS
 * itself; `EMS` an energy management system, `SO` the system operator, `Other`
 * anything else.
 *
 * Complete rather than minimal, by {@link MessageTrigger201}'s rule: an enum
 * value costs a driver nothing to pass through, and adding one later is the
 * breaking direction for a driver that switches on it exhaustively.
 */
export type ChargingLimitSource201 = "EMS" | "Other" | "SO" | "CSO";

/**
 * OCPP 2.0.1 `ChargingProfileCriterionType` -- which of the profiles a station
 * holds a `GetChargingProfiles` is asking about.
 *
 * EVERY MEMBER IS OPTIONAL AND THE OBJECT IS NOT. The schema requires the
 * `chargingProfile` member of the request and requires nothing inside it, so
 * `{}` is the legal way to spell "all of them" and there is no way to spell it
 * by omission. That asymmetry is the reason this is a named type rather than an
 * inline shape: a driver that "helpfully" drops an empty criterion has sent a
 * request the schema rejects.
 *
 * TUPLES RATHER THAN ARRAYS, for {@link ChargingSchedule201}'s reason: the
 * schema says 1..N, so an empty array is not a value either member can take,
 * and a driver forwarding one verbatim is forwarding something already known to
 * be well-sized. The four the wire allows in `chargingLimitSource` are not
 * expressible as a tuple bound without spelling four arms, and the enum has
 * exactly four values, so the bound is stated rather than typed.
 */
export interface ChargingProfileCriterion201 {
  chargingProfilePurpose?: ChargingProfilePurpose201;
  stackLevel?: number;
  chargingProfileId?: [number, ...number[]];
  /** At most four on the wire. */
  chargingLimitSource?: [ChargingLimitSource201, ...ChargingLimitSource201[]];
}

/**
 * OCPP 2.0.1 `ClearChargingProfileType` -- which of the profiles a station
 * holds a `ClearChargingProfile` is asking it to forget.
 *
 * A DIFFERENT TYPE FROM {@link ChargingProfileCriterion201}, and the two are
 * near enough to be worth saying why. That one selects what to REPORT and this
 * one what to REMOVE; the wire gives them different names, different members --
 * this one has `evseId` INSIDE it where the query carries it as a sibling --
 * and different cardinalities, since nothing here is a list. Folding them into
 * one shape would let a scenario ask to clear by `chargingLimitSource`, which
 * is not a thing the request can express.
 *
 * OPTIONAL AND OMISSIBLE, unlike the query's criterion: the schema requires no
 * member of the request at all, so `undefined` here is a request that clears by
 * identifier alone. That is TC_K_08's request and TC_K_05's.
 */
export interface ClearChargingProfileCriteria201 {
  /** Absent = every EVSE; 0 = the station itself. Omit, never send null. */
  evseId?: number;
  chargingProfilePurpose?: ChargingProfilePurpose201;
  stackLevel?: number;
}

/**
 * OCPP 2.0.1 `GetCertificateIdUseEnumType` -- which installed certificates a
 * `GetInstalledCertificateIds` is asking the station to list.
 *
 * FIVE VALUES AND NOT FOUR, which is the whole reason this is its own type
 * rather than a reuse of the enumeration `InstallCertificate` ranges over. A
 * certificate can be INSTALLED only as one of the four roots; it can be ASKED
 * ABOUT as one of those four or as `V2GCertificateChain`, which is not a root
 * at all but the chain a station holds under one. The wire gives the two
 * requests different enumerations for that reason, and a shared type would let
 * a scenario ask to install a chain -- a request the schema rejects.
 *
 * Complete rather than minimal, by {@link MessageTrigger201}'s rule.
 */
export type GetCertificateIdUse201 =
  | "V2GRootCertificate"
  | "MORootCertificate"
  | "CSMSRootCertificate"
  | "V2GCertificateChain"
  | "ManufacturerRootCertificate";

export type CsmsOperation201 =
  // TRIED AND REJECTED, here because here is where it gets re-proposed:
  // folding the two `Reset` arms -- this one and CsmsOperation16's -- into one
  // shared arm, or one shared core union the two protocols extend. They are
  // homonyms, not a duplication. OCPP 1.6's Reset carries `type: "Hard" |
  // "Soft"`; 2.0.1's carries `type: "Immediate" | "OnIdle"`. One member name in
  // common, no value in common, and the two protocols disagree about what the
  // word means. Factoring them together means a driver's 1.6 switch accepting
  // "OnIdle", which the 1.6 wire has no way to spell -- a value no scenario can
  // assert on, reaching a request body. The collision is the ARGUMENT AGAINST a
  // shared core, not a case for one, and it is the first thing anyone reading
  // these two unions side by side will offer to clean up. `//` rather than a
  // doc comment: an internal decision, not something a driver author is
  // shipped.
  | {
      action: "Reset";
      type: ResetType201;
      /** Which EVSE to reset. Absent means the whole charging station, which
       *  is what 2.0.1 says an omitted `evseId` means -- so an absent one is
       *  omitted rather than sent as 0. */
      evseId?: number;
    }
  // Arrays because the wire is an array -- `getVariableData` and
  // `setVariableData` are 1..N in the specification, and the assertions match
  // on the frame. A single-variable arm would read closer to TC_B_06 ("read
  // one variable") and would be a BREAKING change to widen later; an array is
  // not the premature abstraction #25 warns about, which is about how many
  // operations exist, not how many members one of them carries.
  | { action: "GetVariables"; variables: GetVariableData201[] }
  | { action: "SetVariables"; variables: SetVariableData201[] }
  // Homonyms again, and this pair is further apart than `Reset`'s: OCPP 1.6's
  // TriggerMessage scopes to a `connectorId`, 2.0.1's to an `evse` object, and
  // the enums they range over share five of six names against eleven -- only
  // DiagnosticsStatusNotification is 1.6's alone. Same
  // conclusion as the note above, reached for a second time on a second arm --
  // which is the evidence OCA-201-SELECTION.md says a shared abstraction layer
  // would need, not a reason to build one on two data points.
  | { action: "TriggerMessage"; requestedMessage: MessageTrigger201 }
  // Homonyms a third time, and the closest pair yet -- close enough that the
  // shared arm is worth refusing in writing. OCPP 1.6's ChangeAvailability
  // carries `connectorId` plus a `type` of Inoperative | Operative; 2.0.1's
  // carries `operationalStatus` over the same two values plus an OPTIONAL
  // `evse`. Same verb, same two states, and the member that decides what the
  // request is about has a different name, a different type and a different
  // meaning when absent: 1.6's connectorId 0 IS the station, 2.0.1 says the
  // station by omitting `evse` entirely. A shared arm would have to pick one
  // spelling, and either choice puts a value on one protocol's wire that
  // protocol cannot express.
  | {
      action: "ChangeAvailability";
      operationalStatus: "Inoperative" | "Operative";
      /** WHICH PART OF THE STATION, and its absence is a value rather than a
       *  default. Absent addresses the whole charging station; present with
       *  `connectorId` absent addresses that EVSE; present with `connectorId`
       *  addresses that connector. See {@link Evse201} for why this is not a
       *  flat `evseId`. A driver must omit the member rather than send `null`
       *  or an empty object. */
      evse?: Evse201;
    }
  // Homonyms a fourth and fifth time, and this pair is the one where the
  // shared arm is not even tempting: 1.6's SetChargingProfile names a profile
  // by {@link ChargingProfileRef} and scopes it with `connectorId`, 2.0.1's
  // carries the whole {@link ChargingProfile201} inline and scopes it with
  // `evseId`. Not one member survives the crossing. The two GetCompositeSchedule
  // arms are closer -- `duration` and an optional rate unit are common -- and
  // still differ in the member that says WHERE, for the same reason. See
  // {@link ChargingRateUnit201} for the one type in this pair whose values do
  // agree, and why that is not an argument either.
  | {
      action: "SetChargingProfile";
      /** Which EVSE the profile is installed at. 0 addresses the charging
       *  station itself, which is what a `ChargingStationMaxProfile` requires
       *  and what a station-wide `TxDefaultProfile` uses; a `TxProfile` needs
       *  a real EVSE. NOT optional the way `ChangeAvailability`'s `evse` is:
       *  2.0.1's SetChargingProfileRequest makes this member required, so
       *  there is no absence to give a meaning to. */
      evseId: number;
      chargingProfile: ChargingProfile201;
    }
  | {
      action: "GetCompositeSchedule";
      /** Same addressing as above, and 0 means the grid connection point --
       *  the station's own total rather than "every EVSE". */
      evseId: number;
      /** Seconds forward from now that the schedule should cover. */
      duration: number;
      /** Absent means the station picks. Present, it is what the returned
       *  schedule's limits are expressed in. */
      chargingRateUnit?: ChargingRateUnit201;
    }
  // NOT A HOMONYM AT ALL, which is the first arm here that is not, and it is
  // worth one line because the four notes above have trained a reader to look
  // for the 1.6 counterpart. There is none: OCPP 1.6 has no request that asks a
  // station which profiles it holds, so nothing about this arm is a decision
  // between two spellings. What it does inherit is the shape those notes argue
  // for -- the criterion travels as the OCPP object rather than flattened into
  // four sibling members, for `ChangeAvailability`'s reason: which members of
  // it are PRESENT is the whole of what separates one case from the next, and a
  // driver that rebuilt it from four optionals would have to decide what an
  // absent one means.
  | {
      action: "GetChargingProfiles";
      /** The station echoes it in every `ReportChargingProfiles` it answers
       *  with, so it is how a report is tied back to the request that asked
       *  for it. Required by the schema; a scenario chooses the value. */
      requestId: number;
      /** Absent = every EVSE; 0 = the station itself. Omit, never send null.
       *  NOT `SetChargingProfile`'s required member and not
       *  `GetCompositeSchedule`'s either -- this is the one charging-profile
       *  request of the three whose scope has an absence to give a meaning
       *  to. */
      evseId?: number;
      /** Wire name kept: the body IS the OCPP payload. Required by the schema
       *  even when every criterion inside it is optional. */
      chargingProfile: ChargingProfileCriterion201;
    }
  // THE TWO MEMBERS ARE ALTERNATIVES ON THIS DEPLOYMENT AND NOT ON THE WIRE,
  // which is the one thing about this arm a driver author has to know and the
  // type cannot say. The OCPP schema makes both optional and forbids no
  // combination; the pinned CSMS refuses a request carrying BOTH before it
  // reaches the wire, and refuses one carrying NEITHER -- its K10.FR.02 check,
  // and a `success:false` rather than a frame. Both remain optional here
  // because the contract describes OCPP and not one CSMS, and because a driver
  // whose CSMS accepts the pair must be able to spell it. What the scenarios do
  // about it is a scenario's business; what a driver does is pass both through.
  | {
      action: "ClearChargingProfile";
      /** The identifier the profile was installed under. One profile, not a
       *  list -- `GetChargingProfiles`' criterion takes a list and this does
       *  not, which is the wire's asymmetry and not ours. */
      chargingProfileId?: number;
      /** Absent means the request clears by identifier alone. */
      chargingProfileCriteria?: ClearChargingProfileCriteria201;
    }
  // THE FIRST ARM WHOSE ONLY MEMBER IS OPTIONAL, and its absence is the whole
  // of one case. 2.0.1 reads an omitted `certificateType` as "every type", so
  // an absent one must be OMITTED rather than sent as an empty array -- the
  // schema's `minItems` is 1, and `[]` is a request no station will accept.
  //
  // A TUPLE RATHER THAN AN ARRAY, for {@link ChargingSchedule201}'s reason:
  // 1..N on the wire, so an empty array is not a value this member can take and
  // a driver forwarding it verbatim is forwarding something already known to be
  // well-sized. The bound the enumeration puts on the other end -- at most five,
  // since a repeated type asks the same question twice -- is stated rather than
  // typed.
  | {
      action: "GetInstalledCertificateIds";
      /** Which kinds of certificate to list. Absent = every kind. Omit, never
       *  send an empty array: the schema's `minItems` is 1, so `[]` asks for
       *  nothing while looking like it asks for everything. */
      certificateType?: [GetCertificateIdUse201, ...GetCertificateIdUse201[]];
    };

export type CsmsOperation201Action = CsmsOperation201["action"];

/** Every 2.0.1 action name. Same job as {@link CSMS_OPERATION_16_ACTIONS},
 *  and a SECOND list rather than an extension of it -- see the note on
 *  {@link CsmsOperation201}'s `Reset` arm for why the two must not merge. */
export const CSMS_OPERATION_201_ACTIONS = everyOneOf<CsmsOperation201Action>()([
  "Reset",
  "GetVariables",
  "SetVariables",
  "TriggerMessage",
  "ChangeAvailability",
  "SetChargingProfile",
  "GetCompositeSchedule",
  "GetChargingProfiles",
  "ClearChargingProfile",
  "GetInstalledCertificateIds",
]);

/**
 * One well-formed operation per action, and its job is to make the union above
 * expensive to grow in exactly one place.
 *
 * {@link CSMS_OPERATION_201_ACTIONS} is already bidirectional -- `everyOneOf`
 * makes the list and the union agree about NAMES. Agreeing about names says
 * nothing about whether anything can build one, and a name is all a driver
 * needs to declare an operation it cannot express. This is the other half: the
 * annotation is a mapped type over the action union whose value for each
 * action is THAT action's arm, so an arm added to {@link CsmsOperation201} is
 * a type error here until somebody writes a request of its shape. A compiler
 * check rather than a guard, for the reason the note above `everyOneOf` gives
 * -- the compiler already decides the other half, and a shell guard would be
 * re-deciding from outside what tsc knows from inside.
 *
 * `Extract` rather than a plain `Record<CsmsOperation201Action,
 * CsmsOperation201>`, which is the shape a reader reaches for first: that one
 * types every value as the WHOLE union, so `Reset: { action: "TriggerMessage",
 * … }` satisfies it. A table whose key and value may disagree is a table that
 * eventually does.
 *
 * WHAT IT IS FOR, and it is not scenario data. Every value is the cheapest
 * thing its arm admits, and the optional members are omitted rather than
 * filled: the consumer is a driver's mapper, which
 * `tests/capability-parity.ts` pushes each one through to ask whether the
 * driver that DECLARED an action can actually express it. A scenario
 * asserting on one of these would be asserting on a placeholder anyone is free
 * to change. The device-model address is a real 2.0.1 one so that a mapper
 * which looks a variable up does not fail for a reason this table invented.
 *
 * Exported because a third-party driver owes the same parity check, and a
 * second table written over there is a second table free to disagree with this
 * one.
 */
export const SAMPLE_OPERATION_201: {
  readonly [A in CsmsOperation201Action]: Extract<
    CsmsOperation201,
    { action: A }
  >;
} = {
  Reset: { action: "Reset", type: "Immediate" },
  GetVariables: {
    action: "GetVariables",
    variables: [
      {
        component: { name: "OCPPCommCtrlr" },
        variable: { name: "HeartbeatInterval" },
      },
    ],
  },
  SetVariables: {
    action: "SetVariables",
    variables: [
      {
        component: { name: "OCPPCommCtrlr" },
        variable: { name: "HeartbeatInterval" },
        attributeValue: "60",
      },
    ],
  },
  TriggerMessage: { action: "TriggerMessage", requestedMessage: "Heartbeat" },
  // `evse` OMITTED, by the rule stated above: every value here is the cheapest
  // thing its arm admits, and `operationalStatus` is this request's only
  // required member. The omission also happens to be the sample a mapper is
  // most likely to get wrong -- a driver that sends `evse: {}` or `evse: null`
  // for an absent one has changed what the request means -- but that is not
  // what this table measures, and a scenario is where it is measured.
  ChangeAvailability: {
    action: "ChangeAvailability",
    operationalStatus: "Inoperative",
  },
  // THE CHEAPEST PROFILE THE SCHEMA ADMITS, by this table's rule: one
  // schedule, one period, every optional member omitted. `evseId: 0` is the
  // station itself, which is the only scope a profile carrying no
  // `transactionId` is unconditionally allowed at. A mapper that reshapes the
  // nested schedule -- the thing this sample exists to push through -- fails
  // here before a container starts.
  SetChargingProfile: {
    action: "SetChargingProfile",
    evseId: 0,
    chargingProfile: {
      id: 1,
      stackLevel: 0,
      chargingProfilePurpose: "TxDefaultProfile",
      chargingProfileKind: "Absolute",
      chargingSchedule: [
        {
          id: 1,
          chargingRateUnit: "W",
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 0 }],
        },
      ],
    },
  },
  GetCompositeSchedule: {
    action: "GetCompositeSchedule",
    evseId: 0,
    duration: 1,
  },
  // `evseId` OMITTED and the criterion EMPTY, by this table's rule: the
  // cheapest thing the arm admits. The empty object is not a shortcut for an
  // absent one -- the schema requires the member and requires nothing inside it
  // -- so this is also the sample that pushes a mapper's one plausible mistake
  // through, dropping a criterion because it has no members to send.
  GetChargingProfiles: {
    action: "GetChargingProfiles",
    requestId: 1,
    chargingProfile: {},
  },
  // BY IDENTIFIER AND NOTHING ELSE, which is the cheapest thing the arm admits
  // and also the only one of its three spellings that the pinned CSMS accepts
  // unconditionally. A sample carrying both members would be refused before
  // dispatch by the deployment this table's per-action half runs a mapper for,
  // and a sample carrying neither would be refused too -- so the rule "the
  // cheapest value the arm admits" and "a value that could actually be sent"
  // agree here, which they are not obliged to.
  ClearChargingProfile: {
    action: "ClearChargingProfile",
    chargingProfileId: 1,
  },
  // NO MEMBERS AT ALL, which is both the cheapest thing this arm admits and a
  // real request: an omitted `certificateType` asks about every installed
  // certificate. It is also the sample that pushes this arm's one plausible
  // mapper mistake through -- sending `certificateType: []` for an absent one,
  // which the schema refuses.
  GetInstalledCertificateIds: { action: "GetInstalledCertificateIds" },
};

// ---------------------------------------------------------------------------
// Escapes
// ---------------------------------------------------------------------------

/**
 * "This CSMS's API cannot express this operation or observation AT ALL."
 *
 * Not a transport failure, not a rejection, not a timeout: a permanent
 * statement about an API surface. The runner catches it around `drive()` and
 * records NOT APPLICABLE, printing a warning that the scope table is out of
 * date -- because a driver forced to throw this at runtime is telling you its
 * own scope table missed a scenario, and the scope table is what keeps a
 * campaign from starting containers it cannot use.
 *
 * Lives in the core, not in a driver: it is part of the contract, and the
 * runner plus every driver need the SAME class -- the runner recognises it
 * with `instanceof`, so a second copy would silently degrade NOT APPLICABLE
 * into ERROR.
 */
export class UnsupportedOperationError extends Error {
  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`${operation} is not supported by this CSMS: ${reason}`);
    this.name = "UnsupportedOperationError";
  }
}

/**
 * "The request never reached the CSMS."
 *
 * The transport refused it -- a rejected form post, an unauthenticated
 * request, a connection that never opened -- so the CSMS was never asked and
 * nothing went on the wire. Distinct from every other failure a driver can
 * report, and the distinction is the point: a CSMS answering wrongly is a
 * finding about the CSMS, while an operation that was never dispatched is a
 * finding about the client, and any assertion downstream of it is measuring
 * the wrong thing.
 *
 * AN OBSERVATION COUNTS TOO. `warnOpFailed` guards two records waits alongside
 * the operations, and a read whose transport refused it leaves the scenario
 * asserting on a record nobody could look up: the same wrong measurement,
 * reached from the other side.
 *
 * WHAT IT IS NOT is a request the CSMS answered and refused. A driver that
 * cannot tell the two apart must throw a plain `Error` -- claiming a
 * non-dispatch it did not observe converts an honest finding about the CSMS
 * into a false one about the client, which is this class's own failure mode
 * run backwards.
 *
 * WHAT IT CLAIMS, EXACTLY: the driver has no evidence the request became an
 * OCPP CALL. That is weaker than "nothing was sent", and deliberately so,
 * because a TIMEOUT belongs here and is not literally a connection that never
 * opened -- bytes went out and no answer came back, so whether the charge
 * point was asked is precisely what nobody knows. Reporting that as an
 * ordinary failure would warn and carry on into assertions about a station
 * that may never have been asked, which is issue #77 again; reporting it here
 * gets the verdict the uncertainty deserves. What a driver may NOT do is come
 * here from an answer it received and understood.
 *
 * A scenario that swallows this and carries on reports a handful of confident
 * FAILs about a charge point that was never asked to do anything -- which is
 * exactly what issue #77 cost to diagnose, and why `warnOpFailed` in
 * `tck/op-warn.ts` lets this one class through instead of warning and
 * continuing.
 *
 * Lives in the core for the same reason {@link UnsupportedOperationError}
 * does: the recogniser and the thrower sit on opposite sides of the driver
 * boundary and must share one class, or `instanceof` quietly stops matching.
 */
export class CsmsNotDispatchedError extends Error {
  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`${operation} never reached the CSMS: ${reason}`);
    this.name = "CsmsNotDispatchedError";
  }
}

/**
 * The subset of `fetch` a driver's HTTP client needs.
 *
 * A seam, not a policy. A client that routes every request through this can be
 * handed a fake CSMS by an offline guard, which is the only way to reach the
 * branches that matter: what a client does when the transport refuses it is a
 * 45%-of-the-time event on a real server at best, and on most branches -- a
 * 503, an unparseable body -- something no CSMS here can be asked to produce.
 * Each bundled driver's client guard is built on it; the guards name themselves
 * in the clients, which is where a reader of one of them is standing.
 *
 * Lives in the core because more than one driver needs it and
 * `tests/generic-core.sh` forbids one driver from naming another. It is a
 * shape, not behaviour: the core neither calls it nor recognises it, unlike
 * {@link CsmsNotDispatchedError}.
 *
 * TRIED AND REJECTED, here because here is where it gets re-proposed: a core
 * module of its own, so the seam is not inside the one file
 * `tests/documented-install-ref.sh` compares byte for byte against the
 * installed tag. It is a real cost -- changing this type after a tag exists
 * obliges a version bump and a repoint of both install pages. It was chosen
 * anyway: the type ships in `types/` either way, so a change to it IS a public
 * API change that owes a release, and a separate module would owe a new
 * `exports` subpath to be importable at all. The third option, a copy per
 * driver, is the worst of the three -- two `FetchLike`s that drift are two
 * types a shared guard cannot substitute for each other.
 *
 * The default is always the global, resolved PER CALL rather than captured at
 * construction -- the same principle the `defaultXConfig` resolvers follow.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Compile-time exhaustiveness guard for a driver's `switch (op.action)`.
 *
 * Adding an operation to {@link CsmsOperation16} becomes a type error in every
 * driver that has not handled it -- which is the entire reason the vocabulary
 * is a discriminated union rather than a string map.
 */
export function assertNever(value: never, context: string): never {
  throw new UnsupportedOperationError(
    context,
    `unhandled operation ${JSON.stringify(value)} -- this driver has not been ` +
      "updated for an operation the core now defines",
  );
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface CsmsOperations16 {
  /**
   * Drives one CSMS operation against one charge point.
   *
   * Resolves once the CSMS has accepted or dispatched it. This does NOT imply
   * the charge point has responded, or ever will. The returned string is a
   * driver-defined receipt for the run log ONLY -- a redirect Location, a
   * serialized REST body, a task id. Specs MUST NOT branch on it; they assert
   * on the simulator's captured wire log.
   *
   * Throws {@link UnsupportedOperationError} when this CSMS cannot express the
   * operation at all, and {@link CsmsNotDispatchedError} when the transport
   * refused the request so that it never became an OCPP CALL -- a refused form
   * post, a connection that never opened. Prefer the second over a plain
   * `Error` wherever a driver can tell: a scenario warns and continues on
   * anything else, and continuing past an operation the charge point was never
   * asked to perform is how one lost dispatch becomes several confident
   * findings about an idle station.
   */
  execute(cpId: string, op: CsmsOperation16): Promise<string>;
}

/**
 * The same contract for {@link CsmsOperation201}, and OPTIONAL: a driver whose
 * CSMS speaks only OCPP 1.6 omits it from its {@link CsmsDriverParts} and the
 * runner substitutes a stub whose `execute` throws
 * {@link UnsupportedOperationError} -- the same substitution
 * {@link CsmsReservationRecords} gets, for the same reason. A spec therefore
 * calls `ctx.csms201` unconditionally and never branches on which driver is
 * loaded; absence becomes a NOT APPLICABLE verdict through the normal escape.
 */
// TWO FOLDS GET RE-PROPOSED HERE, and this is where a reader meets them.
//
// A second overload of `execute` on CsmsOperations16, rather than a second
// interface: the objection is the substitution above, not the call sites. A
// driver may implement one protocol and not the other, so the two halves have
// to be independently OMISSIBLE -- overloads on one method are not, and the
// runner would have nothing to replace.
//
// `CsmsOperations16<Op = CsmsOperation16>`, parameterised on the operation
// type, which two one-method interfaces differing only in that type invite.
// That is issue #25's second rejected shape, declined there rather than here;
// the header above the 2.0.1 vocabulary says why, and the short version is
// that it asks us to decide what the two protocols share before a second 2.0.1
// driver exists to disagree.
export interface CsmsOperations201 {
  execute(cpId: string, op: CsmsOperation201): Promise<string>;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/**
 * The CSMS-side state a spec may inspect. READ-ONLY: every method answers
 * "what does the CSMS believe happened", never "make the CSMS do something".
 * The one write that used to live on this interface, `closeStaleTx`, was a
 * per-run lifecycle concern with no spec call site at all; it is now
 * {@link CsmsDriverParts.prepareStation}.
 *
 * EVERY METHOD RETURNS A STRING, THE COUNT INCLUDED. That is deliberate and
 * load-bearing: a driver that cannot answer returns `unverifiable("<why>")`
 * (see unverifiable.ts), a sentinel-carrying string that assertEq and
 * assertNonEmpty recognise and degrade to a SKIPPED check -- yielding PARTIAL
 * instead of a false FAIL. A numeric return type would leave no room for it.
 *
 * A driver must NEVER invent a plausible value, and must never return `""` for
 * "I cannot know": `""` is assertNonEmpty's legitimate "not set", so doing so
 * converts a SKIPPED into a FAIL. The two escapes are the sentinel, for values
 * consumed directly by an assertion, and {@link UnsupportedOperationError} for
 * values consumed any other way -- assigned, compared, interpolated, or fed
 * back into an operation field.
 */
export interface CsmsRecords {
  /** Most recent transaction, open or closed, for a charge point. `""` = none. */
  latestTransaction(cpId: string): Promise<TransactionRef>;

  /**
   * Polls, bounded, for an OPEN transaction on `cpId` started with `idTag`.
   * REJECTS on timeout -- fail-hard, matching the bash harness this was ported
   * from, which killed the whole run rather than returning a value a caller
   * might handle gracefully and then assert against.
   */
  waitForActiveTransaction(
    cpId: string,
    idTag: string,
    timeoutSecs?: number,
  ): Promise<TransactionRef>;

  /** The idTag a transaction was started with. `""` if it does not exist. */
  transactionIdTag(tx: TransactionRef): Promise<string>;

  /** `""` while still open or nonexistent, a timestamp string once closed. */
  transactionStopTimestamp(tx: TransactionRef): Promise<string>;

  /** OCPP stop reason, e.g. "EVDisconnected", "SoftReset". `""` if unset. */
  transactionStopReason(tx: TransactionRef): Promise<string>;

  /** Transactions for a charge point + idTag, as a decimal STRING -- see this
   *  interface's header for why it is not a number. */
  transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;

  /** Reservation registry. See {@link CsmsReservationRecords}. */
  reservations: CsmsReservationRecords;

  /** Charging-profile registry. See {@link CsmsChargingProfileRecords}. */
  chargingProfiles: CsmsChargingProfileRecords;

  /** What the CSMS stored about a connector. See {@link CsmsDeviceModelRecords}. */
  deviceModel: CsmsDeviceModelRecords;
}

/**
 * OPTIONAL CAPABILITY. A CSMS with no reservation resource at all -- no
 * ReserveNow, no reservation entity -- omits this from its
 * {@link CsmsDriverParts}, and the runner substitutes a stub whose every
 * method throws {@link UnsupportedOperationError}. Specs therefore call it
 * unconditionally and never branch on which driver is loaded.
 */
export interface CsmsReservationRecords {
  /** Most recent reservation for a charge point. `""` = none. */
  latest(cpId: string): Promise<ReservationRef>;
  /** Reservation state, uppercase, e.g. "CANCELLED". */
  status(reservation: ReservationRef): Promise<string>;
}

/**
 * OPTIONAL CAPABILITY, same substitution rule as
 * {@link CsmsReservationRecords}.
 *
 * `refByDescription` exists because the SmartCharging scenarios need a
 * PRE-PROVISIONED profile they can name, and OCPP offers no way to look one
 * up. It is the most CSMS-shaped method in this file, which is exactly why it
 * sits behind an optional capability instead of in the core interface: all of
 * its call sites feed the result back into an operation field rather than into
 * an assertion, so the unverifiable sentinel is NOT a safe degradation for it.
 * Absence has to be structural, or a sentinel string ends up inside a request
 * body and the CSMS is asked to act on the word "unverifiable".
 */
export interface CsmsChargingProfileRecords {
  /** Handle of a pre-provisioned charging profile named by its human-readable
   *  description. `""` if no such profile exists. */
  refByDescription(description: string): Promise<ChargingProfileRef>;
}

/**
 * OPTIONAL CAPABILITY, same substitution rule as the two above: what the CSMS
 * RECORDED when a `StatusNotification` arrived.
 *
 * THE ONLY PART OF THIS INTERFACE THAT IS NOT VISIBLE FROM THE WIRE, and that
 * is why it exists. A CSMS answers a 2.0.1 `StatusNotification` with an empty
 * `StatusNotificationResponse` whatever it did with the payload -- there is no
 * status member to be wrong -- so a charge point cannot tell "stored" from
 * "dropped on the floor", and neither can a suite whose every other verdict
 * comes off the frames. Issue #86 is the worked example: a CSMS that logged
 * four warnings and answered four times.
 *
 * TWO METHODS, BECAUSE A CSMS CAN FAIL AT EITHER OF TWO PLACES and answering
 * with one string would hide which. {@link connectorStatus} is the connector
 * ENTITY -- what an operator's list of connectors shows -- and
 * {@link availabilityState} is the DEVICE MODEL, the (component, variable)
 * store `GetVariables` reads and `NotifyReport` fills. The same status reaches
 * both by different code paths, and a CSMS that updates one and not the other
 * is a real shape rather than a hypothetical one.
 *
 * ADDRESSED THE WAY OCPP 2.0.1 ADDRESSES A CONNECTOR, `(evseId, connectorId)`,
 * because that is what the request carries. `evseId` 0 is the station itself
 * and is a legitimate argument: a station reports its own availability that
 * way, and a CSMS that has nowhere to put it is exactly the finding here.
 *
 * ABSENCE DEGRADES TO SKIPPED HERE, WHERE THE OTHER TWO THROW, and the
 * difference is unverifiable.ts's rule rather than an inconsistency. A status
 * is only observable AFTER the run, so every call site is in `assert()` and
 * every result flows straight into an assertion -- which is the case that rule
 * reserves for the sentinel. The runner's NOT APPLICABLE escape wraps `drive()`
 * alone, so a throw from here would surface as an ERROR after a container had
 * run; `unsupportedDeviceModel` answers `unverifiable` instead, and the
 * scenario reports PARTIAL with the driver's reason while the checks that do
 * not need this capability keep their verdicts.
 */
export interface CsmsDeviceModelRecords {
  /** Connector state the CSMS recorded for `(evseId, connectorId)`, in the
   *  CSMS's own vocabulary. `""` = the CSMS has no such connector. */
  connectorStatus(
    cpId: string,
    evseId: number,
    connectorId: number,
  ): Promise<string>;

  /** The same connector's availability as the CSMS stored it in its DEVICE
   *  MODEL. `""` = nothing was stored. */
  availabilityState(
    cpId: string,
    evseId: number,
    connectorId: number,
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Driver packaging
// ---------------------------------------------------------------------------

/**
 * Coarse capability declaration, for the run report and a driver's own
 * load-time self-check.
 *
 * Deliberately NOT used to skip scenarios before they run: the core cannot
 * know which operations a scenario will attempt without running it. That is
 * what the per-driver scope table is for.
 */
export interface CsmsCapabilities {
  /** Operations this driver can express. Anything outside it MUST throw
   *  {@link UnsupportedOperationError} from `operations16.execute()`; the
   *  driver's own switch is where that is enforced, this set is what gets
   *  printed. */
  readonly operations16: ReadonlySet<CsmsOperation16Action>;
  /**
   * The same, for {@link CsmsOperation201}. ABSENT means "this driver does not
   * speak OCPP 2.0.1 at all" -- not "it speaks it and declares nothing" -- and
   * `check-driver` says nothing about a driver that omits it.
   *
   * It lives on the CAPABILITIES rather than only on {@link CsmsDriverParts}
   * for the reason {@link CsmsDriverModule.capabilities} gives: parts are
   * reachable only through `create(env)`, which is entitled to demand
   * credentials, and "does this driver speak 2.0.1" has to be answerable
   * offline, without a container.
   */
  // A SECOND SET rather than widening the one above -- the note on
  // CsmsOperation201's `Reset` arm has the argument. One consequence is this
  // declaration's alone, though: merged, every 1.6-only driver would draw an
  // "operation not declared" warning for operations it never claimed,
  // and that zero cost is the whole point of the opt-in shape.
  readonly operations201?: ReadonlySet<CsmsOperation201Action>;
  readonly reservations: boolean;
  readonly chargingProfiles: boolean;
  /**
   * Whether this driver can read back what the CSMS stored about a connector.
   * See {@link CsmsDeviceModelRecords} for why that is not the same question as
   * "does the CSMS speak 2.0.1".
   *
   * REQUIRED, not `deviceModel?`, and the asymmetry with `operations201?` above
   * is deliberate rather than an oversight. That one is opt-in because its
   * absence has a second meaning -- a 1.6-only driver would otherwise draw
   * "operation not declared" warnings for operations it never claimed.
   * This is a plain boolean beside `reservations` and `chargingProfiles`, its
   * two siblings, and a driver that forgets it gets a compiler error naming the
   * field instead of a printed capability list that quietly says `false`.
   */
  readonly deviceModel: boolean;
}

/**
 * Transport defaults a driver contributes for the simulator container. An
 * explicit `SIM_*` value in the environment always wins: an operator's override
 * is the last word, a driver only states what it knows about its own CSMS.
 *
 * EVERY FIELD HERE IS ONE THE RUNNER MERGES. `extraArgs` used to sit in this
 * list and nothing read it, so a driver stating it was ignored in silence; it
 * was removed rather than wired up, because simulator flags are not a fact
 * about a CSMS. A field added here without a matching arm in the runner's
 * merge is that bug again.
 *
 * THE OCPP VERSION DOES NOT BELONG HERE, and this was measured rather than
 * argued: one CitrineOS serves 1.6 and 2.0.1 concurrently on a single websocket
 * endpoint, one server profile advertising `ocpp2.1`, `ocpp2.0.1` and `ocpp1.6`,
 * with two stations connected at once and each call routed on its negotiated
 * subprotocol
 * ({@link https://github.com/juherr/open-ocpp-tck/issues/57#issuecomment-5315202272 the evidence}).
 * So a driver's transport has nothing to say about the version: it is a
 * property of the scenario, and it lives on `SimConfig`. Re-proposing it here
 * needs a CSMS that serves versions on separate endpoints, which is not a thing
 * this repository has.
 */
export interface SimTransportDefaults {
  wsUrl?: string;
  appendCpIdToWsPath?: boolean;
  basicAuthUser?: string;
  basicAuthPass?: string;
  network?: string;
}

/**
 * An extra CLI verb a driver contributes, reachable as
 * `ocpp-tck driver <name> [args...]`. This is how environment bootstrap --
 * provisioning, probing, teardown -- stays a driver concern while the runner
 * stays driver-agnostic.
 *
 * Returns a process exit code rather than void, because "neither success nor
 * breakage" is a real outcome: a provisioner that finds the API refusing
 * writes wants to report VERIFY-ONLY, and collapsing that to a boolean would
 * lose it.
 */
export type CsmsDriverCommand = (argv: string[]) => Promise<number>;

/**
 * The environment a driver reads, structurally.
 *
 * Deliberately NOT `NodeJS.ProcessEnv`: that type is ambient, so naming it here
 * would make this package's published declarations require `@types/node` (or
 * `@types/bun`) in every consumer that only wants to write a driver.
 * `process.env` is assignable to this, so no call site changes.
 */
export type CsmsEnv = Readonly<Record<string, string | undefined>>;

/**
 * A module-level declaration a driver may make a function of the environment.
 *
 * Exists because a CSMS with more than one supported release line has a scope
 * table that depends on WHICH SERVER YOU POINT AT, and the alternative was a
 * module-scope global read at import time -- resolved from `process.env`, while
 * `create(env)` resolved the same setting from the env it was handed. The two
 * agreed only because the runner passes `process.env`; a caller with a
 * synthetic env got a table describing one server while every request targeted
 * the other.
 *
 * It does NOT weaken the credential-free promise below. These fields live on
 * the module to avoid calling `create()`, not to avoid reading the
 * environment: the function is handed the same `CsmsEnv` that reaches
 * `create()` later, and must answer offline, without credentials and without
 * contacting the CSMS. Reading a declaration -- which release line, which
 * profile -- is exactly what it is for.
 *
 * `T` must not itself be callable: resolution discriminates on `typeof`, so a
 * function-valued declaration would be indistinguishable from its own
 * resolver. Every field using it is an object, which is also what lets the
 * resolvers below narrow the union with no cast.
 *
 * THAT LAST PROPERTY IS WHY THE RESOLVERS ARE NOT ONE GENERIC HELPER, which
 * is otherwise the obvious de-duplication and has been proposed once. Factored
 * out over an unconstrained `T`, the union becomes
 * `((env) => T) | (T & Function)` and `typeof value === "function"` no longer
 * narrows it -- tsc says "not all constituents are callable" and the helper
 * needs a cast. Three short bodies that the compiler checks beat one shared
 * body that it cannot, for a rule whose entire failure mode is a declaration
 * being read as its own resolver.
 */
export type EnvDependent<T> = T | ((env: CsmsEnv) => T);

/**
 * What a driver hands the runner. Everything optional is a CAPABILITY that the
 * runner substitutes or skips when absent, so a minimal driver is
 * `{ operations16, records }` and nothing else.
 */
export interface CsmsDriverParts {
  operations16: CsmsOperations16;
  /** OPTIONAL CAPABILITY. Omitted by a driver whose CSMS speaks only OCPP
   *  1.6; the runner substitutes a throwing stub. See
   *  {@link CsmsOperations201}. */
  operations201?: CsmsOperations201;
  records: Omit<
    CsmsRecords,
    "reservations" | "chargingProfiles" | "deviceModel"
  > & {
    reservations?: CsmsReservationRecords;
    chargingProfiles?: CsmsChargingProfileRecords;
    deviceModel?: CsmsDeviceModelRecords;
  };
  /**
   * Runs before the simulator container starts -- where a CSMS closes a stale
   * transaction left by a previous scenario. It is a WRITE, which is why it is
   * here and not on {@link CsmsRecords}.
   *
   * TRIED AND REVERTED, here because here is where it gets re-proposed: a
   * second `topology: { connectors }` argument, so a driver seeding
   * per-connector fixtures could match the station instead of assuming one
   * connector. It was built and then measured, and the configuration it was for
   * cannot work anyway -- see the note on `statusTargets` in
   * drivers/citrineos/device-model.ts. Adding contract surface for a shape no
   * CSMS here can represent is worse than the assumption it replaced.
   */
  prepareStation?(cpId: string): Promise<void>;
  simTransport?(cpId: string): Promise<SimTransportDefaults>;
  /** Connection pools, caches. NOT called by the runner today -- the lane
   *  lifecycle it was written for does not exist; see #28. */
  close?(): Promise<void>;
}

export interface CsmsDriverModule {
  /** Stable id, for logs and results/summary.md. */
  readonly id: string;
  readonly displayName: string;

  /**
   * Per-scenario static declaration, consulted BEFORE any container starts.
   * Absent = "run everything and find out", with the
   * {@link UnsupportedOperationError} net as the backstop.
   *
   * ON THE MODULE, NOT ON {@link CsmsDriverParts}, and that placement is the
   * whole point: the runner promises that a scenario this CSMS cannot drive is
   * reported NOT APPLICABLE *without the driver ever needing valid
   * credentials*. Reaching the table through `create(env)` broke that promise,
   * because a driver is entitled to build its HTTP client there and throw when
   * its token is unset -- so `ocpp-tck run` demanded credentials to tell you it
   * was not going to use them. Reading it off the module keeps the preflight,
   * and `ocpp-tck check-driver`, genuinely offline.
   *
   * May be a function of the environment -- see {@link EnvDependent}. Resolve
   * it with {@link driverScope} rather than by hand.
   */
  // A protocol-level opt-out beside this -- `protocols: ["1.6"]`, so a table
  // need not carry a row per cert201- scenario -- was declined. The argument
  // is in scope.ts, above `scopeCoverage`, which is the other place it gets
  // re-proposed.
  readonly scope?: EnvDependent<ScopeTable>;

  /** Same reasoning as {@link CsmsDriverModule.scope}: read without
   *  credentials, printed by `ocpp-tck check-driver`, and equally free to be a
   *  function of the environment. Resolve it with {@link driverCapabilities}. */
  readonly capabilities?: EnvDependent<CsmsCapabilities>;

  /**
   * Scenarios this CSMS is KNOWN to fail -- drivable, run, red, and understood.
   *
   * The complement of {@link CsmsDriverModule.scope}, not a part of it: a
   * listed scenario keeps its DRIVABLE row, still starts a container and still
   * prints FAIL. What the list changes is only the sweep's exit code, so that
   * a job muted for one finding can still report every other scenario. An
   * entry that PASSES fails the sweep in the other direction -- see
   * {@link ./expected}.
   *
   * Absent = "every failure is a failure", which is what a driver with nothing
   * to declare should keep saying. Free to be a function of the environment
   * for the same reason `scope` is: a CSMS with two release lines does not
   * have the same defects on both. Resolve it with
   * {@link driverExpectedFailures}.
   */
  readonly expectedFailures?: EnvDependent<ExpectedFailureTable>;

  /** Called once per process, and the result is shared by every parallel lane,
   *  so what it returns must be safe to use concurrently and must hold no
   *  per-lane state. The contract used to promise one instance per lane, which
   *  no runner has ever implemented -- see #28. Free to read the environment,
   *  and free to throw a clear configuration error. */
  create(env: CsmsEnv): Promise<CsmsDriverParts> | CsmsDriverParts;
  /** Environment-bootstrap verbs, reachable as `ocpp-tck driver <name>`.
   *  Never invoked during a scenario run. */
  readonly commands?: Readonly<Record<string, CsmsDriverCommand>>;
  /** Printed by `ocpp-tck --help` under "driver environment". */
  readonly envHelp?: string;
}

/**
 * The driver's scope table for one environment, or `undefined` when it
 * declares none ("run everything and find out").
 *
 * Public, and not merely an internal detail of the runner, because
 * `CSMS_DRIVER` is a module specifier: drivers are expected to live in other
 * repositories, and so is whatever tooling reads their tables. Anything
 * touching `module.scope` directly has to narrow an {@link EnvDependent}
 * union, and a resolver that is written twice is written differently twice.
 *
 * Callers MUST pass the same env they later hand to `create()`. The runner
 * holds exactly one, for that reason.
 */
export function driverScope(
  module: CsmsDriverModule,
  env: CsmsEnv,
): ScopeTable | undefined {
  const scope = module.scope;
  return typeof scope === "function" ? scope(env) : scope;
}

/** {@link driverScope} for the capability declaration. */
export function driverCapabilities(
  module: CsmsDriverModule,
  env: CsmsEnv,
): CsmsCapabilities | undefined {
  const capabilities = module.capabilities;
  return typeof capabilities === "function"
    ? capabilities(env)
    : capabilities;
}

/**
 * {@link driverScope} for the expected-failure list, and it must be resolved
 * with the SAME env: a list naming defects of one release line, applied to a
 * sweep pointed at the other, excuses the wrong scenarios in both directions.
 */
export function driverExpectedFailures(
  module: CsmsDriverModule,
  env: CsmsEnv,
): ExpectedFailureTable | undefined {
  const expected = module.expectedFailures;
  return typeof expected === "function" ? expected(env) : expected;
}
