// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * csms-driver-charge-points.ts -- the charge-point administration surface
 * means the same thing whichever CSMS is behind it.
 *
 * `CsmsDriver.chargePoints` is optional and CSMS-neutral (issue #154): a
 * consumer outside the TCK provisions a station through it without knowing
 * which CSMS it is talking to. That only works if every driver answers the
 * edge cases alike, so the contract states them and this guard holds a driver
 * to them through `chargePointAdminViolations`, which takes nothing but a
 * `CsmsDriver`. #155's SteVe adapter gets its row here, behind a fake `fetch`.
 * A LIVE caller (#157) cannot import this file -- it runs on import -- so the
 * function moves to a module of its own the day one needs it, and starts by
 * clearing its fixed `CONFORMANCE-*` ids, which a crashed run leaves behind.
 *
 * PROPERTY, in 5 parts:
 *  1. DECLARED EXACTLY WHEN IMPLEMENTED. `capabilities.chargePoints` is
 *     present if and only if `chargePoints` is, and a present declaration
 *     names at least one security profile. Absent is "no admin surface";
 *     present-and-empty is a driver that can provision nothing, which no
 *     honest declaration is.
 *  2. THE LIFECYCLE TABLE. `get` of a missing id is `null`; `create` stores
 *     what it is given, and `get` reads it back under the id it was created
 *     with -- the stable key, not a CSMS-side one; `create` of an existing id throws
 *     `ChargePointAlreadyExistsError` and changes nothing; `update` of a
 *     missing id throws `ChargePointNotFoundError` and creates nothing;
 *     `delete` removes, and of a missing id resolves.
 *  3. DEFAULTS, UPDATES, READ-BACK. An omitted registration reads back
 *     `Accepted`, on whichever profile the driver declares. Omitted security
 *     IS profile 0: it reads back as 0 where 0 is declared, and is refused
 *     with `UnsupportedOperationError`, storing nothing, where it is not. An
 *     update applies each member it names -- registration, description,
 *     security -- and leaves the others alone; a security update to any
 *     declared profile resolves, including the one the station already has,
 *     so a single-profile declaration is exercised too; a `description: null`
 *     clears.
 *     No read ever returns a password-named member, whatever its value.
 *  4. THE DECLARATION BINDS. A security profile outside
 *     `capabilities.chargePoints.securityProfiles` is refused with
 *     `UnsupportedOperationError` by `create` and by `update`, and the refused
 *     call changes nothing -- not even the other members its patch named.
 *  5. NONE OF THE ABOVE IS VACUOUS. A reference driver passes under several
 *     declarations, and for every entry of `RULE` a copy of it breaking that
 *     rule alone is refused FOR that rule. The bundled factories, which do
 *     not opt in yet, satisfy part 1 by absence.
 *
 * "Changes nothing" and "leaves the others alone" are checked against the
 * WHOLE observable record, compared key by key after sorting, on a station
 * whose every member starts away from its default -- so a rule cannot pass
 * because the member that moved was the one nobody looked at, or because it
 * moved to the value it already had.
 *
 * WHAT IT CANNOT CHECK: that a `security` update to profile 0 or 3 discards
 * the stored password, as the contract says. The password is never read back,
 * so no driver can show it through this surface. It is a per-driver fact --
 * what the driver sends its CSMS, and whether that CSMS honours it -- and
 * #155 owns it for SteVe, offline against its fake `fetch` and live against
 * the pinned image.
 */

import {
  ChargePointAlreadyExistsError,
  ChargePointNotFoundError,
  createCitrineOsCsmsDriver,
  createSteveCsmsDriver,
  UnsupportedOperationError,
  type ChargePointDefinition,
  type ChargePointDetails,
  type ChargePointSecurity,
  type ChargePointSecurityProfile,
  type ChargePointUpdate,
  type CsmsChargePointAdmin,
  type CsmsDriver,
  type FetchLike,
} from "open-ocpp-tck/csms-driver";

/** Every rule the conformance check asks about. Typed, so a check cannot ask
 *  about a rule part 5 does not hold a flawed copy to. */
const RULE = {
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
type Rule = (typeof RULE)[keyof typeof RULE];

const ALL_PROFILES: readonly ChargePointSecurityProfile[] = [0, 1, 2, 3];
/** The declaration the flawed copies run under unless they say otherwise:
 *  the default profile, and one that carries a password. */
const DECLARED_PROFILES: readonly ChargePointSecurityProfile[] = [0, 1];

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function rejectsWith(action: () => Promise<unknown>, type: abstract new (...args: never[]) => Error): Promise<boolean> {
  return action().then(() => false, (error) => error instanceof type);
}

function securityFor(profile: ChargePointSecurityProfile): ChargePointSecurity {
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
async function chargePointAdminViolations(driver: CsmsDriver): Promise<string[]> {
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
    id: "CONFORMANCE-1",
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
    await rejectsWith(() => admin.update("CONFORMANCE-MISSING", { registration: "Accepted" }), ChargePointNotFoundError),
    RULE.updateMissingThrows,
  );
  expect(await read("CONFORMANCE-MISSING") === null, RULE.updateMissingCreatesNothing);

  await admin.delete(station.id);
  expect(await read(station.id) === null, RULE.deleteRemoves);
  expect(await admin.delete(station.id).then(() => true, () => false), RULE.deleteMissingResolves);

  // Part 3, defaults. The registration default does not depend on profile 0.
  await admin.create({ id: "CONFORMANCE-2", security: securityFor(profile) });
  expect((await read("CONFORMANCE-2"))?.registration === "Accepted", RULE.defaultRegistration);
  await admin.delete("CONFORMANCE-2");
  // The security default IS profile 0, so it is only as available as 0 is.
  if (profiles.has(0)) {
    await admin.create({ id: "CONFORMANCE-3" });
    expect((await read("CONFORMANCE-3"))?.security.profile === 0, RULE.defaultSecurity);
  } else {
    expect(
      await rejectsWith(() => admin.create({ id: "CONFORMANCE-3" }), UnsupportedOperationError),
      RULE.omittedSecurityNeedsProfile0,
    );
    expect(await read("CONFORMANCE-3") === null, RULE.refusedDefaultStoresNothing);
  }
  await admin.delete("CONFORMANCE-3");

  // Part 4: an undeclared profile is refused, and the refusal changes
  // nothing -- including the members the refused patch named beside it.
  const undeclared = ALL_PROFILES.find((candidate) => !profiles.has(candidate));
  if (undeclared !== undefined) {
    expect(
      await rejectsWith(() => admin.create({ id: "CONFORMANCE-4", security: securityFor(undeclared) }), UnsupportedOperationError),
      RULE.createRefusesUndeclared,
    );
    expect(await read("CONFORMANCE-4") === null, RULE.refusedCreateStoresNothing);
    await admin.delete("CONFORMANCE-4");

    await admin.create({ id: "CONFORMANCE-5", registration: "Rejected", security: securityFor(profile), description: "kept" });
    before = await mustRead("CONFORMANCE-5");
    expect(
      await rejectsWith(
        () => admin.update("CONFORMANCE-5", { registration: "Accepted", description: "changed", security: securityFor(undeclared) }),
        UnsupportedOperationError,
      ),
      RULE.updateRefusesUndeclared,
    );
    expect(same(await read("CONFORMANCE-5"), before), RULE.refusedUpdateChangesNothing);
    await admin.delete("CONFORMANCE-5");
  }
}

// ---------------------------------------------------------------------------
// A reference driver, and copies of it with one rule broken each
// ---------------------------------------------------------------------------

interface StoredChargePoint extends ChargePointDetails {
  readonly basicAuthPassword?: string;
}
type Store = Map<string, StoredChargePoint>;

/** The contract, over a map. `accepts` is what it refuses outside of. */
function memoryAdmin(store: Store, accepts: ReadonlySet<ChargePointSecurityProfile>): CsmsChargePointAdmin {
  const refuseUnaccepted = (method: string, profile: ChargePointSecurityProfile): void => {
    if (!accepts.has(profile)) {
      throw new UnsupportedOperationError(`chargePoints.${method}`, `security profile ${profile} is not supported`);
    }
  };
  const passwordOf = (security: ChargePointSecurity): string | undefined =>
    "basicAuthPassword" in security ? security.basicAuthPassword : undefined;

  return {
    async create(definition) {
      const security = definition.security ?? { profile: 0 };
      refuseUnaccepted("create", security.profile);
      if (store.has(definition.id)) throw new ChargePointAlreadyExistsError(definition.id);
      store.set(definition.id, {
        id: definition.id,
        registration: definition.registration ?? "Accepted",
        security: { profile: security.profile },
        basicAuthPassword: passwordOf(security),
        description: definition.description,
      });
    },
    async get(cpId) {
      const stored = store.get(cpId);
      if (stored === undefined) return null;
      const { basicAuthPassword: _password, ...details } = stored;
      return details;
    },
    async update(cpId, patch) {
      if (patch.security) refuseUnaccepted("update", patch.security.profile);
      const stored = store.get(cpId);
      if (stored === undefined) throw new ChargePointNotFoundError(cpId);
      store.set(cpId, {
        id: cpId,
        registration: patch.registration ?? stored.registration,
        // `security` replaces the whole block, so a new profile drops the old password.
        security: patch.security ? { profile: patch.security.profile } : stored.security,
        basicAuthPassword: patch.security ? passwordOf(patch.security) : stored.basicAuthPassword,
        description: patch.description === null ? undefined : patch.description ?? stored.description,
      });
    },
    async delete(cpId) {
      store.delete(cpId);
    },
  };
}

interface Reference {
  /** The conforming admin. */
  readonly strict: CsmsChargePointAdmin;
  /** The same store, accepting every profile whatever the declaration says. */
  readonly lax: CsmsChargePointAdmin;
  readonly store: Store;
  readonly declared: ReadonlySet<ChargePointSecurityProfile>;
}

/** One rule broken, and the rule the copy must be refused FOR -- a copy
 *  refused for some other reason would leave its own rule unguarded. Runs
 *  under `declares`, or `DECLARED_PROFILES`. */
type FlawCase = {
  readonly refusedFor: Rule;
  readonly declares?: readonly ChargePointSecurityProfile[];
} & (
  | { readonly admin: (reference: Reference) => Partial<CsmsChargePointAdmin> }
  | { readonly driver: (driver: CsmsDriver) => CsmsDriver }
);

/** A flaw that rewrites what `create` is handed. */
const defining = (rewrite: (definition: ChargePointDefinition) => ChargePointDefinition) =>
  ({ strict }: Reference): Partial<CsmsChargePointAdmin> => ({ create: (definition) => strict.create(rewrite(definition)) });
/** A flaw that rewrites what `update` is handed. */
const patching = (rewrite: (patch: ChargePointUpdate) => ChargePointUpdate) =>
  ({ strict }: Reference): Partial<CsmsChargePointAdmin> => ({ update: (cpId, patch) => strict.update(cpId, rewrite(patch)) });
/** A flaw that applies the call anyway after refusing it. */
const appliesAnyway = <A extends unknown[]>(strict: (...args: A) => Promise<void>, lax: (...args: A) => Promise<void>) =>
  async (...args: A): Promise<void> => {
    try {
      await strict(...args);
    } catch (error) {
      await lax(...args);
      throw error;
    }
  };
/** A flaw whose duplicate `create` rewrites one member before refusing. */
const rewritesOnDuplicate = (pick: (definition: ChargePointDefinition) => ChargePointUpdate) =>
  ({ strict }: Reference): Partial<CsmsChargePointAdmin> => ({
    create: async (definition) => {
      if ((await strict.get(definition.id)) !== null) {
        await strict.update(definition.id, pick(definition));
        throw new ChargePointAlreadyExistsError(definition.id);
      }
      await strict.create(definition);
    },
  });
/** A flaw whose refused `update` applies one member of its patch first. */
const appliesBeforeRefusing = (pick: (patch: ChargePointUpdate) => ChargePointUpdate) =>
  ({ strict, lax, declared }: Reference): Partial<CsmsChargePointAdmin> => ({
    update: async (cpId, patch) => {
      if (patch.security && !declared.has(patch.security.profile)) await lax.update(cpId, pick(patch));
      await strict.update(cpId, patch);
    },
  });

function memoryDriver(flaw?: FlawCase, declares: readonly ChargePointSecurityProfile[] = DECLARED_PROFILES): CsmsDriver {
  const store: Store = new Map();
  const declared = new Set(flaw?.declares ?? declares);
  const reference: Reference = {
    strict: memoryAdmin(store, declared),
    lax: memoryAdmin(store, new Set(ALL_PROFILES)),
    store,
    declared,
  };
  const driver: CsmsDriver = {
    capabilities: { operations16: new Set(), chargePoints: { securityProfiles: declared } },
    operations16: { execute: async () => "" },
    chargePoints: { ...reference.strict, ...(flaw && "admin" in flaw ? flaw.admin(reference) : {}) },
  };
  return flaw && "driver" in flaw ? flaw.driver(driver) : driver;
}

const FLAWS: Readonly<Record<string, FlawCase>> = {
  // Part 1.
  "declared-without-surface": {
    refusedFor: RULE.declaredWhenImplemented,
    driver: ({ chargePoints: _surface, ...driver }) => driver,
  },
  "surface-without-declaration": {
    refusedFor: RULE.declaredWhenImplemented,
    driver: (driver) => ({ ...driver, capabilities: { operations16: driver.capabilities.operations16 } }),
  },
  "no-declared-profile": {
    refusedFor: RULE.declaresAProfile,
    driver: (driver) => ({
      ...driver,
      capabilities: { ...driver.capabilities, chargePoints: { securityProfiles: new Set() } },
    }),
  },
  // Part 2.
  "get-missing-not-null": {
    refusedFor: RULE.getMissingIsNull,
    admin: ({ strict }) => ({
      get: async (cpId) => (await strict.get(cpId)) ?? { id: cpId, registration: "Accepted", security: { profile: 0 } },
    }),
  },
  "create-drops-description": {
    refusedFor: RULE.createStores,
    admin: defining(({ description: _description, ...definition }) => definition),
  },
  "read-back-vendor-id": {
    refusedFor: RULE.readBackKeepsId,
    admin: ({ strict }) => ({
      get: async (cpId) => {
        const details = await strict.get(cpId);
        return details && { ...details, id: `vendor:${details.id}` };
      },
    }),
  },
  "create-overwrites": {
    refusedFor: RULE.createExistingThrows,
    admin: ({ strict }) => ({
      create: async (definition) => {
        await strict.delete(definition.id);
        await strict.create(definition);
      },
    }),
  },
  "duplicate-create-rewrites-registration": {
    refusedFor: RULE.createExistingChangesNothing,
    admin: rewritesOnDuplicate((definition) => ({ registration: definition.registration })),
  },
  "duplicate-create-rewrites-description": {
    refusedFor: RULE.createExistingChangesNothing,
    admin: rewritesOnDuplicate((definition) => ({ description: definition.description })),
  },
  "duplicate-create-rewrites-security": {
    refusedFor: RULE.createExistingChangesNothing,
    admin: rewritesOnDuplicate((definition) => ({ security: definition.security })),
  },
  "update-missing-creates": {
    refusedFor: RULE.updateMissingThrows,
    admin: ({ strict }) => ({
      update: async (cpId, patch) => {
        if ((await strict.get(cpId)) === null) await strict.create({ id: cpId });
        await strict.update(cpId, patch);
      },
    }),
  },
  "update-missing-creates-then-throws": {
    refusedFor: RULE.updateMissingCreatesNothing,
    admin: ({ strict }) => ({
      update: async (cpId, patch) => {
        if ((await strict.get(cpId)) === null) {
          await strict.create({ id: cpId });
          throw new ChargePointNotFoundError(cpId);
        }
        await strict.update(cpId, patch);
      },
    }),
  },
  "delete-keeps": {
    refusedFor: RULE.deleteRemoves,
    admin: () => ({ delete: async () => {} }),
  },
  "delete-missing-throws": {
    refusedFor: RULE.deleteMissingResolves,
    admin: ({ strict }) => ({
      delete: async (cpId) => {
        if ((await strict.get(cpId)) === null) throw new ChargePointNotFoundError(cpId);
        await strict.delete(cpId);
      },
    }),
  },
  // Part 3. The registration default is caught on a declaration WITHOUT
  // profile 0, which is the case a check nested under it used to skip.
  "default-registration-pending": {
    refusedFor: RULE.defaultRegistration,
    declares: [1],
    admin: defining((definition) => ({ registration: "Pending", ...definition })),
  },
  "default-security-not-0": {
    refusedFor: RULE.defaultSecurity,
    admin: defining((definition) => ({ security: securityFor(1), ...definition })),
  },
  "omitted-security-accepted-without-0": {
    refusedFor: RULE.omittedSecurityNeedsProfile0,
    declares: [1],
    admin: ({ strict, lax }) => ({
      create: (definition) => (definition.security ? strict : lax).create(definition),
    }),
  },
  "omitted-security-refused-but-stored": {
    refusedFor: RULE.refusedDefaultStoresNothing,
    declares: [1],
    admin: ({ strict, lax }) => ({
      create: (definition) =>
        definition.security ? strict.create(definition) : appliesAnyway(strict.create, lax.create)(definition),
    }),
  },
  "update-ignores-registration": {
    refusedFor: RULE.updateAppliesRegistration,
    admin: patching(({ registration: _registration, ...patch }) => patch),
  },
  "registration-update-changes-security": {
    refusedFor: RULE.updateKeepsUnnamed,
    admin: patching((patch) => (patch.registration ? { ...patch, security: { profile: 0 } } : patch)),
  },
  "update-clears-unnamed-description": {
    refusedFor: RULE.updateKeepsUnnamed,
    admin: patching((patch) => ({ ...patch, description: patch.description ?? null })),
  },
  "update-ignores-description": {
    refusedFor: RULE.updateAppliesDescription,
    admin: patching((patch) => (typeof patch.description === "string" ? { ...patch, description: undefined } : patch)),
  },
  "null-description-kept": {
    refusedFor: RULE.nullDescriptionClears,
    admin: patching((patch) => (patch.description === null ? { ...patch, description: undefined } : patch)),
  },
  "update-ignores-security": {
    refusedFor: RULE.updateAppliesSecurity,
    admin: patching(({ security: _security, ...patch }) => patch),
  },
  "security-update-resets-registration": {
    refusedFor: RULE.securityUpdateKeepsUnnamed,
    admin: patching((patch) => (patch.security ? { ...patch, registration: "Accepted" } : patch)),
  },
  // On a single-profile declaration, the case a check nested under a second
  // profile used to skip.
  "refuses-same-profile-security-update": {
    refusedFor: RULE.declaredSecurityUpdateResolves,
    declares: [1],
    admin: ({ strict }) => ({
      update: async (cpId, patch) => {
        const current = await strict.get(cpId);
        if (patch.security && patch.security.profile === current?.security.profile) {
          throw new UnsupportedOperationError("chargePoints.update", "security is already set");
        }
        await strict.update(cpId, patch);
      },
    }),
  },
  "security-update-clears-description": {
    refusedFor: RULE.securityUpdateKeepsUnnamed,
    admin: patching((patch) => (patch.security ? { ...patch, description: null } : patch)),
  },
  "password-read-back": {
    refusedFor: RULE.passwordWriteOnly,
    admin: ({ store }) => ({ get: async (cpId) => store.get(cpId) ?? null }),
  },
  "password-read-back-masked": {
    refusedFor: RULE.passwordWriteOnly,
    admin: ({ strict }) => ({
      get: async (cpId) => {
        const details = await strict.get(cpId);
        return details && ({ ...details, security: { ...details.security, basicAuthPassword: "***" } } as ChargePointDetails);
      },
    }),
  },
  // Part 4.
  "create-accepts-undeclared": {
    refusedFor: RULE.createRefusesUndeclared,
    admin: ({ lax }) => ({ create: lax.create }),
  },
  "refused-create-stores": {
    refusedFor: RULE.refusedCreateStoresNothing,
    admin: ({ strict, lax }) => ({ create: appliesAnyway(strict.create, lax.create) }),
  },
  "update-accepts-undeclared": {
    refusedFor: RULE.updateRefusesUndeclared,
    admin: ({ lax }) => ({ update: lax.update }),
  },
  "refused-update-applies-registration": {
    refusedFor: RULE.refusedUpdateChangesNothing,
    admin: appliesBeforeRefusing((patch) => ({ registration: patch.registration })),
  },
  "refused-update-applies-description": {
    refusedFor: RULE.refusedUpdateChangesNothing,
    admin: appliesBeforeRefusing((patch) => ({ description: patch.description })),
  },
  "refused-update-applies-security": {
    refusedFor: RULE.refusedUpdateChangesNothing,
    admin: appliesBeforeRefusing((patch) => ({ security: patch.security })),
  },
};

// The reference conforms under every shape of declaration the checks branch
// on: with and without profile 0, with and without a second profile, with and
// without an undeclared one.
const REFERENCE_DECLARATIONS: readonly (readonly ChargePointSecurityProfile[])[] = [
  DECLARED_PROFILES,
  [1],
  [0],
  ALL_PROFILES,
];
for (const declares of REFERENCE_DECLARATIONS) {
  const violations = await chargePointAdminViolations(memoryDriver(undefined, declares));
  check(
    violations.length === 0,
    `the reference driver conforms declaring profiles ${declares.join(",")} (violations: ${violations.join("; ")})`,
  );
}
const covered = new Set<string>(Object.values(FLAWS).map((flaw) => flaw.refusedFor));
for (const rule of Object.values(RULE)) {
  check(covered.has(rule), `the rule "${rule}" has a flawed copy that breaks it`);
}
for (const [name, flaw] of Object.entries(FLAWS)) {
  const violations = await chargePointAdminViolations(memoryDriver(flaw));
  check(
    violations.includes(flaw.refusedFor),
    `a driver with the flaw "${name}" is refused for "${flaw.refusedFor}" (got: ${violations.join("; ") || "nothing"})`,
  );
}

// The bundled factories do not opt in yet: no declaration, no surface.
const fetch: FetchLike = async () => new Response("unexpected request", { status: 500 });
const bundled: Record<string, CsmsDriver> = {
  steve: createSteveCsmsDriver({
    config: { baseUrl: "http://steve/manager", username: "operator", password: "secret" },
    fetch,
  }),
  citrineos: createCitrineOsCsmsDriver({
    config: { variant: "v2", apiUrl: "http://citrine/api", tenantId: 1 },
    refs: { ocppTransactionId: async () => 1 },
    fetch,
  }),
};
for (const [name, driver] of Object.entries(bundled)) {
  const violations = await chargePointAdminViolations(driver);
  check(violations.length === 0, `the ${name} factory's declaration matches its surface (${violations.join("; ")})`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Charge-point administration: the reference driver conforms under ${REFERENCE_DECLARATIONS.length} declarations, ` +
      `and each of its ${Object.values(RULE).length} rules has a flawed copy refused for it ` +
      `(${Object.keys(FLAWS).length} copies); the bundled factories declare what they implement.`,
  );
}
