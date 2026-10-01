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
 *     rule above a copy of it breaking that rule alone is refused FOR that
 *     rule. The bundled factories, which do not opt in yet, satisfy part 1 by
 *     absence.
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
  type CsmsChargePointAdmin,
  type CsmsDriver,
} from "open-ocpp-tck/csms-driver";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function rejectsWith(
  action: () => Promise<unknown>,
  type: abstract new (...args: never[]) => Error,
): Promise<boolean> {
  try {
    await action();
    return false;
  } catch (error) {
    return error instanceof type;
  }
}

function securityFor(profile: ChargePointSecurityProfile): ChargePointSecurity {
  return profile === 1 || profile === 2
    ? { profile, basicAuthPassword: "conformance-secret" }
    : { profile };
}

/** Every rule `chargePointAdminViolations` has asked about, so part 5 can
 *  require a flaw for each one rather than for the ones someone remembered. */
const RULES_ASKED = new Set<string>();

/** Every way `driver` departs from the contract; empty when it conforms. */
async function chargePointAdminViolations(driver: CsmsDriver): Promise<string[]> {
  const violations: string[] = [];
  const expect = (condition: boolean, message: string): void => {
    RULES_ASKED.add(message);
    if (!condition) violations.push(message);
  };

  const declared = driver.capabilities.chargePoints;
  const admin = driver.chargePoints;
  expect((declared === undefined) === (admin === undefined),
    "capabilities.chargePoints is declared exactly when chargePoints is implemented");
  if (declared === undefined || admin === undefined) return violations;
  const profiles = declared.securityProfiles;
  expect(profiles.size > 0, "a declared admin surface names at least one security profile");
  if (profiles.size === 0) return violations;

  // A driver that throws where the contract says it resolves is a violation
  // to report, not a crash of the guard.
  try {
    await exerciseLifecycle(admin, profiles, expect);
  } catch (error) {
    violations.push(`the lifecycle threw unexpectedly: ${String(error)}`);
  }
  return violations;
}

