export interface SteveConfig {
    /** e.g. http://steve:8180/steve/manager (container-internal: the
     *  public host is behind a forward-auth proxy this client cannot pass). */
    baseUrl: string;
    username: string;
    password: string;
    /** docker container name running SteVe's MariaDB (e.g. steve-db-1). */
    dbContainer: string;
    dbUser: string;
    dbPass: string;
    dbName: string;
    /** docker container running the SteVe application. Deployment, not
     *  transport: only `provision` uses it, to restart the process once so it
     *  picks up the WebAPI credential it just wrote. It sits beside dbContainer
     *  because that is what it is -- a container name -- and not on the API
     *  config, which would make every scenario resolve a variable it never uses. */
    appContainer: string;
    /** OCPP WebSocket endpoint, without the trailing charge-point id. */
    wsBaseUrl: string;
    /** Docker network the simulator must join to reach SteVe by container name. */
    dockerNetwork: string;
}
export declare function defaultSteveConfig(env?: NodeJS.ProcessEnv): SteveConfig;
/**
 * SteVe manager-UI client: login, CSRF, form POST -- one cookie jar per
 * instance. It is SteVe-specific and cannot drive any other CSMS.
 *
 * Two callers: the operations path (index.ts) and provisioning
 * (provision.ts), which posts the charging-profile form through the same
 * session rather than opening a second one.
 */
export declare class SteveUiOps {
    private readonly cfg;
    private cookies;
    constructor(cfg: SteveConfig);
    private cookieHeader;
    private absorbSetCookie;
    isLoggedIn(): Promise<boolean>;
    login(): Promise<void>;
    ensureLogin(): Promise<void>;
    /**
     * GET a manager page for its CSRF token, then POST the form back to the same
     * path. Returns the redirect `Location`, which is how SteVe signals success;
     * throws when there is none, because a 200 here means the form came back with
     * validation errors rather than being accepted.
     *
     * `path` is relative to the manager base, so it spans more than operations:
     * provisioning posts to `chargingProfiles/add` through this same method,
     * which is the point of it being separate from op().
     */
    postForm(path: string, fields: Record<string, string>): Promise<string>;
    /**
     * steve_op OP_PATH FIELDS equivalent. POSTs one CSMS operation,
     * form-encoded, exactly like the manager UI would. Returns the redirect
     * `Location` on success (SteVe 302s to /operations/tasks/<id>); throws on
     * failure (missing CSRF token or no redirect).
     */
    op(opPath: string, fields: Record<string, string>): Promise<string>;
}
