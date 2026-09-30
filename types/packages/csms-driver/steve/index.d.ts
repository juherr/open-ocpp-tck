import { type CsmsCapabilities } from "../contracts";
import type { FetchLike } from "../contracts";
import type { CsmsDriver } from "../models";
import type { CsmsConnectorApi, CsmsSessionApi } from "../models";
import { type SteveUiConfig } from "./ui-client";
export interface SteveCsmsDriverOptions {
    readonly config: SteveUiConfig;
    readonly fetch?: FetchLike;
    readonly sessions?: CsmsSessionApi;
    readonly connectors?: CsmsConnectorApi;
}
export declare const STEVE_CAPABILITIES: CsmsCapabilities;
/** Creates the reusable SteVe operation surface without TCK lifecycle hooks. */
export declare function createSteveCsmsDriver(options: SteveCsmsDriverOptions): CsmsDriver;
export * from "./api-client";
export * from "./forms";
export * from "./ui-client";
