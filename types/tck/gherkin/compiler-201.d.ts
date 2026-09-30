import type { ScenarioOcppVersion, ScenarioSpec } from "../spec-types";
import type { StateInvocation } from "../states-201";
type Payload = Readonly<Record<string, string | number | boolean | null>>;
type DriveInstruction = {
    kind: "wait";
    seconds: number;
} | {
    kind: "operation";
    action: "Reset";
    type: "OnIdle";
};
type AssertionInstruction = {
    kind: "state";
    state: "EnergyTransferStarted";
    description: string;
} | {
    kind: "received";
    action: "Reset";
    description: string;
} | {
    kind: "payload";
    action: "Reset";
    expected: Payload;
    description: string;
} | {
    kind: "conditional-response";
    state: "EnergyTransferStarted";
    action: "Reset";
    status: "Accepted" | "Rejected" | "Scheduled";
    description: string;
    skipReason: string;
} | {
    kind: "answered";
    action: "TransactionEvent";
};
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
export declare function compile201FeatureText(source: string, uri?: string): Gherkin201Plan;
export declare function load201PilotPlan(): Gherkin201Plan;
export declare const GHERKIN_201_PILOT: Gherkin201Plan;
export {};
