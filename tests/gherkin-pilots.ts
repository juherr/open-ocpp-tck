import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AssertContext, DriveContext, ScenarioSpec } from "../tck/spec-types";
import type { Frame } from "../tck/ocpp";
import { CORE_SPECS, tc001ColdBootSpec, tc003ChargingPluginFirstSpec } from "../tck/specs/core";
import { tc011RemoteStartStopSpec } from "../tck/specs/remotetrigger-smartcharging";
import { REMOTETRIGGER_SMARTCHARGING_SPECS } from "../tck/specs/remotetrigger-smartcharging";
import { compileFeatureText, loadPilotSpecs } from "../tck/gherkin/compiler";
import { compile201FeatureText, GHERKIN_201_PILOT } from "../tck/gherkin/compiler-201";
import { CORE_201_SPECS, TC_B_21_REFERENCE } from "../tck/specs/core-201";

const expectedIds = [
  "cert16-tc001-cold-boot",
  "cert16-tc003-charging-plugin-first",
  "cert16-tc011-remote-start-stop",
];
const specs = loadPilotSpecs();
assert.deepEqual(specs.map((spec) => spec.templateId), expectedIds);
assert.ok(specs.slice(0, 2).every((spec) => CORE_SPECS.some((registered) => registered.templateId === spec.templateId)));
assert.ok(REMOTETRIGGER_SMARTCHARGING_SPECS.some((registered) => registered.templateId === specs[2]?.templateId));
assert.ok(specs.every((spec) => spec.ocppVersion === "OCPP-1.6J"));
assert.ok(specs.every((spec) => spec.connector === 1));
assert.ok(specs.every((spec) => Boolean(spec.description)));
assert.deepEqual(
  [specs[0]?.bootWaitSecs, specs[1]?.holdSecs, specs[2]?.holdSecs],
  [4, 45, 20],
);

const source = `
@sut:csms @id:cert16-test @ocpp:1.6 @template:cert16-test @connector:1 @bootWaitSecs:4 @holdSecs:20
  Feature: Test feature
  Scenario: One case
    Given a charge point connects on connector 1
    Then a "BootNotification" request is sent
`;
assert.equal(compileFeatureText(source, "valid.feature").templateId, "cert16-test");
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
assert.ok(GHERKIN_201_PILOT.spec.description?.includes("scheduled reset"));
assert.equal(plan201.spec.ocppVersion, "OCPP-2.0.1");
assert.deepEqual(plan201.states, [{ state: "EnergyTransferStarted", connectorId: 1, idToken: "CE712001" }]);
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

console.log("gherkin-pilots: strict compilation and runtime assertion/drive parity hold");
