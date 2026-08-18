/**
 * trace-format -- a reader for the open-ocpp-trace interchange format.
 *
 * See `README.md` beside this file for what the library is for, the two rules
 * that shape its API, and where it is going.
 */

export type {
  TraceDirection,
  TraceError,
  TraceMessageType,
  TraceRecord,
  TraceTransport,
} from "./record";
export { SUPPORTED_SCHEMA_MAJOR } from "./record";

export type { Diagnostic, DiagnosticCode } from "./diagnostics";

export type { SplitTrace } from "./jsonl";
export { splitJsonl } from "./jsonl";

export type { ValidatedRecord, ValidatedTrace } from "./validate";
export { validateRecord, validateRecords } from "./validate";

export type {
  ConsumerCounts,
  ConsumerRecordView,
  ConsumerView,
} from "./consumer-view";
export { consumerView, crossRecordDiagnostics } from "./consumer-view";

import { splitJsonl } from "./jsonl";
import { validateRecords, type ValidatedTrace } from "./validate";

/**
 * Reads a whole JSONL trace: split, then validate, diagnostics concatenated.
 *
 * The two halves stay separately exported because a consumer that already has
 * records -- from a websocket, from a test table, from another tool's output
 * -- has no text to split, and making it invent some to reach the validator is
 * how a reader ends up with two ways in that drift.
 */
export function readTraceText(text: string): ValidatedTrace {
  const split = splitJsonl(text);
  const validated = validateRecords(split.values);
  return {
    records: validated.records,
    diagnostics: [...split.diagnostics, ...validated.diagnostics],
  };
}
