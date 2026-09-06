// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * requests.ts -- one CsmsOperation, one CitrineOS message-API call. Both
 * vocabularies: {@link toCitrineRequest} for OCPP 1.6, and
 * {@link toCitrineRequest201} for the 2.0.1 half.
 *
 * CitrineOS's outbound surface is generated from the OCPP schemas themselves:
 * `AbstractModuleApi._toMessagePath` builds
 * `/ocpp/<version>/<modulePrefix>/<actionCamelLower>` and validates the body
 * against `<Action>RequestSchema` for that version before dispatching. So the
 * mapping below is almost the identity -- the request bodies ARE the OCPP
 * payloads, which is exactly the shape the neutral vocabulary was derived from.
 *
 * Almost. Three places need real work, and each is a fact about CitrineOS:
 *
 *  - THE MODULE PREFIX IS NOT DERIVABLE FROM THE ACTION. RemoteStart/Stop and
 *    UnlockConnector live under `evdriver` rather than `transactions`;
 *    GetDiagnostics lives under `reporting`. There is no rule, only a table
 *    (apps/ocpp-server/src/config/envs/docker.ts), so it is spelled out here.
 *  - REFS ARE NOT WIRE VALUES. A TransactionRef is this driver's own row key
 *    and has to be resolved to the OCPP integer transactionId; a
 *    ChargingProfileRef expands to the whole inline profile. See
 *    {@link CitrineRefs}.
 *  - RESERVATIONS DO NOT EXIST HERE AT ALL. See the two throwing cases.
 */
import {
  UnsupportedOperationError,
  assertNever,
  type ChargingProfile201,
  type ChargingProfileRef,
  type CsmsOperation16,
  type CsmsOperation201,
  type TransactionRef,
} from "../../tck/driver";
import { profileByRef, type CsChargingProfile } from "./profiles";
import {
  NO_RESERVATIONS,
  unroutedActions,
  unroutedActions201,
  type CitrineVariant,
} from "./variant";

/** The endpointPrefix values CitrineOS's shipped `docker` config declares. */
export type CitrineModule =
  | "certificates"
  | "configuration"
  | "evdriver"
  | "monitoring"
  | "reporting"
  | "smartcharging";

/** The version segment of a message-API path, spelled as CitrineOS spells it.
 *  Not `SimOcppVersion`: that type is the simulator CLI's spelling
 *  (`OCPP-2.0.1`) of a different thing -- which protocol a charge point
 *  speaks, not which route a CSMS registered. */
type CitrineOcppVersion = "1.6" | "2.0.1";

export interface CitrineRequest {
  ocppVersion: CitrineOcppVersion;
  module: CitrineModule;
  /** The path segment, i.e. the OCPP action with a lowercased first letter. */
  action: string;
  body: Record<string, unknown>;
}

/** Everything below the version in `/ocpp/<version>/<module>/<action>`: what
 *  each protocol's mapper returns, before the one place that stamps which
 *  protocol it was. Neither this nor the version union is exported -- only
 *  {@link CitrineRequest} crosses a module boundary, and a published
 *  declaration is this package's API whether anything imports it or not. */
type CitrineRoute = Omit<CitrineRequest, "ocppVersion">;

/**
 * How an opaque ref becomes something CitrineOS will accept.
 *
 * `ocppTransactionId` is async because it is a database lookup: this driver's
 * TransactionRef is `Transactions.id`, the serial primary key, while the wire
 * carries `Transactions.transactionId`, the value CitrineOS handed the charge
 * point in StartTransaction.conf. The two are different columns and, unlike
 * SteVe's, different numbers.
 */
export interface CitrineRefs {
  ocppTransactionId(ref: TransactionRef): Promise<number>;
}


/**
 * An OCPP request body with the `undefined` members dropped.
 *
 * Replaces seventeen copies of `...(x === undefined ? {} : { k: x })`, and the
 * mechanical detail matters: Object.entries/fromEntries preserve insertion
 * order for string keys, which SendLocalList depends on -- TC_043.5 asserts the
 * raw bytes `"listVersion":2,"localAuthorizationList":[{"idTag":...` against the
 * simulator's received line, so reordering these members turns that scenario
 * red for a reason unrelated to local lists.
 *
 * Only `undefined` is dropped. `""` is a defined value and still reaches
 * profileFor(), which is what keeps "absent" and "the lookup found nothing"
 * distinguishable -- see RemoteStartTransaction below.
 */
