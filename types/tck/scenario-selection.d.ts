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
/** The filters that intersect with a group; each reads its own declaration. */
export interface ScenarioSelection {
    readonly version?: ScenarioVersionFilter;
    readonly tag?: ScenarioTag;
}
/** Every filter in `selection`, intersected -- the one way a sweep or a list
 *  narrows its group, so a new axis is added here and nowhere else. */
export declare function selectScenarios<T extends {
    readonly ocppVersion: string;
    readonly tags: readonly string[];
}>(scenarios: readonly T[], selection: ScenarioSelection): T[];
/** The selection as the refusal of an empty sweep spells it. */
export declare function describeSelection(selection: ScenarioSelection): string;
