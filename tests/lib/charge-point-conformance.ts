// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * charge-point-conformance.ts -- the charge-point administration contract,
 * asked of one `CsmsDriver`. The property it checks, and why each rule is
 * stated the way it is, are in the header of
 * tests/csms-driver-charge-points.ts, which holds this function to a flawed
 * copy per rule.
 *
 * A module of its own so that a LIVE caller can import it without running the
 * guard: `tools/steve-charge-points.ts` asks it of the pinned SteVe. The
 * stations it creates use the fixed ids in {@link CONFORMANCE_IDS}, which a
 * crashed run leaves behind, so a live caller runs
 * {@link clearConformanceStations} first. Not the check itself: a flawed copy
 * whose `delete` throws would then fail before its own rule is asked.
 */
import {
  ChargePointAlreadyExistsError,
  ChargePointNotFoundError,
  UnsupportedOperationError,
  type ChargePointDefinition,
  type ChargePointDetails,
  type ChargePointSecurity,
  type ChargePointSecurityProfile,
  type CsmsChargePointAdmin,
  type CsmsDriver,
} from "open-ocpp-tck/csms-driver";

/** Every station id the lifecycle may create, and the one it must never find. */
export const CONFORMANCE_IDS = [
  "CONFORMANCE-1",
  "CONFORMANCE-2",
  "CONFORMANCE-3",
  "CONFORMANCE-4",
  "CONFORMANCE-5",
  "CONFORMANCE-MISSING",
] as const;
const [STATION_1, STATION_2, STATION_3, STATION_4, STATION_5, MISSING] = CONFORMANCE_IDS;

/** Deletes what a crashed run may have left behind; a live caller runs it first. */
export async function clearConformanceStations(admin: CsmsChargePointAdmin): Promise<void> {
  for (const id of CONFORMANCE_IDS) await admin.delete(id);
}

/** Every rule the conformance check asks about. Typed, so a check cannot ask
 *  about a rule part 5 does not hold a flawed copy to. */
export const RULE = {
  declaredWhenImplemented: "capabilities.chargePoints is declared exactly when chargePoints is implemented",
  declaresAProfile: "a declared admin surface names at least one security profile",
  getMissingIsNull: "get of a missing id is null",
  createStores: "create stores the registration, security profile and description it is given",
  readBackKeepsId: "get returns the id the station was created with",
  createExistingThrows: "create of an existing id throws ChargePointAlreadyExistsError",
  createExistingChangesNothing: "create of an existing id leaves the station unchanged",
  updateAppliesRegistration: "update applies the registration it names",
  updateKeepsUnnamed: "update leaves the members it does not name unchanged",
  updateAppliesDescription: "update applies the description it names",
  nullDescriptionClears: "a description of null clears it",
  updateAppliesSecurity: "update applies the security it names",
  securityUpdateKeepsUnnamed: "a security update leaves the members it does not name unchanged",
  declaredSecurityUpdateResolves: "a security update to a declared profile resolves",
  updateMissingThrows: "update of a missing id throws ChargePointNotFoundError",
  updateMissingCreatesNothing: "update of a missing id creates nothing",
  deleteRemoves: "delete removes the station",
  deleteMissingResolves: "delete of a missing id resolves",
  defaultRegistration: "an omitted registration reads back Accepted",
  defaultSecurity: "omitted security reads back profile 0",
  omittedSecurityNeedsProfile0: "create with omitted security throws UnsupportedOperationError when profile 0 is not declared",
  refusedDefaultStoresNothing: "a create refused for its omitted security stores nothing",
  passwordWriteOnly: "no read returns a password-named member",
  createRefusesUndeclared: "create with an undeclared security profile throws UnsupportedOperationError",
  refusedCreateStoresNothing: "a refused create stores nothing",
  updateRefusesUndeclared: "update to an undeclared security profile throws UnsupportedOperationError",
  refusedUpdateChangesNothing: "a refused update changes nothing",
} as const;
export type Rule = (typeof RULE)[keyof typeof RULE];

export const ALL_PROFILES: readonly ChargePointSecurityProfile[] = [0, 1, 2, 3];


