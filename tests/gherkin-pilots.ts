import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AssertContext, DriveContext, ScenarioSpec } from "../tck/spec-types";
import type { Frame } from "../tck/ocpp";
import { CORE_SPECS, tc001ColdBootSpec, tc003ChargingPluginFirstSpec } from "../tck/specs/core";
import { REMOTETRIGGER_SMARTCHARGING_SPECS, tc011RemoteStartStopSpec } from "../tck/specs/remotetrigger-smartcharging";
import { compileFeaturePlanText, compileFeatureText, GHERKIN_PILOT_SPECS, loadPilotPlans, loadPilotSpecs } from "../tck/gherkin/compiler";
import { compile201FeatureText, GHERKIN_201_PILOT } from "../tck/gherkin/compiler-201";
import { CORE_201_SPECS, TC_B_21_REFERENCE } from "../tck/specs/core-201";
import { AUTHORIZE_SPECS } from "../tck/specs/authorize";
import { GHERKIN_AUTHORIZE_PLANS } from "../tck/gherkin/compiler";

const expectedIds = [
  "cert16-tc001-cold-boot",
  "cert16-tc003-charging-plugin-first",
  "cert16-tc011-remote-start-stop",
];
const specs = GHERKIN_PILOT_SPECS;
assert.deepEqual(specs.map((spec) => spec.templateId), expectedIds);
assert.ok(CORE_SPECS.includes(specs[0]!));
assert.ok(CORE_SPECS.includes(specs[1]!));
assert.ok(REMOTETRIGGER_SMARTCHARGING_SPECS.includes(specs[2]!));
assert.deepEqual(loadPilotSpecs().map((spec) => spec.templateId), expectedIds);
assert.ok(specs.every((spec) => spec.ocppVersion === "OCPP-1.6J"));
assert.ok(loadPilotPlans().every((plan) => plan.ocppVersion === plan.spec.ocppVersion));
assert.ok(specs.every((spec) => spec.connector === 1));
assert.ok(specs.every((spec) => Boolean(spec.description)));
assert.deepEqual(
  [specs[0]?.bootWaitSecs, specs[1]?.holdSecs, specs[2]?.holdSecs],
  [4, 45, 20],
);

const source = `
@sut:csms @id:cert16-test @ocpp:1.6 @template:cert16-test @connector:1 @bootWaitSecs:4 @holdSecs:20 @tag:provisioning
  Feature: Test feature
  Scenario: One case
    Given a charge point connects on connector 1
    Then a "BootNotification" request is sent
`;
assert.equal(compileFeatureText(source, "valid.feature").templateId, "cert16-test");
// Scenario tags: the same closed vocabulary as a TypeScript spec, `@tag` the
// one key that may repeat, and every refusal at compile time.
assert.deepEqual(compileFeatureText(source, "one-tag.feature").tags, ["provisioning"]);
assert.deepEqual(
  compileFeatureText(source.replace("@tag:provisioning", "@tag:authorization @tag:transaction"), "two-tags.feature").tags,
  ["authorization", "transaction"],
);
assert.throws(
  () => compileFeatureText(source.replace("@tag:provisioning", "@tag:smartcharging"), "unknown-scenario-tag.feature"),
  /unknown-scenario-tag\.feature: Unknown scenario tag 'smartcharging'\. Supported tags: /,
);
assert.throws(
  () => compileFeatureText(source.replace("@tag:provisioning", "@tag:transaction @tag:transaction"), "repeated-scenario-tag.feature"),
  /repeated-scenario-tag\.feature: .*transaction.*more than once/,
);
assert.throws(
  () => compileFeatureText(source.replace(" @tag:provisioning", ""), "untagged.feature"),
  /untagged\.feature: .*at least one scenario tag/,
);
assert.throws(
  () => compileFeatureText(source.replace("@holdSecs:20", "@holdSecs:20 @holdSecs:20"), "repeated-key.feature"),
  /duplicate tag @holdSecs/,
  "@tag repeating does not let any other key repeat",
);
const rejectedFeature = source.replace(
  'Then a "BootNotification" request is sent',
  'Then the "BootNotification" response status is "Rejected"',
);
const rejectedAssertion = compileFeaturePlanText(rejectedFeature, "rejected-status.feature").assertions.find(
  (assertion) => assertion.kind === "response",
);
assert.ok(rejectedAssertion);
assert.equal(rejectedAssertion.status, "Rejected");
assert.equal(rejectedAssertion.description, "BootNotification response status is Rejected");
assert.doesNotMatch(rejectedAssertion.description, /accepted/i);
const acceptedAssertion = loadPilotPlans()[0]?.assertions.find((assertion) => assertion.kind === "response");
assert.ok(acceptedAssertion);
assert.equal(acceptedAssertion.description, "BootNotification accepted");
assert.throws(
  () => compileFeatureText(source.replace("@ocpp:1.6", "@ocpp:9.9"), "invalid-version.feature"),
  /unsupported OCPP version/i,
);
assert.throws(
  () => compileFeatureText(source.replace("@sut:csms", "@sut:charge-point"), "unsupported-sut.feature"),
  /unsupported SUT/i,
);
assert.throws(
  () => compileFeatureText(source.replace("@sut:csms ", ""), "missing-sut.feature"),
  /unsupported SUT.*missing/i,
);
assert.throws(
  () => compileFeatureText(source.replace("@id:cert16-test", "@unknown:value @id:cert16-test"), "unknown-tag.feature"),
  /unknown tag/i,
);
assert.throws(
  () => compileFeatureText(source.replace("a \"BootNotification\" request is sent", "the station behaves correctly"), "unknown-step.feature"),
  /unsupported step/i,
);
assert.throws(
  () => compileFeatureText(source.replace("@connector:1", "@connector:nope"), "invalid-connector.feature"),
  /@connector must be a positive integer/i,
);
assert.throws(
  () => compileFeatureText(source.replace("@connector:1", "@connector:2"), "unsupported-connector.feature"),
  /supports only @connector:1/i,
);

