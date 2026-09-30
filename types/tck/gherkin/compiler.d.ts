import { type ScenarioTags } from "../scenario-tags";
import type { ScenarioOcppVersion, ScenarioSpec } from "../spec-types";
type AssertionInstruction = {
    kind: "sent";
    action: string;
    description: string;
} | {
    kind: "response";
    action: string;
    status: string;
    description: string;
    direction?: "sent";
} | {
    kind: "answered";
    action: string;
} | {
    kind: "status-payload";
    status: string;
    description: string;
} | {
    kind: "line";
    pattern: RegExp;
    description: string;
} | {
    kind: "no-line";
    pattern: RegExp;
    description: string;
} | {
    kind: "line-order";
    before: RegExp;
    after: RegExp;
    description: string;
} | {
    kind: "request-id-tag";
    action: "Authorize";
    idTag: string;
    description: string;
} | {
    kind: "id-tag-status";
    action: string;
    status: string;
    description: string;
} | {
    kind: "not-sent";
    action: string;
    description: string;
} | {
    kind: "transaction-count-id-tag";
    idTag: string;
    expected: number;
    description: string;
} | {
    kind: "transaction-id-tag";
    idTag: string;
} | {
    kind: "transaction-closed";
} | {
    kind: "operation-result";
    action: "RemoteStartTransaction" | "RemoteStopTransaction";
    status: string;
    description: string;
} | {
    kind: "boot-completed";
} | {
    kind: "boot-gate-clear";
};
type DriveInstruction = {
    kind: "wait";
    seconds: number;
} | {
    kind: "remote-start";
    connectorId: 1;
    idTag: "CERT-TAG-2";
} | {
    kind: "capture-latest-transaction";
} | {
    kind: "remote-stop-captured-transaction";
};
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
/** `@tag:<name>` values, through the same vocabulary a TypeScript spec uses;
 *  the error names the file, as every other refusal here does. */
export declare function featureScenarioTags(values: readonly string[], uri: string): ScenarioTags;
export declare function compileFeaturePlanText(source: string, uri?: string): GherkinPilotPlan;
export declare function compileFeatureText(source: string, uri?: string): ScenarioSpec<void>;
export declare function loadPilotPlans(): GherkinPilotPlan[];
export declare function loadAuthorizePlans(): GherkinPilotPlan[];
export declare const GHERKIN_AUTHORIZE_PLANS: GherkinPilotPlan[];
export declare function loadPilotSpecs(): ScenarioSpec<void>[];
export declare const GHERKIN_PILOT_SPECS: ScenarioSpec<void>[];
export {};
