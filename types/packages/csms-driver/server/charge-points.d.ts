/**
 * The daemon's charge-point bodies: JSON to the `charge-points.ts` model and
 * back. The wire names ARE the model's names, so there is nothing to map --
 * only the shape to enforce, which the model's types cannot do for JSON.
 */
import type { ChargePointDefinition, ChargePointDetails, ChargePointUpdate } from "../charge-points";
export declare function decodeChargePointDefinition(body: unknown): ChargePointDefinition;
export declare function decodeChargePointUpdate(body: unknown): ChargePointUpdate;
/** The read-back, rebuilt member by member so that nothing a driver adds -- a
 *  password above all -- reaches the client. */
export declare function encodeChargePointDetails(details: ChargePointDetails): Record<string, unknown>;
