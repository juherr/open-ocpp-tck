import { type FetchLike } from "../../tck/driver";
import type { EvtivityConfig } from "./config";
/** The list routes' own maximum page size. */
export declare const PAGE_LIMIT = 100;
/** An error's message, or the thrown value as a string. */
export declare function reason(err: unknown): string;
/** The first `max` characters of a text quoted in a failure message. */
export declare function preview(text: string, max?: number): string;
/** The parsed JSON of a text, or undefined when it is not JSON. */
export declare function parseJson(text: string): unknown;
export interface RawResponse {
    status: number;
    /** The body as text; `""` when it could not be read. */
    text: string;
    /** Why the body could not be read, when it could not: `request()` refuses
     *  a 2xx answered so, rather than read it as an empty result. */
    unreadable?: string;
}
export interface ApiResponse {
    status: number;
    parsed: unknown;
}
export declare class EvtivityApi {
    readonly cfg: EvtivityConfig;
    private readonly fetchImpl;
    /** `fetchImpl` is the {@link FetchLike} seam. The default resolves the
     *  global per call rather than capturing it, as the contract asks. */
    constructor(cfg: EvtivityConfig, fetchImpl?: FetchLike);
    private send;
    /** Server, account and a digest of the password -- never the password
     *  itself. See the header. */
    private sessionKey;
    /** The cached session and the cache entry it came from, logging in on
     *  first use, when it runs out, and once a kept refusal has expired. */
    private session;
    /** Drops a cache entry, unless a newer one already replaced it. */
    private forget;
    private login;
    /** One send under the cached session, with the session it used. */
    private authenticated;
    /**
     * One authenticated request, raw: the caller reads the status. A 401
     * renews the session and is sent once more, but only once that session is
     * old enough; see the header.
     */
    raw(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<RawResponse>;
    /**
     * One REST request. A non-2xx is a {@link CsmsNotDispatchedError}, except the
     * statuses `allow` lists -- a 404 that means "no such record", a 409 that
     * means "already there" -- which return with `parsed: null`.
     */
    request(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, allow?: readonly number[]): Promise<ApiResponse>;
    get<T>(path: string, allow?: readonly number[]): Promise<T | null>;
}
/**
 * The row of a paged list that `match` accepts, following `page=` until one
 * does or `total` is reached. Every list route's `search` is a substring
 * match, so the exact station, tag or driver can sit behind a full first page
 * of near misses (`CERTCP1` finds `CERTCP10` and up); a first page alone
 * would report it absent.
 */
export declare function findInPages<T>(api: EvtivityApi, path: string, params: Readonly<Record<string, string | number>>, match: (row: T) => boolean): Promise<T | undefined>;
/** `?a=1&b=2` from the members that are set, or `""`. */
export declare function query(params: Readonly<Record<string, string | number | undefined>>): string;
