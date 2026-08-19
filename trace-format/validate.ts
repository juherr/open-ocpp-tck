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

import type { Diagnostic, RawEnvelopeMember } from "./diagnostics";
import {
  SUPPORTED_SCHEMA_MAJOR,
  type TraceMessageType,
  type TraceRecord,
} from "./record";

/** The `messageType` each OCPP-J message type id must be spelled as. */
const MESSAGE_TYPE_OF_ID: Record<number, TraceMessageType> = {
  2: "CALL",
  3: "CALLRESULT",
  4: "CALLERROR",
};

const TRANSPORTS = ["json", "soap"];
const DIRECTIONS = ["cp-to-csms", "csms-to-cp"];
const MESSAGE_TYPES = ["CALL", "CALLRESULT", "CALLERROR"];

/** The schema's `required`, in the order it lists them. */
const REQUIRED = [
  "schemaVersion",
  "timestamp",
  "transport",
  "direction",
  "messageType",
];

/**
 * RFC 3339 `date-time`, which is what the schema's `format` means and what
 * `ajv-formats` enforces for the reference consumer.
 *
 * Deliberately no stricter than that. The failure modes are not symmetric: a
 * validator that is too lax lets through a timestamp the format would reject,
 * which costs a consumer nothing it was going to rely on; one that is too
 * strict refuses a whole record -- and, for an all-or-nothing consumer, a whole
 * file -- over a spelling. So the shape is checked here, and the calendar
 * below, and nothing beyond what the format actually says.
 */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isRfc3339DateTime(value: string): boolean {
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return false;
  const monthLength =
    month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > monthLength) return false;
  if (hour > 23 || minute > 59) return false;

  // The offset has ranges too -- `time-numoffset` is `time-hour ":" time-minute`
  // in the grammar, so `+99:99` is not a date-time however well it matches the
  // shape. Both groups are absent for a `Z` suffix, hence the presence checks.
  if (match[9] !== undefined && Number(match[9]) > 23) return false;
  if (match[10] !== undefined && Number(match[10]) > 59) return false;

  // 60 is a leap second, which RFC 3339 admits.
  return second <= 60;
}

