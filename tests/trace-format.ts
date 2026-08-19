/**
 * tests/trace-format.ts -- guard over trace-format/, the open-ocpp-trace
 * reader.
 *
 * PROPERTY, in six parts.
 *
 *  1. THE CONTRACT: a record comes back if and only if the value satisfies
 *     `trace-v1.schema.json`. Everything else the reader can say -- an
 *     unreadable `schemaVersion` major, a `raw` that contradicts its envelope
 *     -- comes back WITH the record. This is the whole reason two consumers
 *     with opposite policies can share the library, so it is claim one. And
 *     `validateRecords` is TOTAL: no input value may come back as a hole with
 *     nothing saying why. A caller that refuses on any hole cannot tell the
 *     difference; the other kind of caller -- one that shows what it can and
 *     annotates the rest -- would drop a record with nothing to annotate.
 *  2. THE SCHEMA'S RULES, transcribed rather than compiled, so each one is a
 *     line that can be wrong: the five required members, the types, the three
 *     enums, `connectorId`'s minimum, `timestamp`'s date-time, and the two
 *     conditionals -- `action` required on a CALL, `error` required ON and
 *     forbidden OFF a CALLERROR.
 *  3. `raw` FIDELITY is reported per MEMBER, because a consumer's policy is
 *     allowed to care about `messageId` and not about `error.description` --
 *     tck/trace.ts's does exactly that. A single "raw is wrong" code would
 *     make that policy unwritable.
 *  4. THE CONSUMER VIEW IS THE NORMATIVE DERIVATION, correlation rule
 *     included: most recent PRECEDING call, same `messageId`, OPPOSITE
 *     direction, NOT ALREADY ANSWERED. The last clause is the one that is easy
 *     to drop and hard to notice, because with unique ids a reader that forgets
 *     it returns the same answer; the row below reuses an id, which is where
 *     the rule bites.
 *  5. INDEX ALIGNMENT SURVIVES A BAD LINE. `correlatesWith` is an index, so a
 *     reader that closed the gap after an unreadable line would renumber every
 *     record after it and answer confidently about the wrong ones.
 *  6. NO POLICY: a record that satisfies the schema produces NO diagnostic,
 *     however unusable a consumer finds it. A record with `payload` and no
 *     `raw` is the case that matters -- it is conformant, tck/trace.ts refuses
 *     it, and the day this library starts refusing it too is the day it stops
 *     being usable by a debugger.
 *
 * Why this is TypeScript and not a shell guard: it is a table of records
 * handed to a function, which is not a thing the CLI can be made to do. The
 * same argument as tests/trace-frames.ts, one layer down.
 *
 * WHAT THIS GUARD CANNOT DO, so it is written here rather than assumed: it
 * cannot tell you the transcription in `validate.ts` still matches the
 * document it transcribes. The schema is not vendored here. Only
 * tools/trace-conformance.sh can say that, and it needs the network.
 *
 * Offline: builds objects, calls functions.
 */

import {
  consumerView,
  crossRecordDiagnostics,
  readTraceText,
  splitJsonl,
  validateRecord,
  validateRecords,
  type Diagnostic,
  type DiagnosticCode,
  type TraceRecord,
} from "../trace-format";

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
};

/** A conformant CALL, from the specification's `normal-session` fixture. */
const CALL = {
  schemaVersion: "1.1",
  timestamp: "2024-01-15T10:00:00.000Z",
  ocppVersion: "1.6",
  transport: "json",
  chargePointId: "CS-SYNTHETIC-001",
  direction: "cp-to-csms",
  messageType: "CALL",
  messageId: "msg-001",
  action: "Heartbeat",
  payload: {},
  raw: '[2,"msg-001","Heartbeat",{}]',
};

/** Its answer. */
const RESULT = {
  schemaVersion: "1.1",
  timestamp: "2024-01-15T10:00:00.500Z",
  ocppVersion: "1.6",
  transport: "json",
  chargePointId: "CS-SYNTHETIC-001",
  direction: "csms-to-cp",
  messageType: "CALLRESULT",
  messageId: "msg-001",
  payload: { currentTime: "2024-01-15T10:00:00.500Z" },
  raw: '[3,"msg-001",{"currentTime":"2024-01-15T10:00:00.500Z"}]',
};

