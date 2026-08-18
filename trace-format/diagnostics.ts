/**
 * diagnostics.ts -- what this reader can say about a record, without deciding
 * anything about it.
 *
 * THERE IS NO SEVERITY FIELD, and that is the design rather than an omission.
 * This library has two consumers that are opposites on exactly this axis: a
 * conformance suite refuses a whole file rather than judge a run on frames it
 * is not sure of, and a debugging UI shows every record it can and annotates
 * the rest. A `severity: "error" | "warning"` would encode one of those two
 * answers in the shared layer and make the other one wrong -- and the wrongness
 * would be silent, because both consumers would still compile.
 *
 * So a diagnostic states a FACT about a record, and the caller decides what it
 * costs. Two things carry that decision:
 *
 *  - the CODE, which is a closed union so a consumer can enumerate the ones it
 *    treats as fatal, and a new code added here is not silently swept into an
 *    existing policy;
 *  - the MEMBER, for codes where the same fact matters differently depending on
 *    where it is. `raw-envelope-mismatch` is the worked example: a disagreement
 *    on `messageType`, `messageId` or `action` silently answers the wrong
 *    question for anyone SELECTING records by them, where a disagreement on a
 *    description is visible in whatever the reader prints. Detecting both is
 *    this library's job; caring differently about them is not.
 *
 * AND WHAT IS NOT A DIAGNOSTIC. A record that satisfies the schema produces
 * none, however unusable a given consumer finds it. The conformance rules say
 * a consumer "must accept any record that validates against the schema", so a
 * record carrying `payload` and no `raw` -- both optional -- is silent here
 * even though a consumer that reads wire bytes cannot use it. That refusal
 * belongs to the consumer, and naming it there rather than here is what keeps
 * this library usable by the other one.
 */

/**
 * Every fact this reader can state about a record.
 *
 * Closed on purpose: a consumer's policy is a list of these, and a policy
 * written against an open set cannot be complete.
 */
export type DiagnosticCode =
  // --- Structure: the line, and the shape of what it decoded to.
  /** A non-blank line that is not JSON. */
  | "line-not-json"
  /** JSON, but not a JSON object -- an array, a string, `null`. */
  | "record-not-object"

  // --- The schema's `required`, its types, and its enums.
  /** A member the schema requires is absent. `member` says which. */
  | "missing-required"
  /** A member is present with the wrong JSON type. `member` says which. */
  | "wrong-type"
  /** A member is a string outside the schema's enum. `member` says which. */
  | "unknown-enum"
  /** `connectorId` is an integer below the schema's minimum of 0. */
  | "out-of-range"
  /** `timestamp` is not an RFC 3339 date-time. */
  | "bad-timestamp"

  // --- The two conditionals the schema expresses through `allOf`/`if`.
  /** `messageType` is CALL and `action` is absent. */
  | "call-missing-action"
  /** `messageType` is CALLERROR and `error` is absent. */
  | "callerror-missing-error"
  /** `error` is present on a CALL or a CALLRESULT, where the schema bans it. */
  | "error-not-allowed"

  // --- Version, which the schema types as a bare string and cannot police.
  /**
   * The `schemaVersion` major is not the one this reader implements.
   *
   * Reported rather than refused: the record may be perfectly well-formed, and
   * whether a reader should stop at a major it does not know is a decision
   * about what the reader is FOR. See `SUPPORTED_SCHEMA_MAJOR`.
   */
  | "unsupported-schema-major"

  // --- Producer conformance: `raw` against the members beside it.
  /** `raw` is present and is not JSON. */
  | "raw-not-json"
  /** `raw` is present, is JSON, and is not an OCPP-J array. */
  | "raw-not-array"
  /**
   * `raw` decodes, and contradicts the member beside it. `member` is one of
   * `messageType`, `messageId`, `action`, `payload`, `error.code`,
   * `error.description`, `error.details`.
   */
  | "raw-envelope-mismatch"

  // --- Cross-record, so only derivable once the whole trace is correlated.
  /**
   * A response carries its own `action` and it is not the action of the CALL
   * it correlates with. The conformance rules make the optional response
   * `action` a copy of the CALL's, so a disagreement means one of the two is
   * wrong and nothing in the record says which.
   */
  | "response-action-mismatch";

/**
 * One fact about one record.
 *
 * `index` is the record's position in the array it was read from, which for a
 * file is its ordinal among the NON-BLANK lines -- see `jsonl.ts`, which keeps
 * that alignment by emitting a hole rather than closing the gap.
 */
export interface Diagnostic {
  readonly index: number;
  readonly code: DiagnosticCode;
  /** The member the fact is about, where the code has one. */
  readonly member?: string;
  /** One line, for a human. Never parsed -- the code and member are the API. */
  readonly detail: string;
}