/**
 * Structural equality, for comparing a `raw` frame's members against the
 * record's own. Same shape as the reference consumer's `deepEqual`.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

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
export function validateRecord(value: unknown, index: number): ValidatedRecord {
  const diagnostics: Diagnostic[] = [];
  const say = (
    code: Diagnostic["code"],
    detail: string,
    member?: string,
  ): void => {
    diagnostics.push({ index, code, member, detail });
  };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    say("record-not-object", `record is ${describe(value)}, not an object`);
    return { diagnostics };
  }
  const rec = value as Record<string, unknown>;

  for (const member of REQUIRED) {
    if (rec[member] === undefined) {
      say("missing-required", `${member} is required`, member);
    }
  }

  checkString(rec, "schemaVersion", say);
  checkString(rec, "ocppVersion", say);
  checkString(rec, "chargePointId", say);
  checkString(rec, "messageId", say);
  checkString(rec, "action", say);
  checkString(rec, "raw", say);

  if (rec.timestamp !== undefined) {
    if (typeof rec.timestamp !== "string") {
      say("wrong-type", "timestamp must be a string", "timestamp");
    } else if (!isRfc3339DateTime(rec.timestamp)) {
      say(
        "bad-timestamp",
        `timestamp ${JSON.stringify(rec.timestamp)} is not an RFC 3339 date-time`,
        "timestamp",
      );
    }
  }

  checkEnum(rec, "transport", TRANSPORTS, say);
  checkEnum(rec, "direction", DIRECTIONS, say);
  checkEnum(rec, "messageType", MESSAGE_TYPES, say);

  if (rec.connectorId !== undefined) {
    if (typeof rec.connectorId !== "number" || !Number.isInteger(rec.connectorId)) {
      say("wrong-type", "connectorId must be an integer", "connectorId");
    } else if (rec.connectorId < 0) {
      say("out-of-range", "connectorId must be at least 0", "connectorId");
    }
  }

  if (rec.meta !== undefined && !isPlainObject(rec.meta)) {
    say("wrong-type", "meta must be an object", "meta");
  }

  // The schema's two conditionals. `error` is required on a CALLERROR and
  // FORBIDDEN off one -- the `else` branch spells it `{"error": false}`, which
  // is the schema way of saying the member must be absent.
  if (rec.messageType === "CALL" && rec.action === undefined) {
    say("call-missing-action", "a CALL must carry an action", "action");
  }
  if (rec.messageType === "CALLERROR") {
    if (rec.error === undefined) {
      say("callerror-missing-error", "a CALLERROR must carry an error", "error");
    } else if (!isPlainObject(rec.error)) {
      say("wrong-type", "error must be an object", "error");
    } else {
      checkString(rec.error, "code", say, "error.code");
      checkString(rec.error, "description", say, "error.description");
    }
  } else if (rec.error !== undefined) {
    // Not conditioned on `messageType` being a known one: the schema's `else`
    // branch fires for anything that is not the CALLERROR const, an
    // unrecognised spelling included, and reporting both facts is what ajv
    // does for the reference consumer.
    say(
      "error-not-allowed",
      `error is not allowed on a ${JSON.stringify(rec.messageType)}`,
      "error",
    );
  }

  // Everything said so far is a schema violation, and only those withhold the
  // record. The reportable-but-valid ones are all raised below.
  if (diagnostics.length > 0) return { diagnostics };

  // The cast is what the checks above earn, and it is the ONLY one in this
  // file: every member `TraceRecord` declares has been checked for presence
  // and type by this point. Narrowing `rec` structurally instead would mean
  // rebuilding the object member by member, which would drop the unknown ones
  // the conformance rules say a consumer must carry through.
  const record = rec as unknown as TraceRecord;

  // Everything below here is TRUE of a schema-valid record, and is reported
  // rather than withheld. See this file's header.
  if (record.schemaVersion.split(".")[0] !== SUPPORTED_SCHEMA_MAJOR) {
    say(
      "unsupported-schema-major",
      `schemaVersion ${record.schemaVersion} is not major ${SUPPORTED_SCHEMA_MAJOR}`,
      "schemaVersion",
    );
  }
  checkRawFidelity(record, say);

  return { record, diagnostics };
}

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
export function validateRecords(values: readonly unknown[]): ValidatedTrace {
  const records: (TraceRecord | undefined)[] = [];
  const diagnostics: Diagnostic[] = [];
  values.forEach((value, index) => {
    const { record, diagnostics: found } = validateRecord(value, index);
    records.push(record);
    diagnostics.push(...found);
  });
  return { records, diagnostics };
}

type Say = (
  code: Diagnostic["code"],
  detail: string,
  member?: string,
) => void;

function checkString(
  holder: Record<string, unknown>,
  member: string,
  say: Say,
  reportAs: string = member,
): void {
  if (holder[member] !== undefined && typeof holder[member] !== "string") {
    say("wrong-type", `${reportAs} must be a string`, reportAs);
  }
}

function checkEnum(
  rec: Record<string, unknown>,
  member: string,
  allowed: readonly string[],
  say: Say,
): void {
  const value = rec[member];
  if (value === undefined) return;
  if (typeof value !== "string") {
    say("wrong-type", `${member} must be a string`, member);
    return;
  }
  if (!allowed.includes(value)) {
    say(
      "unknown-enum",
      `${member} ${JSON.stringify(value)} is not one of ${allowed.join(", ")}`,
      member,
    );
  }
}

/**
 * `raw` against the members beside it -- the producer rules the schema cannot
 * express. Every comparison is conditional on both sides being present,
 * because every member involved is optional.
 */
function checkRawFidelity(record: TraceRecord, say: Say): void {
  if (record.raw === undefined) return;

  let frame: unknown;
  try {
    frame = JSON.parse(record.raw);
  } catch {
    say("raw-not-json", "raw is present but does not parse as JSON", "raw");
    return;
  }
  if (!Array.isArray(frame)) {
    say("raw-not-array", "raw does not decode to an OCPP-J array", "raw");
    return;
  }

  const mismatch = (member: RawEnvelopeMember, detail: string): void =>
    say("raw-envelope-mismatch", detail, member);

  if (MESSAGE_TYPE_OF_ID[frame[0] as number] !== record.messageType) {
    mismatch(
      "messageType",
      `raw frame kind ${JSON.stringify(frame[0])} contradicts messageType ${record.messageType}`,
    );
  }
  if (record.messageId !== undefined && frame[1] !== record.messageId) {
    mismatch("messageId", "raw messageId contradicts record messageId");
  }

  if (record.messageType === "CALL") {
    if (frame[2] !== record.action) {
      mismatch("action", "raw action contradicts record action");
    }
    if (record.payload !== undefined && !deepEqual(frame[3], record.payload)) {
      mismatch("payload", "raw payload contradicts record payload");
    }
  } else if (record.messageType === "CALLRESULT") {
    if (record.payload !== undefined && !deepEqual(frame[2], record.payload)) {
      mismatch("payload", "raw payload contradicts record payload");
    }
  } else {
    const error = record.error ?? {};
    if (error.code !== undefined && frame[2] !== error.code) {
      mismatch("error.code", "raw error code contradicts record error.code");
    }
    if (error.description !== undefined && frame[3] !== error.description) {
      mismatch(
        "error.description",
        "raw error description contradicts record error.description",
      );
    }
    if (error.details !== undefined && !deepEqual(frame[4], error.details)) {
      mismatch(
        "error.details",
        "raw error details contradicts record error.details",
      );
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