/** `{...record, ...override}`, with a member DELETED by naming it in `drop`. */
function tweak(
  record: object,
  override: Record<string, unknown> = {},
  drop: readonly string[] = [],
): unknown {
  const copy: Record<string, unknown> = { ...record, ...override };
  for (const member of drop) delete copy[member];
  return copy;
}

const codesOf = (diagnostics: readonly Diagnostic[]): string =>
  diagnostics.map((d) => `${d.code}${d.member ? `/${d.member}` : ""}`).join(",");

// --------------------------------------------------------------------------
// 1 + 2. The contract, and the schema rules that decide it.
// --------------------------------------------------------------------------

{
  const { record, diagnostics } = validateRecord(CALL, 0);
  if (!record) {
    fail("a conformant record validates", `refused with ${codesOf(diagnostics)}`);
  } else if (diagnostics.length !== 0) {
    fail("a conformant record is silent", `said ${codesOf(diagnostics)}`);
  } else if (record.action !== "Heartbeat" || record.messageId !== "msg-001") {
    fail("a validated record keeps its members", JSON.stringify(record));
  }
}

// Unknown members survive: the conformance rules oblige a consumer to ignore
// them, and a reader that REBUILT records from the members it knows would
// silently drop a producer's `meta` on the way through.
{
  const { record } = validateRecord(
    tweak(CALL, { meta: { runId: 7 }, somethingNew: true }),
    0,
  );
  const carried = record as (TraceRecord & { somethingNew?: unknown }) | undefined;
  if (!carried || carried.somethingNew !== true) {
    fail(
      "an unknown member survives validation",
      `got ${JSON.stringify(carried)}`,
    );
  }
}

/** Each row: a value off the schema, and the code that must say so. */
const offSchema: Array<{ name: string; value: unknown; code: DiagnosticCode }> = [
  { name: "no schemaVersion", value: tweak(CALL, {}, ["schemaVersion"]), code: "missing-required" },
  { name: "no timestamp", value: tweak(CALL, {}, ["timestamp"]), code: "missing-required" },
  { name: "no transport", value: tweak(CALL, {}, ["transport"]), code: "missing-required" },
  { name: "no direction", value: tweak(CALL, {}, ["direction"]), code: "missing-required" },
  { name: "no messageType", value: tweak(CALL, {}, ["messageType"]), code: "missing-required" },

  { name: "a numeric schemaVersion", value: tweak(CALL, { schemaVersion: 1.1 }), code: "wrong-type" },
  { name: "a numeric messageId", value: tweak(CALL, { messageId: 1 }), code: "wrong-type" },
  { name: "a non-string raw", value: tweak(CALL, { raw: ["a"] }), code: "wrong-type" },
  { name: "a non-object meta", value: tweak(CALL, { meta: "x" }), code: "wrong-type" },

  { name: "an unknown transport", value: tweak(CALL, { transport: "mqtt" }), code: "unknown-enum" },
  { name: "an unknown direction", value: tweak(CALL, { direction: "cp-to-cp" }), code: "unknown-enum" },
  { name: "an unknown messageType", value: tweak(CALL, { messageType: "CALLBACK" }), code: "unknown-enum" },

  { name: "a negative connectorId", value: tweak(CALL, { connectorId: -1 }), code: "out-of-range" },
  { name: "a fractional connectorId", value: tweak(CALL, { connectorId: 1.5 }), code: "wrong-type" },

  { name: "a timestamp that is not a date-time", value: tweak(CALL, { timestamp: "yesterday" }), code: "bad-timestamp" },
  { name: "a 31st of February", value: tweak(CALL, { timestamp: "2024-02-31T00:00:00Z" }), code: "bad-timestamp" },

  // The schema's two conditionals.
  { name: "a CALL with no action", value: tweak(CALL, {}, ["action"]), code: "call-missing-action" },
  {
    name: "a CALLERROR with no error",
    value: tweak(CALL, { messageType: "CALLERROR" }, ["action"]),
    code: "callerror-missing-error",
  },
  {
    name: "an error on a CALL, which the schema forbids",
    value: tweak(CALL, { error: { code: "GenericError" } }),
    code: "error-not-allowed",
  },

  { name: "a record that is not an object", value: "[2]", code: "record-not-object" },
  { name: "a null record", value: null, code: "record-not-object" },
  { name: "an array record", value: [1, 2], code: "record-not-object" },
];

