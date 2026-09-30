// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * A scenario's tags are a declaration, and `--tag` reads nothing else.
 *
 * Tags are the functional axis beside `--group` (upstream's array membership)
 * and `--version` (the protocol). They are selection metadata only -- neither
 * pinned artifact carries them -- so what keeps them honest is this guard, and
 * it claims eight things:
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
 *     opt-out, and `tagsDrivenNone` reads off it the domains a driver
 *     excludes.
 *  6. `check-driver` exposes both: `scopeByTag` in `--json`, and the
 *     `drives no scenario tagged:` line in its human output, each equal to
 *     what the two helpers compute from the driver's own declarations.
 *  7. `--tag transaction` selects every scenario that NEEDS a transaction --
 *     #34's "debugging a driver whose records implementation is suspect".
 *     Needing one is either declaring the `EnergyTransferStarted` state, which
 *     has the CSMS accept a transaction before the case starts, or reading one
 *     back from the CSMS: a TypeScript spec whose `drive`/`assert` calls a
 *     transaction method of `CsmsRecords`, a `.feature` whose plan holds a
 *     transaction-reading instruction. The TypeScript half reads function
 *     SOURCE, so a call made through a helper defined outside the spec is
 *     invisible to it; none is today. The converse is not claimed: the tag
 *     also covers scenarios that only read transactions off the wire.
 *  8. The README's tag table lists exactly the vocabulary.
 *
 * In-process rather than shell for the reason `tests/scenario-version.ts`
 * is: the spec objects and `scopeByTag` are unreachable through the CLI, and
 * the CLI half is cheaper through the exported `cli()` than a process per row.
 * `captureCli` is that guard's, copied: each guard here stands alone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SCENARIO_TAGS,
  parseScenarioTag,
  parseScenarioTags,
  type ScenarioTag,
} from "../tck/scenario-tags";
import { filterScenariosByTag } from "../tck/scenario-selection";
import { scopeByTag, tagsDrivenNone } from "../tck/scope";
import { driverProtocols, driverScope, type CsmsDriverModule } from "../tck/driver";
import { cli } from "../tck/main";
import { GHERKIN_AUTHORIZE_PLANS, loadPilotPlans } from "../tck/gherkin/compiler";
import { GHERKIN_201_PILOT } from "../tck/gherkin/compiler-201";
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
const idSet = (rows: readonly { templateId: string }[]) => new Set(rows.map((row) => row.templateId));

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
// The rule a `.feature` compiles through: at least one, each known, none twice.
for (const spec of specs) {
  assert.doesNotThrow(() => parseScenarioTags(spec.tags), `${spec.templateId}: ${JSON.stringify(spec.tags)}`);
}
const specById = new Map(specs.map((spec) => [spec.templateId, spec]));
for (const row of registry) {
  assert.deepEqual(row.tags, specById.get(row.templateId)?.tags, `${row.templateId}: list-scenarios reports the declared tags`);
}

// --- 2. no dead vocabulary --------------------------------------------------

