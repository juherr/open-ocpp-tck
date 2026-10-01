import type { CsmsDriver } from "../models";
/** Who the driver is. Passed in rather than read off the driver, which does not carry it. */
export interface CsmsHttpAbout {
    readonly id: string;
    readonly displayName: string;
    /** Absent means the driver did not say. */
    readonly protocols?: readonly string[];
}
export interface CsmsHttpOptions {
    readonly about: CsmsHttpAbout;
    /** How long one driver call may take before the daemon answers 504. Default 60 s. */
    readonly timeoutMs?: number;
    /** Values redacted from every message the daemon returns or logs: the
     *  driver's credentials. A request's own Basic Auth password is added per request. */
    readonly secrets?: readonly string[];
    /** One line per request: method, path, status and error code. Never a body. */
    readonly log?: (line: string) => void;
}
export type CsmsHttpHandler = (request: Request) => Promise<Response>;
export declare const DEFAULT_TIMEOUT_MS = 60000;
/** The largest delay `setTimeout` honours. Beyond it the timer fires at once,
 *  and every dispatched operation would be answered `timeout`. */
export declare const MAX_TIMEOUT_MS = 2147483647;
export declare function createCsmsHttpHandler(driver: CsmsDriver, options: CsmsHttpOptions): CsmsHttpHandler;
