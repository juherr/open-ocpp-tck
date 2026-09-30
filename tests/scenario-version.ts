// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The scenario version is a declaration and every selector reads that field.
 * This holds the user-facing aliases, the intersection used by sweeps and
 * lists, simulator resolution, and the protocol-level driver scope opt-out.
 */
import assert from "node:assert/strict";
import {
  filterScenariosByVersion,
  parseScenarioVersionFilter,
} from "../tck/scenario-selection";
import type { ScenarioOcppVersion, ScenarioSpec } from "../tck/spec-types";
import { simConfigForScenario } from "../tck/sim";
import { scopeCoverage, scopeEntryForScenario } from "../tck/scope";
import { driverProtocols, type CsmsDriverModule } from "../tck/driver";
import { cli } from "../tck/main";
import { CORE_SPECS } from "../tck/specs/core";
import { CORE_201_SPECS } from "../tck/specs/core-201";
import { AUTHLIST_RESERVATION_SPECS } from "../tck/specs/authlist-reservation";
import { REMOTETRIGGER_SMARTCHARGING_SPECS } from "../tck/specs/remotetrigger-smartcharging";
import { FIRMWARE_SPECS } from "../tck/specs/firmware";
import { AUTHORIZE_SPECS } from "../tck/specs/authorize";

type Stub = Pick<ScenarioSpec, "templateId" | "ocppVersion"> & {
  group: string;
};

function scenario(
  templateId: string,
  group: string,
  ocppVersion: ScenarioOcppVersion,
): Stub {
  return { templateId, group, ocppVersion };
}

const mixed: Stub[] = [
  scenario("cert16-misleading-201", "core", "OCPP-2.0.1"),
  scenario("cert201-misleading-16", "core", "OCPP-1.6J"),
  scenario("authlist-16", "authlist-reservation", "OCPP-1.6J"),
];

assert.equal(parseScenarioVersionFilter("1.6"), "1.6");
assert.equal(parseScenarioVersionFilter("2.0.1"), "2.0.1");
assert.throws(() => parseScenarioVersionFilter("1.5"), /Unsupported OCPP version/);
assert.throws(() => parseScenarioVersionFilter("ocpp2"), /Unsupported OCPP version/);

assert.deepEqual(
  filterScenariosByVersion(mixed, parseScenarioVersionFilter("1.6")).map(
    (item) => item.templateId,
  ),
  ["cert201-misleading-16", "authlist-16"],
  "the 1.6 filter follows declarations rather than cert16/cert201 prefixes",
);

const registered = [
  ...CORE_SPECS,
  ...CORE_201_SPECS,
  ...AUTHLIST_RESERVATION_SPECS,
  ...REMOTETRIGGER_SMARTCHARGING_SPECS,
  ...FIRMWARE_SPECS,
  ...AUTHORIZE_SPECS,
];
assert.ok(registered.every((item) => item.ocppVersion === "OCPP-1.6J" || item.ocppVersion === "OCPP-2.0.1"));
assert.equal(registered.length, new Set(registered.map((item) => item.templateId)).size);

