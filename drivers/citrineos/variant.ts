// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * variant.ts -- the two CitrineOS lines this driver speaks, in one place.
 *
 * CitrineOS restructured between the v1.x stable line and the v2 prerelease,
 * and two of those changes reach this driver. Both were read off running
 * containers rather than inferred from release notes:
 *
 *  1. THE OCPP CONNECTION NAME MOVED COLUMN. `Transactions`,
 *     `LocalListVersions` and `SendLocalLists` carry it as `stationId` on
 *     v1.9.1 and as `ocppConnectionName` on v2.0.0-beta1.
 *  2. THE 1.6 LOCAL AUTH LIST ENDPOINTS DID NOT EXIST YET. v1.9.1 advertises
 *     16 `/ocpp/1.6/` paths, v2.0.0-beta1 advertises 18; the two extra are
 *     `evdriver/sendLocalList` and `evdriver/getLocalListVersion`.
 *
 * WHY THIS IS DECLARED AND NOT DETECTED
 * -------------------------------------
 * Detecting the column from information_schema would be easy and would even be
 * unambiguous -- see the trap below. But the scope table and the capability
 * set have to be readable with NO running server and NO credentials, because
 * that is the promise `ocpp-tck check-driver` and the pre-flight rest on. A
 * driver that had to connect to Postgres before it could say which scenarios
 * it can drive would break that promise.
 *
 * So the variant is declared once, drives all three things, and
 * `driver verify` then asserts that the running server agrees. Declare, then
 * check -- rather than two sources of truth free to disagree in silence.
 *
 * THE TRAP, recorded because it is the obvious wrong detection: `stationId`
 * exists on `Transactions` in BOTH lines. On v1.9.1 it is `character varying`
 * and holds the OCPP name; on v2 it is an `integer` foreign key and the name
 * lives in `ocppConnectionName`. Testing for the presence of `stationId` is
 * therefore always true and always useless. The presence of
 * `ocppConnectionName` is the discriminator, and that is what verify() checks.
 */
import type { CsmsEnv, CsmsOperation16Action } from "../../tck/driver";

export type CitrineVariant = "v1" | "v2";

/** v2 by default: it is what `drivers/citrineos/compose.yaml` pins, and the
 *  only line with a complete OCPP 1.6 surface. */
export const DEFAULT_VARIANT: CitrineVariant = "v2";

export function resolveVariant(env: CsmsEnv): CitrineVariant {
  const raw = env.CITRINE_VARIANT;
  if (raw === undefined || raw === "") return DEFAULT_VARIANT;
  if (raw === "v1" || raw === "v2") return raw;
  throw new Error(
    `citrineos: CITRINE_VARIANT must be "v1" or "v2", got ${JSON.stringify(raw)}`,
  );
}

/**
 * The column carrying the OCPP connection name -- the string a charge point
 * connects as. Unquoted; callers quote it.
 */
export function stationColumn(variant: CitrineVariant): string {
  return variant === "v2" ? "ocppConnectionName" : "stationId";
}

/**
 * Why the reservation actions are unrouted, worded ONCE.
 *
 * Both the scope table and the runtime escape have to state this, and they are
 * the two halves a reader compares: a scope row saying one thing and an
 * UnsupportedOperationError saying another is the drift this module exists to
 * prevent. Verified in the sources at v1.9.1, v2.0.0-beta1 and main, and
 * against both running containers.
 */
export const NO_RESERVATIONS =
  "CitrineOS routes no OCPP 1.6 endpoint for ReserveNow or CancelReservation: " +
  "the 1.6 schemas and the Reservations table exist, but no @AsMessageEndpoint " +
  "binds either action to OCPPVersion.OCPP1_6 and no 1.6 response handler " +
  "exists (verified at v1.9.1, v2.0.0-beta1 and main), so the path answers 404.";

/** Same, for the local auth list pair, which v1.9.1 alone lacks. */
export const NO_LOCAL_LIST =
  "CitrineOS v1.9.1 routes no OCPP 1.6 endpoint for SendLocalList or " +
  "GetLocalListVersion: the evdriver 1.6 MessageApi gained both only on the v2 " +
  "line. Measured on the running image -- it advertises 16 /ocpp/1.6/ paths " +
  "where v2.0.0-beta1 advertises 18. Drivable with CITRINE_VARIANT=v2 against " +
  "a v2 server.";

/**
 * Operations the 1.6 message API does not route on this variant, with the
 * reason each one is unrouted.
 *
 * ReserveNow and CancelReservation are absent from both lines. The local auth
 * list pair is absent from v1 only -- and absent means the path answers 404,
 * so these must throw UnsupportedOperationError rather than be POSTed.
 *
 * Built once per variant rather than per call: `index.ts` reads it when it
 * resolves `capabilities` and `requests.ts` reads it per operation, and two
 * independent constructions of the same fact is exactly what this module is
 * for.
 */
