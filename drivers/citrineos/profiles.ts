// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * profiles.ts -- the pre-provisioned charging profiles, owned by this driver.
 *
 * THIS IS A FIXTURE CATALOGUE, NOT SCENARIO BRANCHING. It looks like branching
 * because the two descriptions below are the ones the SmartCharging scenarios
 * name, so it is worth being precise about the difference: a driver may not
 * change its BEHAVIOUR based on which scenario is running, but the environment
 * every scenario assumes is exactly what `ocpp-tck driver provision` exists to
 * create. SteVe's provisioner seeds the same two profiles, under the same two
 * descriptions, with the same 11000 W limit -- it just seeds them into SteVe's
 * charging_profile table, because SteVe has one.
 *
 * CitrineOS does not, and does not need one. OCPP 1.6 SetChargingProfile
 * carries the whole profile inline (`csChargingProfiles`), so there is nothing
 * for a CSMS-side registry to be looked up FROM. Its `ChargingProfiles` table
 * is a record of what was sent, written after the fact, and it has no
 * `description` or `name` column to look up BY -- verified against
 * packages/core/src/dal/layers/drizzle/schema/ChargingProfile.ts.
 *
 * So `refByDescription` resolves here instead. Two consequences follow, and
 * both are load-bearing:
 *
 *  - THE REF IS THE OCPP `chargingProfileId`. It has to be: the scenarios
 *    assert `Applied charging profile #<ref>` against the SIMULATOR's log,
 *    which prints the id the charge point received on the wire. A ref that
 *    were a database key, or an index into this array, would make every
 *    SmartCharging scenario fail on an assertion about the CSMS's bookkeeping
 *    rather than about the charge point.
 *  - THE SHAPE MIRRORS SteVe's `chargingProfileForm`: stackLevel 0, kind
 *    Relative, rate unit W, one period at startPeriod 0. TC_066 asserts
 *    `"limit":11000` on the returned composite schedule, so the limit is not
 *    decorative.
 */

/** OCPP 1.6 ChargingProfile, spelled as the wire spells it. */
export interface CsChargingProfile {
  chargingProfileId: number;
  /** Only meaningful for a TxProfile; absent otherwise. */
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
  chargingProfileKind: "Absolute" | "Recurring" | "Relative";
  chargingSchedule: {
    chargingRateUnit: "A" | "W";
    chargingSchedulePeriod: { startPeriod: number; limit: number }[];
  };
}

interface CatalogueEntry {
  /** The human-readable name a scenario looks the profile up by. */
  description: string;
  profile: CsChargingProfile;
}

function watts(
  chargingProfileId: number,
  chargingProfilePurpose: CsChargingProfile["chargingProfilePurpose"],
  limit: number,
): CsChargingProfile {
  return {
    chargingProfileId,
    stackLevel: 0,
    chargingProfilePurpose,
    chargingProfileKind: "Relative",
    chargingSchedule: {
      chargingRateUnit: "W",
      chargingSchedulePeriod: [{ startPeriod: 0, limit }],
    },
  };
}

/**
 * Ids 56 and 57 name the test cases that use them rather than counting from 1.
 * A single-digit id would make the scenarios' `#<id>(?!\d)` log assertions
 * depend on that negative lookahead to avoid matching `#10`; two digits chosen
 * to be memorable cost nothing and remove the question.
 */
export const PROFILE_CATALOGUE: readonly CatalogueEntry[] = [
  { description: "TC056 TxDefaultProfile", profile: watts(56, "TxDefaultProfile", 11000) },
  { description: "TC057 TxProfile", profile: watts(57, "TxProfile", 11000) },
];

/** The ref for a description, or "" when this driver provisions no such
 *  profile -- which is the contract's "the CSMS has no such record". */
export function refByDescription(description: string): string {
  const entry = PROFILE_CATALOGUE.find((e) => e.description === description);
  return entry ? String(entry.profile.chargingProfileId) : "";
}

/** The profile behind a ref. `undefined` when the ref names nothing here. */
export function profileByRef(ref: string): CsChargingProfile | undefined {
  return PROFILE_CATALOGUE.find(
    (e) => String(e.profile.chargingProfileId) === ref,
  )?.profile;
}