export function rejectsWith(action: () => Promise<unknown>, type: abstract new (...args: never[]) => Error): Promise<boolean> {
  return action().then(() => false, (error) => error instanceof type);
}

export function securityFor(profile: ChargePointSecurityProfile): ChargePointSecurity {
  return profile === 1 || profile === 2
    ? { profile, basicAuthPassword: "conformance-secret" }
    : { profile };
}

/** The whole observable record, keys sorted at every level, so two reads
 *  compare equal exactly when nothing a consumer can see differs. */
function observable(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    member !== null && typeof member === "object" && !Array.isArray(member)
      ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => a.localeCompare(b)))
      : member,
  );
}

/** Any member named like a password, at any depth, whatever its value -- a
 *  masked `"***"` is still the contract returning authentication material. */
function exposesPassword(value: unknown): boolean {
  return value !== null && typeof value === "object" &&
    Object.entries(value).some(([key, member]) => /password/i.test(key) || exposesPassword(member));
}

/** Every rule `driver` breaks; empty when it conforms. */
export async function chargePointAdminViolations(driver: CsmsDriver): Promise<string[]> {
  const violations: string[] = [];
  const expect = (condition: boolean, rule: Rule): void => {
    if (!condition) violations.push(rule);
  };

  const declared = driver.capabilities.chargePoints;
  const admin = driver.chargePoints;
  expect((declared === undefined) === (admin === undefined), RULE.declaredWhenImplemented);
  if (declared === undefined || admin === undefined) return violations;
  expect(declared.securityProfiles.size > 0, RULE.declaresAProfile);

  // A driver that throws where the contract says it resolves is a violation
  // to report, not a crash of the guard.
  try {
    await exerciseLifecycle(admin, declared.securityProfiles, expect);
  } catch (error) {
    violations.push(`the lifecycle threw unexpectedly: ${String(error)}`);
  }
  return violations;
}

