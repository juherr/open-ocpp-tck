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
 * `CsmsDriver`. It lives in tests/lib/charge-point-conformance.ts because a
 * live caller cannot import this file, which runs on import:
 * `tools/steve-charge-points.ts` asks it of the pinned SteVe.
 *
 * PROPERTY, in 6 parts:
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
 *     rule alone is refused FOR that rule. Of the bundled factories, SteVe
 *     conforms behind tests/fixtures/fake-steve-manager.ts, and CitrineOS,
 *     which does not opt in yet, satisfies part 1 by absence.
 *  6. STEVE KEEPS WHAT THE CONTRACT PROMISES, where the generic surface cannot
 *     see it (#155). A `security` update to profile 0 or 3 discards the
 *     stored password -- and the password is never read back, so no driver
 *     can show that through the surface. SteVe reads an empty password field
 *     as "unchanged" and has no way to clear one, so the rows assert on the
 *     POSTED BODY: a downgrade posts a password SteVe accepts, a new one each
 *     time, and an operator switching the station back to profile 1 without
 *     typing one does not revive the old one. A control row shows the fake
 *     DOES keep a password an empty field leaves alone, which is what the
 *     rows stand on. The rest of the adapter's claims are rows too: a
 *     refusal SteVe renders is a plain `Error` carrying its error text and
 *     never the posted password, which the re-rendered form echoes; a
 *     duplicate is refused before anything is posted, and still reads as one
 *     when a concurrent create wins the race past that check; a POST bounced
 *     to sign-in is a non-dispatch that changed nothing, not an acceptance; a create that cannot be
 *     read back, and an update whose members do not read back as written,
 *     are not a success; `CP-1` is not `CP-10`, which SteVe's LIKE
 *     query lists beside it; and the details form goes back whole, because
 *     SteVe's update erases whatever it is not sent.
 *
 * "Changes nothing" and "leaves the others alone" are checked against the
 * WHOLE observable record, compared key by key after sorting, on a station
 * whose every member starts away from its default -- so a rule cannot pass
 * because the member that moved was the one nobody looked at, or because it
 * moved to the value it already had.
 *
 * WHAT IT CANNOT CHECK: that the fake behaves as the pinned SteVe does. It is
 * the one assumption of part 6, and `bun tools/steve-charge-points.ts
 * --yes-isolated` re-checks it against a live image -- including over the
 * OCPP endpoint, which this guard has no way to reach.
 */

import { STEVE_CHARGE_POINT_PAGES } from "../packages/csms-driver/steve/forms";
import { SteveUiOps } from "../packages/csms-driver/steve/ui-client";
import { FAKE_STEVE_BASE, fakeSteveManager, type FakeSteveManager } from "./fixtures/fake-steve-manager";
import {
  ALL_PROFILES,
  chargePointAdminViolations,
  rejectsWith,
  RULE,
  securityFor,
  type Rule,
} from "./lib/charge-point-conformance";
import {
  ChargePointAlreadyExistsError,
  ChargePointNotFoundError,
  createCitrineOsCsmsDriver,
  createSteveCsmsDriver,
  CsmsNotDispatchedError,
  UnsupportedOperationError,
  type ChargePointDefinition,
  type ChargePointDetails,
  type ChargePointSecurity,
  type ChargePointSecurityProfile,
  type ChargePointUpdate,
  type CsmsChargePointAdmin,
  type CsmsDriver,
} from "open-ocpp-tck/csms-driver";

/** The declaration the flawed copies run under unless they say otherwise:
 *  the default profile, and one that carries a password. */
const DECLARED_PROFILES: readonly ChargePointSecurityProfile[] = [0, 1];

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
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

// ---------------------------------------------------------------------------
// The bundled factories: SteVe behind a fake manager UI, CitrineOS absent
// ---------------------------------------------------------------------------

const STEVE_CONFIG = { baseUrl: FAKE_STEVE_BASE, username: "operator", password: "secret" };
const steveAdmin = (fake: FakeSteveManager): CsmsChargePointAdmin => {
  const admin = createSteveCsmsDriver({ config: STEVE_CONFIG, fetch: fake.fetch }).chargePoints;
  if (admin === undefined) throw new Error("the SteVe factory has no chargePoints surface");
  return admin;
};
/** What an operator does in the manager UI: open the details page, change two fields, press Update. */
const operatorPosts = (fake: FakeSteveManager, cpId: string, profile: string, authPassword: string): Promise<string> =>
  new SteveUiOps(STEVE_CONFIG, fake.fetch).submitForm(
    STEVE_CHARGE_POINT_PAGES.details(fake.stations.get(cpId)?.pk ?? -1),
    STEVE_CHARGE_POINT_PAGES.updateAction,
    {
      submitter: "update",
      fill: (fields) => {
        fields.set("securityProfile", profile);
        fields.set("authPassword", authPassword);
      },
    },
  );
const OLD_PASSWORD = "provisioned-secret-1";
/** An `Error` of no subclass: the CSMS answered, and refused. */
const isPlainError = (error: unknown): error is Error => error instanceof Error && error.constructor === Error;
/** What `promise` rejects with, or `undefined` when it resolves. */
const caught = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => undefined, (thrown: unknown) => thrown);

