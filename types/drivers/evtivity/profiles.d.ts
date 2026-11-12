/**
 * profiles.ts -- the two charging profiles the SmartCharging scenarios name,
 * owned by this driver because the raw 1.6 command route takes them inline.
 *
 * A FIXTURE CATALOGUE, NOT SCENARIO BRANCHING. The descriptions are the ones
 * the scenarios look profiles up by, and the environment every scenario
 * assumes is what a driver is allowed to own. `POST /v1/ocpp/commands/v16/
 * SetChargingProfile` forwards `csChargingProfiles` as the CALL's payload and
 * records no description to look a profile up BY, so the route is handed the
 * profile built here.
 *
 * THE REF IS THE OCPP `chargingProfileId`, because the scenarios assert
 * `Applied charging profile #<ref>` against the SIMULATOR's log, which prints
 * the id the station received. The shape is the one every bundled driver
 * sends: stack level 0, kind Relative, rate unit W, one period at 0 with an
 * 11000 W limit -- TC_066 asserts that limit on the composite schedule, so it
 * is not decorative.
 *
 * A fourth copy of the same two rows, and it stays a copy: tests/generic-core.sh
 * forbids one driver importing another, and the contract has no core home for
 * fixtures.
 */
/** OCPP 1.6 ChargingProfile, spelled as the wire spells it. */
export interface CsChargingProfile {
    chargingProfileId: number;
    /** Only meaningful for a TxProfile, and absent otherwise. */
    transactionId?: number;
    stackLevel: number;
    chargingProfilePurpose: "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
    chargingProfileKind: "Absolute" | "Recurring" | "Relative";
    chargingSchedule: {
        chargingRateUnit: "A" | "W";
        chargingSchedulePeriod: {
            startPeriod: number;
            limit: number;
        }[];
    };
}
interface CatalogueEntry {
    description: string;
    profile: CsChargingProfile;
}
/** Ids 56 and 57 name the test cases that use them; two digits keep the
 *  scenarios' `#<id>(?!\d)` assertions from leaning on the lookahead. */
export declare const PROFILE_CATALOGUE: readonly CatalogueEntry[];
/** The ref for a description, or `""` when no such profile exists here --
 *  the contract's "the CSMS has no such record". */
export declare function refByDescription(description: string): string;
/** The profile behind a ref, or undefined when the ref names nothing here. */
export declare function profileByRef(ref: string): CsChargingProfile | undefined;
export {};