const source201 = readFileSync(new URL("../features/ocpp201/csms/tcb21-reset-scheduled.feature", import.meta.url), "utf8");
const plan201 = compile201FeatureText(source201, "tcb21-reset-scheduled.feature");
assert.equal(GHERKIN_201_PILOT.templateId, plan201.templateId);
assert.equal(plan201.spec.templateId, "cert201-tcb21-reset-scheduled");
assert.ok(CORE_201_SPECS.includes(GHERKIN_201_PILOT.spec));
assert.equal(GHERKIN_201_PILOT.ocppVersion, "OCPP-2.0.1");
assert.equal(GHERKIN_201_PILOT.spec.ocppVersion, GHERKIN_201_PILOT.ocppVersion);
assert.ok(GHERKIN_201_PILOT.spec.description?.includes("scheduled reset"));
assert.equal(plan201.spec.ocppVersion, "OCPP-2.0.1");
assert.deepEqual(plan201.states, [{ state: "EnergyTransferStarted", connectorId: 1, idToken: "CE712001" }]);
assert.deepEqual(plan201.spec.tags, TC_B_21_REFERENCE.tags, "the compiled TC_B_21 declares its reference's tags");
assert.throws(
  () => compile201FeatureText(source201.replace("@tag:provisioning", "@tag:nope"), "unknown-scenario-tag-201.feature"),
  /Unknown scenario tag 'nope'/,
);
assert.throws(
  () => compile201FeatureText(source201.replace(/ @tag:[a-z-]+/g, ""), "untagged-201.feature"),
  /untagged-201\.feature: .*at least one scenario tag/,
);
assert.throws(
  () => compile201FeatureText(source201.replace("@tag:provisioning", "@tag:provisioning @tag:provisioning"), "repeated-scenario-tag-201.feature"),
  /more than once/,
);
assert.throws(
  () => compile201FeatureText(source201.replace("@connector:1", "@connector:2"), "unsupported-connector-201.feature"),
  /supports only @connector:1/i,
);
assert.throws(
  () => compile201FeatureText(source201.replace("type | OnIdle", "type | Immediate"), "invalid-reset-parameter.feature"),
  /Reset requires type=OnIdle/i,
);
assert.throws(
  () => compile201FeatureText(source201.replace("the \"Reset\" request is received", "the station behaves correctly"), "unsupported-201-step.feature"),
  /unsupported step: the station behaves correctly/i,
);
assert.notDeepEqual(
  plan201.assertions,
  compile201FeatureText(source201.replace('status is "Scheduled"', 'status is "Accepted"'), "changed-assertion.feature").assertions,
);
assert.notDeepEqual(
  plan201.drive,
  compile201FeatureText(source201.replace("waits 2 seconds", "waits 3 seconds"), "changed-drive.feature").drive,
);
assert.notDeepEqual(
  plan201.drive,
  compile201FeatureText(
    source201.replace(
      'When the CSMS waits 2 seconds\n    And the CSMS sends "Reset"\n      | type | OnIdle |',
      'When the CSMS sends "Reset"\n      | type | OnIdle |\n    And the CSMS waits 2 seconds',
    ),
    "reordered-drive.feature",
  ).drive,
);

