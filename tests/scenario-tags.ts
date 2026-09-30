// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * A scenario's tags are a declaration, and `--tag` reads nothing else.
 *
 * Tags are the functional axis beside `--group` (upstream's array membership)
 * and `--version` (the protocol). They are selection metadata only -- neither
 * pinned artifact carries them -- so what keeps them honest is this guard, and
 * it claims six things:
 *
 *  1. Every registered scenario declares at least one tag, every tag is in
 *     the closed vocabulary, and none is repeated. Checked at runtime over what
 *     the registry actually lists, because `ScenarioSpec<any>` and a compiled
 *     `.feature` both reach the registry without the type's help.
 *  2. Every tag in the vocabulary is carried by some registered scenario: a tag
 *     nothing carries is a filter that selects nothing and a vocabulary that
 *     grew ahead of the suite.
 *  3. The filter follows the declaration and not the name or the group -- the
 *     stubs below are named and grouped for one domain and tagged for another.
 *  4. Through the CLI, the three axes intersect and answer what groups cannot:
 *     smart charging without the remote-trigger scenarios that share its
 *     group, transactions across groups, the Gherkin Authorize scenarios by
 *     function. An unknown tag, and a second `--tag`, are refused.
 *  5. `scopeByTag` counts a driver's scope per tag, including the protocol
 *     opt-out, which is how `check-driver` names a domain a driver excludes.
 *  6. The README's tag table lists exactly the vocabulary.
 *
 * In-process rather than shell for the reason `tests/scenario-version.ts`
 * is: the spec objects and `scopeByTag` are unreachable through the CLI, and
 * the CLI half is cheaper through the exported `cli()` than a process per row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCENARIO_TAGS,
  isScenarioTag,
  parseScenarioTag,
  type ScenarioTag,
} from "../tck/scenario-tags";
import { filterScenariosByTag } from "../tck/scenario-selection";
import { scopeByTag } from "../tck/scope";
import { cli } from "../tck/main";
import { CORE_SPECS } from "../tck/specs/core";
import { CORE_201_SPECS } from "../tck/specs/core-201";
import { AUTHLIST_RESERVATION_SPECS } from "../tck/specs/authlist-reservation";
import { REMOTETRIGGER_SMARTCHARGING_SPECS } from "../tck/specs/remotetrigger-smartcharging";
import { FIRMWARE_SPECS } from "../tck/specs/firmware";
import { AUTHORIZE_SPECS } from "../tck/specs/authorize";

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

type Row = { templateId: string; group: string; tags: string[] };

async function listJson(...args: string[]): Promise<Row[]> {
  const result = await captureCli(["list-scenarios", ...args, "--json"]);
  assert.equal(result.code, 0, `list-scenarios ${args.join(" ")}: ${result.output}`);
  return JSON.parse(result.output) as Row[];
}

const ids = (rows: readonly { templateId: string }[]) => rows.map((row) => row.templateId).sort();

// --- 1. every registered scenario carries valid, distinct tags -------------

const registry = await listJson();
const specs = [
  ...CORE_SPECS,
  ...CORE_201_SPECS,
  ...AUTHLIST_RESERVATION_SPECS,
  ...REMOTETRIGGER_SMARTCHARGING_SPECS,
  ...FIRMWARE_SPECS,
  ...AUTHORIZE_SPECS,
];
assert.deepEqual(ids(registry), ids(specs), "list-scenarios lists every exported spec");
for (const spec of specs) {
  const tags: readonly unknown[] = spec.tags;
  assert.ok(Array.isArray(tags) && tags.length > 0, `${spec.templateId} declares no tag`);
  for (const tag of tags) {
    assert.ok(typeof tag === "string" && isScenarioTag(tag), `${spec.templateId}: unknown tag ${String(tag)}`);
  }
  assert.equal(new Set(tags).size, tags.length, `${spec.templateId} repeats a tag`);
}
for (const row of registry) {
  const spec = specs.find((candidate) => candidate.templateId === row.templateId);
  assert.deepEqual(row.tags, spec?.tags, `${row.templateId}: list-scenarios reports the declared tags`);
}