for (const { name, value, code } of offSchema) {
  const { record, diagnostics } = validateRecord(value, 0);
  if (record !== undefined) {
    fail(`off the schema withholds the record: ${name}`, "a record came back");
  }
  if (!diagnostics.some((d) => d.code === code)) {
    fail(`off the schema says why: ${name}`, `expected ${code}, got ${codesOf(diagnostics)}`);
  }
}

// validateRecords is TOTAL. `undefined` is the shape that used to slip
// through: it was skipped so that readTraceText would not report a line as
// "not an object" when it was not JSON at all, and the skip made an
// unexplained hole reachable through the library's own entry point.
{
  const { records, diagnostics } = validateRecords([undefined, CALL, null]);
  if (records.length !== 3) {
    fail("validateRecords is index-aligned", `got ${records.length} records for 3 values`);
  }
  for (const index of [0, 2]) {
    if (records[index] !== undefined) {
      fail("validateRecords withholds a bad record", `index ${index} came back`);
    }
    if (!diagnostics.some((d) => d.index === index)) {
      fail(
        "validateRecords explains every hole it leaves",
        `index ${index} is missing with no diagnostic -- got ${codesOf(diagnostics)}`,
      );
    }
  }
}

// A leap day is a real date, and a validator that got there by rejecting every
// 29th of February would pass every row above.
if (validateRecord(tweak(CALL, { timestamp: "2024-02-29T00:00:00Z" }), 0).record === undefined) {
  fail("a leap day validates", "2024-02-29 was refused");
}

// A minor bump adds members within a major, which is the change a reader of
// named members survives -- so it is NOT reported.
{
  const { record, diagnostics } = validateRecord(tweak(CALL, { schemaVersion: "1.9" }), 0);
  if (!record || diagnostics.length !== 0) {
    fail("a newer MINOR version is silent", `got ${codesOf(diagnostics)}`);
  }
}

// A major this reader does not implement IS reported -- and still yields the
// record, because the schema types `schemaVersion` as a bare string and has no
// opinion about its value. Claim 1, in the one place it is easiest to get
// wrong.
{
  const { record, diagnostics } = validateRecord(tweak(CALL, { schemaVersion: "2.0" }), 0);
  if (!record) {
    fail("an unknown major still yields the record", "the record was withheld");
  }
  if (!diagnostics.some((d) => d.code === "unsupported-schema-major")) {
    fail("an unknown major is reported", `got ${codesOf(diagnostics)}`);
  }
}

// --------------------------------------------------------------------------
// 3. `raw` against the members beside it, per member.
// --------------------------------------------------------------------------

const fidelity: Array<{ name: string; value: unknown; code: DiagnosticCode; member?: string }> = [
  { name: "raw that is not JSON", value: tweak(CALL, { raw: "not json" }), code: "raw-not-json", member: "raw" },
  { name: "raw that is not an array", value: tweak(CALL, { raw: '{"a":1}' }), code: "raw-not-array", member: "raw" },
  {
    name: "a messageType the bytes contradict",
    value: tweak(CALL, { raw: '[3,"msg-001",{}]' }),
    code: "raw-envelope-mismatch",
    member: "messageType",
  },
  {
    name: "a messageId the bytes contradict",
    value: tweak(CALL, { messageId: "other" }),
    code: "raw-envelope-mismatch",
    member: "messageId",
  },
  {
    name: "an action the bytes contradict",
    value: tweak(CALL, { action: "BootNotification" }),
    code: "raw-envelope-mismatch",
    member: "action",
  },
  {
    name: "a payload the bytes contradict",
    value: tweak(CALL, { payload: { a: 1 } }),
    code: "raw-envelope-mismatch",
    member: "payload",
  },
  {
    name: "an error.code the bytes contradict",
    value: tweak(CALL, {
      messageType: "CALLERROR",
      error: { code: "GenericError" },
      raw: '[4,"msg-001","NotSupported","",{}]',
    }, ["action", "payload"]),
    code: "raw-envelope-mismatch",
    member: "error.code",
  },
  {
    name: "an error.description the bytes contradict",
    value: tweak(CALL, {
      messageType: "CALLERROR",
      error: { code: "NotSupported", description: "mine" },
      raw: '[4,"msg-001","NotSupported","theirs",{}]',
    }, ["action", "payload"]),
    code: "raw-envelope-mismatch",
    member: "error.description",
  },
];

