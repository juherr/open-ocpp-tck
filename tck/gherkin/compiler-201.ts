/** A closed Gherkin compiler for the OCPP 2.0.1 Reusable State pilot. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type { GherkinDocument, Step } from "@cucumber/messages";
import {
  assertAllAnswered,
  assertCallPayload,
  assertReceived,
  assertResponseStatus,
  UNEXERCISED_PREFIX,
} from "../assert";
import type { ScenarioTags } from "../scenario-tags";
import type { AssertContext, DriveContext, ScenarioOcppVersion, ScenarioSpec } from "../spec-types";
import { featureScenarioTags } from "./compiler";
import type { StateInvocation } from "../states-201";
import { assertStateEstablished } from "../states-201";
import { sleep } from "../util";

const FEATURE = "../../features/ocpp201/csms/tcb21-reset-scheduled.feature";
type Payload = Readonly<Record<string, string | number | boolean | null>>;
type DriveInstruction =
  | { kind: "wait"; seconds: number }
  | { kind: "operation"; action: "Reset"; type: "OnIdle" };
type AssertionInstruction =
  | { kind: "state"; state: "EnergyTransferStarted"; description: string }
  | { kind: "received"; action: "Reset"; description: string }
  | { kind: "payload"; action: "Reset"; expected: Payload; description: string }
  | { kind: "conditional-response"; state: "EnergyTransferStarted"; action: "Reset"; status: "Accepted" | "Rejected" | "Scheduled"; description: string; skipReason: string }
  | { kind: "answered"; action: "TransactionEvent" };

export interface Gherkin201Plan {
  readonly spec: ScenarioSpec<void>;
  readonly templateId: string;
  readonly ocppVersion: ScenarioOcppVersion;
  readonly connector: number;
  readonly bootWaitSecs: number;
  readonly holdSecs: number;
  readonly states: readonly StateInvocation[];
  readonly drive: readonly DriveInstruction[];
  readonly assertions: readonly AssertionInstruction[];
}

function parse(source: string, uri: string): GherkinDocument {
  try {
    return new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher()).parse(source);
  } catch (error) {
    throw new Error(`${uri}: invalid Gherkin: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cells(step: Step, uri: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of step.dataTable?.rows ?? []) {
    if (row.cells.length !== 2) throw new Error(`${uri}:${step.location.line}: expected a two-column table`);
    const key = row.cells[0]?.value;
    const value = row.cells[1]?.value;
    if (!key || value === undefined || result.has(key)) throw new Error(`${uri}:${step.location.line}: invalid or duplicate table field ${key ?? ""}`);
    result.set(key, value);
  }
  return result;
}

function metadata(document: GherkinDocument, uri: string) {
  const feature = document.feature;
  if (!feature || feature.children.length !== 1 || !feature.children[0]?.scenario) {
    throw new Error(`${uri}: expected exactly one Feature and one Scenario`);
  }
  const tags = new Map<string, string>();
  const scenarioTags: string[] = [];
  for (const tag of [...feature.tags, ...feature.children[0].scenario.tags]) {
    const match = /^@([A-Za-z][A-Za-z0-9]*):([^\s]+)$/.exec(tag.name);
    if (!match) throw new Error(`${uri}: invalid tag ${tag.name}`);
    const [, key, value] = match;
    if (key === "tag") {
      scenarioTags.push(value);
      continue;
    }
    if (!["id", "sut", "ocpp", "template", "connector", "bootWaitSecs", "holdSecs"].includes(key)) throw new Error(`${uri}: unknown tag @${key}`);
    if (tags.has(key)) throw new Error(`${uri}: duplicate tag @${key}`);
    tags.set(key, value);
  }
  if (tags.get("sut") !== "csms") throw new Error(`${uri}: unsupported SUT`);
  if (tags.get("ocpp") !== "2.0.1") throw new Error(`${uri}: unsupported OCPP version`);
  const id = tags.get("id");
  if (!id || !/^cert201-tcb21-reset-scheduled$/.test(id) || tags.get("template") !== id) throw new Error(`${uri}: invalid TC_B_21 identity`);
  const positive = (name: string) => {
    const value = Number(tags.get(name));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${uri}: @${name} must be a positive integer`);
    return value;
  };
  const connector = positive("connector");
  if (connector !== 1) throw new Error(`${uri}: this pilot compiler supports only @connector:1`);
  return { scenario: feature.children[0].scenario, id, ocppVersion: "OCPP-2.0.1" as const, tags: featureScenarioTags(scenarioTags, uri), connector, bootWaitSecs: positive("bootWaitSecs"), holdSecs: positive("holdSecs") };
}

function compileSteps(steps: readonly Step[], uri: string) {
  const states: StateInvocation[] = [];
  const drive: DriveInstruction[] = [];
  const assertions: AssertionInstruction[] = [];
  let outcomes = false;
  for (const step of steps) {
    const values = cells(step, uri);
    let match: RegExpExecArray | null;
    if ((match = /^the charge point has reusable state "(EnergyTransferStarted)"$/.exec(step.text))) {
      if (step.keywordType !== "Context" || states.length || values.size !== 2 || values.get("connectorId") !== "1" || values.get("idToken") !== "CE712001") throw new Error(`${uri}:${step.location.line}: invalid EnergyTransferStarted state parameters`);
      states.push({ state: "EnergyTransferStarted", connectorId: 1, idToken: "CE712001" });
      assertions.push({ kind: "state", state: "EnergyTransferStarted", description: "a transaction was running when the reset was asked for" });
    } else if (!outcomes && (match = /^the CSMS waits (\d+) seconds$/.exec(step.text))) {
      if (values.size) throw new Error(`${uri}:${step.location.line}: wait step does not accept a table`);
      drive.push({ kind: "wait", seconds: Number(match[1]) });
    } else if (!outcomes && step.text === 'the CSMS sends "Reset"') {
      if (values.size !== 1 || values.get("type") !== "OnIdle") throw new Error(`${uri}:${step.location.line}: Reset requires type=OnIdle`);
      drive.push({ kind: "operation", action: "Reset", type: "OnIdle" });
    } else {
      outcomes = true;
      if ((match = /^the "Reset" request is received$/.exec(step.text)) && values.size === 0) {
        assertions.push({ kind: "received", action: "Reset", description: "Reset.req received" });
      } else if (step.text === 'the "Reset" request payload contains:' && values.size === 1 && values.get("type") === "OnIdle") {
        assertions.push({ kind: "payload", action: "Reset", expected: { type: "OnIdle" }, description: "Reset.req asks for type=OnIdle" });
      } else if ((match = /^if reusable state "(EnergyTransferStarted)" was established, the "Reset" response status is "(Accepted|Rejected|Scheduled)"$/.exec(step.text)) && values.size === 0) {
        assertions.push({ kind: "conditional-response", state: "EnergyTransferStarted", action: "Reset", status: match[2] as "Accepted" | "Rejected" | "Scheduled", description: "Reset scheduled until the transaction ends", skipReason: `${UNEXERCISED_PREFIX} the station was idle, so this case's distinguishing outcome was never reachable` });
      } else if ((match = /^every "(TransactionEvent)" request is answered$/.exec(step.text)) && values.size === 0) {
        assertions.push({ kind: "answered", action: "TransactionEvent" });
      } else {
        throw new Error(`${uri}:${step.location.line}: unsupported step: ${step.text}`);
      }
    }
  }
  if (states.length !== 1 || drive.length !== 2 || assertions.length !== 5) throw new Error(`${uri}: incomplete TC_B_21 scenario`);
  return { states, drive, assertions };
}

function makeSpec(plan: Omit<Gherkin201Plan, "spec">, description: string, tags: ScenarioTags): ScenarioSpec<void> {
  return {
    templateId: plan.templateId,
    description,
    ocppVersion: plan.ocppVersion,
    tags,
    runsSimTemplate: false,
    connector: plan.connector,
    bootWaitSecs: plan.bootWaitSecs,
    holdSecs: plan.holdSecs,
    states: [...plan.states],
    async drive({ cpId, csms201 }: DriveContext) {
      for (const instruction of plan.drive) {
        if (instruction.kind === "wait") await sleep(instruction.seconds * 1000);
        else await csms201.execute(cpId, { action: instruction.action, type: instruction.type });
      }
    },
    async assert({ frames, rec, fixtures }: AssertContext<void>) {
      for (const instruction of plan.assertions) {
        switch (instruction.kind) {
          case "state": assertStateEstablished(rec, fixtures, instruction.state, instruction.description); break;
          case "received": assertReceived(rec, frames, instruction.action, instruction.description); break;
          case "payload": assertCallPayload(rec, frames, "received", instruction.action, instruction.expected, instruction.description); break;
          case "conditional-response":
            if (fixtures.established(instruction.state)) assertResponseStatus(rec, frames, instruction.action, instruction.status, instruction.description, { direction: "received" });
            else rec.skip(instruction.description, instruction.skipReason);
            break;
          case "answered": assertAllAnswered(rec, frames, instruction.action); break;
        }
      }
    },
  };
}

export function compile201FeatureText(source: string, uri = "<feature>"): Gherkin201Plan {
  const parsed = parse(source, uri);
  const meta = metadata(parsed, uri);
  const steps = compileSteps(meta.scenario.steps, uri);
  const plan = { templateId: meta.id, ocppVersion: meta.ocppVersion, connector: meta.connector, bootWaitSecs: meta.bootWaitSecs, holdSecs: meta.holdSecs, ...steps };
  return { ...plan, spec: makeSpec(plan, `${parsed.feature?.name ?? ""}: ${meta.scenario.name}`, meta.tags) };
}

export function load201PilotPlan(): Gherkin201Plan {
  const path = fileURLToPath(new URL(FEATURE, import.meta.url));
  return compile201FeatureText(readFileSync(path, "utf8"), path);
}

export const GHERKIN_201_PILOT = load201PilotPlan();