// --- 2. no dead vocabulary --------------------------------------------------

for (const tag of SCENARIO_TAGS) {
  assert.ok(
    specs.some((spec) => (spec.tags as readonly string[]).includes(tag)),
    `no registered scenario carries '${tag}'`,
  );
}

// --- 3. the filter reads the declaration ------------------------------------

assert.equal(parseScenarioTag("smart-charging"), "smart-charging");
assert.throws(() => parseScenarioTag("smartcharging"), /Unknown scenario tag 'smartcharging'\. Supported tags: provisioning, /);
assert.throws(() => parseScenarioTag("core"), /Unknown scenario tag 'core'/);
assert.throws(() => parseScenarioTag(""), /Unknown scenario tag/);

const stubs: Array<{ templateId: string; group: string; tags: readonly ScenarioTag[] }> = [
  { templateId: "cert16-smart-charging-profile", group: "remotetrigger-smartcharging", tags: ["firmware"] },
  { templateId: "cert16-firmware-update", group: "firmware", tags: ["smart-charging"] },
  { templateId: "cert16-reservation", group: "authlist-reservation", tags: ["transaction", "reservation"] },
];
assert.deepEqual(
  ids(filterScenariosByTag(stubs, "smart-charging")),
  ["cert16-firmware-update"],
  "--tag follows the declaration, not the template id or the group",
);
assert.deepEqual(ids(filterScenariosByTag(stubs, "transaction")), ["cert16-reservation"]);
assert.deepEqual(ids(filterScenariosByTag(stubs, undefined)), ids(stubs), "no tag filter keeps everything");

// --- 4. the CLI -------------------------------------------------------------

const remoteTriggerGroup = await listJson("--group", "remotetrigger-smartcharging");
const smartCharging = await listJson("--tag", "smart-charging");
const triggers = ["cert16-tc054-trigger-message", "cert16-tc055-trigger-message-rejected"];
assert.ok(triggers.every((id) => ids(remoteTriggerGroup).includes(id)), "the historical group still mixes both domains");
assert.ok(triggers.every((id) => !ids(smartCharging).includes(id)), "--tag smart-charging leaves remote trigger out");
assert.ok(smartCharging.every((row) => row.tags.includes("smart-charging")));
assert.ok(ids(smartCharging).includes("cert16-tc056-central-smart-charging-txdefault"));
assert.ok(ids(smartCharging).includes("cert201-tck01-set-tx-default-profile"));

const transactions = await listJson("--tag", "transaction");
assert.ok(new Set(transactions.map((row) => row.group)).size >= 3, "--tag transaction spans groups");

const authorization = await listJson("--tag", "authorization");
for (const id of [
  "cert16-tc023-1-authorize-invalid",
  "cert16-tc023-2-authorize-expired",
  "cert16-tc023-3-authorize-blocked",
]) {
  assert.ok(ids(authorization).includes(id), `--tag authorization finds the Gherkin-compiled ${id}`);
}

const smartCharging201 = await listJson("--version", "2.0.1", "--tag", "smart-charging");
assert.ok(smartCharging201.length > 0);
assert.deepEqual(
  ids(smartCharging201),
  ids(smartCharging).filter((id) => CORE_201_SPECS.some((spec) => spec.templateId === id)),
  "--version and --tag intersect",
);

const groupAndTag = await listJson("--group", "remotetrigger-smartcharging", "--tag", "smart-charging");
assert.deepEqual(
  ids(groupAndTag),
  ids(remoteTriggerGroup).filter((id) => ids(smartCharging).includes(id)),
  "--group and --tag intersect",
);
assert.ok(groupAndTag.length > 0 && groupAndTag.length < remoteTriggerGroup.length);

