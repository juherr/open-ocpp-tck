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
import { type CsmsChargingProfileRecords, type CsmsDeviceModelRecords, type CsmsOperations201, type CsmsReservationRecords } from "./driver";
export declare function unsupportedReservations(reason: string): CsmsReservationRecords;
export declare function unsupportedChargingProfiles(reason: string): CsmsChargingProfileRecords;
/**
 * THE ONE STAND-IN HERE THAT DOES NOT THROW, and the asymmetry is the rule in
 * unverifiable.ts rather than an exception to this file.
 *
 * That rule picks the escape by how the value is CONSUMED: the sentinel for a
 * result that flows straight into `assertEq` or `assertNonEmpty`, the throw for
 * one assigned, compared, interpolated or fed back into an operation field.
 * Both methods here return a string that a spec hands directly to an
 * assertion -- a status is only observable after the run, so there is nowhere
 * else for it to go -- which is the sentinel's case exactly.
 *
 * It also puts this capability back inside the shared mechanism. The runner's
 * NOT APPLICABLE escape wraps `drive()` alone, so a throw from an assert-phase
 * read escapes as an ERROR and costs a container first (issue #96). Answering
 * `unverifiable` instead degrades the two checks to SKIPPED and the scenario to
 * PARTIAL, with the driver's own reason printed beside them -- and the wire
 * checks that DID run keep their verdicts, where NOT APPLICABLE would have
 * discarded them.
 */
export declare function unsupportedDeviceModel(reason: string): CsmsDeviceModelRecords;
/**
 * The stand-in for a driver that declares no OCPP 2.0.1 operations.
 *
 * It reports `operations201.<action>`: QUALIFIED like the three above, whose
 * names are also the sub-interface they stand in for, and carrying the ACTION
 * because that is what the runner prints when it degrades the scenario and
 * what becomes the NOT APPLICABLE reason in the summary -- "driver reported
 * "operations201.GetVariables" unsupported" is a sentence a driver author can
 * act on.
 */
export declare function unsupportedOperations201(reason: string): CsmsOperations201;
