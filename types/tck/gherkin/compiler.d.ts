import type { ScenarioSpec } from "../spec-types";
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
    kind: "id-tag-status";
    action: string;
    status: string;
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
    readonly connector: number;
    readonly bootWaitSecs: number;
    readonly holdSecs: number;
    readonly assertions: readonly AssertionInstruction[];
    readonly drive: readonly DriveInstruction[];
}
export declare function compileFeaturePlanText(source: string, uri?: string): GherkinPilotPlan;
export declare function compileFeatureText(source: string, uri?: string): ScenarioSpec<void>;
export declare function loadPilotPlans(): GherkinPilotPlan[];
export declare function loadPilotSpecs(): ScenarioSpec<void>[];
export declare const GHERKIN_PILOT_SPECS: ScenarioSpec<void>[];
export {};
