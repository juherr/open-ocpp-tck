/**
 * specs/authlist-reservation.ts -- typed port of the "LocalAuthList +
 * Reservation" bash specs (scripts/steve-verify/specs/cert16-{tc042(x2),
 * tc043(x4),reservation-basic,tc048(x4),tc051,tc052}-*.spec.sh), mirroring
 * run-all.sh's AUTHLIST_RESERVATION array exactly (13 scenarios). Each spec
 * asserts AT LEAST what its bash predecessor asserted; CALLRESULT status
 * checks are upgraded to uniqueId-paired correlation (assertResponseStatus)
 * instead of the bash version's log-window grep.
 */
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
export declare const AUTHLIST_RESERVATION_SPECS: ScenarioSpec<any>[];
export {};
