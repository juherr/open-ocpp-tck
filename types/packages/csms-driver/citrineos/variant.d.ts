import { type CsmsEnv, type CsmsOperation16Action, type CsmsOperation201Action } from "../contracts";
export type CitrineVariant = "v1" | "v2";
export declare const DEFAULT_VARIANT: CitrineVariant;
export declare function resolveVariant(env: CsmsEnv): CitrineVariant;
/** Shared reason for the reservation routes absent from both supported lines. */
export declare const NO_RESERVATIONS: string;
export declare const NO_LOCAL_LIST: string;
export declare const NO_OCPP_201_ON_V1: string;
export declare function unroutedActions(variant: CitrineVariant): ReadonlyMap<CsmsOperation16Action, string>;
export declare function unroutedActions201(variant: CitrineVariant): ReadonlyMap<CsmsOperation201Action, string>;
export declare function speaksOcpp201(variant: CitrineVariant): boolean;
