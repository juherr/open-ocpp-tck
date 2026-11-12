import { EvtivityApi } from "./api-client";
/** The settings compose.yaml seeds, and the value each must hold. */
export declare const REQUIRED_SETTINGS: Readonly<Record<string, unknown>>;
/**
 * Ends the sessions an interrupted run left active on a station, without the
 * station: `POST /v1/sessions/{ses}/end`. EVtivity answers the next Authorize
 * or StartTransaction of that tag ConcurrentTx while one is (authorize-token.ts).
 *
 * Two 409s, which are not alike (packages/api/src/routes/sessions.ts):
 *  - SESSION_NOT_ACTIVE: it ended since it was listed, which a station
 *    ending it on its own can do at any moment -- expected, and quiet;
 *  - STATION_ONLINE: the route refuses while the station is connected, so the
 *    session stays active and the scenario about to run will meet
 *    ConcurrentTx. Not an error the hook can fix -- the station connected is
 *    another process's -- but one the run must name, so it warns with the
 *    station and the session.
 * Any other refusal is a non-dispatch, as for every REST call.
 */
export declare function endLeftoverSessions(api: EvtivityApi, cpId: string, sessions: readonly string[], warn?: (line: string) => void): Promise<void>;
/**
 * Registers one station on security profile 0 for OCPP 1.6, or unblocks it
 * when a teardown left it blocked. Idempotent, and safe for two lanes racing
 * on one id: a 409 from the create means the other one won.
 */
export declare function ensureStation(api: EvtivityApi, cpId: string): Promise<void>;
/** `ocpp-tck driver provision` */
export declare function provisionCommand(): Promise<number>;
/** `ocpp-tck driver verify` */
export declare function verifyCommand(): Promise<number>;
/** `ocpp-tck driver teardown` */
export declare function teardownCommand(): Promise<number>;
