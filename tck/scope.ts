// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scope.ts -- the TYPE of a driver's scope declaration, and the coverage
 * helpers that keep it honest. The DATA lives in each driver
 * (drivers/<id>/scope.ts): what a CSMS can and cannot drive is a fact about
 * that CSMS, not about this harness.
 *
 * The runner consults the active driver's table BEFORE starting any container.
 * A NOT_APPLICABLE scenario never launches docker, never touches the CSMS, and
 * is reported with its reason. Deterministic, reviewable offline, free.
 *
 * {@link UnsupportedOperationError} is the SECOND line of defence, not the
 * first. When it fires the runner records NOT APPLICABLE *and* prints that the
 * scope table is out of date -- that print is how a desynchronisation between
 * a driver's claims and its behaviour gets noticed instead of accumulating.
 *
 * RULES FOR A DRIVER AUTHOR EDITING ITS TABLE
 *  - Every `reason` cites the precise limitation: an endpoint that does not
 *    exist, a DTO member that is absent. Never a guess. If you cannot name the
 *    limitation, the row is CONDITIONAL, not NOT_APPLICABLE.
 *  - CONDITIONAL means "expressible, but whether the CSMS emits the OCPP
 *    message we need is unknown until a real run". State the exact question
 *    the first live run must answer.
 *  - NEVER demote a row to NOT_APPLICABLE to make a red scenario go away. That
 *    converts a finding about the CSMS into a silence about the harness, and
 *    it is indistinguishable from the finding never having existed.
 *  - For an OCPP 2.0.1 scenario, OPEN the reason with the feature identifier
 *    the case is conditional on -- "C-45: ...", from Part 5 §4's `Feature no.`
 *    column. That protocol makes features optional rather than cases and
 *    publishes an identifier per feature; OCPP 1.6 publishes none, so its rows
 *    are prose and stay prose. OCA-201-SELECTION.md has the provenance.
 *  - A driver that declares `protocols` needs rows only for scenarios in those
 *    protocols. A driver with no declaration keeps the compatibility rule:
 *    rows for every registered scenario. This is checked by `scopeCoverage`.
 */

import { SCENARIO_TAGS, type ScenarioTag } from "./scenario-tags";
import type { ScenarioOcppVersion } from "./spec-types";

export type ScopeStatus = "DRIVABLE" | "CONDITIONAL" | "NOT_APPLICABLE";

// TRIED AND NOT BUILT, here because here is where it gets re-proposed: giving
// the feature identifier above a home of its own instead of a string prefix.
// Two shapes, declined for two different reasons, and `//` rather than a doc
// comment so an internal decision stays out of the emitted declarations.
//
// A CLOSED UNION of feature ids, so a typo is a build error the way
// V1_LOCAL_LIST makes one in drivers/citrineos/scope.ts: premature. No scenario
// of the protocol that HAS those identifiers is registered yet, so the union
// would be written against zero rows. It used to be premature twice, the second
// reason being that the complete enumeration it needs would reproduce a
// no-derivatives table rather than cite one; that reason is retired -- such a
// table is permitted, and OCA-201-SELECTION.md's licensing section says why. So
// zero rows is the whole of the objection now, and it expires on its own.
//
// AN OPTIONAL `feature?: string` beside `reason`, which is additive, keeps 1.6
// rows prose and enumerates nothing: the objections above do not touch it, and
// it is declined only because it would ship a field no row sets and no check
// reads. It is the cheaper of the two the day either changes, so weigh it
// first -- the prefix convention is what has to be shown insufficient, and one
// real row citing one real feature is what shows it.
export interface ScopeEntry {
  status: ScopeStatus;
  reason: string;
}

/** One row per registered scenario `templateId`. */
export type ScopeTable = Readonly<Record<string, ScopeEntry>>;

/** A protocol declaration can make an absent scope row mean the driver cannot
 *  execute that scenario. Without a declaration, absence retains the legacy
 *  "run it and find out" behavior. */