async function captureCli(args: string[]): Promise<{ code: number; output: string }> {
  const originalWrite = process.stdout.write;
  const originalErrorWrite = process.stderr.write;
  let output = "";
  const capture = (chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  try { return { code: await cli(args), output }; }
  finally { process.stdout.write = originalWrite; process.stderr.write = originalErrorWrite; }
}

const cli201 = await captureCli(["list-scenarios", "--group", "core", "--version", "2.0.1", "--json"]);
assert.equal(cli201.code, 0);
const cli201Rows = JSON.parse(cli201.output) as Array<{ templateId: string; group: string }>;
assert.ok(cli201Rows.length > 0);
assert.ok(cli201Rows.every((row) => row.templateId.startsWith("cert201-") && row.group === "core"));
assert.ok(cli201Rows.every((row) => !("ocppVersion" in row)), "list-scenarios keeps its existing output shape");
const legacyCore = await captureCli(["list-scenarios", "--group", "core", "--version", "1.6", "--json"]);
assert.equal(legacyCore.code, 0);
assert.ok((JSON.parse(legacyCore.output) as Array<{ templateId: string }>).every((row) => row.templateId.startsWith("cert16-")));
const bothCore = await captureCli(["list-scenarios", "--group", "core", "--json"]);
assert.equal(bothCore.code, 0);
assert.ok((JSON.parse(bothCore.output) as Array<{ templateId: string }>).some((row) => row.templateId.startsWith("cert16-")));
assert.ok((JSON.parse(bothCore.output) as Array<{ templateId: string }>).some((row) => row.templateId.startsWith("cert201-")));
const invalidCliVersion = await captureCli(["list-scenarios", "--version", "1.5"]);
assert.equal(invalidCliVersion.code, 1);
assert.match(invalidCliVersion.output, /Unsupported OCPP version/);
const priorSimVersion = process.env.SIM_OCPP_VERSION;
process.env.SIM_OCPP_VERSION = "OCPP-1.6J";
try {
  const incompatibleSweep = await captureCli(["run", "--group", "core", "--version", "2.0.1"]);
  assert.equal(incompatibleSweep.code, 1);
  assert.match(incompatibleSweep.output, /conflicts with scenario protocol OCPP-2\.0\.1/);
  const unfilteredSweep = await captureCli(["run"]);
  assert.equal(unfilteredSweep.code, 1);
  assert.match(unfilteredSweep.output, /conflicts with scenario protocol OCPP-2\.0\.1/);
  const incompatibleSingle = await captureCli(["run", "cert16-tc001-cold-boot", "--version", "2.0.1"]);
  assert.equal(incompatibleSingle.code, 1);
  assert.match(incompatibleSingle.output, /does not match --version 2\.0\.1/);
} finally {
  if (priorSimVersion === undefined) delete process.env.SIM_OCPP_VERSION;
  else process.env.SIM_OCPP_VERSION = priorSimVersion;
}
assert.deepEqual(
  filterScenariosByVersion(mixed, parseScenarioVersionFilter("2.0.1")).map(
    (item) => item.templateId,
  ),
  ["cert16-misleading-201"],
  "the 2.0.1 filter follows the declared protocol",
);
assert.deepEqual(
  filterScenariosByVersion(mixed, undefined),
  mixed,
  "omitting the filter retains every supported protocol",
);
assert.deepEqual(
  filterScenariosByVersion(
    mixed.filter((item) => item.group === "core"),
    parseScenarioVersionFilter("2.0.1"),
  ).map((item) => item.templateId),
  ["cert16-misleading-201"],
  "version selection intersects with an existing group selection",
);

assert.equal(
  simConfigForScenario("case-201", "OCPP-2.0.1", {}).ocppVersion,
  "OCPP-2.0.1",
  "an unset SIM_OCPP_VERSION lets the scenario declaration drive the sim",
);
assert.equal(
  simConfigForScenario("case-201", "OCPP-2.0.1", {
    SIM_OCPP_VERSION: "OCPP-2.0.1",
  }).ocppVersion,
  "OCPP-2.0.1",
  "a matching explicit simulator version is accepted",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", { SIM_OCPP_VERSION: "OCPP-1.6J" }),
  /conflicts with scenario protocol OCPP-2\.0\.1/,
  "an explicit incompatible simulator version is refused",
);
assert.equal(
  simConfigForScenario("case-201", "OCPP-2.0.1", {
    SIM_FORCE_OCPP_VERSION: "OCPP-1.6J",
  }).ocppVersion,
  "OCPP-1.6J",
  "the diagnostic force switch can run a scenario against another protocol",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", {
    SIM_FORCE_OCPP_VERSION: "OCPP-1.6J",
    SIM_OCPP_VERSION: "OCPP-2.0.1",
  }),
  /SIM_OCPP_VERSION=OCPP-2\.0\.1 conflicts with forced simulator protocol OCPP-1\.6J/,
  "the compatibility assertion must agree with a forced diagnostic protocol",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", {
    SIM_FORCE_OCPP_VERSION: "OCPP-1.6J",
    SIM_EXTRA_ARGS: "--ocpp-version OCPP-2.0.1",
  }),
  /SIM_EXTRA_ARGS --ocpp-version=OCPP-2\.0\.1 conflicts with simulator protocol OCPP-1\.6J/,
  "a lower-level argument cannot silently undo the diagnostic force switch",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", {
    SIM_FORCE_OCPP_VERSION: "OCPP-9.9",
  }),
  /SIM_FORCE_OCPP_VERSION=OCPP-9\.9 is not a version this simulator image accepts/,
  "the diagnostic switch accepts only protocol values understood by the simulator",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", { SIM_OCPP_VERSION: "" }),
  /SIM_OCPP_VERSION= is not a version this simulator image accepts/,
  "an explicitly empty simulator version is invalid",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", { SIM_EXTRA_ARGS: "--ocpp-version OCPP-1.6J" }),
  /SIM_EXTRA_ARGS --ocpp-version=OCPP-1\.6J conflicts/,
  "a conflicting extra argument cannot override the declared scenario protocol",
);
assert.equal(
  simConfigForScenario("case-201", "OCPP-2.0.1", { SIM_EXTRA_ARGS: "--ocpp-version=OCPP-2.0.1" }).ocppVersion,
  "OCPP-2.0.1",
  "an extra argument that agrees with the scenario protocol is allowed",
);
assert.throws(
  () => simConfigForScenario("case-201", "OCPP-2.0.1", { SIM_EXTRA_ARGS: "--ocpp-version=OCPP-2.0.1 --ocpp-version OCPP-1.6J" }),
  /conflicts with scenario protocol/,
  "every extra protocol flag must agree with the scenario",
);

