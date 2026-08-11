import { type SteveConfig } from "./ui-client";
export interface SteveApiConfig {
    /** e.g. http://localhost:8180/steve/api/v1 */
    baseUrl: string;
    username: string;
    password: string;
    /** Container running the SteVe application, restarted to pick up API access. */
    appContainer: string;
}
export declare function defaultApiConfig(cfg: SteveConfig, env?: NodeJS.ProcessEnv): SteveApiConfig;
export declare class SteveProvisioner {
    private readonly cfg;
    private readonly api;
    private readonly log;
    private readonly ui;
    private readonly db;
    constructor(cfg: SteveConfig, api: SteveApiConfig, log?: (msg: string) => void);
    private apiFetch;
    /** One place that decides what an unacceptable WebAPI status looks like, so
     *  the body-truncation and the message shape cannot drift per call site. */
    private expectStatus;
    /**
     * Makes the WebAPI answer, restarting SteVe only if it does not already.
     *
     * SteVe keeps API credentials in `web_user.api_password`, a bcrypt column
     * distinct from the UI password, NULL by default -- so REST is off until
     * something writes it. Two facts make this awkward, both measured rather
     * than assumed: the row does not exist until SteVe has booted once (Flyway
     * creates the table, the app seeds the row), and the application reads that
     * column at startup and caches it, so a fresh hash is ignored until a
     * restart. There is no environment variable for it and the /webusers page
     * is not reachable, so this dance is the only way in.
     *
     * The probe-first shape is what keeps it cheap: the restart is paid once, on
     * a fresh environment, and never again.
     *
     * It will only ever write a password that was never set. Enabling API access
     * costs a credential write and a service restart, which is fine on the
     * throwaway environment compose.yaml brings up and is not fine on a SteVe
     * someone already uses: silently replacing a working admin API credential
     * with a default published in this file, then bouncing the process, is not
     * something a command called "provision" should do on its own authority. So
     * a non-null api_password that simply does not match is reported, not
     * overwritten -- the operator knows their password and this does not.
     */
    ensureApiAccess(): Promise<void>;
    private apiReachable;
    private restartApp;
    private listTags;
    private createTag;
    private deleteTag;
    provisionTags(): Promise<void>;
    provisionProfiles(): Promise<void>;
    /**
     * Read-only. Deliberately answers from the database rather than the WebAPI:
     * verify must work on an environment where API access was never enabled,
     * and must not be the thing that enables it.
     */
    verify(): Promise<string[]>;
    /**
     * Removes the fixtures, and nothing else. Charge points and their
     * transactions are left alone: they are runtime residue, not fixtures, and
     * `docker compose down -v` is the honest way to get a clean slate.
     *
     * The WebAPI password provision may have set is deliberately left in place.
     * Clearing it would need a second restart to take effect, and would leave
     * the environment in a state where the next provision has to restart again
     * -- paying that twice to undo something harmless. `down -v` removes it with
     * the volume, which is the only case where it matters.
     */
    teardown(): Promise<void>;
}
/** `ocpp-tck driver provision` */
export declare function provisionCommand(): Promise<number>;
/** `ocpp-tck driver verify` */
export declare function verifyCommand(): Promise<number>;
/** `ocpp-tck driver teardown` */
export declare function teardownCommand(): Promise<number>;
