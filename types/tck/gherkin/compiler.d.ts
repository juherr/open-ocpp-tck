import type { ScenarioSpec } from "../spec-types";
export declare function compileFeatureText(source: string, uri?: string): ScenarioSpec<void>;
export declare function loadPilotSpecs(): ScenarioSpec<void>[];
export declare const GHERKIN_PILOT_SPECS: ScenarioSpec<void>[];
