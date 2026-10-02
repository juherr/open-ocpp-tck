/**
 * forms.ts -- renders a neutral CsmsOperation16 into the fields SteVe's manager
 * UI forms expect.
 *
 * This mapping used to BE the contract: every scenario was written in these
 * field names, and every other CSMS driver had to parse its way back out of
 * them. Now it is what it always was -- one CSMS's serialisation, owned by the
 * driver for that CSMS.
 */
import type { ChargePointDetails, ChargePointRegistration, ChargePointSecurityProfile } from "../charge-points";
import { type CsmsOperation16 } from "../contracts";
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
/**
 * The manager pages and form actions behind charge-point administration.
 * SteVe has no REST controller for charge points (steve-community/steve#2068),
 * so these are the only way in.
 */
export declare const STEVE_CHARGE_POINT_PAGES: {
    readonly add: "chargepoints/add";
    readonly addAction: "chargepoints/add/single";
    readonly query: (cpId: string) => string;
    readonly details: (chargeBoxPk: number) => string;
    readonly updateAction: "chargepoints/update";
    readonly deleteAction: (chargeBoxPk: number) => string;
};
/** What a charge-point form is asked to change; an absent member is left as the page rendered it. */
export interface ChargePointFormChange {
    readonly chargeBoxId?: string;
    readonly registration?: ChargePointRegistration;
    /** `authPassword` empty leaves SteVe's stored password unchanged -- it is never a way to clear it. */
    readonly security?: {
        readonly profile: ChargePointSecurityProfile;
        readonly authPassword: string;
    };
    /** `null` posts an empty description, which SteVe stores as none. */
    readonly description?: string | null;
}
/** Applies `change` to a charge-point form read off the add or details page. */
export declare function fillChargePointForm(fields: URLSearchParams, change: ChargePointFormChange): void;
/** A description as SteVe stores what it was posted: trimmed, and empty as none. */
export declare function steveStoredDescription(description: string | null | undefined): string | undefined;
/**
 * A charge point as its details form renders it, or `undefined` when a
 * member reads as nothing this mapping knows -- a SteVe that renamed one.
 */
export declare function chargePointFromForm(fields: URLSearchParams): ChargePointDetails | undefined;
/**
 * The `chargeBoxPk` the list page links `cpId` to. Matched on the link text
 * EXACTLY: the query page filters with LIKE, so asking for `CP-1` also lists
 * `CP-10`.
 */
export declare function chargeBoxPkOf(listHtml: string, cpId: string): number | undefined;
export declare function toSteveForm(op: CsmsOperation16): {
    opPath: string;
    fields: Record<string, string>;
};
