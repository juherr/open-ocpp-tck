/**
 * A deliberately small Gherkin compiler for the OCPP 1.6 feasibility
 * pilots. Gherkin describes the case; this module translates its closed
 * vocabulary into the existing ScenarioSpec runner contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type { GherkinDocument, Scenario as GherkinScenario, Step as GherkinStep } from "@cucumber/messages";
import {
  assertAllAnswered,
  assertEq,
  assertIdTagInfoStatus,
  assertLineMatches,
  assertLineOrder,
  assertNoLineMatches,
  assertNonEmpty,
  assertNotSent,
  assertResponseStatus,
  assertSent,
} from "../assert";
import type { Frame } from "../ocpp";
import { warnOpFailed } from "../op-warn";
import { parseScenarioTags, type ScenarioTags } from "../scenario-tags";
import type { AssertContext, DriveContext, ScenarioOcppVersion, ScenarioSpec } from "../spec-types";
import { sleep } from "../util";

const PILOT_URIS = [
  "../../features/ocpp16/csms/tc001-cold-boot.feature",
  "../../features/ocpp16/csms/tc003-charging-plugin-first.feature",
  "../../features/ocpp16/csms/tc011-remote-start-stop.feature",
] as const;
const AUTHORIZE_URIS = [
  "../../features/ocpp16/csms/authorize/tc023-1-invalid.feature",
  "../../features/ocpp16/csms/authorize/tc023-2-expired.feature",
  "../../features/ocpp16/csms/authorize/tc023-3-blocked.feature",
] as const;

type AssertionInstruction =
  | { kind: "sent"; action: string; description: string }
  | { kind: "response"; action: string; status: string; description: string; direction?: "sent" }
  | { kind: "answered"; action: string }
  | { kind: "status-payload"; status: string; description: string }
  | { kind: "line"; pattern: RegExp; description: string }
  | { kind: "no-line"; pattern: RegExp; description: string }
  | { kind: "line-order"; before: RegExp; after: RegExp; description: string }
  | { kind: "request-id-tag"; action: "Authorize"; idTag: string; description: string }
  | { kind: "id-tag-status"; action: string; status: string; description: string }
  | { kind: "not-sent"; action: string; description: string }
  | { kind: "transaction-count-id-tag"; idTag: string; expected: number; description: string }
  | { kind: "transaction-id-tag"; idTag: string }
  | { kind: "transaction-closed" }
  | { kind: "operation-result"; action: "RemoteStartTransaction" | "RemoteStopTransaction"; status: string; description: string }
  | { kind: "boot-completed" }
  | { kind: "boot-gate-clear" };

type DriveInstruction =
  | { kind: "wait"; seconds: number }
  | { kind: "remote-start"; connectorId: 1; idTag: "CERT-TAG-2" }
  | { kind: "capture-latest-transaction" }
  | { kind: "remote-stop-captured-transaction" };

interface CompiledSteps {
  assertions: AssertionInstruction[];
  drive: DriveInstruction[];
}

interface AssertionExecutionState {
  transactionPk: string | null;
}

interface ScenarioMetadata {
  id: string;
  sut: "csms";
  template: string;
  ocppVersion: ScenarioOcppVersion;
  connector: number;
  bootWaitSecs: number;
  holdSecs: number;
  description: string;
  tags: ScenarioTags;
}

export interface GherkinPilotPlan {
  readonly spec: ScenarioSpec<void>;
  readonly templateId: string;
  readonly ocppVersion: ScenarioOcppVersion;
  readonly connector: number;
  readonly bootWaitSecs: number;
  readonly holdSecs: number;
  readonly assertions: readonly AssertionInstruction[];
  readonly drive: readonly DriveInstruction[];
}

function parseDocument(source: string, uri: string): GherkinDocument {
  try {
    const parser = new Parser(
      new AstBuilder(IdGenerator.uuid()),
      new GherkinClassicTokenMatcher(),
    );
    return parser.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${uri}: invalid Gherkin: ${message}`);
  }
}

function parseTags(document: GherkinDocument, scenario: GherkinScenario, uri: string): ScenarioMetadata {
  const feature = document.feature;
  if (!feature) throw new Error(`${uri}: expected one Feature`);
  const values = new Map<string, string>();
  const scenarioTags: string[] = [];
  for (const tag of [...feature.tags, ...scenario.tags]) {
    const match = /^@([A-Za-z][A-Za-z0-9]*):([^\s]+)$/.exec(tag.name);
    if (!match) throw new Error(`${uri}: invalid tag ${tag.name}`);
    const [, key, value] = match;
    // The one key that repeats: a scenario may be about several things.
    if (key === "tag") {
      scenarioTags.push(value);
      continue;
    }
    if (!["id", "sut", "ocpp", "template", "connector", "bootWaitSecs", "holdSecs"].includes(key)) {
      throw new Error(`${uri}: unknown tag @${key}`);
    }
    if (values.has(key)) throw new Error(`${uri}: duplicate tag @${key}`);
    values.set(key, value);
  }
  const tags = featureScenarioTags(scenarioTags, uri);
  if (values.get("ocpp") !== "1.6") {
    throw new Error(`${uri}: unsupported OCPP version ${values.get("ocpp") ?? "(missing)"}`);
  }
  if (values.get("sut") !== "csms") {
    throw new Error(`${uri}: unsupported SUT ${values.get("sut") ?? "(missing)"}; this compiler supports @sut:csms`);
  }
  const id = values.get("id");
  const template = values.get("template");
  if (!id || !/^cert16-[a-z0-9-]+$/.test(id)) throw new Error(`${uri}: invalid or missing @id`);
  if (!template || template !== id) throw new Error(`${uri}: @template must match @id`);
  const connector = positiveInteger(values.get("connector"), "connector", uri);
  if (connector !== 1) throw new Error(`${uri}: this pilot compiler supports only @connector:1`);
  const bootWaitSecs = positiveInteger(values.get("bootWaitSecs"), "bootWaitSecs", uri, true);
  const holdSecs = positiveInteger(values.get("holdSecs"), "holdSecs", uri);
  return { id, sut: "csms", template, ocppVersion: "OCPP-1.6J", connector, bootWaitSecs, holdSecs, description: "", tags };
}

/** `@tag:<name>` values, through the same vocabulary a TypeScript spec uses;
 *  the error names the file, as every other refusal here does. */