async function exerciseLifecycle(
  admin: CsmsChargePointAdmin,
  profiles: ReadonlySet<ChargePointSecurityProfile>,
  expect: (condition: boolean, rule: Rule) => void,
): Promise<void> {
  // Every read is also a check that no password escapes it.
  const read = async (cpId: string): Promise<ChargePointDetails | null> => {
    const details = await admin.get(cpId);
    expect(!exposesPassword(details), RULE.passwordWriteOnly);
    return details;
  };
  // A station that must exist at this point; its absence is a violation
  // reported elsewhere, so it ends the lifecycle rather than cascading.
  const mustRead = async (cpId: string): Promise<ChargePointDetails> => {
    const details = await read(cpId);
    if (details === null) throw new Error(`station ${cpId} vanished`);
    return details;
  };
  const same = (a: unknown, b: unknown): boolean => observable(a) === observable(b);

  // Every member away from its default: a non-zero profile where one is
  // declared, a non-Accepted registration, a description.
  const declared = [...profiles];
  const profile = declared.find((candidate) => candidate !== 0) ?? declared[0];
  if (profile === undefined) return;
  const otherProfile = declared.find((candidate) => candidate !== profile);

  // Part 2.
  const station: ChargePointDefinition = {
    id: STATION_1,
    registration: "Rejected",
    security: securityFor(profile),
    description: "first",
  };
  expect(await read(station.id) === null, RULE.getMissingIsNull);
  await admin.create(station);
  const created = await mustRead(station.id);
  expect(
    created.registration === "Rejected" && created.security.profile === profile && created.description === "first",
    RULE.createStores,
  );
  expect(created.id === station.id, RULE.readBackKeepsId);
  expect(
    await rejectsWith(
      () => admin.create({
        id: station.id,
        registration: "Accepted",
        security: securityFor(otherProfile ?? profile),
        description: "second",
      }),
      ChargePointAlreadyExistsError,
    ),
    RULE.createExistingThrows,
  );
  expect(same(await read(station.id), created), RULE.createExistingChangesNothing);

  // Part 3: an update applies what it names and nothing else, each step
  // compared with the whole record before it.
  let before = await mustRead(station.id);
  await admin.update(station.id, { registration: "Pending" });
  let after = await mustRead(station.id);
  expect(after.registration === "Pending", RULE.updateAppliesRegistration);
  expect(same(after, { ...before, registration: "Pending" }), RULE.updateKeepsUnnamed);

  before = after;
  await admin.update(station.id, { description: "second" });
  after = await mustRead(station.id);
  expect(after.description === "second", RULE.updateAppliesDescription);
  expect(same(after, { ...before, description: "second" }), RULE.updateKeepsUnnamed);

  // A security update the declaration allows resolves even when there is
  // only one profile to move to -- the one the station already has. The
  // password it replaces is not observable here; #155 owns that per driver.
  before = after;
  expect(
    await admin.update(station.id, { security: securityFor(profile) }).then(() => true, () => false),
    RULE.declaredSecurityUpdateResolves,
  );
  after = await mustRead(station.id);
  expect(same(after, before), RULE.securityUpdateKeepsUnnamed);

  if (otherProfile !== undefined) {
    before = after;
    await admin.update(station.id, { security: securityFor(otherProfile) });
    after = await mustRead(station.id);
    expect(after.security.profile === otherProfile, RULE.updateAppliesSecurity);
    expect(same(after, { ...before, security: { profile: otherProfile } }), RULE.securityUpdateKeepsUnnamed);
  }

  before = after;
  await admin.update(station.id, { description: null });
  after = await mustRead(station.id);
  const { description: _cleared, ...withoutDescription } = before;
  expect(after.description === undefined, RULE.nullDescriptionClears);
  expect(same(after, withoutDescription), RULE.updateKeepsUnnamed);

  expect(
    await rejectsWith(() => admin.update(MISSING, { registration: "Accepted" }), ChargePointNotFoundError),
    RULE.updateMissingThrows,
  );
  expect(await read(MISSING) === null, RULE.updateMissingCreatesNothing);

  await admin.delete(station.id);
  expect(await read(station.id) === null, RULE.deleteRemoves);
  expect(await admin.delete(station.id).then(() => true, () => false), RULE.deleteMissingResolves);

  // Part 3, defaults. The registration default does not depend on profile 0.
  await admin.create({ id: STATION_2, security: securityFor(profile) });
  expect((await read(STATION_2))?.registration === "Accepted", RULE.defaultRegistration);
  await admin.delete(STATION_2);
  // The security default IS profile 0, so it is only as available as 0 is.
  if (profiles.has(0)) {
    await admin.create({ id: STATION_3 });
    expect((await read(STATION_3))?.security.profile === 0, RULE.defaultSecurity);
  } else {
    expect(
      await rejectsWith(() => admin.create({ id: STATION_3 }), UnsupportedOperationError),
      RULE.omittedSecurityNeedsProfile0,
    );
    expect(await read(STATION_3) === null, RULE.refusedDefaultStoresNothing);
  }
  await admin.delete(STATION_3);

  // Part 4: an undeclared profile is refused, and the refusal changes
  // nothing -- including the members the refused patch named beside it.
  const undeclared = ALL_PROFILES.find((candidate) => !profiles.has(candidate));
  if (undeclared !== undefined) {
    expect(
      await rejectsWith(() => admin.create({ id: STATION_4, security: securityFor(undeclared) }), UnsupportedOperationError),
      RULE.createRefusesUndeclared,
    );
    expect(await read(STATION_4) === null, RULE.refusedCreateStoresNothing);
    await admin.delete(STATION_4);

    await admin.create({ id: STATION_5, registration: "Rejected", security: securityFor(profile), description: "kept" });
    before = await mustRead(STATION_5);
    expect(
      await rejectsWith(
        () => admin.update(STATION_5, { registration: "Accepted", description: "changed", security: securityFor(undeclared) }),
        UnsupportedOperationError,
      ),
      RULE.updateRefusesUndeclared,
    );
    expect(same(await read(STATION_5), before), RULE.refusedUpdateChangesNothing);
    await admin.delete(STATION_5);
  }
}