const text = await captureCli(["list-scenarios", "--tag", "remote-trigger"]);
assert.equal(text.code, 0);
assert.match(text.output, /^cert16-tc054-trigger-message\tremotetrigger-smartcharging\tremote-trigger$/m);

for (const invocation of [
  ["list-scenarios", "--tag", "smartcharging"],
  ["run", "--tag", "smartcharging"],
  ["run-all", "--tag", "smartcharging"],
]) {
  const refused = await captureCli(invocation);
  assert.equal(refused.code, 1, `${invocation.join(" ")} must fail`);
  assert.match(refused.output, /Unknown scenario tag 'smartcharging'\. Supported tags: .*smart-charging/);
}
for (const invocation of [
  ["list-scenarios", "--tag", "transaction", "--tag", "reservation"],
  ["run-all", "--tag", "transaction", "--tag", "reservation"],
]) {
  const refused = await captureCli(invocation);
  assert.equal(refused.code, 1, `${invocation.join(" ")} must fail`);
  assert.match(refused.output, /--tag may be given once/);
}
// Both refusals below return before any preflight, container or CSMS.
const mismatch = await captureCli(["run", "cert16-tc054-trigger-message", "--tag", "smart-charging"]);
assert.equal(mismatch.code, 1);
assert.match(mismatch.output, /Scenario 'cert16-tc054-trigger-message' does not carry tag 'smart-charging'/);
const empty = await captureCli(["run-all", "--group", "firmware", "--tag", "smart-charging"]);
assert.equal(empty.code, 1);
assert.match(empty.output, /group 'firmware' has 0 scenario\(s\) for version all and tag smart-charging/);

// --- 5. scope per tag -------------------------------------------------------

const byTag = scopeByTag(
  {
    a: { status: "DRIVABLE", reason: "" },
    b: { status: "NOT_APPLICABLE", reason: "no endpoint" },
    c: { status: "CONDITIONAL", reason: "unknown until a run" },
  },
  [
    { templateId: "a", ocppVersion: "OCPP-1.6J", tags: ["transaction", "smart-charging"] },
    { templateId: "b", ocppVersion: "OCPP-1.6J", tags: ["firmware"] },
    { templateId: "c", ocppVersion: "OCPP-1.6J", tags: ["transaction"] },
    { templateId: "d", ocppVersion: "OCPP-2.0.1", tags: ["certificates"] },
  ],
  ["OCPP-1.6J"],
);
assert.deepEqual(byTag, {
  "smart-charging": { DRIVABLE: 1, CONDITIONAL: 0, NOT_APPLICABLE: 0 },
  transaction: { DRIVABLE: 1, CONDITIONAL: 1, NOT_APPLICABLE: 0 },
  firmware: { DRIVABLE: 0, CONDITIONAL: 0, NOT_APPLICABLE: 1 },
  // No row, and still counted: the driver's protocols exclude it.
  certificates: { DRIVABLE: 0, CONDITIONAL: 0, NOT_APPLICABLE: 1 },
});
assert.deepEqual(Object.keys(byTag), ["smart-charging", "transaction", "firmware", "certificates"].sort(
  (x, y) => SCENARIO_TAGS.indexOf(x as ScenarioTag) - SCENARIO_TAGS.indexOf(y as ScenarioTag),
), "vocabulary order, so two runs diff cleanly");

// --- 6. the README table ----------------------------------------------------

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const section = /^### Scenario tags\n([\s\S]*?)(?=^#{2,3} )/m.exec(readme)?.[1];
assert.ok(section, "README.md has a '### Scenario tags' section");
const documented = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
assert.deepEqual(documented, [...SCENARIO_TAGS], "the README tag table lists exactly the vocabulary, in order");

process.stdout.write(
  `Scenario tags: ${specs.length} scenarios over ${SCENARIO_TAGS.length} tags, selected by declaration.\n`,
);