export function scopeEntryForScenario(
  table: ScopeTable | undefined,
  templateId: string,
  ocppVersion: ScenarioOcppVersion,
  protocols?: readonly ScenarioOcppVersion[],
): ScopeEntry | undefined {
  if (protocols !== undefined && !protocols.includes(ocppVersion)) {
    return {
      status: "NOT_APPLICABLE",
      reason: `Driver does not declare support for ${ocppVersion}.`,
    };
  }
  return table?.[templateId];
}

export function scopeFor(
  table: ScopeTable,
  templateId: string,
): ScopeEntry | undefined {
  return table[templateId];
}

export function templateIdsWithStatus(
  table: ScopeTable,
  status: ScopeStatus,
): string[] {
  return Object.entries(table)
    .filter(([, entry]) => entry.status === status)
    .map(([templateId]) => templateId)
    .sort();
}

/**
 * Both directions of drift between a table and the scenario registry.
 *
 * `missing` -- a registered scenario with no row: the campaign would run it
 * and only discover the gap at runtime, through UnsupportedOperationError,
 * after starting a container and touching the CSMS.
 *
 * `stale` -- a row for a scenario nobody registers: usually a rename, and it
 * silently stops covering anything.
 */
// A protocol declaration is resolved and validated by driverProtocols, then
// used for both scope coverage and runtime applicability. Declared protocols
// need rows only for scenarios in those protocols; unsupported scenarios are
// NOT_APPLICABLE before simulator startup. Drivers without a declaration keep
// the legacy requirement for rows covering every registered scenario.
export function scopeCoverage(
  table: ScopeTable,
  registeredScenarios: readonly { templateId: string; ocppVersion: ScenarioOcppVersion }[],
  protocols?: readonly ScenarioOcppVersion[],
): { missing: string[]; stale: string[] } {
  const registered = new Set(registeredScenarios.map((scenario) => scenario.templateId));
  const required = new Set(
    registeredScenarios
      .filter((scenario) => protocols === undefined || protocols.includes(scenario.ocppVersion))
      .map((scenario) => scenario.templateId),
  );
  const rows = new Set(Object.keys(table));
  return {
    missing: [...required].filter((id) => !rows.has(id)).sort(),
    stale: [...rows].filter((id) => !registered.has(id)).sort(),
  };
}

/**
 * A driver's scope, counted per tag: what `check-driver` reports so that a
 * driver excluding a whole domain is named as such rather than left for a
 * reader to add up. A scenario counts under every tag it carries, so the
 * counts do not sum to the registry. Its status is the one the runner would
 * apply -- a protocol the driver does not declare is NOT_APPLICABLE with no
 * row -- and a scenario with no status at all is left out: `scopeCoverage`
 * already reports it as missing. Keys in vocabulary order, and only tags
 * some scenario carries, so two runs diff cleanly.
 */
export function scopeByTag(
  table: ScopeTable,
  registeredScenarios: readonly {
    templateId: string;
    ocppVersion: ScenarioOcppVersion;
    tags: readonly ScenarioTag[];
  }[],
  protocols?: readonly ScenarioOcppVersion[],
): Partial<Record<ScenarioTag, Record<ScopeStatus, number>>> {
  const counts = new Map<ScenarioTag, Record<ScopeStatus, number>>();
  for (const scenario of registeredScenarios) {
    const entry = scopeEntryForScenario(
      table,
      scenario.templateId,
      scenario.ocppVersion,
      protocols,
    );
    if (!entry) continue;
    for (const tag of scenario.tags) {
      const count = counts.get(tag) ?? { DRIVABLE: 0, CONDITIONAL: 0, NOT_APPLICABLE: 0 };
      count[entry.status] += 1;
      counts.set(tag, count);
    }
  }
  return Object.fromEntries(
    SCENARIO_TAGS.filter((tag) => counts.has(tag)).map((tag) => [tag, counts.get(tag)!]),
  );
}