const references = [tc001ColdBootSpec, tc003ChargingPluginFirstSpec, tc011RemoteStartStopSpec];
references.forEach((reference, index) => {
  assert.deepEqual(specs[index]?.tags, reference.tags, `${reference.templateId}: the .feature declares its reference's tags`);
});
assert.ok(
  AUTHORIZE_SPECS.every((spec) => spec.tags.includes("authorization")),
  "the Authorize features are tagged for what they exercise",
);
assert.deepEqual(specs.map((spec, index) => spec.templateId === references[index]?.templateId), [true, true, true]);

function frame(
  kind: "call" | "callresult",
  direction: "sent" | "received",
  uniqueId: string,
  action: string,
  payload: unknown,
): Frame {
  if (kind === "call") return { kind, direction, uniqueId, action, payload, timestamp: "", raw: "" };
  return { kind, direction, uniqueId, payload, timestamp: "", raw: "" };
}

const framesByScenario: Frame[][] = [
  [
    frame("call", "sent", "boot", "BootNotification", {}),
    frame("callresult", "received", "boot", "", { status: "Accepted" }),
    frame("call", "sent", "status", "StatusNotification", { connectorId: 1, status: "Available" }),
    frame("callresult", "received", "status", "", {}),
  ],
  [
    frame("call", "sent", "start", "StartTransaction", { idTag: "CERT003" }),
    frame("callresult", "received", "start", "", { idTagInfo: { status: "Accepted" } }),
    frame("call", "sent", "meter", "MeterValues", {}),
    frame("callresult", "received", "meter", "", {}),
    frame("call", "sent", "stop", "StopTransaction", {}),
    frame("callresult", "received", "stop", "", {}),
    frame("call", "sent", "status", "StatusNotification", {}),
    frame("callresult", "received", "status", "", {}),
  ],
  [
    frame("call", "received", "remote-start", "RemoteStartTransaction", {}),
    frame("callresult", "sent", "remote-start", "", { status: "Accepted" }),
    frame("call", "received", "remote-stop", "RemoteStopTransaction", {}),
    frame("callresult", "sent", "remote-stop", "", { status: "Accepted" }),
    frame("call", "sent", "start", "StartTransaction", { idTag: "CERT-TAG-2" }),
    frame("callresult", "received", "start", "", {}),
    frame("call", "sent", "status", "StatusNotification", {}),
    frame("callresult", "received", "status", "", {}),
    frame("call", "sent", "stop", "StopTransaction", {}),
    frame("callresult", "received", "stop", "", {}),
  ],
];
const linesByScenario = [
  ['Sent: [2,"status","StatusNotification",{"connectorId":1,"status":"Available"}]', '{"event":"scenario_completed"}'],
  [
    'Sent: [2,"status","StatusNotification",{"status":"Preparing"}]',
    'Sent: [2,"start","StartTransaction",{"idTag":"CERT003"}]',
    'Sent: [2,"meter","MeterValues",{}]',
    'Sent: [2,"stop","StopTransaction",{}]',
    'Sent: [2,"final","StatusNotification",{"status":"Available"}]',
  ],
  [
    'Sent: [2,"start","StartTransaction",{"idTag":"CERT-TAG-2"}]',
    'Sent: [2,"stop","StopTransaction",{"reason":"Remote"}]',
  ],
];

async function assertionResults(
  spec: ScenarioSpec<void>,
  index: number,
  transactionPk = "42",
  transactionIdTag = "CERT003",
): Promise<string[]> {
  const results: string[] = [];
  const rec = {
    pass: (description: string) => results.push(`PASS ${description}`),
    fail: (description: string, reason: string) => results.push(`FAIL ${description} :: ${reason}`),
    skip: (description: string, reason: string) => results.push(`SKIP ${description} :: ${reason}`),
  };
  const records = {
    latestTransaction: async () => transactionPk,
    transactionIdTag: async () => transactionIdTag,
    transactionStopTimestamp: async () => "2026-01-01T00:00:00Z",
  };
  await spec.assert?.({
    cpId: "CERTCP1",
    connector: 1,
    frames: framesByScenario[index] ?? [],
    lines: linesByScenario[index] ?? [],
    rec,
    records,
    driveState: undefined,
    fixtures: [],
  } as unknown as AssertContext<void>);
  return results;
}

