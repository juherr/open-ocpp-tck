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
    /** OCPP WebSocket endpoint, without the trailing charge-point id. */
    wsBaseUrl: string;
    /** Docker network the simulator must join to reach SteVe by container name. */
    dockerNetwork: string;
}
export declare function defaultSteveConfig(env?: NodeJS.ProcessEnv): SteveConfig;
/**
 * SteVe manager-UI client: login + operation POST, one cookie jar per
 * instance. Retained ONLY for specs/authlist-reservation.ts's TC_052, which
 * instantiates it directly (see this module's header). It is SteVe-specific
 * and cannot drive any other CSMS.
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
    /** steve_cp_select CP_ID equivalent -- the chargePointSelectList form value
     *  SteVe expects for an OCPP 1.6J charge point. */
    cpSelect(cpId: string): string;
    /**
     * steve_op OP_PATH FIELDS equivalent. POSTs one CSMS operation,
     * form-encoded, exactly like the manager UI would. Returns the redirect
     * `Location` on success (SteVe 302s to /operations/tasks/<id>); throws on
     * failure (missing CSRF token or no redirect).
     */
    op(opPath: string, fields: Record<string, string>): Promise<string>;
}