export function featureScenarioTags(values: readonly string[], uri: string): ScenarioTags {
  try {
    return parseScenarioTags(values);
  } catch (error) {
    throw new Error(`${uri}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function positiveInteger(value: string | undefined, name: string, uri: string, allowZero = false): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${uri}: @${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return parsed;
}

function table(step: GherkinStep, uri: string): Map<string, string> {
  const rows = step.dataTable?.rows;
  if (!rows) return new Map();
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.cells.length !== 2) throw new Error(`${uri}:${step.location.line}: expected a two-column table`);
    const key = row.cells[0]?.value;
    const value = row.cells[1]?.value;
    if (!key || value === undefined || result.has(key)) {
      throw new Error(`${uri}:${step.location.line}: invalid or duplicate table field ${key ?? ""}`);
    }
    result.set(key, value);
  }
  return result;
}

function compileSteps(steps: readonly GherkinStep[], uri: string): CompiledSteps {
  const result: CompiledSteps = { assertions: [], drive: [] };
  let assertionPhase = false;
  for (const step of steps) {
    const text = step.text;
    const values = table(step, uri);
    let match: RegExpExecArray | null;
    if (step.keywordType === "Outcome") assertionPhase = true;
    const unsupported = (): never => {
      throw new Error(`${uri}:${step.location.line}: unsupported step: ${text}`);
    };

    if (text === "a charge point connects on connector 1") {
      if (step.keywordType !== "Context" || values.size) unsupported();
      continue;
    }
    if (text === "the simulator scenario completes") {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({ kind: "boot-completed" });
      continue;
    }
    if ((match = /^an? "Authorize" request is sent with idTag "([A-Z0-9-]+)"$/.exec(text))) {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({
        kind: "request-id-tag",
        action: "Authorize",
        idTag: match[1]!,
        description: `Authorize.req sent with idTag ${match[1]}`,
      });
      continue;
    }
    if ((match = /^the "Authorize" response idTagInfo status is "(Invalid|Expired|Blocked)"$/.exec(text))) {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({
        kind: "id-tag-status",
        action: "Authorize",
        status: match[1]!,
        description: `Authorize.conf idTagInfo.status is ${match[1]}`,
      });
      continue;
    }
    if (text === 'no "StartTransaction" request is sent') {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({
        kind: "not-sent",
        action: "StartTransaction",
        description: "no StartTransaction sent (Authorize denied)",
      });
      continue;
    }
    if ((match = /^no transaction exists for idTag "([A-Z0-9-]+)"$/.exec(text))) {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({
        kind: "transaction-count-id-tag",
        idTag: match[1]!,
        expected: 0,
        description: `DB: no transaction row created for ${match[1]} (Authorize denied)`,
      });
      continue;
    }
    if (text === "no message is blocked by the boot gate") {
      if (!assertionPhase || values.size) unsupported();
      result.assertions.push({ kind: "boot-gate-clear" });
      continue;
    }

    if (!assertionPhase && step.keywordType !== "Outcome" && /^the CSMS waits \d+ seconds$/.test(text)) {
      if (values.size) unsupported();
      result.drive.push({ kind: "wait", seconds: Number(/\d+/.exec(text)?.[0]) });
      continue;
    }
    if (!assertionPhase && step.keywordType !== "Outcome" && text === "the CSMS sends RemoteStartTransaction") {
      if (values.size !== 3 || values.get("connectorId") !== "1" || values.get("idTag") !== "CERT-TAG-2" || values.get("action") !== "RemoteStartTransaction") unsupported();
      result.drive.push({ kind: "remote-start", connectorId: 1, idTag: "CERT-TAG-2" });
      continue;
    }
    if (!assertionPhase && step.keywordType !== "Outcome" && text === "the latest transaction is captured") {
      if (values.size) unsupported();
      result.drive.push({ kind: "capture-latest-transaction" });
      continue;
    }
    if (!assertionPhase && step.keywordType !== "Outcome" && text === "the CSMS sends RemoteStopTransaction for the captured transaction when one exists") {
      if (values.size !== 1 || values.get("action") !== "RemoteStopTransaction") unsupported();
      result.drive.push({ kind: "remote-stop-captured-transaction" });
      continue;
    }

    assertionPhase = true;
    if (values.size) unsupported();
    if ((match = /^a "([A-Za-z]+)" request is sent$/.exec(text))) {
      const description = match[1] === "MeterValues"
        ? "MeterValues sent while charging"
        : match[1] === "StopTransaction"
          ? "StopTransaction sent"
          : `${match[1]}.req sent`;
      result.assertions.push({ kind: "sent", action: match[1], description });
    } else if ((match = /^the "([A-Za-z]+)" response status is "([A-Za-z]+)"$/.exec(text))) {
      const [action, status] = [match[1]!, match[2]!];
      const description = status === "Accepted"
        ? `${action} accepted`
        : `${action} response status is ${status}`;
      result.assertions.push({ kind: "response", action, status, description, direction: "sent" });
    } else if ((match = /^every "([A-Za-z]+)" request is answered$/.exec(text))) {
      result.assertions.push({ kind: "answered", action: match[1] });
    } else if ((match = /^a "StatusNotification" request with status "(Preparing|Available)" precedes a "(StartTransaction|StopTransaction)" request$/.exec(text))) {
      result.assertions.push({ kind: "line-order", before: new RegExp(`Sent: \\[2,.*"StatusNotification".*"status":"${match[1]}"`), after: new RegExp(`Sent: \\[2,.*"${match[2]}"`), description: `${match[1]} precedes ${match[2]}` });
    } else if ((match = /^a "StartTransaction" request is sent with idTag "([A-Z0-9-]+)"$/.exec(text))) {
      result.assertions.push({ kind: "line", pattern: new RegExp(`Sent: \\[2,.*"StartTransaction".*"idTag":"${match[1]}"`), description: `StartTransaction sent with idTag ${match[1]}` });
    } else if (text === "a MeterValues request precedes a StopTransaction request") {
      result.assertions.push({ kind: "line-order", before: /Sent: \[2,.*"MeterValues"/, after: /Sent: \[2,.*"StopTransaction"/, description: "MeterValues precede StopTransaction" });
    } else if (text === "a StatusNotification request is sent with status Available") {
      result.assertions.push({ kind: "line", pattern: /Sent: \[2,.*"StatusNotification".*"status":"Available"/, description: "final StatusNotification(Available) sent" });
    } else if (text === "a StatusNotification request is sent with status Available on connector 1") {
      result.assertions.push({ kind: "status-payload", status: "Available", description: "StatusNotification(Available) sent for connector 1" });
    } else if ((match = /^the "StartTransaction" response idTagInfo status is "([A-Za-z]+)"$/.exec(text))) {
      result.assertions.push({ kind: "id-tag-status", action: "StartTransaction", status: match[1], description: "StartTransaction accepted by the CSMS" });
    } else if ((match = /^a transaction exists with idTag "([A-Z0-9-]+)"$/.exec(text))) {
      result.assertions.push({ kind: "transaction-id-tag", idTag: match[1] });
    } else if (text === "the transaction is closed") {
      result.assertions.push({ kind: "transaction-closed" });
    } else if ((match = /^the CSMS "(RemoteStartTransaction|RemoteStopTransaction)" response status is "(Accepted)"$/.exec(text))) {
      result.assertions.push({ kind: "operation-result", action: match[1] as "RemoteStartTransaction" | "RemoteStopTransaction", status: match[2], description: `${match[1]} accepted` });
    } else if ((match = /^a StartTransaction request is sent with (CSMS-supplied )?idTag "([A-Z0-9-]+)"$/.exec(text))) {
      const wording = match[1] ? "CSMS-supplied idTag" : `idTag ${match[2]}`;
      result.assertions.push({ kind: "line", pattern: new RegExp(`Sent: \\[2,.*"StartTransaction".*"idTag":"${match[2]}"`), description: `StartTransaction sent with ${wording}` });
    } else if ((match = /^a StopTransaction request is sent with reason "([A-Za-z]+)"$/.exec(text))) {
      result.assertions.push({ kind: "line", pattern: new RegExp(`Sent: \\[2,.*"StopTransaction".*"reason":"${match[1]}"`), description: `StopTransaction sent with reason ${match[1]}` });
    } else {
      unsupported();
    }
  }
  return result;
}

function parseScenario(document: GherkinDocument, uri: string): { metadata: ScenarioMetadata; steps: CompiledSteps } {
  const feature = document.feature;
  if (!feature || feature.children.length !== 1 || !feature.children[0]?.scenario) {
    throw new Error(`${uri}: expected exactly one Scenario and no Background, Rule or Scenario Outline`);
  }
  const scenario = feature.children[0].scenario;
  if (scenario.examples.length) throw new Error(`${uri}: Scenario Outline is not supported`);
  return { metadata: parseTags(document, scenario, uri), steps: compileSteps(scenario.steps, uri) };
}

function makeSpec(metadata: ScenarioMetadata, steps: CompiledSteps): ScenarioSpec<void> {
  const spec: ScenarioSpec<void> = {
    templateId: metadata.id,
    description: metadata.description,
    ocppVersion: metadata.ocppVersion,
    tags: metadata.tags,
    connector: metadata.connector,
    bootWaitSecs: metadata.bootWaitSecs,
    holdSecs: metadata.holdSecs,
    ...(steps.drive.length > 0
      ? {
          async drive(context: DriveContext): Promise<void> {
            let transactionPk = "";
            for (const instruction of steps.drive) {
              if (instruction.kind === "wait") {
                await sleep(instruction.seconds * 1000);
              } else if (instruction.kind === "remote-start") {
                try {
                  await context.csms16.execute(context.cpId, {
                    action: "RemoteStartTransaction",
                    connectorId: instruction.connectorId,
                    idTag: instruction.idTag,
                  });
                } catch (error) {
                  warnOpFailed("RemoteStartTransaction", error);
                }
              } else if (instruction.kind === "capture-latest-transaction") {
                transactionPk = await context.records.latestTransaction(context.cpId);
              } else if (transactionPk !== "") {
                try {
                  await context.csms16.execute(context.cpId, {
                    action: "RemoteStopTransaction",
                    transaction: transactionPk,
                  });
                } catch (error) {
                  warnOpFailed("RemoteStopTransaction", error);
                }
              }
            }
          }
        }
      : {}),
    async assert(context: AssertContext<void>): Promise<void> {
      const executionState: AssertionExecutionState = { transactionPk: null };
      for (const instruction of steps.assertions) {
        const keepGoing = await runAssertion(instruction, context, executionState);
        if (!keepGoing) return;
      }
    },
  };
  return spec;
}

async function selectedTransactionPk(
  context: AssertContext<void>,
  state: AssertionExecutionState,
): Promise<string> {
  if (state.transactionPk === null) {
    state.transactionPk = await context.records.latestTransaction(context.cpId);
  }
  return state.transactionPk;
}

async function runAssertion(
  instruction: AssertionInstruction,
  context: AssertContext<void>,
  state: AssertionExecutionState,
): Promise<boolean> {
  const { frames, lines, rec } = context;
  switch (instruction.kind) {
    case "sent": assertSent(rec, frames, instruction.action, instruction.description); return true;
    case "response": assertResponseStatus(rec, frames, instruction.action, instruction.status, instruction.description, { direction: instruction.direction }); return true;
    case "answered": assertAllAnswered(rec, frames, instruction.action); return true;
    case "line": assertLineMatches(rec, lines, instruction.pattern, instruction.description); return true;
    case "no-line": assertNoLineMatches(rec, lines, instruction.pattern, instruction.description); return true;
    case "line-order": assertLineOrder(rec, lines, instruction.before, instruction.after, instruction.description); return true;
    case "request-id-tag": {
      const escapedIdTag = instruction.idTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assertLineMatches(
        rec,
        lines,
        new RegExp(`Sent: \\[2,.*"Authorize".*"idTag":"${escapedIdTag}"`),
        instruction.description,
      );
      return true;
    }
    case "id-tag-status": assertIdTagInfoStatus(rec, frames, instruction.action, instruction.status, instruction.description); return true;
    case "not-sent": assertNotSent(rec, frames, instruction.action, "sent", instruction.description); return true;
    case "status-payload": {
      const found = frames.some((frame: Frame) => frame.kind === "call" && frame.direction === "sent" && frame.action === "StatusNotification" && (frame.payload as { connectorId?: number; status?: string } | null)?.connectorId === 1 && (frame.payload as { connectorId?: number; status?: string } | null)?.status === instruction.status);
      if (found) rec.pass(instruction.description);
      else rec.fail(instruction.description, "no Sent StatusNotification frame with connectorId=1, status=Available");
      return true;
    }
    case "boot-completed": assertLineMatches(rec, lines, /"event":"scenario_completed"/, "scenario ran to completion"); return true;
    case "boot-gate-clear": assertNoLineMatches(rec, lines, /blocked by the boot gate/, "no messages were dropped by the boot gate"); return true;
    case "transaction-id-tag": {
      const txPk = await selectedTransactionPk(context, state);
      if (!txPk) {
        rec.fail(`DB: transaction row exists for ${context.cpId}`, "no transaction found");
        return false;
      }
      rec.pass(`DB: transaction row exists for ${context.cpId} (pk=${txPk})`);
      const idTag = await context.records.transactionIdTag(txPk);
      assertEq(rec, idTag, instruction.idTag, `DB: id_tag is ${instruction.idTag}`);
      return true;
    }
    case "transaction-closed": {
      const txPk = await selectedTransactionPk(context, state);
      if (!txPk) {
        rec.fail("DB: transaction is closed (stop_timestamp set)", "no transaction found");
        return false;
      }
      assertNonEmpty(rec, await context.records.transactionStopTimestamp(txPk), "DB: transaction is closed (stop_timestamp set)");
      return true;
    }
    case "transaction-count-id-tag": {
      const count = await context.records.transactionCountForIdTag(context.cpId, instruction.idTag);
      assertEq(rec, count, String(instruction.expected), instruction.description);
      return true;
    }
    case "operation-result": assertResponseStatus(rec, frames, instruction.action, instruction.status, instruction.description); return true;
  }
}

export function compileFeaturePlanText(source: string, uri = "<feature>"): GherkinPilotPlan {
  const document = parseDocument(source, uri);
  const { metadata, steps } = parseScenario(document, uri);
  const feature = document.feature;
  const scenario = feature?.children[0]?.scenario;
  metadata.description = feature && scenario ? `${feature.name}: ${scenario.name}` : scenario?.name ?? "";
  return {
    spec: makeSpec(metadata, steps),
    templateId: metadata.id,
    ocppVersion: metadata.ocppVersion,
    connector: metadata.connector,
    bootWaitSecs: metadata.bootWaitSecs,
    holdSecs: metadata.holdSecs,
    assertions: steps.assertions,
    drive: steps.drive,
  };
}

export function compileFeatureText(source: string, uri = "<feature>"): ScenarioSpec<void> {
  return compileFeaturePlanText(source, uri).spec;
}

export function loadPilotPlans(): GherkinPilotPlan[] {
  return PILOT_URIS.map((relative) => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    return compileFeaturePlanText(readFileSync(path, "utf8"), path);
  });
}

export function loadAuthorizePlans(): GherkinPilotPlan[] {
  return AUTHORIZE_URIS.map((relative) => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    return compileFeaturePlanText(readFileSync(path, "utf8"), path);
  });
}

export const GHERKIN_AUTHORIZE_PLANS = loadAuthorizePlans();

export function loadPilotSpecs(): ScenarioSpec<void>[] {
  return loadPilotPlans().map((plan) => plan.spec);
}

export const GHERKIN_PILOT_SPECS = loadPilotSpecs();