for (let index = 0; index < specs.length; index += 1) {
  assert.deepEqual(await assertionResults(specs[index]!, index), await assertionResults(references[index]!, index));
}
async function transactionIdentityResults(spec: ScenarioSpec<void>) {
  const results: string[] = [];
  const latestPks: string[] = [];
  const inspectedPks: string[] = [];
  const rec = {
    pass: (description: string) => results.push(`PASS ${description}`),
    fail: (description: string, reason: string) => results.push(`FAIL ${description} :: ${reason}`),
    skip: (description: string, reason: string) => results.push(`SKIP ${description} :: ${reason}`),
  };
  await spec.assert?.({
    cpId: "CERTCP1",
    connector: 1,
    frames: framesByScenario[1] ?? [],
    lines: linesByScenario[1] ?? [],
    rec,
    records: {
      latestTransaction: async () => {
        const pk = latestPks.length === 0 ? "transaction-A" : "transaction-B";
        latestPks.push(pk);
        return pk;
      },
      transactionIdTag: async (pk: string) => {
        inspectedPks.push(`idTag:${pk}`);
        return pk === "transaction-A" ? "CERT003" : "OTHER-TAG";
      },
      transactionStopTimestamp: async (pk: string) => {
        inspectedPks.push(`closed:${pk}`);
        return pk === "transaction-A" ? "" : "2026-01-01T00:00:00Z";
      },
    },
    driveState: undefined,
    fixtures: [],
  } as unknown as AssertContext<void>);
  return { results, latestPks, inspectedPks };
}
const gherkinTransactionIdentity = await transactionIdentityResults(specs[1]!);
const referenceTransactionIdentity = await transactionIdentityResults(references[1]!);
assert.deepEqual(gherkinTransactionIdentity, referenceTransactionIdentity);
assert.deepEqual(gherkinTransactionIdentity.latestPks, ["transaction-A"]);
assert.deepEqual(gherkinTransactionIdentity.inspectedPks, ["idTag:transaction-A", "closed:transaction-A"]);
for (const index of [1, 2]) {
  assert.deepEqual(await assertionResults(specs[index]!, index, ""), await assertionResults(references[index]!, index, ""));
}
assert.deepEqual(await assertionResults(specs[1]!, 1, "42", "wrong-tag"), await assertionResults(references[1]!, 1, "42", "wrong-tag"));

const driveEvents = async (spec: ScenarioSpec<void>, transactionPk = "42"): Promise<{ waits: number[]; events: string[] }> => {
  const waits: number[] = [];
  const events: string[] = [];
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay = 0, ...args: unknown[]) => {
    waits.push(Number(delay));
    return originalTimeout(handler, 0, ...args);
  }) as typeof globalThis.setTimeout;
  try {
    await spec.drive?.({
      cpId: "CERTCP1",
      connector: 1,
      sim: {} as DriveContext["sim"],
      csms16: {
        execute: async (_cpId: string, operation: Parameters<DriveContext["csms16"]["execute"]>[1]) => {
          events.push(`operation:${JSON.stringify(operation)}`);
          return "request-id";
        },
        } as unknown as DriveContext["csms16"],
      csms201: {} as DriveContext["csms201"],
      records: {
        latestTransaction: async () => {
          events.push("records:latestTransaction");
          return transactionPk;
        },
      } as unknown as DriveContext["records"],
    });
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
  return { waits, events };
};
assert.deepEqual(await driveEvents(specs[2]!), await driveEvents(references[2]!));
assert.deepEqual(await driveEvents(specs[2]!, ""), await driveEvents(references[2]!, ""));