function body(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

/**
 * An OCPP 2.0.1 `ChargingProfileType` as CitrineOS will accept it.
 *
 * THE ONLY WORK IS THE THREE DATES, and it is work rather than a pass-through
 * for the reason `UpdateFirmware`'s `retrieveDate` is: the contract carries a
 * `Date` because that is the type a scenario can compute a window with, and
 * `SetChargingProfileRequestSchema` validates `format: date-time`, which is a
 * string. `JSON.stringify` would in fact render a Date as the same ISO 8601
 * text -- and relying on that would put the wire spelling of three members
 * inside a serialiser nothing here declares. `toISOString()` says it.
 *
 * REBUILT MEMBER BY MEMBER RATHER THAN SPREAD, which costs the eleven lines
 * below and buys the thing a spread cannot: a member added to
 * {@link ChargingProfile201} is a member this function does not send until
 * somebody writes it here, so a `Date`-valued one cannot reach the wire as
 * `{}`. `body()` drops the undefined ones, so an omitted optional is omitted
 * rather than sent as null -- which for `transactionId` is the difference
 * between a TxProfile CitrineOS refuses and one it dispatches.
 */
function profile201Body(profile: ChargingProfile201): Record<string, unknown> {
  return body({
    id: profile.id,
    stackLevel: profile.stackLevel,
    chargingProfilePurpose: profile.chargingProfilePurpose,
    chargingProfileKind: profile.chargingProfileKind,
    recurrencyKind: profile.recurrencyKind,
    validFrom: profile.validFrom?.toISOString(),
    validTo: profile.validTo?.toISOString(),
    transactionId: profile.transactionId,
    chargingSchedule: profile.chargingSchedule.map((schedule) =>
      body({
        id: schedule.id,
        startSchedule: schedule.startSchedule?.toISOString(),
        duration: schedule.duration,
        chargingRateUnit: schedule.chargingRateUnit,
        minChargingRate: schedule.minChargingRate,
        chargingSchedulePeriod: schedule.chargingSchedulePeriod.map((period) =>
          body({
            startPeriod: period.startPeriod,
            limit: period.limit,
            numberPhases: period.numberPhases,
            phaseToUse: period.phaseToUse,
          }),
        ),
      }),
    ),
  });
}

/** The inline profile a ref names, or a hard failure naming the ref. */
function profileFor(ref: ChargingProfileRef): CsChargingProfile {
  const profile = profileByRef(ref);
  if (!profile) {
    // Deliberately NOT UnsupportedOperationError: CitrineOS can express this
    // operation perfectly well. An unknown ref means `ocpp-tck driver provision`
    // did not run, or profiles.ts and the scenario disagree about a name --
    // an environment fault, and reporting it as a capability gap would file it
    // against the CSMS.
    throw new Error(
      `citrineos: no provisioned charging profile for ref ${JSON.stringify(ref)} ` +
        "-- did `ocpp-tck driver provision` run?",
    );
  }
  return profile;
}

/**
 * STAMPED ONCE PER PROTOCOL, not once per arm. Sixteen arms each repeating
 * `ocppVersion: "1.6"` is sixteen chances to write the other one, and the
 * failure would be silent in the worst way: a 2.0.1 payload POSTed to a 1.6
 * route is a 404 with a hint about an unrouted action, which reads as a
 * capability gap in the CSMS rather than as a typo here.
 */
export async function toCitrineRequest(
  op: CsmsOperation16,
  refs: CitrineRefs,
  variant: CitrineVariant,
): Promise<CitrineRequest> {
  return { ocppVersion: "1.6", ...(await route16(op, refs, variant)) };
}

/**
 * The same for {@link CsmsOperation201}, and a SECOND function rather than a
 * widened first one -- the two vocabularies are two closed unions for the
 * reason tck/driver.ts gives beside `CsmsOperation201`'s `Reset` arm, and
 * `Reset` being an action name in both is exactly what a shared switch would
 * lose. It needs no `refs`: nothing in the 2.0.1 slice carries an opaque ref,
 * so there is no database round-trip to hand it.
 *
 * IT DOES TAKE A `variant`, and that is a reversal worth stating because the
 * argument against it was written here and was right at the time: the v1 line
 * declares no 2.0.1 surface at all rather than one with holes in it, so there
 * was nothing for a variant to decide. What changed is the OTHER direction --
 * `capabilitiesFor` declared the whole of `CSMS_OPERATION_201_ACTIONS` for v2,
 * so an arm added to the contract was declared supported by this driver before
 * any endpoint had been read off a decorator (issue #71). The fix is the one
 * the 1.6 half already had: a table of what is unrouted, subtracted from the
 * declaration and read again here, so a declared action and a POSTed request
 * cannot disagree. A variant is what indexes that table, and v2's row being
 * empty today is not a reason to have no parameter -- it is the row the next
 * arm lands in.
 *
 * The module for each action is CitrineOS's, not the OCPP specification's:
 * `Reset`, `TriggerMessage` and `ChangeAvailability` are Configuration's, the
 * two device-model actions are Monitoring's, the four charging-profile
 * actions are SmartCharging's and `GetInstalledCertificateIds` is
 * Certificates', read off the `@AsMessageEndpoint` decorators in
 * `packages/core/src/modules/{Certificates,Configuration,Monitoring,SmartCharging}/src/module/2/MessageApi.ts`.
 * There is no rule to derive it from, the same way there is none for 1.6 --
 * and that all five actions with a 1.6 namesake happen to share their
 * namesake's module is a fact about this arrangement, not one to route by: the
 * two device-model actions have no namesake to agree with.
 */
export function toCitrineRequest201(
  op: CsmsOperation201,
  variant: CitrineVariant,
): CitrineRequest {
  return { ocppVersion: "2.0.1", ...route201(op, variant) };
}

function route201(op: CsmsOperation201, variant: CitrineVariant): CitrineRoute {
  // The same guard `route16` opens with, and for the same reason: an action
  // this variant does not route must never be POSTed to a 404, and the reason
  // comes from variant.ts rather than being re-derived here, which is what
  // keeps this escape, the capability set and the scope table saying one
  // thing. Empty for v2 today -- see UNROUTED_201 for why that is the state to
  // build for rather than the state to code around.
  const unrouted = unroutedActions201(variant).get(op.action);
  if (unrouted !== undefined) {
    throw new UnsupportedOperationError(op.action, unrouted);
  }
  switch (op.action) {
    case "Reset":
      // An absent evseId is OMITTED, not sent as 0: 2.0.1 reads its absence as
      // "the whole charging station", and 0 addresses the station's own
      // component. body() drops only `undefined`, so the two stay different
      // requests.
      return {
        module: "configuration",
        action: "reset",
        body: body({ type: op.type, evseId: op.evseId }),
      };

    // The member names are the OCPP ones, because the body IS the OCPP
    // payload -- CitrineOS validates it against `GetVariablesRequestSchema`
    // and forwards it. An array on both sides, matching the wire, which is
    // what the scenarios assert on.
    case "GetVariables":
      return {
        module: "monitoring",
        action: "getVariables",
        body: { getVariableData: op.variables },
      };

    case "SetVariables":
      return {
        module: "monitoring",
        action: "setVariables",
        body: { setVariableData: op.variables },
      };

    // Configuration's, like 1.6's -- see this function's doc comment for the
    // module table and for why it is not derivable. `evse` is omitted because
    // the contract has no member for it: TC_F_20 triggers a station-wide
    // Heartbeat, and tck/driver.ts's NOT BUILT note is where the member
    // arrives if a case ever scopes one to an EVSE.
    case "TriggerMessage":
      return {
        module: "configuration",
        action: "triggerMessage",
        body: { requestedMessage: op.requestedMessage },
      };

    // Configuration's, like both of its namesakes. `evse` is passed THROUGH
    // rather than unpacked: the body is the OCPP payload, CitrineOS validates
    // it against `ChangeAvailabilityRequestSchema` and forwards it, and the
    // three addressing modes the scenarios measure are exactly which members
    // of that object are present. Unpacking it into `evseId` / `connectorId`
    // here -- the shape 1.6's arm two functions down has -- would collapse
    // "the whole station" and "this EVSE" into one request.
    //
    // body() drops only `undefined`, so an absent `evse` is OMITTED rather
    // than sent as null, which is the difference between addressing the
    // station and sending a member the schema does not allow to be null. The
    // `connectorId` inside it needs no such treatment: it is already absent
    // from the object the contract built, and JSON.stringify drops an
    // undefined property.
    case "ChangeAvailability":
      return {
        module: "configuration",
        action: "changeAvailability",
        body: body({ operationalStatus: op.operationalStatus, evse: op.evse }),
      };

    // SmartCharging's, and the first 2.0.1 pair whose module is NOT the one
    // its 1.6 namesake uses by coincidence -- both namesakes are under
    // `smartcharging` too, and both were read off `@AsMessageEndpoint`
    // decorators in
    // `packages/core/src/modules/SmartCharging/src/module/2/MessageApi.ts`
    // rather than inferred from that.
    //
    // WHAT MAKES THESE TWO DIFFERENT FROM EVERY ARM ABOVE: this endpoint
    // VALIDATES BEFORE IT DISPATCHES, and a refusal is an HTTP 200 carrying
    // `success: false` with nothing on the wire. It checks the profile against
    // a dozen of Part 2's K01 rules -- a `validFrom` in the future, a
    // `ChargingStationMaxProfile` anywhere but evseId 0, a first period whose
    // `startPeriod` is not 0, a second profile at a stack level and purpose an
    // active one already holds unless the newcomer outlives it -- so a
    // scenario here can fail with an empty log and a correct CSMS. The
    // scenarios carry that reasoning; the driver's job is to send what it was
    // handed, and every one of those rules is about a value it did not choose.
    case "SetChargingProfile":
      return {
        module: "smartcharging",
        action: "setChargingProfile",
        body: {
          evseId: op.evseId,
          chargingProfile: profile201Body(op.chargingProfile),
        },
      };

    // `chargingRateUnit` is omitted rather than defaulted: absent means the
    // station picks, and the endpoint checks a PRESENT one against the
    // station's `RateUnit` member list before dispatching, so inventing a
    // value is inventing a way to be refused.
    case "GetCompositeSchedule":
      return {
        module: "smartcharging",
        action: "getCompositeSchedule",
        body: body({
          evseId: op.evseId,
          duration: op.duration,
          chargingRateUnit: op.chargingRateUnit,
        }),
      };

    // SmartCharging's third, and the one whose body is closest to a
    // pass-through: no dates to render, no nested arrays to rebuild, so
    // profile201Body's member-by-member argument does not apply and the
    // criterion goes through as the contract built it -- `ChangeAvailability`'s
    // `evse` treatment, for its reason. Which members of it are PRESENT is what
    // the cases measure.
    //
    // `evseId` THROUGH body() AND THE CRITERION NOT. An absent evseId must be
    // OMITTED -- 2.0.1 reads its absence as "every EVSE" where 0 addresses the
    // station itself -- and body() drops only `undefined`, so the two stay
    // different requests. `chargingProfile` never goes through it: an EMPTY
    // criterion is a defined value the schema requires, and dropping it would
    // turn "ask about all of them" into a request CitrineOS validates away
    // before dispatch.
    case "GetChargingProfiles":
      return {
        module: "smartcharging",
        action: "getChargingProfiles",
        body: {
          ...body({ requestId: op.requestId, evseId: op.evseId }),
          chargingProfile: op.chargingProfile,
        },
      };

    // SmartCharging's fourth and last, and the only 2.0.1 request in the
    // contract whose two members this deployment treats as MUTUALLY EXCLUSIVE.
    // Its K10.FR.02 check refuses a body carrying both and refuses one carrying
    // neither, each with an HTTP 200 `{success:false}` and no frame -- which
    // `send` classifies as a non-dispatch, so a scenario that spells the pair
    // gets an ERROR naming the rule rather than a red assertion. Nothing is
    // enforced here: the contract keeps both optional (see the note on the arm)
    // and a mapper that dropped one to make the pair legal would be deciding
    // which half of a scenario's request was the real one.
    //
    // BOTH THROUGH body(), unlike GetChargingProfiles' criterion. There is no
    // "empty means all" spelling to protect here -- an absent criterion IS the
    // clear-by-identifier request -- so dropping `undefined` is exactly right,
    // and `evseId: 0` inside the criterion survives it because body() drops
    // only `undefined`. That last part matters: 0 addresses the charging
    // station itself, and this CSMS's own gate reads the member for truthiness,
    // so a 0 that survives our mapper is still refused by theirs. The refusal
    // is theirs to make and ours to report.
    case "ClearChargingProfile":
      return {
        module: "smartcharging",
        action: "clearChargingProfile",
        body: body({
          chargingProfileId: op.chargingProfileId,
          chargingProfileCriteria: op.chargingProfileCriteria,
        }),
      };

    // CERTIFICATES', THE SIXTH MODULE, and the first 2.0.1 action here whose
    // prefix no 1.6 namesake could have suggested: OCPP 1.6 puts certificate
    // management in a Security Whitepaper extension this deployment does not
    // route at all. The prefix was read off the shipped
    // `apps/ocpp-server/src/config/envs/docker.ts` -- `endpointPrefix:
    // '/certificates'` -- and the endpoint off the `@AsMessageEndpoint`
    // decorator in
    // `packages/core/src/modules/Certificates/src/module/2/MessageApi.ts`,
    // which forwards the body after validating it against
    // `GetInstalledCertificateIdsRequestSchema` and does nothing else. So this
    // arm's body IS the OCPP payload, and unlike its two neighbours in that
    // module it touches no database row before dispatch.
    //
    // THROUGH body(), and that is the whole of the work. An absent
    // `certificateType` must be OMITTED -- 2.0.1 reads its absence as "every
    // type", and the schema's `minItems` refuses the empty array a mapper that
    // defaulted it would send -- and body() drops only `undefined`, so the two
    // stay different requests. TC_M_18 is the case that is the omission.
    case "GetInstalledCertificateIds":
      return {
        module: "certificates",
        action: "getInstalledCertificateIds",
        body: body({ certificateType: op.certificateType }),
      };

    default:
      return assertNever(op, "citrineos.operations201.execute");
  }
}

async function route16(
  op: CsmsOperation16,
  refs: CitrineRefs,
  variant: CitrineVariant,
): Promise<CitrineRoute> {
  // An action this variant does not route must never be POSTed to a 404, so it
  // throws here and the runner turns it into NOT APPLICABLE. The reason comes
  // from variant.ts rather than being re-derived from the action, which is what
  // keeps this escape and the scope table saying the same thing.
  const unrouted = unroutedActions(variant).get(op.action);
  if (unrouted !== undefined) {
    throw new UnsupportedOperationError(op.action, unrouted);
  }
  switch (op.action) {
    case "Reset":
      return { module: "configuration", action: "reset", body: { type: op.type } };

    case "UnlockConnector":
      return {
        module: "evdriver",
        action: "unlockConnector",
        body: { connectorId: op.connectorId },
      };

    case "ClearCache":
      return { module: "evdriver", action: "clearCache", body: {} };

    case "ChangeAvailability":
      return {
        module: "configuration",
        action: "changeAvailability",
        body: { connectorId: op.connectorId, type: op.type },
      };

    case "GetConfiguration":
      // Absent `key` means every key, which is what OCPP 1.6 says an omitted
      // list means -- so an absent one is omitted rather than sent as [].
      return {
        module: "configuration",
        action: "getConfiguration",
        body: op.keys?.length ? { key: op.keys } : {},
      };

    case "ChangeConfiguration":
      return {
        module: "configuration",
        action: "changeConfiguration",
        body: { key: op.key, value: op.value },
      };

    case "RemoteStartTransaction":
      return {
        module: "evdriver",
        action: "remoteStartTransaction",
        // `undefined` means "start without a profile"; `""` means the
        // scenario's lookup found none, and those are not the same request.
        // body() drops only `undefined`, so `""` still reaches profileFor(),
        // which rejects it loudly -- TC_059, whose whole assertion is that the
        // attached profile is NOT applied, would otherwise pass for a reason
        // that never happened.
        body: body({
          connectorId: op.connectorId,
          idTag: op.idTag,
          chargingProfile:
            op.chargingProfile === undefined
              ? undefined
              : profileFor(op.chargingProfile),
        }),
      };

    case "RemoteStopTransaction":
      return {
        module: "evdriver",
        action: "remoteStopTransaction",
        body: { transactionId: await refs.ocppTransactionId(op.transaction) },
      };

    case "TriggerMessage":
      // connectorId is omitted rather than sent as 0 for a station-wide
      // trigger: CitrineOS rejects `connectorId <= 0` locally, without putting
      // anything on the wire, and the scenario asserts on the wire.
      return {
        module: "configuration",
        action: "triggerMessage",
        body: body({
          requestedMessage: op.requestedMessage,
          connectorId: op.connectorId,
        }),
      };

    case "SetChargingProfile": {
      const profile = profileFor(op.chargingProfile);
      // A TxProfile is scoped to a running transaction by carrying its OCPP
      // transactionId INSIDE the profile, not beside it. An empty ref means
      // the scenario's own lookup came back empty; sending the profile
      // unscoped is closer to what was asked than refusing to send it, and the
      // scenario's assertions are what decide whether that was good enough.
      const transactionId =
        op.transaction === undefined || op.transaction === ""
          ? undefined
          : await refs.ocppTransactionId(op.transaction);
      return {
        module: "smartcharging",
        action: "setChargingProfile",
        body: {
          connectorId: op.connectorId,
          csChargingProfiles:
            transactionId === undefined ? profile : { ...profile, transactionId },
        },
      };
    }

    case "GetCompositeSchedule":
      return {
        module: "smartcharging",
        action: "getCompositeSchedule",
        body: body({
          connectorId: op.connectorId,
          duration: op.duration,
          chargingRateUnit: op.chargingRateUnit,
        }),
      };

    case "ClearChargingProfile":
      // Every member is optional in OCPP 1.6, and an omitted one is a wildcard.
      // Sending `id: null` for an absent ref would not be the same request.
      //
      // Same `undefined` vs `""` distinction as RemoteStartTransaction above,
      // and the consequence here is worse: an empty ref treated as absent
      // becomes a WILDCARD clear, so TC_067 would see its profile removed by a
      // request that named nothing and still pass.
      return {
        module: "smartcharging",
        action: "clearChargingProfile",
        body: body({
          id:
            op.chargingProfile === undefined
              ? undefined
              : profileFor(op.chargingProfile).chargingProfileId,
          connectorId: op.connectorId,
          chargingProfilePurpose: op.purpose,
          stackLevel: op.stackLevel,
        }),
      };

    case "UpdateFirmware":
      // toISOString() and not a local rendering: CitrineOS validates this
      // against `format: date-time` and forwards the string verbatim, so
      // there is no minute-resolution form to round up for here -- the
      // rounding rule in tck/driver.ts exists for CSMSs that have one.
      return {
        module: "configuration",
        action: "updateFirmware",
        body: body({
          location: op.location,
          retrieveDate: op.retrieveDate.toISOString(),
          retries: op.retries,
          retryInterval: op.retryInterval,
        }),
      };

    case "GetDiagnostics":
      return {
        module: "reporting",
        action: "getDiagnostics",
        body: body({
          location: op.location,
          retries: op.retries,
          retryInterval: op.retryInterval,
          startTime: op.startTime?.toISOString(),
          stopTime: op.stopTime?.toISOString(),
        }),
      };

    case "GetLocalListVersion":
      return { module: "evdriver", action: "getLocalListVersion", body: {} };

    case "SendLocalList":
      // Unlike SteVe's manager UI, which carries tag NAMES only, this path is
      // lossless: status, expiryDate and parentIdTag all reach the wire.
      //
      // KEY ORDER IS DELIBERATE. CitrineOS forwards the parsed body to
      // sendCall, so this object's insertion order is the order the charge
      // point receives -- and TC_043.5 asserts
      // /"listVersion":2,"localAuthorizationList":\[\{"idTag":"CERT-TAG-2"/
      // against the simulator's raw received line. Reordering these three
      // members turns that scenario red for a reason that has nothing to do
      // with local lists.
      //
      // An entry with no status carries no idTagInfo at all, which is not the
      // same as carrying an empty one: in a Differential update, OCPP 1.6
      // reads an AuthorizationData without idTagInfo as "remove this tag".
      // Inventing a status would silently change what the scenario asked for.
      return {
        module: "evdriver",
        action: "sendLocalList",
        body: body({
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
        }),
      };

    case "ReserveNow":
    case "CancelReservation":
      // Unreachable: the guard above throws for every unrouted action, and
      // these two are unrouted on both variants. The arms exist so the switch
      // stays exhaustive -- deleting them breaks assertNever's compile-time
      // check, not the runtime.
      throw new UnsupportedOperationError(op.action, NO_RESERVATIONS);

    default:
      return assertNever(op, "citrineos.execute");
  }
}
