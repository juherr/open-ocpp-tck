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

export type {
  Diagnostic,
  DiagnosticCode,
  RawEnvelopeMember,
} from "./diagnostics";

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

export type { Correlatable, Correlation } from "./correlate";
export { correlate } from "./correlate";

export { readTraceText } from "./read";

// `conformance.ts` is NOT re-exported here, and that is the point of it having
// its own entry. It reads directories, so re-exporting it would put `node:fs`
// in the module graph of every consumer -- including the browser UI this
// library exists to be usable by, whose bundler would then have to be told to
// drop it. `tests/trace-format-standalone.sh` cannot see this: `node:` imports
// are allowed there, correctly, because that guard is about ties to THIS
// repository. Import it as `<pkg>/trace-format/conformance`.
