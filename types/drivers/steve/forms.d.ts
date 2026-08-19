/**
 * forms.ts -- renders a neutral CsmsOperation16 into the fields SteVe's manager
 * UI forms expect.
 *
 * This mapping used to BE the contract: every scenario was written in these
 * field names, and every other CSMS driver had to parse its way back out of
 * them. Now it is what it always was -- one CSMS's serialisation, owned by the
 * driver for that CSMS.
 */
import { type CsmsOperation16 } from "../../tck/driver";
/**
 * SteVe's ReserveNow `expiry` and UpdateFirmware `retrieveDateTime` inputs
 * have no seconds field. Round UP, so any strictly-future instant formats to a
 * strictly-future minute: truncating can land in the already-past current
 * minute, which is why the old spec helper had to default to +90 seconds and
 * explain itself. The rounding lives here now, where the resolution limit is.
 */
export declare function steveLocalDateTime(d: Date): string;
/** The manager-UI select-list token for an OCPP 1.6J charge point. */
export declare function cpSelect(cpId: string): string;
/** SteVe's ChargingProfileForm purpose enum. */
export type SteveChargingProfilePurpose = "CHARGE_POINT_MAX_PROFILE" | "TX_DEFAULT_PROFILE" | "TX_PROFILE";
export interface ChargingProfileFields {
    description: string;
    purpose: SteveChargingProfilePurpose;
    /** Watts, as the single schedule period's limit. */
    limitW: number;
}
/**
 * The `chargingProfiles/add` form, as the manager UI posts it.
 *
 * Lives here rather than at the call site for the same reason toSteveForm()
 * does: these field names -- including the indexed `schedulePeriods[N].*` that
 * the page builds in JavaScript -- are SteVe's serialisation, and a version
 * that renames one should break in a single place.
 *
 * `RELATIVE` avoids a startSchedule, which SteVe requires for `ABSOLUTE` and
 * which would age out of validity between runs.
 */
export declare function chargingProfileForm(profile: ChargingProfileFields): Record<string, string>;
export declare function toSteveForm(op: CsmsOperation16): {
    opPath: string;
    fields: Record<string, string>;
};
