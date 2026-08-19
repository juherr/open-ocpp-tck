// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * capabilities.ts -- stand-ins for the optional parts of a driver.
 *
 * A driver whose CSMS has no reservation resource, no charging-profile
 * registry, or no OCPP 2.0.1 surface at all simply omits that sub-interface.
 * The runner substitutes one of these, whose every method throws
 * UnsupportedOperationError with the driver's own stated reason.
 *
 * The point is that SPECS NEVER BRANCH ON THE DRIVER. `records.reservations`
 * and `ctx.csms201` are non-optional as the specs see it, so a scenario reads
 * the same whether or not the CSMS under test has reservations or speaks
 * 2.0.1, and absence produces a NOT APPLICABLE verdict through the normal
 * escape rather than an `if` inside a vendored scenario.
 */
import {
  UnsupportedOperationError,
  type CsmsChargingProfileRecords,
  type CsmsOperations201,
  type CsmsReservationRecords,
} from "./driver";

export function unsupportedReservations(
  reason: string,
): CsmsReservationRecords {
  return {
    latest: async () => {
      throw new UnsupportedOperationError("reservations.latest", reason);
    },
    status: async () => {
      throw new UnsupportedOperationError("reservations.status", reason);
    },
  };
}

export function unsupportedChargingProfiles(
  reason: string,
): CsmsChargingProfileRecords {
  return {
    refByDescription: async () => {
      throw new UnsupportedOperationError(
        "chargingProfiles.refByDescription",
        reason,
      );
    },
  };
}

/**
 * The stand-in for a driver that declares no OCPP 2.0.1 operations.
 *
 * It reports `operations201.<action>`: QUALIFIED like the two above, whose
 * names are also the sub-interface they stand in for, and carrying the ACTION
 * because that is what the runner prints when it degrades the scenario and
 * what becomes the NOT APPLICABLE reason in the summary -- "driver reported
 * "operations201.GetVariables" unsupported" is a sentence a driver author can
 * act on.
 */
// TRIED AND NOT BUILT, here because here is where it gets re-proposed: folding
// these three into one `unsupported<T>(prefix, methods): T`. They do rhyme --
// each returns an object whose every method throws with a stated reason -- and
// two things stop it. The fold has to name its methods in an array, so the
// return type stops being CsmsReservationRecords / CsmsChargingProfileRecords
// / CsmsOperations201 and starts being a cast, which is what these three
// signatures are FOR: the runner substitutes them into a typed slot. And this
// third one is not the same shape anyway -- its name comes from the argument
// at call time, not from a fixed method. Two of three is not a pattern.
export function unsupportedOperations201(reason: string): CsmsOperations201 {
  return {
    execute: async (_cpId, op) => {
      throw new UnsupportedOperationError(`operations201.${op.action}`, reason);
    },
  };
}
