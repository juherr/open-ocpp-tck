// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * driver-env-scope.ts -- `scope`, `capabilities` and `expectedFailures`
 * describe the server the driver was RESOLVED for, not the one that happened
 * to be in `process.env` when the module was imported.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. Every other check in this
 * directory drives the CLI, and the CLI always passes `process.env` -- which
 * is exactly the coincidence this guard exists to remove. A driver targeting a
 * CSMS with two incompatible release lines has a scope table that depends on
 * which server you point at; before `EnvDependent`, that could only come from
 * a module-scope global read at import time, while `create(env)` read the
 * environment it was handed. The two agreed only because the runner passes
 * `process.env`, so a caller with a synthetic `CsmsEnv` got a scope table
 * describing one server while every request targeted the other. Reaching that
 * requires calling the contract in-process with an env that differs from the
 * ambient one, which no `bash` can do.
 *
 * TWO HALVES, and the split is deliberate. The first asserts the MECHANISM
 * against a synthetic module owned by this file: it cannot be broken by a
 * bundled driver changing, and it outlives CitrineOS's v1 line. The second
 * asserts that the bundled drivers actually use that mechanism -- one with two
 * release lines, one with none -- which is a fact about them, not about the
 * contract. Renaming a CitrineOS scenario should fail `check-driver`, which
 * says so precisely; it reaches this file only through the second half.
 *
 * Offline: importing a driver module contacts nothing, and `create()` builds
 * clients without connecting.
 */
import { csmsDriver as citrineos } from "../drivers/citrineos/index";
import {
  CERT_201_SCENARIOS,
  V1_LOCAL_LIST_SCENARIOS,
} from "../drivers/citrineos/variant";
import { csmsDriver as steve } from "../drivers/steve/index";
import { STEVE_SCOPE } from "../drivers/steve/scope";
import {
  driverCapabilities,
  driverExpectedFailures,
  driverScope,
  type CsmsDriverModule,
  type CsmsEnv,
} from "../tck/driver";
import type { ExpectedFailureTable } from "../tck/expected";

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

// --- the mechanism, against a module this file owns -------------------------
// `create` throws on purpose: resolving a declaration must never reach it, or
// the credential-free promise that puts these fields on the module rather than
// on CsmsDriverParts is gone.
const SYNTHETIC: CsmsDriverModule = {
  id: "synthetic",
  displayName: "Synthetic two-line CSMS",
  scope: (env) => ({
    "one-scenario": {
      status: env.LINE === "old" ? "NOT_APPLICABLE" : "DRIVABLE",
      reason: `the ${env.LINE ?? "current"} line`,
    },
  }),
  capabilities: (env) => ({
    operations16: new Set(env.LINE === "old" ? [] : ["Reset"]),
    reservations: false,
    chargingProfiles: false,
    deviceModel: false,
  }),
  // The third declaration, and the one where getting the env wrong is worst:
  // a list resolved for the other release line excuses scenarios that are
  // failing for reasons nobody has looked at, AND withholds the UNEXPECTED
  // PASS that would delete the entries that no longer apply. Both directions
  // are silent, which is why it is asserted here rather than left to
  // check-driver.
  expectedFailures: (env): ExpectedFailureTable =>
    env.LINE === "old"
      ? {
          "one-scenario": {
            reason: "the old line has the defect",
            finding: "synthetic",
          },
        }
      : {},
  create() {
    throw new Error("resolving a declaration must not call create()");
  },
};

const PLAIN_SCOPE = {
  "one-scenario": { status: "DRIVABLE", reason: "stated once" },
} as const;
const PLAIN_EXPECTED = {
  "one-scenario": { reason: "stated once", finding: "synthetic" },
} as const;
const PLAIN: CsmsDriverModule = {
  ...SYNTHETIC,
  scope: PLAIN_SCOPE,
  expectedFailures: PLAIN_EXPECTED,
};

check(
  driverScope(SYNTHETIC, { LINE: "old" })?.["one-scenario"]?.status ===
    "NOT_APPLICABLE" &&
    driverScope(SYNTHETIC, {})?.["one-scenario"]?.status === "DRIVABLE",
  "driverScope() does not answer from the env it was handed.",
);
check(
  driverCapabilities(SYNTHETIC, { LINE: "old" })?.operations16.size === 0 &&
    driverCapabilities(SYNTHETIC, {})?.operations16.has("Reset") === true,
  "driverCapabilities() does not answer from the env it was handed.",
);
check(
  driverExpectedFailures(SYNTHETIC, { LINE: "old" })?.["one-scenario"] !==
    undefined && driverExpectedFailures(SYNTHETIC, {})?.["one-scenario"] === undefined,
  "driverExpectedFailures() does not answer from the env it was handed.",
);
check(
  driverScope(PLAIN, { LINE: "old" }) === PLAIN_SCOPE,
  "a plain ScopeTable no longer resolves to itself -- the union broke the " +
    "single-release driver, which is the common case.",
);
check(
  driverExpectedFailures(PLAIN, { LINE: "old" }) === PLAIN_EXPECTED,
  "a plain ExpectedFailureTable no longer resolves to itself.",
);
// The field is OPTIONAL, and a driver that declares nothing must keep the
// original rule -- every failure is a failure. Resolving `undefined` to
// anything else would silently excuse scenarios for every driver that never
// opted in.
check(
  driverExpectedFailures(
    { ...SYNTHETIC, expectedFailures: undefined },
    { LINE: "old" },
  ) === undefined,
  "a driver that declares no expected failures no longer resolves to " +
    "undefined, so 'every failure is a failure' stopped being the default.",
);

