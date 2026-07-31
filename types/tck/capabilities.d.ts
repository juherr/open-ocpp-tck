/**
 * capabilities.ts -- stand-ins for the optional parts of CsmsRecords.
 *
 * A driver whose CSMS has no reservation resource, or no charging-profile
 * registry, simply omits that sub-interface. The runner substitutes one of
 * these, whose every method throws UnsupportedOperationError with the driver's
 * own stated reason.
 *
 * The point is that SPECS NEVER BRANCH ON THE DRIVER. `records.reservations`
 * is non-optional as the specs see it, so a scenario reads the same whether or
 * not the CSMS under test has reservations, and absence produces a NOT
 * APPLICABLE verdict through the normal escape rather than an `if` inside a
 * vendored scenario.
 */
import { type CsmsChargingProfileRecords, type CsmsReservationRecords } from "./driver";
export declare function unsupportedReservations(reason: string): CsmsReservationRecords;
export declare function unsupportedChargingProfiles(reason: string): CsmsChargingProfileRecords;
