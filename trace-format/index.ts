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

export { readTraceText } from "./read";

export type { FixtureResult } from "./conformance";
export { checkFixture, checkFixtures, formatResults } from "./conformance";
