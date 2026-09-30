import { type CsmsEnv, type CsmsOperation16Action, type CsmsOperation201Action } from "../contracts";
export type CitrineVariant = "v1" | "v2";
export type Where = Record<string, unknown>;
export declare function resolveVariant(env: CsmsEnv): CitrineVariant;
/** Generic reason returned when a protocol operation is not routed. */
export declare const NO_RESERVATIONS = "CitrineOS has no OCPP 1.6 endpoint for ReserveNow or CancelReservation.";
export declare function unroutedActions(variant: CitrineVariant): ReadonlyMap<CsmsOperation16Action, string>;
export declare function unroutedActions201(variant: CitrineVariant): ReadonlyMap<CsmsOperation201Action, string>;
export declare function speaksOcpp201(variant: CitrineVariant): boolean;