/** One row: a throw is that row failing, named, rather than the guard crashing. */
async function row(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    failures.push(`${name} threw: ${String(error)}`);
  }
}

const bundled: Record<string, CsmsDriver> = {
  steve: createSteveCsmsDriver({ config: STEVE_CONFIG, fetch: fakeSteveManager().fetch }),
  citrineos: createCitrineOsCsmsDriver({
    config: { variant: "v2", apiUrl: "http://citrine/api", tenantId: 1 },
    refs: { ocppTransactionId: async () => 1 },
    fetch: async () => new Response("unexpected request", { status: 500 }),
  }),
};
for (const [name, driver] of Object.entries(bundled)) {
  const violations = await chargePointAdminViolations(driver);
  check(violations.length === 0, `the ${name} factory conforms (${violations.join("; ")})`);
}
check(bundled.steve.chargePoints !== undefined, "the SteVe factory implements the admin surface");
check(bundled.citrineos.chargePoints === undefined, "the CitrineOS factory does not implement the admin surface yet");

// #155: a downgrade to profile 0 or 3 discards the password. SteVe reads an
// empty authPassword as "unchanged", so what is checked is the POSTED BODY --
// a password nobody holds -- and then the consequence: an operator who
// switches the station back to profile 1 without typing one does not revive
// the old password.
const discarded: string[] = [];
for (const profile of [0, 3] as const) await row(`a downgrade to profile ${profile}`, async () => {
  const fake = fakeSteveManager();
  const admin = steveAdmin(fake);
  await admin.create({ id: "CP-155", security: { profile: 1, basicAuthPassword: OLD_PASSWORD } });
  const before = fake.posts.length;
  await admin.update("CP-155", { security: { profile } });
  const posted = fake.posts.slice(before).filter((post) => post.action === STEVE_CHARGE_POINT_PAGES.updateAction);
  const password = posted[0]?.fields.get("authPassword") ?? "";
  check(posted.length === 1, `a downgrade to profile ${profile} posts one update form (posted ${posted.length})`);
  check(
    password.length >= 16 && password.length <= 20 && password !== OLD_PASSWORD,
    `a downgrade to profile ${profile} posts a new password SteVe accepts, not an empty one (posted ${JSON.stringify(password)})`,
  );
  check(fake.stations.get("CP-155")?.authPassword !== OLD_PASSWORD, `a downgrade to profile ${profile} replaces the stored password`);
  await operatorPosts(fake, "CP-155", "Profile_1", "");
  check(
    !fake.authenticates("CP-155", OLD_PASSWORD),
    `after a downgrade to profile ${profile}, switching back to profile 1 without a password does not revive the old one`,
  );
  discarded.push(password);
});
check(new Set(discarded).size === discarded.length, `every downgrade posts a password of its own (${discarded.join(", ")})`);

// The control the rows above stand on: the fake does keep a password an empty
// field leaves alone, so they are not green because it forgets everything.
await row("control", async () => {
  const fake = fakeSteveManager();
  await steveAdmin(fake).create({ id: "CP-155", security: { profile: 1, basicAuthPassword: OLD_PASSWORD } });
  await operatorPosts(fake, "CP-155", "Profile_0", "");
  await operatorPosts(fake, "CP-155", "Profile_1", "");
  check(
    fake.authenticates("CP-155", OLD_PASSWORD),
    "control: a downgrade posting an empty password leaves the old one able to authenticate",
  );
});

// A refusal is SteVe answering: a plain Error carrying the page's error list,
// and never the re-rendered form, which echoes the posted password.
await row("the refusal row", async () => {
  const fake = fakeSteveManager();
  const tooLong = "far-too-long-to-be-a-steve-password";
  const error = await caught(steveAdmin(fake).create({ id: "CP-LONG", security: { profile: 1, basicAuthPassword: tooLong } }));
  check(isPlainError(error), `a create SteVe refuses is a plain Error (got ${String(error)})`);
  const message = error instanceof Error ? error.message : "";
  check(message.includes("between 16 and 20 characters"), `the refusal names SteVe's reason (${message})`);
  check(!message.includes(tooLong), "the refusal does not carry the posted password");
  // The re-rendered form sits after the error list, so a message that keeps
  // any of the body's markup is one excerpt away from carrying it.
  check(!/[<>]|value=/.test(message), `the refusal carries the page's error text and none of its markup (${message})`);
});

