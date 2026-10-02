// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The daemon's error envelope, `{"error":{"code","message"}}`, and the one
 * function that decides which code a failure gets.
 *
 * The codes are the API; the messages are for humans and may change. Each
 * failure class maps to exactly one (status, code), so a client branches on
 * the code and never parses a message.
 */
import { ChargePointAlreadyExistsError, ChargePointNotFoundError } from "../charge-points";
import { CsmsNotDispatchedError, UnsupportedOperationError } from "../contracts";
import { InvalidInputError } from "./decode";

export type CsmsErrorCode =
  | "invalid_input"
  | "not_found"
  | "method_not_allowed"
  | "forbidden_origin"
  | "unsupported_media_type"
  | "conflict"
  | "unsupported_capability"
  | "transport_failure"
  | "csms_rejected"
  | "timeout"
  | "internal";

/** A failure the daemon decides itself, before or instead of a driver call. */
export class CsmsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: CsmsErrorCode,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "CsmsHttpError";
  }
}

/** The driver call did not settle within the daemon's deadline. */
export class CsmsTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(
      `the CSMS did not answer within ${timeoutMs} ms; the outcome is unknown -- ` +
        "the request may still have been dispatched",
    );
    this.name = "CsmsTimeoutError";
  }
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
export function classify(err: unknown, driverCall: boolean): Classified {
  const message = err instanceof Error ? err.message : String(err);
  const plain = (status: number, code: CsmsErrorCode): Classified => ({ status, code, message, headers: {} });
  if (err instanceof CsmsHttpError) return { status: err.status, code: err.code, message, headers: err.headers };
  if (err instanceof InvalidInputError) return plain(400, "invalid_input");
  if (err instanceof UnsupportedOperationError) return plain(501, "unsupported_capability");
  if (err instanceof ChargePointNotFoundError) return plain(404, "not_found");
  if (err instanceof ChargePointAlreadyExistsError) return plain(409, "conflict");
  if (err instanceof CsmsTimeoutError) return plain(504, "timeout");
  if (err instanceof CsmsNotDispatchedError) return plain(502, "transport_failure");
  return driverCall ? plain(502, "csms_rejected") : plain(500, "internal");
}

/** Replaces every occurrence of every secret. Longest first, so a secret that
 *  contains another is not left half-visible. */
export function redact(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}