for (const { name, value, code, member } of fidelity) {
  const { record, diagnostics } = validateRecord(value, 0);
  // Claim 1 again: `raw` disagreeing with its envelope is a schema-VALID
  // record. Withholding it here would make the library's strictness the
  // caller's problem.
  if (record === undefined) {
    fail(`a raw mismatch still yields the record: ${name}`, "the record was withheld");
  }
  const hit = diagnostics.find((d) => d.code === code && d.member === member);
  if (!hit) {
    fail(
      `a raw mismatch names its member: ${name}`,
      `expected ${code}/${member ?? "-"}, got ${codesOf(diagnostics)}`,
    );
  }
}

// The comparisons are CONDITIONAL on both sides being present, because every
// member involved is optional. A record with no `payload` beside a `raw` that
// carries one is not a contradiction, it is a producer that chose not to
// duplicate the bytes.
{
  const { diagnostics } = validateRecord(tweak(CALL, {}, ["payload"]), 0);
  if (diagnostics.length !== 0) {
    fail("an absent payload is not a mismatch", `said ${codesOf(diagnostics)}`);
  }
}

// --------------------------------------------------------------------------
// 4. The consumer view, and the clause of the correlation rule that hides.
// --------------------------------------------------------------------------

const recordsOf = (values: readonly unknown[]): TraceRecord[] => {
  const { records, diagnostics } = validateRecords(values);
  const bad = records.filter((r) => r === undefined).length;
  if (bad > 0) {
    fail("the view fixture validates", `${bad} record(s) off the schema: ${codesOf(diagnostics)}`);
  }
  return records.filter((r): r is TraceRecord => r !== undefined);
};

{
  const view = consumerView(recordsOf([CALL, RESULT]));
  if (view.records[1]?.correlatesWith !== 0) {
    fail("a response correlates with its call", JSON.stringify(view.records[1]));
  }
  // The response inherits the CALL's action: a CALLRESULT's wire frame carries
  // none, and this is the derivation that puts one back.
  if (view.records[1]?.action !== "Heartbeat") {
    fail("a response inherits the call's action", JSON.stringify(view.records[1]));
  }
  if (view.counts.records !== 2 || view.counts.calls !== 1 || view.counts.callResults !== 1) {
    fail("the view counts by message type", JSON.stringify(view.counts));
  }
  if (view.unansweredCalls.length !== 0 || view.orphanResponses.length !== 0) {
    fail("a complete exchange leaves nothing over", JSON.stringify(view));
  }
}

// Same direction is not an answer -- two charge-point CALLs sharing an id do
// not correlate with each other.
{
  const view = consumerView(recordsOf([CALL, tweak(RESULT, { direction: "cp-to-csms" })]));
  if (view.orphanResponses.length !== 1 || view.unansweredCalls.length !== 1) {
    fail("direction must be opposite to correlate", JSON.stringify(view));
  }
}

// A response before any call is an orphan; a call with no response is
// unanswered.
{
  const view = consumerView(recordsOf([RESULT, CALL]));
  if (view.orphanResponses[0] !== 0 || view.unansweredCalls[0] !== 1) {
    fail("order decides orphan and unanswered", JSON.stringify(view));
  }
}

// NOT-ALREADY-ANSWERED, the clause that hides. Two CALLs reuse one id and two
// responses come back: the rule pairs them 1:1, backwards -- response 2 with
// call 1, response 3 with call 0. A reader that forgot the clause maps BOTH
// responses onto the most recent call and reports call 0 unanswered, and every
// trace with unique ids would still pass it.
{
  const view = consumerView(
    recordsOf([CALL, tweak(CALL, { timestamp: "2024-01-15T10:00:01.000Z" }), RESULT, tweak(RESULT, { timestamp: "2024-01-15T10:00:01.500Z" })]),
  );
  const pairs = view.records.map((r) => r.correlatesWith);
  if (pairs[2] !== 1 || pairs[3] !== 0) {
    fail(
      "a reused messageId pairs one to one, most recent first",
      `expected [.,.,1,0], got ${JSON.stringify(pairs)}`,
    );
  }
  if (view.unansweredCalls.length !== 0 || view.orphanResponses.length !== 0) {
    fail("a reused messageId leaves nothing over", JSON.stringify(view));
  }
}

