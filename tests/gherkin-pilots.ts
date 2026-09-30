import assert from "node:assert/strict";
import type { AssertContext, DriveContext, ScenarioSpec } from "../tck/spec-types";
import type { Frame } from "../tck/ocpp";
import { tc001ColdBootSpec, tc003ChargingPluginFirstSpec } from "../tck/specs/core";
import { tc011RemoteStartStopSpec } from "../tck/specs/remotetrigger-smartcharging";
import { compileFeatureText, loadPilotSpecs } from "../tck/gherkin/compiler";

const expectedIds = [
  "cert16-tc001-cold-boot",
  "cert16-tc003-charging-plugin-first",
  "cert16-tc011-remote-start-stop",
];
const specs = loadPilotSpecs();
assert.deepEqual(specs.map((spec) => spec.templateId), expectedIds);
assert.ok(specs.every((spec) => spec.ocppVersion === "OCPP-1.6J"));
assert.ok(specs.every((spec) => spec.connector === 1));
assert.deepEqual(
  [specs[0]?.bootWaitSecs, specs[1]?.holdSecs, specs[2]?.holdSecs],
  [4, 45, 20],
);

const source = `
@sut:csms @id:cert16-test @ocpp:1.6 @template:cert16-test @connector:1 @bootWaitSecs:4 @holdSecs:20
Feature: Test feature
  Scenario: One case
    Given the charge point connects
    Then a "BootNotification" request is sent
`;
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
  /connector/i,
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

console.log("gherkin-pilots: strict compilation and runtime assertion/drive parity hold");
