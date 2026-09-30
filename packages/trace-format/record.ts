/**
 * record.ts -- one record of the open-ocpp-trace interchange format.
 *
 * A transcription of `schema/trace-v1.schema.json`, and nothing more. The
 * members are the schema's members, the optional ones are optional, and the
 * two conditionals it expresses -- `action` required on a CALL, `error`
 * required on and forbidden off a CALLERROR -- are enforced in `validate.ts`
 * rather than in the type, because a type cannot refuse a value that arrived
 * at runtime from a file.
 *
 * `additionalProperties` is `true` in the schema and the conformance rules say
 * a consumer must "ignore unknown fields", so this interface is deliberately
 * not exhaustive of what a record may carry. Reading a member that is not
 * here is a change to this file, not a cast at the call site. There is no
 * index signature for the rest: it would make every typo compile. The
 * unlisted members still SURVIVE, because `validate.ts` narrows the object it
 * was given rather than rebuilding one from the members it knows -- a reader
 * that relays records must not be the thing that drops a producer's `meta`.
 */

/** A CALLERROR's error object. Every member is optional in the schema. */
export interface TraceError {
  code?: string;
  description?: string;
  details?: unknown;
}

/** The two transports the format admits. */
export type TraceTransport = "json" | "soap";

/**
 * Absolute, not observer-relative: `cp-to-csms` is a message travelling from
 * the charge point to the CSMS whoever recorded it. A recorder that labels
 * frames from its own point of view has to map them before emitting.
 */
export type TraceDirection = "cp-to-csms" | "csms-to-cp";

/** The OCPP-J message types, spelled as the schema spells them. */
export type TraceMessageType = "CALL" | "CALLRESULT" | "CALLERROR";

/** A record that satisfies `trace-v1.schema.json`. */
export interface TraceRecord {
  schemaVersion: string;
  timestamp: string;
  transport: TraceTransport;
  direction: TraceDirection;
  messageType: TraceMessageType;
  ocppVersion?: string;
  chargePointId?: string;
  connectorId?: number;
  messageId?: string;
  action?: string;
  payload?: unknown;
  raw?: string;
  error?: TraceError;
  meta?: Record<string, unknown>;
}

/**
 * The `schemaVersion` major this reader implements.
 *
 * Exported rather than applied: whether an unreadable major is fatal is the
 * caller's decision, and `validate.ts` only reports it. See
 * {@link ../diagnostics.DiagnosticCode} `unsupported-schema-major`.
 *
 * A major is the right granularity because the format versions in-band and has
 * already moved 1.0 -> 1.1 by adding members, which is exactly the change a
 * consumer reading named members survives. A major bump is the one that may
 * move what a name means.
 */
export const SUPPORTED_SCHEMA_MAJOR = "1";