const resetFrames: Frame[] = [
  frame("call", "received", "reset", "Reset", { type: "OnIdle" }),
  frame("callresult", "sent", "reset", "", { status: "Scheduled" }),
  frame("call", "sent", "tx-event", "TransactionEvent", { eventType: "Updated" }),
  frame("callresult", "received", "tx-event", "", {}),
];
async function assertionResults201(spec: ScenarioSpec<void>, established: boolean): Promise<string[]> {
  const results: string[] = [];
  const rec = {
    pass: (description: string) => results.push(`PASS ${description}`),
    fail: (description: string, reason: string) => results.push(`FAIL ${description} :: ${reason}`),
    skip: (description: string, reason: string) => results.push(`SKIP ${description} :: ${reason}`),
  };
  await spec.assert?.({
    cpId: "CERTCP1", connector: 1, frames: resetFrames, lines: [], rec,
    records: {}, driveState: undefined,
    fixtures: { established: () => established, reasonFor: () => established ? undefined : "fixture did not reach state" },
  } as unknown as AssertContext<void>);
  return results;
}
assert.deepEqual(await assertionResults201(plan201.spec, true), await assertionResults201(TC_B_21_REFERENCE, true));
assert.deepEqual(await assertionResults201(plan201.spec, false), await assertionResults201(TC_B_21_REFERENCE, false));

async function driveEvents201(spec: ScenarioSpec<void>): Promise<{ waits: number[]; events: string[] }> {
  const waits: number[] = [];
  const events: string[] = [];
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay = 0, ...args: unknown[]) => {
    waits.push(Number(delay));
    return originalTimeout(handler, 0, ...args);
  }) as typeof setTimeout;
  try {
    await spec.drive?.({
      cpId: "CERTCP1", connector: 1, sim: {} as DriveContext["sim"],
      csms16: {} as DriveContext["csms16"],
      csms201: { execute: async (_cpId: string, operation: Parameters<DriveContext["csms201"]["execute"]>[1]) => { events.push(JSON.stringify(operation)); return "request-id"; } } as unknown as DriveContext["csms201"],
      records: {} as DriveContext["records"],
    });
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
  return { waits, events };
}
assert.deepEqual(await driveEvents201(plan201.spec), await driveEvents201(TC_B_21_REFERENCE));

const authorizePlans = GHERKIN_AUTHORIZE_PLANS;
const authorizeSpecs = authorizePlans.map((plan) => plan.spec);
const authorizeIds = [
  "cert16-tc023-1-authorize-invalid",
  "cert16-tc023-2-authorize-expired",
  "cert16-tc023-3-authorize-blocked",
];
const authorizeTags = ["CERT023-INV", "CERT023-EXP", "CERT023-BLK"];
const authorizeStatuses = ["Invalid", "Expired", "Blocked"];
assert.deepEqual(authorizeSpecs.map((spec) => spec.templateId), authorizeIds);
assert.deepEqual(authorizeSpecs.map((spec) => spec.description), [
  "TC_023.1 Authorize Outcome (Invalid): unknown idTag CERT023-INV -> Authorize.conf Invalid, no StartTransaction.",
  "TC_023.2 Authorize Outcome (Expired): idTag CERT023-EXP has expiry_date in the past -> Authorize.conf Expired, no StartTransaction.",
  "TC_023.3 Authorize Outcome (Blocked): idTag CERT023-BLK is blocked -> Authorize.conf Blocked, no StartTransaction.",
]);
assert.deepEqual(authorizePlans.map((plan) => [plan.ocppVersion, plan.connector, plan.bootWaitSecs, plan.holdSecs]),
  authorizeIds.map(() => ["OCPP-1.6J", 1, 4, 15]));

