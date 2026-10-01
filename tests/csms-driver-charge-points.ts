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
 *     what it is given; `create` of an existing id throws
 *     `ChargePointAlreadyExistsError` and changes nothing; `update` of a
 *     missing id throws `ChargePointNotFoundError` and creates nothing;
 *     `delete` removes, and of a missing id resolves.
 *  3. DEFAULTS, UPDATES, READ-BACK. An omitted registration reads back
 *     `Accepted` and omitted security profile 0; an update applies each member
 *     it names -- registration, description, security -- and leaves the
 *     others alone; a `description: null` clears; the Basic Auth password is
 *     never read back.
 *  4. THE DECLARATION BINDS. A security profile outside
 *     `capabilities.chargePoints.securityProfiles` is refused with
 *     `UnsupportedOperationError` by `create` and by `update`, and the refused
 *     call changes nothing.
 *  5. NONE OF THE ABOVE IS VACUOUS. A reference driver passes, and for every
 *     entry of `RULE` a copy of it breaking that rule alone is refused FOR
 *     that rule. The bundled factories, which do not opt in yet, satisfy part
 *     1 by absence.
 *
 * WHAT IT CANNOT CHECK: that a `security` update to profile 0 or 3 discards
 * the stored password, as the contract says. The password is never read back,
 * so no conforming driver can show it either way; the reference does it, and
 * #157's live run is where a station connecting with the old password would
 * be refused.
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
  createExistingThrows: "create of an existing id throws ChargePointAlreadyExistsError",
  createExistingChangesNothing: "create of an existing id leaves the station unchanged",
  updateAppliesRegistration: "update applies the registration it names",
  updateKeepsUnnamed: "update leaves the members it does not name unchanged",
  updateAppliesDescription: "update applies the description it names",
  nullDescriptionClears: "a description of null clears it",
  updateAppliesSecurity: "update applies the security it names",
  securityUpdateKeepsUnnamed: "a security update leaves the members it does not name unchanged",
  updateMissingThrows: "update of a missing id throws ChargePointNotFoundError",
  updateMissingCreatesNothing: "update of a missing id creates nothing",
  deleteRemoves: "delete removes the station",
  deleteMissingResolves: "delete of a missing id resolves",
  defaultRegistration: "an omitted registration reads back Accepted",
  defaultSecurity: "omitted security reads back profile 0",
  passwordWriteOnly: "the Basic Auth password is never read back",
  createRefusesUndeclared: "create with an undeclared security profile throws UnsupportedOperationError",
  refusedCreateStoresNothing: "a refused create stores nothing",
  updateRefusesUndeclared: "update to an undeclared security profile throws UnsupportedOperationError",
  refusedUpdateChangesNothing: "a refused update changes nothing",
} as const;
type Rule = (typeof RULE)[keyof typeof RULE];

