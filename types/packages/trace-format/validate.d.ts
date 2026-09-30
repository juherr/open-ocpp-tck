/**
 * validate.ts -- a JSON value read as a {@link TraceRecord}, or the reasons it
 * is not one.
 *
 * THE CONTRACT, in one line: `record` is `undefined` if and only if the value
 * violates `trace-v1.schema.json`. Every other diagnostic -- an unreadable
 * `schemaVersion` major, a `raw` that contradicts the members beside it --
 * comes back WITH the record, because the schema admits it and the conformance
 * rules oblige a consumer to accept it. A caller that wants to be stricter has
 * the diagnostics to be stricter with; a caller that does not is still handed a
 * usable record.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN AJV. The specification's reference
 * consumer (`conformance/validate.mjs`) compiles the schema with ajv, which is
 * the right tool for a corpus check that runs in the format's own CI. This
 * library is imported by conformance suites and by browser UIs, so a validator
 * dependency lands in both -- and the schema is 40 lines of `required`, six
 * types, three enums and two conditionals. The cost of transcribing it is one
 * guard; the cost of the dependency is paid by every consumer forever.
 *
 * THE PRICE, STATED: a transcription can drift from the schema it transcribes,
 * and nothing in this repository would notice, because the schema is not
 * vendored here. `tools/trace-conformance.sh` is the answer -- it runs this
 * validator over the specification's own fixtures, which is the only check
 * that compares this file against the document it claims to implement.
 *
 * WHERE THE `raw` RULES COME FROM: `conformance/README.md`'s producer rules,
 * transcribed from `checkRawFidelity` in the reference consumer, member for
 * member -- including which comparisons are CONDITIONAL on the member being
 * present. `raw` is optional, and so are `messageId`, `payload` and every
 * member of `error`, so most of these checks are "if both sides said it, they
 * must agree" rather than "both sides must say it".
 */
import type { Diagnostic } from "./diagnostics";
import { type TraceRecord } from "./record";
/** A value read as a record, or the reasons it is not one. */
export interface ValidatedRecord {
    /** Present if and only if the value satisfies the schema. */
    readonly record?: TraceRecord;
    readonly diagnostics: readonly Diagnostic[];
}
/** One entry per input value, index-aligned with it. */
export interface ValidatedTrace {
    readonly records: readonly (TraceRecord | undefined)[];
    readonly diagnostics: readonly Diagnostic[];
}
/** Reads one JSON value as a record, reporting everything wrong with it. */
export declare function validateRecord(value: unknown, index: number): ValidatedRecord;
/**
 * Reads a whole trace, index-aligned with the values it was given.
 *
 * TOTAL: every input value gets either a record or at least one diagnostic
 * explaining why it did not. An earlier shape skipped `undefined` entries
 * silently -- so that `readTraceText` would not report a line as "not an
 * object" when what happened is that it was not JSON at all -- and that made
 * this function able to return an unexplained hole. Harmless to a caller that
 * refuses on any hole, and exactly wrong for the other kind: a UI that shows
 * what it can and annotates the rest would have dropped the record with
 * nothing to annotate.
 *
 * The no-double-report belongs to the caller that HAS the earlier diagnostic,
 * so it lives in {@link ../index.readTraceText} now.
 */
export declare function validateRecords(values: readonly unknown[]): ValidatedTrace;