const UNROUTED: Readonly<
  Record<CitrineVariant, ReadonlyMap<CsmsOperation16Action, string>>
> = {
  v2: new Map([
    ["ReserveNow", NO_RESERVATIONS],
    ["CancelReservation", NO_RESERVATIONS],
  ]),
  v1: new Map([
    ["ReserveNow", NO_RESERVATIONS],
    ["CancelReservation", NO_RESERVATIONS],
    ["SendLocalList", NO_LOCAL_LIST],
    ["GetLocalListVersion", NO_LOCAL_LIST],
  ]),
};

/** The unrouted actions for a variant, mapped to why. */
export function unroutedActions(
  variant: CitrineVariant,
): ReadonlyMap<CsmsOperation16Action, string> {
  return UNROUTED[variant];
}

/**
 * Whether this driver declares an OCPP 2.0.1 surface for a line.
 *
 * ONE PLACE, TWO READERS -- the capability set and the parts `create()`
 * returns -- for the reason this module exists: a driver whose capabilities
 * claim a protocol its parts cannot drive reports the gap only once a
 * container has started, and `check-driver` cannot catch it because it never
 * calls `create()`. The scope table is the third statement of the same fact
 * and reads {@link CERT_201_SCENARIOS} instead, because what it needs is the
 * rows rather than the answer.
 *
 * v2 ONLY, and that is a statement about what has been MEASURED rather than
 * about what v1.9.1 can do. The 2.0.1 routes were read off the v2 line and the
 * handshake was observed against the pinned v2 image; nobody has pointed a
 * 2.0.1 station at v1.9.1 here. Declaring a surface on the strength of a
 * version number is exactly the "declare, then check" this module refuses.
 */
export function speaksOcpp201(variant: CitrineVariant): boolean {
  return variant === "v2";
}

/** Why a `cert201-` row is NOT_APPLICABLE on v1. Prose rather than a feature
 *  identifier, by tck/scope.ts's rule: nothing here is conditional on a
 *  feature, the whole protocol is undeclared for this line. */
export const NO_OCPP_201_ON_V1 =
  "This driver declares no OCPP 2.0.1 surface for the v1.9.1 line: the " +
  "message-API routes and the handshake were both measured on the v2 line " +
  "only, so `capabilities.operations201` is absent here and the runner " +
  "substitutes a stub that throws. Drivable with CITRINE_VARIANT=v2 against a " +
  "v2 server -- and a v1 measurement, not a version comparison, is what would " +
  "change this row.";

/**
 * Scenarios the OCPP 2.0.1 declaration covers, and which v1 therefore demotes.
 * Named here rather than in scope.ts for the same reason
 * {@link V1_LOCAL_LIST_SCENARIOS} is: one list, and the table cannot drift from
 * {@link speaksOcpp201}.
 *
 * ONE DIRECTION OF THAT IS UNGUARDED, and it is worth knowing which.
 * `scopeCoverage` catches a row that is missing and a row that is stale; it
 * cannot catch a row that is present and NOT demoted. So a sixth `cert201-`
 * scenario added without a line here still gets its v2 row -- the coverage
 * check forces that -- and `v1Scope()` inherits it unchanged, leaving the v1
 * table claiming exactly what the comment above that function calls wrong.
 *
 * Unlike {@link V1_LOCAL_LIST_SCENARIOS}, this list cannot be derived from
 * anything the driver can see: a scenario's declared protocol lives on its
 * `ScenarioSpec` and never reaches a driver. Whatever changes that is what
 * deletes this list.
 */
export const CERT_201_SCENARIOS = [
  "cert201-tcb01-cold-boot",
  "cert201-tcb20-reset-accepted",
  "cert201-tcb21-reset-scheduled",
  "cert201-tcb22-reset-rejected",
  "cert201-tcf20-heartbeat",
] as const;

/** Scenarios the local-auth-list gap costs on v1. Named here rather than in
 *  scope.ts so the two cannot drift from {@link unroutedActions}. */
export const V1_LOCAL_LIST_SCENARIOS = [
  "cert16-tc042-1-get-local-list-version-not-supported",
  "cert16-tc042-2-get-local-list-version-empty",
  "cert16-tc043-1-send-local-list-not-supported",
  "cert16-tc043-3-send-local-list-failed",
  "cert16-tc043-4-send-local-list-full",
  "cert16-tc043-5-send-local-list-differential",
] as const;
