import type { SteveUiConfig } from "../../packages/csms-driver/steve/ui-client";
/** TCK deployment settings; only the UI subset belongs to the reusable factory. */
export interface SteveConfig extends SteveUiConfig {
    dbContainer: string;
    dbUser: string;
    dbPass: string;
    dbName: string;
    appContainer: string;
    wsBaseUrl: string;
    dockerNetwork: string;
}
export declare function defaultSteveConfig(env?: Readonly<Record<string, string | undefined>>): SteveConfig;