const authorizeFrames = (idTag: string, status: string, startTransaction = false): Frame[] => [
  frame("call", "sent", "authorize", "Authorize", { idTag }),
  frame("callresult", "received", "authorize", "", { idTagInfo: { status } }),
  ...(startTransaction ? [frame("call", "sent", "start", "StartTransaction", { idTag })] : []),
];
async function authorizeAssertionResults(
  spec: ScenarioSpec<void>, index: number,
  { idTag = authorizeTags[index]!, status = authorizeStatuses[index]!, authorizePresent = true, startTransaction = false, completed = true, transactionCount = "0" } = {},
): Promise<string[]> {
  const results: string[] = [];
  const rec = {
    pass: (description: string) => results.push(`PASS ${description}`),
    fail: (description: string, reason: string) => results.push(`FAIL ${description} :: ${reason}`),
    skip: (description: string, reason: string) => results.push(`SKIP ${description} :: ${reason}`),
  };
  await spec.assert?.({
    cpId: "CERTCP1", connector: 1,
    frames: authorizePresent ? authorizeFrames(idTag, status, startTransaction) : [],
    lines: [
      ...(authorizePresent ? [`Sent: [2,"authorize","Authorize",{"idTag":"${idTag}"}]`] : []),
      ...(completed ? ['{"event":"scenario_completed"}'] : []),
    ],
    rec,
    records: { transactionCountForIdTag: async () => transactionCount },
    driveState: undefined, fixtures: [],
  } as unknown as AssertContext<void>);
  return results;
}
for (let index = 0; index < authorizeSpecs.length; index += 1) {
  const parityCases = [
    { input: {}, statuses: ["PASS", "PASS", "PASS", "PASS", "PASS"] },
    { input: { idTag: "WRONG-TAG" }, statuses: ["FAIL", "PASS", "PASS", "PASS", "PASS"] },
    { input: { status: "Accepted" }, statuses: ["PASS", "FAIL", "PASS", "PASS", "PASS"] },
    { input: { startTransaction: true }, statuses: ["PASS", "PASS", "FAIL", "PASS", "PASS"] },
    { input: { completed: false }, statuses: ["PASS", "PASS", "PASS", "FAIL", "PASS"] },
    { input: { transactionCount: "1" }, statuses: ["PASS", "PASS", "PASS", "PASS", "FAIL"] },
    { input: { authorizePresent: false }, statuses: ["FAIL", "FAIL", "PASS", "PASS", "PASS"] },
  ];
  for (const { input, statuses } of parityCases) {
    const gherkinResult = await authorizeAssertionResults(authorizeSpecs[index]!, index, input);
    assert.deepEqual(
      gherkinResult.map((result) => result.slice(0, 4).trim()),
      statuses,
      `authorize ${authorizeIds[index]} reports the expected verdicts for ${JSON.stringify(input)}`,
    );
    assert.ok(gherkinResult.every((result) => /^\w+ .+/.test(result)), "authorize reports retain readable descriptions");
  }
}
assert.equal(AUTHORIZE_SPECS.length, authorizeSpecs.length);
assert.ok(AUTHORIZE_SPECS.every((spec, index) => spec === authorizeSpecs[index]));
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace('status is "Invalid"', 'status is "Accepted"'),
    "unsupported-authorize-status.feature",
  ),
  /unsupported step/i,
);
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace('"Authorize" request is sent with idTag', '"MysteryAction" request is sent with idTag'),
    "unsupported-authorize-action.feature",
  ),
  /unsupported step/i,
);
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace('idTag "CERT023-INV"', 'idTag "bad tag"'),
    "malformed-authorize-id-tag.feature",
  ),
  /unsupported step|invalid idTag/i,
);
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace("no transaction exists for idTag", "a transaction exists for idTag"),
    "unknown-authorize-step.feature",
  ),
  /unsupported step/i,
);
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace(
        'Then an "Authorize" request is sent with idTag "CERT023-INV"',
        'Then an "Authorize" request is sent with idTag "CERT023-INV"\n      | idTag | CERT023-INV | extra |',
      ),
    "invalid-authorize-table.feature",
  ),
  /expected a two-column table/i,
);
assert.throws(
  () => compileFeaturePlanText(
    readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8")
      .replace("@holdSecs:15", "@holdSecs:bad"),
    "invalid-authorize-metadata.feature",
  ),
  /@holdSecs must be a positive integer/i,
);
const invalidAuthorizeSource = readFileSync(new URL("../features/ocpp16/csms/authorize/tc023-1-invalid.feature", import.meta.url), "utf8");
const invalidAuthorizePlan = compileFeaturePlanText(invalidAuthorizeSource, "authorize-mutation-control.feature");
for (const [before, after] of [
  ['status is "Invalid"', 'status is "Expired"'],
  ['idTag "CERT023-INV"', 'idTag "CERT023-EXP"'],
  ['no "StartTransaction" request is sent', 'a "StartTransaction" request is sent'],
  ['no transaction exists for idTag "CERT023-INV"', 'no transaction exists for idTag "CERT023-EXP"'],
]) {
  const changed = compileFeaturePlanText(invalidAuthorizeSource.replace(before, after), "authorize-mutated.feature");
  assert.notDeepEqual(changed.assertions, invalidAuthorizePlan.assertions, `canonical assertions change for ${before}`);
}
assert.notDeepEqual(
  compileFeaturePlanText(invalidAuthorizeSource.replace("@holdSecs:15", "@holdSecs:16"), "authorize-mutated-timing.feature"),
  invalidAuthorizePlan,
  "canonical plan changes when Gherkin timing changes",
);

console.log("gherkin-pilots: strict compilation and runtime assertion/drive parity hold");
