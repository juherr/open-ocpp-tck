// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * requests.ts -- one CsmsOperation16, one CitrineOS message-API call.
 *
 * CitrineOS's outbound surface is generated from the OCPP schemas themselves:
 * `AbstractModuleApi._toMessagePath` builds
 * `/ocpp/1.6/<modulePrefix>/<actionCamelLower>` and validates the body against
 * `OCPP1_6.<Action>RequestSchema` before dispatching. So the mapping below is
 * almost the identity -- the request bodies ARE the OCPP payloads, which is
 * exactly the shape the neutral vocabulary was derived from.
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
  type ChargingProfileRef,
  type CsmsOperation16,
  type TransactionRef,
} from "../../tck/driver";
import { profileByRef, type CsChargingProfile } from "./profiles";
import {
  NO_RESERVATIONS,
  unroutedActions,
  type CitrineVariant,
} from "./variant";

/** The endpointPrefix values CitrineOS's shipped `docker` config declares. */
export type CitrineModule =
  | "configuration"
  | "evdriver"
  | "reporting"
  | "smartcharging";

export interface CitrineRequest {
  module: CitrineModule;
  /** The path segment, i.e. the OCPP action with a lowercased first letter. */
  action: string;
  body: Record<string, unknown>;
}

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

export async function toCitrineRequest(
  op: CsmsOperation16,
  refs: CitrineRefs,
  variant: CitrineVariant,
): Promise<CitrineRequest> {
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
