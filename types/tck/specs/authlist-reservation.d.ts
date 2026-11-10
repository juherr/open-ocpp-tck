/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/specs/authlist-reservation.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: CSMS operations are expressed as typed OCPP through the driver contract.
 *
 * specs/authlist-reservation.ts -- typed port of the "LocalAuthList +
 * Reservation" bash specs (scripts/steve-verify/specs/cert16-{tc042(x2),
 * tc043(x4),reservation-basic,tc048(x4),tc051,tc052}-*.spec.sh), mirroring
 * run-all.sh's AUTHLIST_RESERVATION array exactly (13 scenarios). Each spec
 * asserts AT LEAST what its bash predecessor asserted; CALLRESULT status
 * checks are upgraded to uniqueId-paired correlation (assertResponseStatus)
 * instead of the bash version's log-window grep. TC_053 came later and has no
 * bash predecessor, nor a simulator template: its drive() sends the station's
 * two commands itself.
 */
import { type AssertRecorder } from "../assert";
import { type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
export declare const tc0421GetLocalListVersionNotSupportedSpec: ScenarioSpec<void>;
export declare const tc0422GetLocalListVersionEmptySpec: ScenarioSpec<void>;
export declare const tc0431SendLocalListNotSupportedSpec: ScenarioSpec<void>;
export declare const tc0433SendLocalListFailedSpec: ScenarioSpec<void>;
export declare const tc0434SendLocalListFullSpec: ScenarioSpec<void>;
export declare const tc0435SendLocalListDifferentialSpec: ScenarioSpec<void>;
export declare const reservationBasicSpec: ScenarioSpec<void>;
export declare const tc0481ReserveNowFaultedSpec: ScenarioSpec<void>;
export declare const tc0482ReserveNowOccupiedSpec: ScenarioSpec<void>;
export declare const tc0483ReserveNowUnavailableSpec: ScenarioSpec<void>;
export declare const tc0484ReserveNowRejectedSpec: ScenarioSpec<void>;
interface CancelReservationDriveState {
    reservationPk: string;
}
export declare const tc051CancelReservationSpec: ScenarioSpec<CancelReservationDriveState>;
export declare const tc052CancelReservationRejectedSpec: ScenarioSpec<void>;
/**
 * The parent the CSMS put in the idTagInfo answering the first sent `action`
 * for `idTag`.
 *
 * WHY IT IS HERE, and not only implied by the start that follows. OCPP 1.6
 * §5.13 lets the reserved connector admit a tag whose parent equals the
 * reservation's, and the station learns a stranger's parent from the
 * Authorize.conf (§4.1: idTagInfo MAY carry it). A CSMS that leaves it out
 * makes the station refuse the start, and the checks downstream then say "no
 * StartTransaction" -- true, and silent about why. This check names the cause
 * on the row where it happens.
 *
 * The arguments are literals at the call site so ASSERT-INVENTORY.txt pins
 * them -- see the rejected-refactor note beside `assertIdTagInfoStatus` in
 * assert.ts for why this is not a predicate handed to a generic helper.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames. Not part of
 * the driver-author surface: tck/index.ts deliberately re-exports no specs.
 */
export declare function assertIdTagInfoParent(rec: AssertRecorder, frames: readonly Frame[], action: string, idTag: string, expectedParent: string, description: string): void;
/**
 * The StartTransaction.req the station sent for `idTag` names the
 * reservationId of the ReserveNow.req the CSMS sent.
 *
 * A CHARGE-POINT behaviour (§5.13), checked because it is where this case
 * becomes observable: the station sends the id only when it admitted the tag
 * to the reservation, which for a tag other than the reserved one is only
 * through the parent the CSMS supplied. The reservationId is the CSMS's own
 * allocation, so it is compared to the request rather than written here.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames.
 */
export declare function assertStartUsesReservation(rec: AssertRecorder, frames: readonly Frame[], idTag: string, description: string): void;
export declare const tc053ReservedConnectorParentIdTagSpec: ScenarioSpec<void>;
export declare const AUTHLIST_RESERVATION_SPECS: ScenarioSpec<any>[];
export {};
