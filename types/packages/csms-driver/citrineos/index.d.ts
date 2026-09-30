import { type CsmsCapabilities, type FetchLike } from "../contracts";
import type { CsmsDriver } from "../models";
import type { CsmsConnectorApi, CsmsSessionApi } from "../models";
import type { CitrineApiConfig } from "./config";
import { type CitrineRefs } from "./requests";
export interface CitrineOsCsmsDriverOptions {
    readonly config: CitrineApiConfig;
    readonly refs: CitrineRefs;
    readonly fetch?: FetchLike;
    readonly sessions?: CsmsSessionApi;
    readonly connectors?: CsmsConnectorApi;
}
export declare function citrineOsCapabilities(config: CitrineApiConfig): CsmsCapabilities;
/** Creates the reusable CitrineOS operation surface without TCK lifecycle hooks. */
export declare function createCitrineOsCsmsDriver(options: CitrineOsCsmsDriverOptions): CsmsDriver;
export * from "./api-client";
export * from "./config";
export * from "./requests";
export * from "./variant";