for (const tag of SCENARIO_TAGS) {
  assert.ok(
    specs.some((spec) => spec.tags.includes(tag)),
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
const remoteTriggerGroupIds = idSet(remoteTriggerGroup);
const smartChargingIds = idSet(smartCharging);
assert.ok(triggers.every((id) => remoteTriggerGroupIds.has(id)), "the historical group still mixes both domains");
assert.ok(triggers.every((id) => !smartChargingIds.has(id)), "--tag smart-charging leaves remote trigger out");
assert.ok(smartCharging.every((row) => row.tags.includes("smart-charging")));
assert.ok(smartChargingIds.has("cert16-tc056-central-smart-charging-txdefault"));
assert.ok(smartChargingIds.has("cert201-tck01-set-tx-default-profile"));

const transactions = await listJson("--tag", "transaction");
assert.ok(new Set(transactions.map((row) => row.group)).size >= 3, "--tag transaction spans groups");

const authorizationIds = idSet(await listJson("--tag", "authorization"));
for (const id of [
  "cert16-tc023-1-authorize-invalid",
  "cert16-tc023-2-authorize-expired",
  "cert16-tc023-3-authorize-blocked",
]) {
  assert.ok(authorizationIds.has(id), `--tag authorization finds the Gherkin-compiled ${id}`);
}

const smartCharging201 = await listJson("--version", "2.0.1", "--tag", "smart-charging");
assert.ok(smartCharging201.length > 0);
assert.deepEqual(
  ids(smartCharging201),
  ids(smartCharging).filter((id) => specById.get(id)?.ocppVersion === "OCPP-2.0.1"),
  "--version and --tag intersect",
);

const groupAndTag = await listJson("--group", "remotetrigger-smartcharging", "--tag", "smart-charging");
assert.deepEqual(
  ids(groupAndTag),
  ids(remoteTriggerGroup).filter((id) => smartChargingIds.has(id)),
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
assert.deepEqual(
  Object.keys(byTag),
  ["transaction", "smart-charging", "firmware", "certificates"],
  "vocabulary order, so two runs diff cleanly",
);
assert.deepEqual(tagsDrivenNone(byTag), ["firmware", "certificates"], "a domain driven by nothing is named");
assert.deepEqual(
  tagsDrivenNone({ transaction: { DRIVABLE: 0, CONDITIONAL: 1, NOT_APPLICABLE: 3 } }),
  [],
  "one CONDITIONAL scenario is not an excluded domain",
);

// --- 6. check-driver exposes the per-tag scope --------------------------------

// The bundled SteVe driver, resolved here the way check-driver resolves it, so
// the expectation is computed from its declarations rather than copied from
// them: a change to its scope table moves both sides. Absolute, because
// `--driver` is a module specifier and this guard may run from anywhere.
const steveSpecifier = fileURLToPath(new URL("../drivers/steve/index.ts", import.meta.url));
const steve = ((await import(steveSpecifier)) as { csmsDriver: CsmsDriverModule }).csmsDriver;
const steveScope = driverScope(steve, process.env);
assert.ok(steveScope, "the SteVe driver declares a scope table");
const steveByTag = scopeByTag(
  steveScope,
  specs.map(({ templateId, ocppVersion, tags }) => ({ templateId, ocppVersion, tags })),
  driverProtocols(steve, process.env),
);
const steveExcluded = tagsDrivenNone(steveByTag);
// Not vacuous: a 1.6-only driver drives none of the 2.0.1-only domains.
assert.ok(steveExcluded.includes("certificates"), `SteVe excludes certificates: ${steveExcluded.join(", ")}`);
const priorDriver = process.env.CSMS_DRIVER;
try {
  const json = await captureCli(["check-driver", "--driver", steveSpecifier, "--json"]);
  assert.equal(json.code, 0, json.output);
  const summary = JSON.parse(json.output) as { scopeByTag?: unknown };
  assert.deepEqual(summary.scopeByTag, steveByTag, "check-driver --json exposes scopeByTag");
  const human = await captureCli(["check-driver", "--driver", steveSpecifier]);
  assert.equal(human.code, 0, human.output);
  assert.match(
    human.output,
    new RegExp(`^  drives no scenario tagged: ${steveExcluded.join(", ")}$`, "m"),
    "check-driver names the tags the driver drives nothing of",
  );
} finally {
  if (priorDriver === undefined) delete process.env.CSMS_DRIVER;
  else process.env.CSMS_DRIVER = priorDriver;
}

// --- 7. --tag transaction reaches every scenario that needs one ----------------

// The transaction half of CsmsRecords (tck/driver.ts); reservations, charging
// profiles and the device model are records too, and are not transactions.
const READS_TRANSACTION = /\brecords\.(?:latestTransaction|waitForActiveTransaction|transaction[A-Z]\w*)\(/;
const gherkinPlans = [...loadPilotPlans(), ...GHERKIN_AUTHORIZE_PLANS];
const gherkinIds = new Set([...gherkinPlans.map((plan) => plan.templateId), GHERKIN_201_PILOT.templateId]);
const needsTransaction = new Map<string, string>();
for (const spec of specs) {
  if (spec.states?.some((invocation) => invocation.state === "EnergyTransferStarted")) {
    needsTransaction.set(spec.templateId, "declares EnergyTransferStarted");
  } else if (!gherkinIds.has(spec.templateId) && READS_TRANSACTION.test(`${spec.drive ?? ""}\n${spec.assert}`)) {
    needsTransaction.set(spec.templateId, "reads a transaction from CsmsRecords");
  }
}
for (const plan of gherkinPlans) {
  const kinds = [...plan.drive, ...plan.assertions].map((instruction) => instruction.kind as string);
  if (kinds.some((kind) => kind === "capture-latest-transaction" || kind.startsWith("transaction-"))) {
    needsTransaction.set(plan.templateId, "its plan reads a transaction from CsmsRecords");
  }
}
// Not vacuous: all three ways in are exercised.
assert.ok(needsTransaction.get("cert201-tck29-profiles-in-transaction")?.includes("EnergyTransferStarted"));
assert.ok(needsTransaction.get("cert16-tc013-hard-reset")?.includes("CsmsRecords"));
assert.ok(needsTransaction.get("cert16-tc023-1-authorize-invalid")?.includes("plan"));
const transactionIds = idSet(transactions);
for (const [templateId, why] of needsTransaction) {
  assert.ok(transactionIds.has(templateId), `${templateId} ${why}, so --tag transaction must select it`);
}

// --- 8. the README table ----------------------------------------------------

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const section = /^### Scenario tags\n([\s\S]*?)(?=^#{2,3} )/m.exec(readme)?.[1];
assert.ok(section, "README.md has a '### Scenario tags' section");
const documented = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
assert.deepEqual(documented, [...SCENARIO_TAGS], "the README tag table lists exactly the vocabulary, in order");

process.stdout.write(
  `Scenario tags: ${specs.length} scenarios over ${SCENARIO_TAGS.length} tags, selected by declaration.\n`,
);
