/**
 * specs/remotetrigger-smartcharging.ts -- typed port of the "RemoteTrigger +
 * SmartCharging" bash specs (scripts/steve-verify/specs/cert16-{tc010,tc011,
 * tc012,tc026,tc028,tc054,tc055,tc056,tc057,tc059,tc066,tc067}-*.spec.sh),
 * mirroring run-all.sh's REMOTETRIGGER_SMARTCHARGING array exactly (12
 * scenarios). Each spec asserts AT LEAST what its bash predecessor asserted;
 * CALLRESULT status checks are upgraded to uniqueId-paired correlation
 * (assertResponseStatus) instead of the bash version's log-window grep.
 *
 * cert16-tc026-remote-start-rejected moves here from main.ts (Task 1's proof
 * scenario, kept there unported until this group existed).
 */
import type { ScenarioSpec } from "../spec-types";
export declare const tc010RemoteStartSpec: ScenarioSpec<void>;
export declare const tc011RemoteStartStopSpec: ScenarioSpec<void>;
export declare const tc012RemoteStopSpec: ScenarioSpec<void>;
interface RemoteStartRejectedDriveState {
    baselineTxPk: string;
}
export declare const tc026RemoteStartRejectedSpec: ScenarioSpec<RemoteStartRejectedDriveState>;
interface RemoteStopRejectedDriveState {
    txPk: string;
}
export declare const tc028RemoteStopRejectedSpec: ScenarioSpec<RemoteStopRejectedDriveState>;
export declare const tc054TriggerMessageSpec: ScenarioSpec<void>;
export declare const tc055TriggerMessageRejectedSpec: ScenarioSpec<void>;
interface TxDefaultProfileDriveState {
    txPk: string;
    /** Looked up by description (see steve.ts's `SteveTx.chargingProfilePkByDescription`
     *  doc comment) rather than hardcoded -- a hardcoded pk drifts on a
     *  long-lived SteVe DB (auto_increment gaps from unrelated provisioning
     *  history), which is exactly what broke this spec (issue #184 Task 4). */
    profilePk: string;
}
export declare const tc056SmartChargingTxDefaultSpec: ScenarioSpec<TxDefaultProfileDriveState>;
interface TxProfileDriveState {
    txPk: string;
    /** See TxDefaultProfileDriveState.profilePk's comment above -- same
     *  hardcoded-pk drift issue, fixed the same way. */
    profilePk: string;
}
export declare const tc057SmartChargingTxProfileSpec: ScenarioSpec<TxProfileDriveState>;
interface RemoteStartWithProfileDriveState {
    /** See TxDefaultProfileDriveState.profilePk's comment above -- same
     *  hardcoded-pk drift issue, fixed the same way. */
    profilePk: string;
}
export declare const tc059RemoteStartWithProfileSpec: ScenarioSpec<RemoteStartWithProfileDriveState>;
export declare const tc066GetCompositeScheduleSpec: ScenarioSpec<void>;
export declare const tc067ClearChargingProfileSpec: ScenarioSpec<void>;
export declare const REMOTETRIGGER_SMARTCHARGING_SPECS: ScenarioSpec<any>[];
export {};