async function exerciseLifecycle(
  admin: CsmsChargePointAdmin,
  profiles: ReadonlySet<ChargePointSecurityProfile>,
  expect: (condition: boolean, message: string) => void,
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
  expect(await admin.get(station.id) === null, "get of a missing id is null");
  await admin.create(station);
  const created = await admin.get(station.id);
  expect(
    created?.registration === "Rejected" && created.security.profile === profile && created.description === "first",
    "create stores the registration, security profile and description it is given",
  );
  expect(
    await rejectsWith(() => admin.create({ ...station, description: "second" }), ChargePointAlreadyExistsError),
    "create of an existing id throws ChargePointAlreadyExistsError",
  );
  expect((await admin.get(station.id))?.description === "first",
    "create of an existing id leaves the station unchanged");

  // Part 3: an update applies what it names and nothing else.
  await admin.update(station.id, { registration: "Pending" });
  let read = await admin.get(station.id);
  expect(read?.registration === "Pending", "update applies the registration it names");
  expect(read?.description === "first" && read.security.profile === profile,
    "update leaves the members it does not name unchanged");
  await admin.update(station.id, { description: "second" });
  read = await admin.get(station.id);
  expect(read?.description === "second", "update applies the description it names");
  await admin.update(station.id, { description: null });
  read = await admin.get(station.id);
  expect(read !== null && read.description === undefined, "a description of null clears it");
  if (otherProfile !== undefined) {
    await admin.update(station.id, { security: securityFor(otherProfile) });
    read = await admin.get(station.id);
    expect(read?.security.profile === otherProfile, "update applies the security it names");
    expect(read?.registration === "Pending", "update leaves the members it does not name unchanged");
  }

  expect(
    await rejectsWith(() => admin.update("CONFORMANCE-MISSING", { registration: "Accepted" }), ChargePointNotFoundError),
    "update of a missing id throws ChargePointNotFoundError",
  );
  expect(await admin.get("CONFORMANCE-MISSING") === null, "update of a missing id creates nothing");

  await admin.delete(station.id);
  expect(await admin.get(station.id) === null, "delete removes the station");
  expect(!(await rejectsWith(() => admin.delete(station.id), Error)), "delete of a missing id resolves");

  // Part 3, defaults -- where the default profile is one the driver declares.
  if (profiles.has(0)) {
    await admin.create({ id: "CONFORMANCE-2" });
    const defaults = await admin.get("CONFORMANCE-2");
    expect(defaults?.registration === "Accepted", "an omitted registration reads back Accepted");
    expect(defaults?.security.profile === 0, "omitted security reads back profile 0");
    await admin.delete("CONFORMANCE-2");
  }

  // Part 3, the password is write-only wherever a profile carries one.
  const basicAuth = ([1, 2] as const).find((candidate) => profiles.has(candidate));
  if (basicAuth !== undefined) {
    await admin.create({ id: "CONFORMANCE-3", security: securityFor(basicAuth) });
    const details = await admin.get("CONFORMANCE-3");
    expect(details !== null && !JSON.stringify(details).includes("conformance-secret"),
      "the Basic Auth password is never read back");
    await admin.delete("CONFORMANCE-3");
  }

  // Part 4: an undeclared profile is refused, and the refusal changes nothing.
  const undeclared = ([0, 1, 2, 3] as const).find((candidate) => !profiles.has(candidate));
  if (undeclared !== undefined) {
    expect(
      await rejectsWith(() => admin.create({ id: "CONFORMANCE-4", security: securityFor(undeclared) }), UnsupportedOperationError),
      "create with an undeclared security profile throws UnsupportedOperationError",
    );
    expect(await admin.get("CONFORMANCE-4") === null, "a refused create stores nothing");
    await admin.delete("CONFORMANCE-4");
    await admin.create({ id: "CONFORMANCE-5", security: securityFor(profile) });
    expect(
      await rejectsWith(() => admin.update("CONFORMANCE-5", { security: securityFor(undeclared) }), UnsupportedOperationError),
      "update to an undeclared security profile throws UnsupportedOperationError",
    );
    expect((await admin.get("CONFORMANCE-5"))?.security.profile === profile, "a refused update changes nothing");
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

const DECLARED_PROFILES: ReadonlySet<ChargePointSecurityProfile> = new Set([0, 1]);
const ALL_PROFILES: ReadonlySet<ChargePointSecurityProfile> = new Set([0, 1, 2, 3]);

/** The contract, over a map. `accepts` is what it refuses outside of. */
function memoryAdmin(store: Store, accepts: ReadonlySet<ChargePointSecurityProfile>): CsmsChargePointAdmin {
  const refuseUnaccepted = (method: string, profile: ChargePointSecurityProfile): void => {
    if (!accepts.has(profile)) {
      throw new UnsupportedOperationError(`chargePoints.${method}`, `security profile ${profile} is not supported`);
    }
  };
  const passwordOf = (security: ChargePointSecurity): string | undefined =>
    "basicAuthPassword" in security ? security.basicAuthPassword : undefined;
  const save = (id: string, fields: Omit<StoredChargePoint, "id">): void => {
    const { description, basicAuthPassword, ...rest } = fields;
    store.set(id, {
      id,
      ...rest,
      ...(description !== undefined ? { description } : {}),
      ...(basicAuthPassword !== undefined ? { basicAuthPassword } : {}),
    });
  };

  return {
    async create(definition) {
      const security = definition.security ?? { profile: 0 };
      refuseUnaccepted("create", security.profile);
      if (store.has(definition.id)) throw new ChargePointAlreadyExistsError(definition.id);
      save(definition.id, {
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
      save(cpId, {
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

interface FlawCase {
  /** The violation the flawed copy must be refused FOR -- a copy refused for
   *  some other reason would leave its own rule unguarded. */
  readonly refusedFor: string;
  readonly admin?: (reference: Reference) => Partial<CsmsChargePointAdmin>;
  readonly driver?: (driver: CsmsDriver) => CsmsDriver;
}

function memoryDriver(flaw?: FlawCase): CsmsDriver {
  const store: Store = new Map();
  const reference: Reference = {
    strict: memoryAdmin(store, DECLARED_PROFILES),
    lax: memoryAdmin(store, ALL_PROFILES),
    store,
  };
  const driver: CsmsDriver = {
    capabilities: { operations16: new Set(), chargePoints: { securityProfiles: DECLARED_PROFILES } },
    operations16: { execute: async () => "" },
    chargePoints: { ...reference.strict, ...flaw?.admin?.(reference) },
  };
  return flaw?.driver ? flaw.driver(driver) : driver;
}

const FLAWS: Readonly<Record<string, FlawCase>> = {
  // Part 1.
  "declared-without-surface": {
    refusedFor: "capabilities.chargePoints is declared exactly when chargePoints is implemented",
    driver: ({ chargePoints: _surface, ...driver }) => driver,
  },
  "surface-without-declaration": {
    refusedFor: "capabilities.chargePoints is declared exactly when chargePoints is implemented",
    driver: (driver) => ({ ...driver, capabilities: { operations16: driver.capabilities.operations16 } }),
  },
  "no-declared-profile": {
    refusedFor: "a declared admin surface names at least one security profile",
    driver: (driver) => ({
      ...driver,
      capabilities: { ...driver.capabilities, chargePoints: { securityProfiles: new Set() } },
    }),
  },
  // Part 2.
  "get-missing-not-null": {
    refusedFor: "get of a missing id is null",
    admin: ({ strict }) => ({
      get: async (cpId) => (await strict.get(cpId)) ?? { id: cpId, registration: "Accepted", security: { profile: 0 } },
    }),
  },
  "create-drops-description": {
    refusedFor: "create stores the registration, security profile and description it is given",
    admin: ({ strict }) => ({ create: ({ description: _description, ...definition }) => strict.create(definition) }),
  },
  "create-overwrites": {
    refusedFor: "create of an existing id throws ChargePointAlreadyExistsError",
    admin: ({ strict }) => ({
      create: async (definition) => {
        await strict.delete(definition.id);
        await strict.create(definition);
      },
    }),
  },
  "create-existing-overwrites-then-throws": {
    refusedFor: "create of an existing id leaves the station unchanged",
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
    refusedFor: "update of a missing id throws ChargePointNotFoundError",
    admin: ({ strict }) => ({
      update: async (cpId, patch) => {
        if ((await strict.get(cpId)) === null) await strict.create({ id: cpId });
        await strict.update(cpId, patch);
      },
    }),
  },
  "update-missing-creates-then-throws": {
    refusedFor: "update of a missing id creates nothing",
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
    refusedFor: "delete removes the station",
    admin: () => ({ delete: async () => {} }),
  },
  "delete-missing-throws": {
    refusedFor: "delete of a missing id resolves",
    admin: ({ strict }) => ({
      delete: async (cpId) => {
        if ((await strict.get(cpId)) === null) throw new ChargePointNotFoundError(cpId);
        await strict.delete(cpId);
      },
    }),
  },
  // Part 3.
  "default-registration-pending": {
    refusedFor: "an omitted registration reads back Accepted",
    admin: ({ strict }) => ({ create: (definition) => strict.create({ registration: "Pending", ...definition }) }),
  },
  "default-security-not-0": {
    refusedFor: "omitted security reads back profile 0",
    admin: ({ strict }) => ({ create: (definition) => strict.create({ security: securityFor(1), ...definition }) }),
  },
  "update-ignores-registration": {
    refusedFor: "update applies the registration it names",
    admin: ({ strict }) => ({ update: (cpId, { registration: _registration, ...patch }) => strict.update(cpId, patch) }),
  },
  "update-ignores-description": {
    refusedFor: "update applies the description it names",
    admin: ({ strict }) => ({
      update: (cpId, patch) =>
        strict.update(cpId, typeof patch.description === "string" ? { ...patch, description: undefined } : patch),
    }),
  },
  "update-ignores-security": {
    refusedFor: "update applies the security it names",
    admin: ({ strict }) => ({ update: (cpId, { security: _security, ...patch }) => strict.update(cpId, patch) }),
  },
  "update-clears-unnamed-description": {
    refusedFor: "update leaves the members it does not name unchanged",
    admin: ({ strict }) => ({
      update: (cpId, patch) => strict.update(cpId, { ...patch, description: patch.description ?? null }),
    }),
  },
  "null-description-kept": {
    refusedFor: "a description of null clears it",
    admin: ({ strict }) => ({
      update: (cpId, patch) =>
        strict.update(cpId, patch.description === null ? { ...patch, description: undefined } : patch),
    }),
  },
  "password-read-back": {
    refusedFor: "the Basic Auth password is never read back",
    admin: ({ store }) => ({ get: async (cpId) => store.get(cpId) ?? null }),
  },
  // Part 4.
  "create-accepts-undeclared": {
    refusedFor: "create with an undeclared security profile throws UnsupportedOperationError",
    admin: ({ lax }) => ({ create: lax.create }),
  },
  "refused-create-stores": {
    refusedFor: "a refused create stores nothing",
    admin: ({ strict, lax }) => ({
      create: async (definition) => {
        try {
          await strict.create(definition);
        } catch (error) {
          await lax.create(definition);
          throw error;
        }
      },
    }),
  },
  "update-accepts-undeclared": {
    refusedFor: "update to an undeclared security profile throws UnsupportedOperationError",
    admin: ({ lax }) => ({ update: lax.update }),
  },
  "refused-update-changes": {
    refusedFor: "a refused update changes nothing",
    admin: ({ strict, lax }) => ({
      update: async (cpId, patch) => {
        try {
          await strict.update(cpId, patch);
        } catch (error) {
          await lax.update(cpId, patch);
          throw error;
        }
      },
    }),
  },
};

const reference = await chargePointAdminViolations(memoryDriver());
check(reference.length === 0, `the reference driver conforms (violations: ${reference.join("; ")})`);
const refusedFor = new Set(Object.values(FLAWS).map((flaw) => flaw.refusedFor));
for (const rule of RULES_ASKED) {
  check(refusedFor.has(rule), `the rule "${rule}" has a flawed copy that breaks it`);
}
for (const [name, flaw] of Object.entries(FLAWS)) {
  const violations = await chargePointAdminViolations(memoryDriver(flaw));
  check(
    violations.includes(flaw.refusedFor),
    `a driver with the flaw "${name}" is refused for "${flaw.refusedFor}" (got: ${violations.join("; ") || "nothing"})`,
  );
}

// The bundled factories do not opt in yet: no declaration, no surface.
const fetch = async (): Promise<Response> => new Response("unexpected request", { status: 500 });
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
    `Charge-point administration: the reference driver conforms, ${Object.keys(FLAWS).length} flawed copies ` +
      "are each refused for their own rule, the bundled factories declare what they implement.",
  );
}