const scope = { legacy: { status: "DRIVABLE" as const, reason: "fixture" } };
assert.deepEqual(
  scopeCoverage(
    scope,
    [
      { templateId: "legacy", ocppVersion: "OCPP-1.6J" },
      { templateId: "unsupported-201", ocppVersion: "OCPP-2.0.1" },
    ],
    ["OCPP-1.6J"],
  ),
  { missing: [], stale: [] },
  "a protocol opt-out removes row obligations only for unsupported protocols",
);
assert.deepEqual(
  scopeCoverage(scope, [
    { templateId: "legacy", ocppVersion: "OCPP-1.6J" },
    { templateId: "missing-supported", ocppVersion: "OCPP-1.6J" },
  ], ["OCPP-1.6J"]),
  { missing: ["missing-supported"], stale: [] },
  "a supported scenario still requires its own scope row",
);
assert.deepEqual(
  scopeCoverage(scope, [
    { templateId: "legacy", ocppVersion: "OCPP-1.6J" },
    { templateId: "legacy-201", ocppVersion: "OCPP-2.0.1" },
  ]),
  { missing: ["legacy-201"], stale: [] },
  "drivers without a protocol declaration retain all-scenario scope checks",
);
const singleProtocolDriver = fixtureDriver(["OCPP-1.6J"]);
const singleProtocolDeclaration = driverProtocols(singleProtocolDriver, {});
assert.deepEqual(
  scopeEntryForScenario({}, "missing-201", "OCPP-2.0.1", singleProtocolDeclaration),
  {
    status: "NOT_APPLICABLE",
    reason: "Driver does not declare support for OCPP-2.0.1.",
  },
  "runtime treats an omitted unsupported-protocol row as not applicable before simulator startup",
);
assert.equal(
  scopeEntryForScenario(
    {},
    "missing-201",
    "OCPP-2.0.1",
    driverProtocols(fixtureDriver(undefined), {}),
  ),
  undefined,
  "legacy drivers without protocols keep their previous runtime behavior",
);

function fixtureDriver(protocols: unknown): CsmsDriverModule {
  return {
    id: "fixture",
    displayName: "Fixture",
    protocols: protocols as CsmsDriverModule["protocols"],
    create() { return {} as never; },
  };
}
assert.throws(() => driverProtocols(fixtureDriver([]), {}), /at least one supported protocol/);
assert.throws(() => driverProtocols(fixtureDriver(["OCPP-9.9"]), {}), /unsupported protocol/);
assert.throws(() => driverProtocols(fixtureDriver(["OCPP-1.6J", "OCPP-1.6J"]), {}), /duplicate protocol/);

const priorSimVersionForInvalidCli = process.env.SIM_OCPP_VERSION;
process.env.SIM_OCPP_VERSION = "OCPP-2.0.1";
try {
  const invalidCliCombinations = [
    ["run", "cert16-tc001-cold-boot", "--group", "core"],
    ["run-all", "--cp", "fixture"],
    ["run-all", "--connector", "2"],
    ["run-all", "--timeout", "5"],
    ["run", "cert16-tc001-cold-boot", "--shard", "1/2"],
  ];
  for (const invocation of invalidCliCombinations) {
    const result = await captureCli(invocation);
    assert.equal(result.code, 1, `${invocation.join(" ")} must fail`);
    assert.match(result.output, /cannot be used with|cannot be combined/i);
  }
} finally {
  if (priorSimVersionForInvalidCli === undefined) delete process.env.SIM_OCPP_VERSION;
  else process.env.SIM_OCPP_VERSION = priorSimVersionForInvalidCli;
}

process.stdout.write(
  "Scenario versions drive CLI selection, simulator configuration, and driver scope.\n",
);
