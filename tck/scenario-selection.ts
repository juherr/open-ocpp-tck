// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
import type { ScenarioTag } from "./scenario-tags";

/** OCPP version filters accepted by the scenario runner CLI. */
export type ScenarioVersionFilter = "1.6" | "2.0.1";

/** Validate the user-facing version spelling before any CSMS or simulator work. */
export function parseScenarioVersionFilter(value: string): ScenarioVersionFilter {
  if (value === "1.6" || value === "2.0.1") return value;
  throw new Error(
    `Unsupported OCPP version '${value}'. Supported versions: 1.6, 2.0.1.`,
  );
}

/** Filter by the protocol declaration, independently of names and groups. */
export function filterScenariosByVersion<
  T extends { readonly ocppVersion: string },
>(
  scenarios: readonly T[],
  version: ScenarioVersionFilter | undefined,
): T[] {
  if (version === undefined) return [...scenarios];
  const protocol = version === "1.6" ? "OCPP-1.6J" : "OCPP-2.0.1";
  return scenarios.filter((scenario) => scenario.ocppVersion === protocol);
}

/** Filter by the tag declaration, independently of names, groups and versions. */
export function filterScenariosByTag<
  T extends { readonly tags: readonly string[] },
>(
  scenarios: readonly T[],
  tag: ScenarioTag | undefined,
): T[] {
  if (tag === undefined) return [...scenarios];
  return scenarios.filter((scenario) => scenario.tags.includes(tag));
}