// The one producer rule that needs the whole trace: a response that carries
// its own action must agree with the call it answers.
{
  const records = recordsOf([CALL, tweak(RESULT, { action: "BootNotification" })]);
  const found = crossRecordDiagnostics(records, consumerView(records));
  if (!found.some((d) => d.code === "response-action-mismatch")) {
    fail("a response action that contradicts its call is reported", codesOf(found));
  }
  const agreeing = recordsOf([CALL, tweak(RESULT, { action: "Heartbeat" })]);
  if (crossRecordDiagnostics(agreeing, consumerView(agreeing)).length !== 0) {
    fail("a response action that agrees is silent", "a diagnostic was raised");
  }
}

// --------------------------------------------------------------------------
// 5. A bad line leaves a hole, so every other index stays true.
// --------------------------------------------------------------------------

{
  const text = [JSON.stringify(CALL), "{ not json", JSON.stringify(RESULT)].join("\n");
  const { values, diagnostics } = splitJsonl(text);
  if (values.length !== 3 || values[1] !== undefined) {
    fail("a bad line leaves a hole", `got ${values.length} values, [1]=${String(values[1])}`);
  }
  if (diagnostics[0]?.code !== "line-not-json" || diagnostics[0]?.index !== 1) {
    fail("the hole is reported at its own index", codesOf(diagnostics));
  }

  const read = readTraceText(text);
  if (read.records.length !== 3 || read.records[1] !== undefined) {
    fail("readTraceText keeps the hole", `got ${read.records.length} records`);
  }
  // The record AFTER the hole must still be at index 2. This is the whole
  // point: closing the gap would put it at 1 and every correlatesWith after it
  // would name the wrong record.
  if (read.records[2]?.messageType !== "CALLRESULT") {
    fail("indices survive a bad line", JSON.stringify(read.records[2]));
  }
  // And a hole must not be re-reported as a shape problem: "not JSON" and "not
  // an object" are different facts and only one of them happened.
  if (read.diagnostics.some((d) => d.index === 1 && d.code === "record-not-object")) {
    fail("a hole is not also a shape complaint", codesOf(read.diagnostics));
  }
}

// Blank lines are skipped, not holed: a trailing newline is how appending to a
// file works.
{
  const { values, diagnostics } = splitJsonl(`\n${JSON.stringify(CALL)}\n\n`);
  if (values.length !== 1 || diagnostics.length !== 0) {
    fail("blank lines are skipped", `${values.length} values, ${codesOf(diagnostics)}`);
  }
}

// --------------------------------------------------------------------------
// 6. No policy: schema-valid is silent, whatever a consumer would do with it.
// --------------------------------------------------------------------------

const silentButUnusable: Array<{ name: string; value: unknown }> = [
  // The case that matters. `raw` is optional, tck/trace.ts refuses this record
  // as `payload-only`, and this library must not: a debugger reads `payload`
  // and has everything it needs.
  { name: "payload and no raw", value: tweak(CALL, {}, ["raw"]) },
  // Also optional, also refused by tck/trace.ts, also none of this library's
  // business.
  { name: "no messageId", value: tweak(CALL, {}, ["messageId", "raw"]) },
  // A SOAP record carries no OCPP-J array. The schema admits the transport.
  { name: "a soap record", value: tweak(CALL, { transport: "soap" }, ["raw"]) },
];

for (const { name, value } of silentButUnusable) {
  const { record, diagnostics } = validateRecord(value, 0);
  if (!record || diagnostics.length !== 0) {
    fail(
      `schema-valid is silent: ${name}`,
      record ? `said ${codesOf(diagnostics)}` : "the record was withheld",
    );
  }
}

// --------------------------------------------------------------------------

if (failures > 0) {
  process.stderr.write(
    `\ntrace-format/ no longer reads the open-ocpp-trace format the way the ` +
      `specification defines it (${failures} check(s) wrong). See the header ` +
      `of this file. Two of these are easy to break without noticing: a ` +
      `record comes back if and only if it satisfies the SCHEMA -- a stricter ` +
      `library is one its other consumer cannot use -- and the correlation ` +
      `rule skips calls that are already answered, which only shows on a ` +
      `reused messageId.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `trace-format/: ${offSchema.length} schema refusals, ${fidelity.length} raw mismatches, ` +
    `${silentButUnusable.length} valid-but-unusable records left silent -- OK\n`,
);
