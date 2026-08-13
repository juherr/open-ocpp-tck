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
import type { CsmsEnv, CsmsOperationAction } from "../../tck/driver";
export type CitrineVariant = "v1" | "v2";
/** v2 by default: it is what `drivers/citrineos/compose.yaml` pins, and the
 *  only line with a complete OCPP 1.6 surface. */
export declare const DEFAULT_VARIANT: CitrineVariant;
export declare function resolveVariant(env: CsmsEnv): CitrineVariant;
/**
 * The column carrying the OCPP connection name -- the string a charge point
 * connects as. Unquoted; callers quote it.
 */
export declare function stationColumn(variant: CitrineVariant): string;
/**
 * Why the reservation actions are unrouted, worded ONCE.
 *
 * Both the scope table and the runtime escape have to state this, and they are
 * the two halves a reader compares: a scope row saying one thing and an
 * UnsupportedOperationError saying another is the drift this module exists to
 * prevent. Verified in the sources at v1.9.1, v2.0.0-beta1 and main, and
 * against both running containers.
 */
export declare const NO_RESERVATIONS: string;
/** Same, for the local auth list pair, which v1.9.1 alone lacks. */
export declare const NO_LOCAL_LIST: string;
/** The unrouted actions for a variant, mapped to why. */
export declare function unroutedActions(variant: CitrineVariant): ReadonlyMap<CsmsOperationAction, string>;
/** Scenarios the local-auth-list gap costs on v1. Named here rather than in
 *  scope.ts so the two cannot drift from {@link unroutedActions}. */
export declare const V1_LOCAL_LIST_SCENARIOS: readonly ["cert16-tc042-1-get-local-list-version-not-supported", "cert16-tc042-2-get-local-list-version-empty", "cert16-tc043-1-send-local-list-not-supported", "cert16-tc043-3-send-local-list-failed", "cert16-tc043-4-send-local-list-full", "cert16-tc043-5-send-local-list-differential"];
