// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scenario-tags.ts -- the closed vocabulary of a scenario's functional tags.
 *
 * Three selection axes, each read off its own fact and never off another's:
 * `--version` reads `ScenarioSpec.ocppVersion`, the protocol; `--group` reads
 * upstream's array membership, mirrored on purpose and not a taxonomy; and
 * `--tag` reads `ScenarioSpec.tags`, what the scenario is about. A scenario
 * may carry several tags, which a group cannot express.
 *
 * The names follow OCPP 2.0.1's functional blocks, applied to 1.6 scenarios by
 * the same meaning, with one exception: TriggerMessage is `remote-trigger`
 * rather than part of `remote-control`, because OCPP 1.6 makes it a feature
 * profile of its own and a conformance report is read along those.
 *
 * THE ASSIGNMENT RULE. A tag names a function the scenario EXERCISES -- one it
 * drives, one it has established against the CSMS as its precondition, or one
 * its verdict reads -- not one that is incidental to it. TC_003 checks that
 * every Authorize is answered, which is a transport obligation rather than an
 * idToken decision, so it is `transaction` and not `authorization`. TC_K_29 is
 * about the station's profiles, but its `EnergyTransferStarted` precondition
 * has the CSMS accept a transaction first -- a CSMS that refuses one leaves
 * the case unestablished -- so it is `transaction` as well as `smart-charging`.
 *
 * That makes `transaction` what #34 asked it to be: every scenario that NEEDS
 * a transaction, the set to run when a driver's transaction records are
 * suspect. `tests/scenario-tags.ts` holds that direction against what the
 * specs declare and read.
 *
 * A tag is declared on the spec (or the `.feature`), never derived from its
 * file, its template id, its group, its OCA case prefix or its protocol.
 *
 * Extending the vocabulary is adding a member here, a row to README.md's tag
 * table, and at least one scenario that carries it:
 * `tests/scenario-tags.ts` refuses a tag nothing carries.
 */

/** Every tag, in the order help and reports list them. What each one covers
 *  is README.md's tag table, which `tests/scenario-tags.ts` holds to this list. */
export const SCENARIO_TAGS = [
  "provisioning", // boot, reset, configuration, variables, network profile
  "authorization", // an idToken decision, the authorization cache
  "local-auth-list", // GetLocalListVersion, SendLocalList
  "transaction", // needs one: starts, stops, refuses, reads or presupposes it
  "remote-control", // RemoteStart/StopTransaction, UnlockConnector
  "remote-trigger", // TriggerMessage
  "availability", // ChangeAvailability, connector/EVSE/station status
  "reservation", // ReserveNow, CancelReservation
  "metering", // meter values outside a transaction
  "smart-charging", // charging profiles, composite schedules
  "firmware", // UpdateFirmware, GetDiagnostics
  "certificates", // InstallCertificate, GetInstalledCertificateIds
  "data-transfer", // DataTransfer
] as const;

export type ScenarioTag = (typeof SCENARIO_TAGS)[number];

/** What a spec declares: at least one tag, so a filter never misses it. */
export type ScenarioTags = readonly [ScenarioTag, ...ScenarioTag[]];

export function isScenarioTag(value: string): value is ScenarioTag {
  return (SCENARIO_TAGS as readonly string[]).includes(value);
}

/** Validate a user- or feature-supplied tag before anything is selected. */
export function parseScenarioTag(value: string): ScenarioTag {
  if (isScenarioTag(value)) return value;
  throw new Error(
    `Unknown scenario tag '${value}'. Supported tags: ${SCENARIO_TAGS.join(", ")}.`,
  );
}

/** Validate a whole declaration -- at least one tag, each known, none twice.
 *  What a `.feature` compiles through; a TypeScript spec gets the first two
 *  from its type, and `tests/scenario-tags.ts` runs every spec through here. */
export function parseScenarioTags(values: readonly string[]): ScenarioTags {
  const [first, ...rest] = values.map(parseScenarioTag);
  if (first === undefined) {
    throw new Error(
      `A scenario declares at least one scenario tag. Supported tags: ${SCENARIO_TAGS.join(", ")}.`,
    );
  }
  const tags: ScenarioTags = [first, ...rest];
  const repeated = tags.find((tag, index) => tags.indexOf(tag) !== index);
  if (repeated !== undefined) {
    throw new Error(`Scenario tag '${repeated}' is declared more than once.`);
  }
  return tags;
}
