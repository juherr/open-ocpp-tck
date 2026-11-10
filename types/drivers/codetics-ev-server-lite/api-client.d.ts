/**
 * api-client.ts -- the one HTTP surface this driver uses: the server's admin
 * REST API under `/api/v1`.
 *
 * WHAT THE SERVER ASKS OF A CLIENT, source-verified at the pinned commit
 * (security/SecurityConfiguration.kt, security/AuthController.kt):
 *
 *  - a bearer token from `POST /api/v1/auth/app/signin {tenant,email,password}`,
 *    answered as `{token, expires_at, user}`;
 *  - CSRF on EVERY mutating request, signin included, bearer or not. The
 *    repository is `CookieCsrfTokenRepository` with the plain (non-XOR) request
 *    handler, so the token `GET /api/v1/auth/csrf` returns is sent back twice:
 *    as the `XSRF-TOKEN` cookie and in the header that response names.
 *
 * ONE LOGIN PER PROCESS, AND THE REASON IS A LIMIT RATHER THAN A COURTESY.
 * AccountService#login counts every attempt, good or bad, against
 * `login:<tenant>:<email>` -- ten per fifteen minutes -- and the counter lives
 * in the server's database, so only a restart clears it. Three sweep lanes,
 * the readiness gate and `driver selftest` each calling `create()` would
 * otherwise spend that budget in one run. So the session is cached at module
 * level, keyed by server and account, and shared by every client in the
 * process, in-flight attempt included.
 *
 * ONLY A REFUSED SIGNIN IS CACHED. The counter is incremented by
 * `POST /api/v1/auth/app/signin` alone (AccountService#login is the one caller
 * of RateLimiter#check on this path), so a signin the server answered 401, 403
 * or 429 is the one failure that spent budget and would spend more if retried:
 * that rejection is kept for the life of the process. Every other failure is
 * dropped from the cache and the next call tries again -- a `fetch` that threw
 * (the readiness gate waiting for a CSMS still booting), any answer to the
 * uncounted `GET /api/v1/auth/csrf`, a 5xx from signin, a 2xx without a token.
 * Keeping those would turn one bad moment into a failure of every later lane
 * and scenario, for an attempt that either was not counted or succeeded.
 *
 * FAILURE CLASSES. A request `fetch` could not complete, and one the server
 * answered with a non-2xx status, are both {@link CsmsNotDispatchedError}: for
 * every call this driver makes, a refused HTTP request is one whose effect --
 * a queued command, a seeded fixture, a read -- did not happen, so nothing it
 * would have caused went on the wire. A 2xx whose body cannot be read is a
 * plain `Error`: the request was answered, and whether it took effect is
 * exactly what is unknown.
 *
 * NOT GUARDED OFFLINE YET. The `fetch` seam below is the one the other bundled
 * drivers' transport guards ride, and this client takes it for the same
 * reason, but no guard drives it: what is unprotected is the classification
 * above and the login cache's two branches.
 */
import { type FetchLike } from "../../tck/driver";
import type { EvslConfig } from "./config";
export interface ApiResponse {
    status: number;
    parsed: unknown;
}
export declare class EvslApi {
    private readonly cfg;
    private readonly fetchImpl;
    /** `fetchImpl` is the {@link FetchLike} seam. The default resolves the
     *  global per call rather than capturing it, as the contract asks. */
    constructor(cfg: EvslConfig, fetchImpl?: FetchLike);
    private send;
    private sessionKey;
    /** The cached session, logging in on first use. */
    private session;
    private login;
    /**
     * One authenticated request. `body` present makes it a mutation, which
     * carries the CSRF pair. `allow` lists the non-2xx statuses the caller
     * handles itself -- a 404 that means "no such record", a 409 that means
     * "already there" -- and returns rather than throws for.
     */
    request(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, allow?: readonly number[]): Promise<ApiResponse>;
    get<T>(path: string, allow?: readonly number[]): Promise<T | null>;
}
/** `?a=1&b=2` from the members that are set, or `""`. */
export declare function query(params: Readonly<Record<string, string | number | undefined>>): string;
