/**
 * config.ts -- every default this driver has, in one place.
 *
 * The values below resolve to the names in drivers/citrineos/compose.yaml, so
 * a stock `docker compose -f drivers/citrineos/compose.yaml up -d --wait`
 * needs no environment at all. Renaming anything there means passing the
 * matching CITRINE_* variable by hand; index.ts's envHelp is the user-facing
 * copy of this table.
 *
 * Note the asymmetry between `apiUrl` and `wsBaseUrl`, which is not an
 * oversight: the driver runs on the HOST (it reaches Postgres through
 * `docker exec`) and so talks to `localhost`, while the simulator runs in a
 * container on the compose network and talks to `citrine`. One CSMS, two
 * addresses, because two different processes are doing the addressing.
 */
import type { CsmsEnv } from "../../tck/driver";
import { type CitrineVariant } from "./variant";
export interface CitrineConfig {
    /** Which CitrineOS line the target runs. Everything version-specific is
     *  derived from it rather than stored beside it -- see variant.ts. */
    variant: CitrineVariant;
    /** Message-API base, no trailing slash, e.g. http://localhost:8080 */
    apiUrl: string;
    /** Every message-API call carries it; CitrineOS's DEFAULT_TENANT_ID is 1. */
    tenantId: number;
    /** docker container running CitrineOS's Postgres. */
    dbContainer: string;
    dbUser: string;
    dbPass: string;
    dbName: string;
    /** OCPP WebSocket endpoint, without the trailing charge-point id. */
    wsBaseUrl: string;
    /** Docker network the simulator must join to reach CitrineOS by name. */
    dockerNetwork: string;
}
export declare function defaultCitrineConfig(env: CsmsEnv): CitrineConfig;