const ALL_PROFILES: readonly ChargePointSecurityProfile[] = [0, 1, 2, 3];
const DECLARED_PROFILES: ReadonlySet<ChargePointSecurityProfile> = new Set([0, 1]);

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
  // Part 2, on a profile the driver declares.
  const [profile, otherProfile] = [...profiles];
  if (profile === undefined) return;
  const station: ChargePointDefinition = {
    id: "CONFORMANCE-1",
    registration: "Rejected",
    security: securityFor(profile),
    description: "first",
  };
  expect(await admin.get(station.id) === null, RULE.getMissingIsNull);
  await admin.create(station);
  const created = await admin.get(station.id);
  expect(
    created?.registration === "Rejected" && created.security.profile === profile && created.description === "first",
    RULE.createStores,
  );
  expect(
    await rejectsWith(() => admin.create({ ...station, description: "second" }), ChargePointAlreadyExistsError),
    RULE.createExistingThrows,
  );
  expect((await admin.get(station.id))?.description === "first", RULE.createExistingChangesNothing);

  // Part 3: an update applies what it names and nothing else.
  await admin.update(station.id, { registration: "Pending" });
  let read = await admin.get(station.id);
  expect(read?.registration === "Pending", RULE.updateAppliesRegistration);
  expect(read?.description === "first" && read.security.profile === profile, RULE.updateKeepsUnnamed);
  await admin.update(station.id, { description: "second" });
  expect((await admin.get(station.id))?.description === "second", RULE.updateAppliesDescription);
  await admin.update(station.id, { description: null });
  read = await admin.get(station.id);
  expect(read !== null && read.description === undefined, RULE.nullDescriptionClears);
  if (otherProfile !== undefined) {
    await admin.update(station.id, { security: securityFor(otherProfile) });
    read = await admin.get(station.id);
    expect(read?.security.profile === otherProfile, RULE.updateAppliesSecurity);
    expect(read?.registration === "Pending", RULE.securityUpdateKeepsUnnamed);
  }

  expect(
    await rejectsWith(() => admin.update("CONFORMANCE-MISSING", { registration: "Accepted" }), ChargePointNotFoundError),
    RULE.updateMissingThrows,
  );
  expect(await admin.get("CONFORMANCE-MISSING") === null, RULE.updateMissingCreatesNothing);

  await admin.delete(station.id);
  expect(await admin.get(station.id) === null, RULE.deleteRemoves);
  expect(await admin.delete(station.id).then(() => true, () => false), RULE.deleteMissingResolves);

  // Part 3, defaults -- where the default profile is one the driver declares.
  if (profiles.has(0)) {
    await admin.create({ id: "CONFORMANCE-2" });
    const defaults = await admin.get("CONFORMANCE-2");
    expect(defaults?.registration === "Accepted", RULE.defaultRegistration);
    expect(defaults?.security.profile === 0, RULE.defaultSecurity);
    await admin.delete("CONFORMANCE-2");
  }

  // Part 3, the password is write-only wherever a profile carries one.
  const basicAuth = ([1, 2] as const).find((candidate) => profiles.has(candidate));
  if (basicAuth !== undefined) {
    await admin.create({ id: "CONFORMANCE-3", security: securityFor(basicAuth) });
    const details = await admin.get("CONFORMANCE-3");
    expect(details !== null && !JSON.stringify(details).includes("conformance-secret"), RULE.passwordWriteOnly);
    await admin.delete("CONFORMANCE-3");
  }

  // Part 4: an undeclared profile is refused, and the refusal changes nothing.
  const undeclared = ALL_PROFILES.find((candidate) => !profiles.has(candidate));
  if (undeclared !== undefined) {
    expect(
      await rejectsWith(() => admin.create({ id: "CONFORMANCE-4", security: securityFor(undeclared) }), UnsupportedOperationError),
      RULE.createRefusesUndeclared,
    );
    expect(await admin.get("CONFORMANCE-4") === null, RULE.refusedCreateStoresNothing);
    await admin.delete("CONFORMANCE-4");
    await admin.create({ id: "CONFORMANCE-5", security: securityFor(profile) });
    expect(
      await rejectsWith(() => admin.update("CONFORMANCE-5", { security: securityFor(undeclared) }), UnsupportedOperationError),
      RULE.updateRefusesUndeclared,
    );
    expect((await admin.get("CONFORMANCE-5"))?.security.profile === profile, RULE.refusedUpdateChangesNothing);
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
}

/** One rule broken, and the rule the copy must be refused FOR -- a copy
 *  refused for some other reason would leave its own rule unguarded. */
type FlawCase = { readonly refusedFor: Rule } & (
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

function memoryDriver(flaw?: FlawCase): CsmsDriver {
  const store: Store = new Map();
  const reference: Reference = {
    strict: memoryAdmin(store, DECLARED_PROFILES),
    lax: memoryAdmin(store, new Set(ALL_PROFILES)),
    store,
  };
  const driver: CsmsDriver = {
    capabilities: { operations16: new Set(), chargePoints: { securityProfiles: DECLARED_PROFILES } },
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
  "create-overwrites": {
    refusedFor: RULE.createExistingThrows,
    admin: ({ strict }) => ({
      create: async (definition) => {
        await strict.delete(definition.id);
        await strict.create(definition);
      },
    }),
  },
  "create-existing-overwrites-then-throws": {
    refusedFor: RULE.createExistingChangesNothing,
    admin: ({ strict }) => ({
      create: async (definition) => {
        const existed = (await strict.get(definition.id)) !== null;
        await strict.delete(definition.id);
        await strict.create(definition);
        if (existed) throw new ChargePointAlreadyExistsError(definition.id);
      },
    }),
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
  // Part 3.
  "default-registration-pending": {
    refusedFor: RULE.defaultRegistration,
    admin: defining((definition) => ({ registration: "Pending", ...definition })),
  },
  "default-security-not-0": {
    refusedFor: RULE.defaultSecurity,
    admin: defining((definition) => ({ security: securityFor(1), ...definition })),
  },
  "update-ignores-registration": {
    refusedFor: RULE.updateAppliesRegistration,
    admin: patching(({ registration: _registration, ...patch }) => patch),
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
  "password-read-back": {
    refusedFor: RULE.passwordWriteOnly,
    admin: ({ store }) => ({ get: async (cpId) => store.get(cpId) ?? null }),
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
  "refused-update-changes": {
    refusedFor: RULE.refusedUpdateChangesNothing,
    admin: ({ strict, lax }) => ({ update: appliesAnyway(strict.update, lax.update) }),
  },
};

const reference = await chargePointAdminViolations(memoryDriver());
check(reference.length === 0, `the reference driver conforms (violations: ${reference.join("; ")})`);
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
    `Charge-point administration: the reference driver conforms, and each of its ${Object.values(RULE).length} ` +
      `rules has a flawed copy refused for it (${Object.keys(FLAWS).length} copies); the bundled factories declare ` +
      "what they implement.",
  );
}
