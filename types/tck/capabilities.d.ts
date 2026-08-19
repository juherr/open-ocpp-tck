/**
 * capabilities.ts -- stand-ins for the optional parts of a driver.
 *
 * A driver whose CSMS has no reservation resource, no charging-profile
 * registry, or no OCPP 2.0.1 surface at all simply omits that sub-interface.
 * The runner substitutes one of these, whose every method throws
 * UnsupportedOperationError with the driver's own stated reason.
 *
 * The point is that SPECS NEVER BRANCH ON THE DRIVER. `records.reservations`
 * and `ctx.csms201` are non-optional as the specs see it, so a scenario reads
 * the same whether or not the CSMS under test has reservations or speaks
 * 2.0.1, and absence produces a NOT APPLICABLE verdict through the normal
 * escape rather than an `if` inside a vendored scenario.
 */
import { type CsmsChargingProfileRecords, type CsmsOperations201, type CsmsReservationRecords } from "./driver";
export declare function unsupportedReservations(reason: string): CsmsReservationRecords;
export declare function unsupportedChargingProfiles(reason: string): CsmsChargingProfileRecords;
/**
 * The stand-in for a driver that declares no OCPP 2.0.1 operations.
 *
 * It reports the ACTION, not a fixed method name, because that is what the
 * runner prints when it degrades the scenario, and what ends up as the NOT
 * APPLICABLE reason in the summary -- "driver reported "GetVariables"
 * unsupported" is a sentence a driver author can act on.
 *
 * QUALIFIED WITH THE SUB-INTERFACE, like the two above, and here that is not
 * merely symmetry: `Reset` is an action name in BOTH vocabularies, so a bare
 * one makes a summary row about a 2.0.1 Reset read exactly like one about a
 * 1.6 Reset. The whole reason these are two unions is that the two operations
 * are not the same; the one place their names actually collide in OUTPUT
 * should not be where that gets forgotten.
 */
export declare function unsupportedOperations201(reason: string): CsmsOperations201;
