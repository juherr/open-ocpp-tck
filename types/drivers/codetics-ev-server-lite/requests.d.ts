/**
 * requests.ts -- the OCPP 1.6 vocabulary as this CSMS's generic command
 * endpoint takes it, and the wait that turns "queued" into "dispatched".
 *
 * ONE ROUTE FOR EVERY OPERATION. `POST /api/v1/stations/{id}/commands`
 * accepts `{action, payload}` where `payload` IS the OCPP request body: the
 * server validates it (ocpp/OcppValidation.kt, `serverInitiated = true`),
 * stores it, and its dispatcher sends it verbatim as the CALL's payload. So
 * each arm below builds the OCPP 1.6 payload itself, with members spelled as
 * the specification spells them.
 *
 * WHAT THE VALIDATOR REFUSES THAT OCPP ALLOWS, which is why two arms throw
 * rather than build:
 *
 *  - GetConfiguration with a key list. Its `textLimits` table checks a member
 *    called `key` on EVERY action as a string of 1 to 50 characters, and in
 *    GetConfiguration.req `key` is an array -- so any key list is answered 400
 *    and never queued. Only "every key" (an empty payload) is expressible.
 *  - ReserveNow without a reservation id. `reservationId` is required, and the
 *    server has no reservation entity to allocate one from, so this driver
 *    allocates it.
 *
 * DISPATCH, NOT COMPLETION. `execute()` resolves once the command has left
 * `QUEUED`: the dispatcher runs every second and moves at most ten queued
 * commands per connected station to `SENT` as it writes the CALL. The answer is
 * the scenario's business, read off the simulator's wire log; a station's
 * Rejected is a normal return. What the states mean, from ocpp/OcppCommandQueue.kt:
 *
 *   SENT, SUCCEEDED      the CALL was written to the station's socket
 *   FAILED with a result the station answered with a CALLERROR -- dispatched
 *   FAILED, no result    the socket write itself threw -- never dispatched
 *   TIMED_OUT            the server's 60 s deadline passed while the command
 *                        was ACTIVE, i.e. QUEUED or SENT. The wait returns at
 *                        SENT, so a TIMED_OUT it sees is one whose SENT it never
 *                        observed: no evidence of a CALL
 *   CANCELLED            withdrawn while QUEUED (StationSecurityService only
 *                        cancels a queued row) -- never sent
 *   QUEUED past our wait the station is not connected
 *
 * Those last four are {@link CsmsNotDispatchedError}: nothing shows the request
 * became an OCPP CALL, which is that class's claim exactly. So is a refusal of
 * the POST itself, since nothing was queued.
 *
 * WHAT IS NOT A NON-DISPATCH: anything that goes wrong AFTER the POST was
 * accepted, other than the states above. The command is queued server-side by
 * then, and a poll that cannot read it -- a refused read, a body that is not a
 * list, a command that never shows in the list -- knows nothing about whether
 * the dispatcher took it. The wait retries such a read until its deadline and
 * then throws a plain `Error`; claiming a non-dispatch there would file a
 * failure of our read as a fact about the CSMS's wire.
 */
import { type CsmsOperation16 } from "../../tck/driver";
import { type EvslApi } from "./api-client";
export interface Command {
    action: string;
    payload: Record<string, unknown>;
}
export declare function allocateReservationId(): number;
/** The `{action, payload}` the command endpoint takes for one operation. */
export declare function toCommand(op: CsmsOperation16): Command;
/** Why a GetConfiguration key list cannot be queued. Shared with scope.ts so
 *  the refusal and the scope row say the same thing. */
export declare const GET_CONFIGURATION_KEYS_UNSUPPORTED: string;
/**
 * Queues one command and waits for the dispatcher to take it. Returns the
 * command row, serialised, as the receipt for the run log.
 */
export declare function dispatch(api: EvslApi, cpId: string, command: Command, timeoutMs: number): Promise<string>;
