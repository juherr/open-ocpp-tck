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
    /**
     * The parent SteVe stores for an OCPP tag, null for none. Only a ReserveNow
     * carrying a `parentIdTag` asks it: SteVe sends the reserved tag's stored
     * parent and has no field for another one, so without this lookup such a
     * request is refused as unsupported rather than posted with its parent
     * dropped. The manager UI cannot answer it; SteVe's WebAPI can
     * (`GET /ocppTags` reports `parentIdTag`).
     */
    readonly ocppTagParent?: (idTag: string) => Promise<string | null>;
}
export declare const STEVE_CAPABILITIES: CsmsCapabilities;
/**
 * Creates the reusable SteVe operation and charge-point administration
 * surfaces, without TCK lifecycle hooks. Both share one manager-UI session.
 */
export declare function createSteveCsmsDriver(options: SteveCsmsDriverOptions): CsmsDriver;
export * from "./api-client";
export * from "./forms";
export * from "./ui-client";
