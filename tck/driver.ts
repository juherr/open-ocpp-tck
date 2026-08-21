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
// The OCPP 2.0.1 operation vocabulary -- 3 members, OPT-IN.
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
// WHY THREE AND NOT SIX. OCA-201-SELECTION.md's first slice was seven
// certification cases, and CASES ARE NOT OPERATION KINDS -- the distinction is
// the whole of this note. FIVE of the seven are CSMS-INITIATED: TC_B_20,
// TC_B_21 and TC_B_22 all drive Reset, and TC_B_06 and TC_B_09 drive
// GetVariables and SetVariables. Between them those five spell THREE kinds of
// operation, which is what this union counts. TC_B_01 and TC_F_20 are
// BootNotification and Heartbeat, observed on the wire rather than driven, so
// they need no operation at all. "As few as the first slice needs" is that
// file's number, not this file's judgement.
//
// AND WHY THREE IS NOT THE FINAL ANSWER. That page's rule now selects 205
// cases rather than seven, so this union grows. What does NOT change is how:
// the count comes from the cases selected, derived once the identifiers behind
// the 205 exist, and a case that only observes charge-point-initiated traffic
// still needs no arm here. Adding the rest of the 2.0.1 messages because they
// exist is the mistake "three, not eighteen" was written against, and it reads
// the same whichever direction the number moves in.
// ---------------------------------------------------------------------------

/** OCPP 2.0.1 `ResetEnumType`. Not OCPP 1.6's Hard/Soft -- see the note on
 *  the `Reset` arm below. */
export type ResetType201 = "Immediate" | "OnIdle";

// NOT BUILT, here because here is where they get added -- every OPTIONAL
// member of the three requests below EXCEPT the one the first slice reached:
// `ComponentType`'s `instance` and `evse`, `VariableType`'s `instance`,
// `GetVariableDataType`'s and `SetVariableDataType`'s `attributeType`, and the
// `EVSEType` and `AttributeEnumType` the last two of those need.
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
  // operations exist, and there are still three.
  | { action: "GetVariables"; variables: GetVariableData201[] }
  | { action: "SetVariables"; variables: SetVariableData201[] };

export type CsmsOperation201Action = CsmsOperation201["action"];

/** Every 2.0.1 action name. Same job as {@link CSMS_OPERATION_16_ACTIONS},
 *  and a SECOND list rather than an extension of it -- see the note on
 *  {@link CsmsOperation201}'s `Reset` arm for why the two must not merge. */
export const CSMS_OPERATION_201_ACTIONS = everyOneOf<CsmsOperation201Action>()([
  "Reset",
  "GetVariables",
  "SetVariables",
]);

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
  // "operation not declared" warning for three operations it never claimed,
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
   * "operation not declared" warnings for three operations it never claimed.
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
  /** Runs before the simulator container starts -- where a CSMS closes a stale
   *  transaction left by a previous scenario. It is a WRITE, which is why it
   *  is here and not on {@link CsmsRecords}. */
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
