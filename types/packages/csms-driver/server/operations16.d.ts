/**
 * The daemon's OCPP 1.6 operation routes: one path per `CsmsOperation16`
 * action, and the decoder from a request body to that action's arm.
 *
 * The paths are a SPELLING of the existing vocabulary, not a second one: the
 * table is keyed by the action, so it cannot name an operation the contract
 * does not have, and the compiler refuses it until a new action has a path.
 * Four are the issue's shortened names (`reset`, `unlock`, `remote-start`,
 * `remote-stop`); the rest are the action in kebab case.
 */
import { type CsmsOperation16, type CsmsOperation16Action } from "../contracts";
export declare const OPERATION_16_PATHS: Readonly<Record<CsmsOperation16Action, string>>;
/** The action a path names, or `undefined` for a path no action has. */
export declare function operation16ForPath(path: string): CsmsOperation16Action | undefined;
/** The arm of `CsmsOperation16` a body describes for `action`. Throws `InvalidInputError`. */
export declare function decodeOperation16(action: CsmsOperation16Action, body: unknown): CsmsOperation16;
