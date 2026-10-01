export type CsmsErrorCode = "invalid_input" | "not_found" | "method_not_allowed" | "conflict" | "unsupported_capability" | "transport_failure" | "csms_rejected" | "timeout" | "internal";
/** A failure the daemon decides itself, before or instead of a driver call. */
export declare class CsmsHttpError extends Error {
    readonly status: number;
    readonly code: CsmsErrorCode;
    readonly headers: Readonly<Record<string, string>>;
    constructor(status: number, code: CsmsErrorCode, message: string, headers?: Readonly<Record<string, string>>);
}
/** The driver call did not settle within the daemon's deadline. */
export declare class CsmsTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(timeoutMs: number);
}
export interface Classified {
    readonly status: number;
    readonly code: CsmsErrorCode;
    readonly message: string;
    readonly headers: Readonly<Record<string, string>>;
}
/**
 * `driverCall` says whether the failure came out of the driver. A plain
 * `Error` from the driver is the CSMS answering and not doing what was asked;
 * the same thrown by the daemon itself is a daemon bug, and calling it a CSMS
 * rejection would send the reader to the wrong system.
 */
export declare function classify(err: unknown, driverCall: boolean): Classified;
/** Replaces every occurrence of every secret. Longest first, so a secret that
 *  contains another is not left half-visible. */
export declare function redact(text: string, secrets: readonly string[]): string;
