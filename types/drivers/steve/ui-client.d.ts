/**
 * ui-client.ts -- SteVe's manager UI, driven exactly as a browser would drive
 * it: log in, read the CSRF token out of the operation page, POST the form.
 *
 * This is the transport of last resort and the transport of record. SteVe's
 * REST API pre-validates some operations server-side and never puts them on
 * the wire; the UI path does not, which matters for any scenario whose point
 * is that the CHARGE POINT produces the answer.
 */
import { type FetchLike } from "../../tck/driver";
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
 * The seam every request below goes through, so that
 * `tests/steve-ui-session-race.ts` can hand this class a fake SteVe: the
 * property that matters here is how concurrent callers interleave, and against
 * a real server that is a 45%-of-the-time event nobody can reproduce on demand.
 *
 * Re-exported rather than merely imported. It was declared here until the
 * second driver needed the same seam and could not import it -- a driver may
 * not name another (`tests/generic-core.sh`) -- so it moved to the core. The
 * re-export is what keeps `types/drivers/steve/ui-client.d.ts` naming it, and
 * the move from being a break for anyone importing it from this path.
 */
export type { FetchLike };
/**
 * How SteVe renders the CSRF token into a manager page.
 *
 * Exported because `tools/steve-csrf-race.ts` scrapes the same field to report
 * whether the token varied between GETs, and that observation is the whole
 * point of the tool. A second copy of this pattern would keep matching nothing
 * after a markup change and report "0 distinct tokens", which reads as "no
 * rotation, the fix holds" -- failing open on exactly the question asked.
 */
export declare const CSRF_RE: RegExp;
/**
 * SteVe manager-UI client: login, CSRF, form POST -- one cookie jar per
 * instance. It is SteVe-specific and cannot drive any other CSMS.
 *
 * Two callers, each with an instance and therefore a session of its own: the
 * operations path (index.ts) and provisioning (provision.ts, which posts the
 * charging-profile form -- the one manager form with no REST equivalent, since
 * SteVe exposes REST controllers for OCPP tags, transactions and operations
 * but none for stored charging profiles).
 *
 * ONE SESSION, SHARED BY EVERY LANE, AND THEREFORE LOCKED. `tck/main.ts` loads
 * the driver once per process, so the operations instance is a singleton that
 * every parallel lane posts through, and `postForm` is a read-modify-write over
 * `cookies`: it may log in (clearing the jar), then GET a page for a CSRF
 * token, then POST it back. Interleave two of those and a lane spends a token
 * against a session that replaced its own, which Spring answers 403 -- so the
 * operation never reaches the wire and the scenario reports failures about a
 * charge point nobody asked. That was issue #77, at 45% of sweeps.
 *
 * REJECTED, having been measured: one instance per lane. It is the obvious way
 * to delete the lock, and it costs a login per lane and gives up the single
 * session this class exists to hold -- while fixing nothing the lock does not,
 * since provisioning posts through the same method. Serialising also survives
 * the part that is easy to get wrong: what rotates on SteVe is the SESSION, not
 * the token. Spring Security's default `HttpSessionCsrfTokenRepository` keeps
 * one token per session and never rotates it per request; the default
 * `XorCsrfTokenRequestAttributeHandler` re-masks it on every render, so the
 * string in the HTML changes each GET while unmasking to the same token. Only
 * `login()` moves the session, via `changeSessionId`. A fix aimed at the token
 * would have addressed the illusion.
 */
export declare class SteveUiOps {
    private readonly cfg;
    private readonly fetchImpl;
    private cookies;
    /** Tail of the queue of `postForm` calls. Never rejects -- see serialise(). */
    private gate;
    constructor(cfg: SteveConfig, fetchImpl?: FetchLike);
    /**
     * Run `work` after every call already queued, and before every later one.
     *
     * A promise chain rather than a dependency: this package has no runtime
     * dependencies, and `tck/main.ts` memoises its driver with the same
     * `promise ??=` shape. The caller's failure is the caller's -- `run` rejects
     * for whoever owns it, while the chain itself is left resolved, because a
     * rejected `gate` would fail every lane queued behind the first one to
     * stumble.
     */
    private serialise;
    private cookieHeader;
    private absorbSetCookie;
    /**
     * One request, carrying the caller's cookies and two deadlines: its own, and
     * the one bounding the whole critical section it runs in.
     *
     * The section deadline is the load-bearing half. Every request used to carry
     * only its own timeout, which composes rather than caps: five of them in a
     * row is fifty seconds, and holding the lock that long would push a queued
     * lane past its scenario's observation window -- reintroducing "the operation
     * never reached the wire", relocated from the CSRF race to the queue behind
     * it. Neither budget is shortened by combining them.
     */
    private request;
    private isLoggedIn;
    private login;
    /**
     * NOT SERIALISED, and neither are isLoggedIn() or login() -- which is why all
     * three are private. They run only from postFormExclusive(), which already
     * holds the gate, so taking it again here would deadlock on the first call.
     * The invariant is "postForm is the only entry point", and `private` is what
     * enforces it: a second door into the session is not a wrong answer that some
     * guard could catch, it is a caller no guard ever sees.
     */
    private ensureLogin;
    /**
     * GET a manager page for its CSRF token, then POST the form back to the same
     * path. Returns the redirect `Location`, which is how SteVe signals success;
     * throws when there is none, because a 200 here means the form came back with
     * validation errors rather than being accepted.
     *
     * `path` is relative to the manager base, so it spans more than operations:
     * provisioning posts to `chargingProfiles/add` through this same method,
     * which is the point of it being separate from op().
     *
     * Serialised against every other call on this instance, login included: the
     * three steps below are one read-modify-write over the cookie jar, and the
     * class comment says what interleaving two of them costs.
     */
    postForm(path: string, fields: Record<string, string>): Promise<string>;
    /** {@link postForm}'s body, which assumes it already holds the lock. */
    private postFormExclusive;
    /**
     * steve_op OP_PATH FIELDS equivalent. POSTs one CSMS operation,
     * form-encoded, exactly like the manager UI would. Returns the redirect
     * `Location` on success (SteVe 302s to /operations/tasks/<id>); throws on
     * failure (missing CSRF token or no redirect).
     */
    op(opPath: string, fields: Record<string, string>): Promise<string>;
}