// --- the bundled drivers use it ---------------------------------------------
const V1_ENV: CsmsEnv = { CITRINE_VARIANT: "v1" };
const V2_ENV: CsmsEnv = { CITRINE_VARIANT: "v2" };

// BOTH lines are asserted, and that pair is what makes the guard independent
// of whatever CITRINE_VARIANT the operator happens to have exported. A driver
// that regressed to reading `process.env` once, at import, answers the same
// table for both envs -- so whichever of the two the ambient value matches,
// the OTHER assertion fails. Checking only the v1 side would instead need the
// ambient env to be v2, and would read green in a v1 shell.
const v1Scope = driverScope(citrineos, V1_ENV);
const v2Scope = driverScope(citrineos, V2_ENV);

for (const id of V1_LOCAL_LIST_SCENARIOS) {
  check(
    v1Scope?.[id]?.status === "NOT_APPLICABLE",
    `${id} is ${v1Scope?.[id]?.status ?? "absent"} in the table resolved for ` +
      "CITRINE_VARIANT=v1, but the v1.9.1 line routes no 1.6 local auth list.",
  );
  check(
    v2Scope?.[id]?.status === "DRIVABLE",
    `${id} is ${v2Scope?.[id]?.status ?? "absent"} in the table resolved for ` +
      "CITRINE_VARIANT=v2, so the two resolutions do not differ and the " +
      "driver's table is not a function of the environment.",
  );
}

const LOCAL_LIST_ACTIONS = ["SendLocalList", "GetLocalListVersion"] as const;
const v1Caps = driverCapabilities(citrineos, V1_ENV);
const v2Caps = driverCapabilities(citrineos, V2_ENV);

for (const action of LOCAL_LIST_ACTIONS) {
  check(
    v1Caps?.operations16.has(action) === false,
    `capabilities resolved for v1 declare ${action}, which v1.9.1 does not route.`,
  );
  check(
    v2Caps?.operations16.has(action) === true,
    `capabilities resolved for v2 omit ${action}, so the two resolutions do ` +
      "not differ.",
  );
}

// THE SECOND ENV-DEPENDENT AXIS, and it differs from the first in the way that
// matters here: the local-auth-list rows differ in STATUS between the two
// lines, while these differ in whether the driver declares the protocol at
// all. `capabilities.operations201` ABSENT is the contract's "does not speak
// OCPP 2.0.1", so a driver that resolved the variant once at import would
// declare a 2.0.1 surface for a line it has never been pointed at -- and the
// scope rows and the capability set would agree with each other while both
// described the wrong server. That is the failure this file exists for,
// arriving through a door it did not previously watch.
for (const id of CERT_201_SCENARIOS) {
  check(
    v1Scope?.[id]?.status === "NOT_APPLICABLE",
    `${id} is ${v1Scope?.[id]?.status ?? "absent"} in the table resolved for ` +
      "CITRINE_VARIANT=v1, where this driver declares no OCPP 2.0.1 surface.",
  );
  check(
    v2Scope?.[id]?.status !== "NOT_APPLICABLE" &&
      v2Scope?.[id] !== undefined,
    `${id} is ${v2Scope?.[id]?.status ?? "absent"} in the table resolved for ` +
      "CITRINE_VARIANT=v2, so the two resolutions do not differ and the " +
      "driver's table is not a function of the environment.",
  );
}

check(
  v1Caps?.operations201 === undefined,
  "capabilities resolved for v1 declare an OCPP 2.0.1 vocabulary, which no " +
    "run has ever measured against the v1.9.1 line. Absent means 'does not " +
    "speak it'; an empty set would claim it was measured and found nothing.",
);
check(
  v2Caps?.operations201?.size === 3,
  `capabilities resolved for v2 declare ${v2Caps?.operations201?.size ?? "no"} ` +
    "OCPP 2.0.1 operation(s) rather than three, so the two resolutions do not " +
    "differ as the scope rows above say they do.",
);

// This threw before the contract change: the driver resolved the variant twice
// -- once from process.env at module load for `scope`, once from the env given
// to create() -- and a guard compared them. One resolution means there is
// nothing left to disagree.
try {
  citrineos.create(V1_ENV);
} catch (err) {
  failures.push(
    "create() rejected an env the scope table resolved happily: " +
      `${err instanceof Error ? err.message : String(err)}`,
  );
}

// The env-dependent form is an option, not an obligation: a single-release
// CSMS states its table and never writes a function.
check(
  driverScope(steve, {}) === STEVE_SCOPE,
  "the single-release bundled driver's plain table no longer resolves to itself.",
);
check(
  driverCapabilities(steve, {})?.reservations === true,
  "the single-release bundled driver's plain capabilities no longer resolve " +
    "to themselves.",
);

if (failures.length > 0) {
  process.stderr.write(
    "FAIL: a driver's scope, capabilities or expected failures do not follow " +
      "the environment they are resolved with.\n",
  );
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  "Driver scope, capabilities and expected failures follow the resolved " +
    `environment (${V1_LOCAL_LIST_SCENARIOS.length} local-auth-list rows and ` +
    `${LOCAL_LIST_ACTIONS.length} operations differ between the two CitrineOS ` +
    `lines, as do ${CERT_201_SCENARIOS.length} OCPP 2.0.1 rows and the whole ` +
    "2.0.1 vocabulary; a plain table still resolves to itself, and an absent " +
    "expected-failure list still resolves to undefined).\n",
);
