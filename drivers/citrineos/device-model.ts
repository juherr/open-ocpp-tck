// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * device-model.ts -- where a 2.0.1 StatusNotification has to land, named once.
 *
 * THE FAILURE THIS EXISTS FOR IS SILENT FROM THE WIRE. A 2.0.1 CSMS answers
 * `StatusNotification` with an empty `StatusNotificationResponse` -- no status
 * member, nothing to be wrong -- so a charge point cannot tell "recorded" from
 * "dropped", and neither can a suite whose every other verdict comes off the
 * frames. Measured on the pinned image: a station that booted, sent two
 * statuses, got two answers, and left four warnings in the CSMS log and no row
 * anywhere. Issue #86.
 *
 * WHAT THE HANDLER WANTS, read from `StatusNotificationService`
 * (`packages/core/src/modules/Transactions/src/module/`) at the digest
 * compose.yaml pins, and then measured rather than left as a reading:
 *
 *  1. a charging station carrying an EVSE whose `evseTypeId` equals the
 *     request's `evseId`, with a connector under it -- otherwise the resolved
 *     `evseId` is null and the connector update is skipped;
 *  2. a component named {@link COMPONENT_NAME}, joined to an EVSE type with
 *     `id = evseId` and `connectorId = connectorId`, carrying a variable named
 *     {@link VARIABLE_NAME} -- otherwise the component query returns nothing
 *     and the status never reaches the device model.
 *
 * Two conditions, two log lines each, which is the four.
 *
 * WHY ONLY THE 2.0.1 STATION NEEDS THIS. The 1.6 path in the same class
 * auto-commissions an EVSE for an unknown connector; the 2.0.1 path has no
 * such fallback. So the 1.6 half of a mixed run is green with nothing
 * provisioned, and reading that as "the CSMS handles this" is the mistake this
 * file is downstream of.
 *
 * AND ONE HARDER FAILURE THAN THE WARNINGS. When the connection's
 * `allowUnknownChargingStations` is false, an unknown connector THROWS instead
 * of warning. This compose sets it true, so the symptom here is four warnings;
 * against a deployment that does not, the same gap is a CALLERROR.
 */

/** A `(evseId, connectorId)` the charge point addresses a status to. */
export interface StatusTarget {
  evseId: number;
  connectorId: number;
}

/**
 * How many connectors the provisioned topology covers.
 *
 * ONE, because that is what runs: every scenario in `tck/specs/` declares
 * `connector: 1`, and the simulator defaults to a single connector. It is a
 * named constant rather than a literal inside {@link statusTargets} so that
 * raising it is a one-line change with a name, and so that function states the
 * rule instead of the answer.
 */
export const PROVISIONED_CONNECTORS = 1;

/**
 * The targets a station reports, derived from the simulator's own projection
 * rather than from what a CSMS log happened to show.
 *
 * `v201StatusEvse` (`src/cp/infrastructure/transport/v201/topologyWireV201.ts`
 * in the pinned simulator image) maps station scope to `{evseId: 0,
 * connectorId: 0}` and domain connector *N* to `{evseId: N, connectorId: 1}`.
 *
 * THE STATION-SCOPE TARGET IS THE ONE THAT LOOKS SKIPPABLE. `evseId` 0 is the
 * charging station itself, so an EVSE type numbered 0 reads like a placeholder
 * -- but it is half of what the station sends, and leaving it out leaves two
 * of the four warnings exactly where they were.
 */
export function statusTargets(
  connectors: number = PROVISIONED_CONNECTORS,
): StatusTarget[] {
  const targets: StatusTarget[] = [{ evseId: 0, connectorId: 0 }];
  for (let n = 1; n <= connectors; n += 1) {
    targets.push({ evseId: n, connectorId: 1 });
  }
  return targets;
}

/** The component name the handler queries for. A literal there, so a literal
 *  here. */
export const COMPONENT_NAME = "Connector";

/** The variable name the handler queries for, same. */
export const VARIABLE_NAME = "AvailabilityState";

/**
 * What tells one provisioned component from another.
 *
 * NOT COSMETIC, AND NOT OPTIONAL. The components table carries a unique index
 * on `(tenantId, name)` restricted to rows whose `instance` is null, so at most
 * one component may be named {@link COMPONENT_NAME} with no instance -- and the
 * handler's query filters on the name and the joined EVSE type, never on the
 * instance. One target per component means one instance per target, or the
 * second insert fails on an index whose name says nothing about any of this.
 */
export function componentInstance(target: StatusTarget): string {
  return `${target.evseId}:${target.connectorId}`;
}

/**
 * What every provisioned EVSE row's `evseId` starts with -- the eMI3 STRING
 * column, not the numeric OCPP one two fields away.
 *
 * DELIBERATELY NOT eMI3-SHAPED. It is the only thing that tells a fixture EVSE
 * from one the CSMS or an operator created, and teardown deletes on it, so it
 * has to be a spelling nothing else would arrive at by accident. A well-formed
 * eMI3 id would be exactly such a spelling -- and the pinned image's own
 * backfill migration writes `US*TST*C*…` rows that a country-code-shaped marker
 * would sit next to indistinguishably.
 */
export const FIXTURE_EVSE_PREFIX = "TCK*FIXTURE*";

/** The `evseId` of one provisioned EVSE row. */
export function fixtureEvseId(cpId: string, evseId: number): string {
  return `${FIXTURE_EVSE_PREFIX}${cpId}*${evseId}`;
}

/**
 * Every fixture EVSE, whatever station it belongs to, as a SQL `LIKE` pattern.
 *
 * Teardown ranges over all of them rather than over a roster because it has
 * none: the station half is written per station by the driver's prepare hook,
 * from a charge point id the runner supplies scenario by scenario, and nothing
 * in the driver's environment lists them. `*` is a literal in `LIKE`, so the
 * only metacharacter here is the trailing `%`.
 */
export const FIXTURE_EVSE_PATTERN = `${FIXTURE_EVSE_PREFIX}%`;
