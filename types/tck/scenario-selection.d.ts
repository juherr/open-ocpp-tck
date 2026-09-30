import type { ScenarioTag } from "./scenario-tags";
/** OCPP version filters accepted by the scenario runner CLI. */
export type ScenarioVersionFilter = "1.6" | "2.0.1";
/** Validate the user-facing version spelling before any CSMS or simulator work. */
export declare function parseScenarioVersionFilter(value: string): ScenarioVersionFilter;
/** Filter by the protocol declaration, independently of names and groups. */
export declare function filterScenariosByVersion<T extends {
    readonly ocppVersion: string;
}>(scenarios: readonly T[], version: ScenarioVersionFilter | undefined): T[];
/** Filter by the tag declaration, independently of names, groups and versions. */
export declare function filterScenariosByTag<T extends {
    readonly tags: readonly string[];
}>(scenarios: readonly T[], tag: ScenarioTag | undefined): T[];
