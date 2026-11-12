import { type FetchLike } from "../../tck/driver";
import type { EvtivityConfig } from "./config";
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
/** `?a=1&b=2` from the members that are set, or `""`. */
export declare function query(params: Readonly<Record<string, string | number | undefined>>): string;
