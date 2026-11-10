/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/specs/remotetrigger-smartcharging.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: CSMS operations are expressed as typed OCPP through the driver contract.
 *
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
import { type AssertRecorder } from "../assert";
import { type Frame } from "../ocpp";
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
/**
 * One TriggerMessage of TC_054, judged on its own: the CSMS sent a
 * TriggerMessage.req asking for `requestedMessage` (scoped to `connectorId`
 * when the case scopes it, i.e. for MeterValues and StatusNotification), the
 * CP answered it, and -- when the answer is Accepted -- the requested message
 * left the CP AFTER that answer.
 *
 * Why per trigger rather than the generic helpers: `assertResponseStatus`
 * reads the FIRST TriggerMessage only, and `assertLineAfter` anchors on the
 * LAST one, so with five triggers in a row the first would stop covering
 * triggers two to five and the second would read the Heartbeat sent at step 7
 * as missing because the FirmwareStatusNotification trigger comes later. And
 * "sent after" is the check that FAILS: `assertAllAnswered` reports SKIPPED
 * when nothing was sent, so without this a trigger the CSMS never dispatched
 * would leave the scenario PARTIAL rather than red.
 *
 * `notImplementedAllowed` is the case's own exception for its last trigger:
 * the CP sends FirmwareStatusNotification only "if implemented", and answers
 * NotImplemented otherwise, after which nothing is owed on the wire.
 *
 * The arguments are literals at the call sites so ASSERT-INVENTORY.txt
 * renders which trigger each check is about -- see the rejected-refactor note
 * beside `assertIdTagInfoStatus` in assert.ts for why a predicate would not.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames. Not part of
 * the driver-author surface: tck/index.ts deliberately re-exports no specs.
 */
export declare function assertTriggered(rec: AssertRecorder, frames: readonly Frame[], requestedMessage: string, connectorId: number | null, notImplementedAllowed: boolean, description: string): void;
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
