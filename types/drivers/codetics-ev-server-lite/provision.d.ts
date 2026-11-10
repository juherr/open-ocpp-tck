import { EvslApi } from "./api-client";
/**
 * Registers one station on security profile 0, or leaves it as it is when it
 * already is. Idempotent, and safe for two lanes racing on one id: a 409 from
 * the create means the other one won.
 *
 * `sendToStation: false` on the profile change, although lowering 1 -> 0
 * queues nothing today (StationSecurityService#changeProfile only queues a
 * ChangeConfiguration when RAISING): a command queued here would reach the
 * station unprompted the moment it connects, in the middle of a scenario.
 */
export declare function ensureStation(api: EvslApi, cpId: string): Promise<void>;
/** `ocpp-tck driver provision` */
export declare function provisionCommand(): Promise<number>;
/** `ocpp-tck driver verify` */
export declare function verifyCommand(): Promise<number>;
/** `ocpp-tck driver teardown` */
export declare function teardownCommand(): Promise<number>;