// A duplicate is the contract's error, decided before anything is posted.
await row("the duplicate row", async () => {
  const fake = fakeSteveManager();
  const admin = steveAdmin(fake);
  await admin.create({ id: "CP-DUP" });
  const before = fake.posts.length;
  check(
    await rejectsWith(() => admin.create({ id: "CP-DUP" }), ChargePointAlreadyExistsError),
    "a duplicate create throws ChargePointAlreadyExistsError",
  );
  check(fake.posts.length === before, "a duplicate create posts nothing");

  // Two creates of one id racing past the existence check: the one that loses
  // gets SteVe's duplicate page, and must still read as the contract's error.
  const raced = await Promise.allSettled([admin.create({ id: "CP-RACE" }), admin.create({ id: "CP-RACE" })]);
  const lost = raced.filter((outcome) => outcome.status === "rejected");
  check(
    raced.some((outcome) => outcome.status === "fulfilled") &&
      lost.length === 1 &&
      lost[0].status === "rejected" &&
      lost[0].reason instanceof ChargePointAlreadyExistsError,
    `of two concurrent creates of one id, one succeeds and the other throws ChargePointAlreadyExistsError ` +
      `(got ${raced.map((outcome) => (outcome.status === "fulfilled" ? "ok" : String(outcome.reason))).join(", ")})`,
  );
});

// A session that expired between a form's GET and its POST is bounced to
// sign-in -- a redirect, which is how SteVe also says "accepted". A password
// cannot be read back, so a password-only update would pass the read-back:
// the bounce itself has to be the failure, and a non-dispatch, since nothing
// was applied.
await row("the sign-in bounce row", async () => {
  const fake = fakeSteveManager();
  const admin = steveAdmin(fake);
  await admin.create({ id: "CP-BOUNCE", security: { profile: 1, basicAuthPassword: OLD_PASSWORD } });
  fake.expireSessionBeforeNextPost();
  const error = await caught(admin.update("CP-BOUNCE", { security: { profile: 1, basicAuthPassword: "rotated-secret-0002" } }));
  check(
    error instanceof CsmsNotDispatchedError,
    `a form POST bounced to sign-in throws CsmsNotDispatchedError (got ${String(error)})`,
  );
  check(fake.stations.get("CP-BOUNCE")?.authPassword === OLD_PASSWORD, "the bounced update changed nothing");
});

// SteVe redirects whether or not a row was written, so a create that cannot
// be read back is not a success.
await row("the read-back row", async () => {
  const error = await caught(steveAdmin(fakeSteveManager({ forgetAdds: true })).create({ id: "CP-LOST" }));
  check(isPlainError(error) && /read back/.test(error.message), `a create that cannot be read back throws (got ${String(error)})`);
  const fake = fakeSteveManager({ forgetUpdates: true });
  const admin = steveAdmin(fake);
  await admin.create({ id: "CP-STILL" });
  for (const [what, patch] of [
    ["registration", { registration: "Rejected" }],
    ["security", { security: { profile: 1, basicAuthPassword: OLD_PASSWORD } }],
    ["description", { description: "changed" }],
  ] as const) {
    const unchanged = await caught(admin.update("CP-STILL", patch));
    check(
      isPlainError(unchanged) && /does not read back/.test(unchanged.message),
      `an update whose ${what} does not read back throws (got ${String(unchanged)})`,
    );
  }
});

// The list query matches with LIKE: CP-10 is not CP-1.
await row("the LIKE row", async () => {
  const fake = fakeSteveManager();
  const admin = steveAdmin(fake);
  await admin.create({ id: "CP-10" });
  check((await admin.get("CP-1")) === null, "get of CP-1 does not resolve to CP-10");
  check(
    await rejectsWith(() => admin.update("CP-1", { registration: "Rejected" }), ChargePointNotFoundError),
    "update of CP-1 does not apply to CP-10",
  );
  await admin.delete("CP-1");
  check(fake.stations.has("CP-10"), "delete of CP-1 does not remove CP-10");
});

// The details form is posted back whole: what an operator set beside the
// members the contract knows survives an update, and markup round-trips.
await row("the whole-form row", async () => {
  const fake = fakeSteveManager();
  const admin = steveAdmin(fake);
  const description = `a & <b> "quoted" 'single'`;
  await admin.create({ id: "CP-FORM", description });
  check((await admin.get("CP-FORM"))?.description === description, "a description with markup characters reads back as written");
  const station = fake.stations.get("CP-FORM");
  if (station) {
    station.note = "set by an operator";
    station.adminAddress = "http://admin.example";
    station.address = { ...station.address, city: "Aachen", country: "DE" };
    station.insertConnectorStatusAfterTransactionMsg = true;
  }
  await admin.update("CP-FORM", { registration: "Pending" });
  const after = fake.stations.get("CP-FORM");
  check(
    after?.note === "set by an operator" &&
      after.adminAddress === "http://admin.example" &&
      after.address.city === "Aachen" &&
      after.address.country === "DE" &&
      after.insertConnectorStatusAfterTransactionMsg,
    "an update keeps the fields of the form the contract does not name",
  );
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Charge-point administration: the reference driver conforms under ${REFERENCE_DECLARATIONS.length} declarations, ` +
      `and each of its ${Object.values(RULE).length} rules has a flawed copy refused for it ` +
      `(${Object.keys(FLAWS).length} copies); the bundled factories declare what they implement, ` +
      `and SteVe keeps the password rule behind its fake manager UI.`,
  );
}
