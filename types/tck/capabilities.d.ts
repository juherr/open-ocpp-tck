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
 * It reports the ACTION rather than a fixed name, because that is what the
 * runner prints when it degrades the scenario: "scope table out of date for
 * cert201-... -- driver reported "GetVariables" unsupported" is a sentence a
 * driver author can act on, where "operations201.execute" is not.
 */
export declare function unsupportedOperations201(reason: string): CsmsOperations201;
