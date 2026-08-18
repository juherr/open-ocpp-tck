/**
 * tests/trace-frames.ts -- guard over tck/trace.ts, the JSONL wire trace read
 * as frames.
 *
 * PROPERTY, in seven parts.
 *
 *  1. A well-formed trace maps IN FILE ORDER onto the frames ocpp.ts defines,
 *     with `cp-to-csms` -> "sent" and `csms-to-cp` -> "received", and the
 *     result correlates: findResponseFor pairs a CALLRESULT to its CALL, which
 *     is the only thing every assertion in the suite is built on.
 *  2. A CALLERROR carries its code, description and details onto errorCode /
 *     errorDescription / errorDetails.
 *  3. A `schemaVersion` whose MAJOR is not 1 refuses. The format versions
 *     in-band and has already added fields inside major 1 (1.0 -> 1.1), which a
 *     consumer reading named members survives; a major bump is where a name may
 *     stop meaning what this module reads it as.
 *  4. A missing or empty `messageId` refuses rather than yielding an empty
 *     uniqueId. The schema makes that member OPTIONAL, and an empty uniqueId
 *     would make findResponseFor answer every id-less CALL with every id-less
 *     response -- a wrong verdict, where refusing is a missing one.
 *  5. Every other member the ENVELOPE must carry is required the same way: no
 *     `raw`, no `timestamp`, a CALL with no `action`, an unrecognised
 *     `direction` or `messageType`, a record that is not an object.
 *  6. THE ENVELOPE MUST AGREE WITH THE BYTES on the three members a check
 *     selects by -- `messageId`, `messageType`, `action` -- and `raw` itself
 *     must be a frame `ocpp.ts` accepts. This is the half that survives the
 *     single-parser design: tck/trace.ts hands `raw` to parseFrameMessage, so
 *     a frame is a frame by construction, and the only thing left to get wrong
 *     is a record disagreeing with its own bytes. Two of these cases are what
 *     the first draft got wrong by parsing records itself -- it accepted a
 *     CALLERROR with no `details` and a CALL with no payload, both of which
 *     parseLog refuses, so the fallback and the trace disagreed about what a
 *     frame IS.
 *  7. Refusal is WHOLE-FILE, and readTrace NAMES ITS REASON: `absent`,
 *     `empty`, `unreadable`. One unmappable record among good ones refuses all
 *     of them, so the caller falls back to a complete log rather than judging a
 *     wire with a hole in it -- and it can say which of the three happened
 *     without going back to the filesystem, where the answer may have changed.
 *     A blank line is skipped rather than refused: a trailing newline is a
 *     property of appending to a file.
 *
 * Why this is TypeScript and not a shell guard. Every refusal above needs a
 * trace no run produces: across PR #64's CI artifacts -- 94 scenarios, 1576
 * records -- not one record is missing a member or disagrees with its bytes,
 * and both bundled drivers ride the same producer, so no sweep this repository
 * can perform, offline or live, reaches any of these branches. Handing the
 * mapper its records is the only way in, which is the same argument
 * tests/assert-answered.ts and tests/get-configuration-filter.ts make.
 *
 * The three base records are REAL BYTES, copied from
 * results/cert16-tc044-2-firmware-download-failed.jsonl in run 32061610947 --
 * a CALL, its CALLRESULT, and a genuine CitrineOS CALLERROR. A hand-written
 * fixture would only ever prove this module agrees with whoever wrote it.
 *
 * Offline: maps objects and reads a temp file, runs nothing.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findCall, findResponseFor } from "../tck/ocpp";
import {
  readTrace,
  recordsToFrames,
  type TraceRead,
  type TraceRefusal,
} from "../tck/trace";

// --------------------------------------------------------------------------
// The fixture: three real records from one real run, verbatim.
// --------------------------------------------------------------------------

const CALL = {
  schemaVersion: "1.1",
  timestamp: "2026-08-17T19:53:02.684Z",
  transport: "json",
  direction: "cp-to-csms",
  messageType: "CALL",
  ocppVersion: "1.6",
  chargePointId: "CERTCP2",
  messageId: "07b4312a-594f-4aee-ab01-a015ade45000",
  action: "BootNotification",
  payload: { chargePointVendor: "CLI-Vendor", chargePointModel: "CLI-Model" },
  raw: '[2,"07b4312a-594f-4aee-ab01-a015ade45000","BootNotification",{"chargePointVendor":"CLI-Vendor","chargePointModel":"CLI-Model"}]',
};

const CALLRESULT = {
  schemaVersion: "1.1",
  timestamp: "2026-08-17T19:53:02.694Z",
  transport: "json",
  direction: "csms-to-cp",
  messageType: "CALLRESULT",
  ocppVersion: "1.6",
  chargePointId: "CERTCP2",
  messageId: "07b4312a-594f-4aee-ab01-a015ade45000",
  payload: { currentTime: "2026-08-17T19:53:02.689Z", status: "Accepted", interval: 60 },
  raw: '[3,"07b4312a-594f-4aee-ab01-a015ade45000",{"currentTime":"2026-08-17T19:53:02.689Z","status":"Accepted","interval":60}]',
  // Back-filled by the producer's correlator: the wire frame has no action.
  action: "BootNotification",
};

const CALLERROR = {
  schemaVersion: "1.1",
  timestamp: "2026-08-17T19:53:23.711Z",
  transport: "json",
  direction: "csms-to-cp",
  messageType: "CALLERROR",
  ocppVersion: "1.6",
  chargePointId: "CERTCP2",
  messageId: "7399c59e-1123-4b21-94c4-fbad101988ff",
  error: {
    code: "NotSupported",
    description: "No handler found for action: FirmwareStatusNotification at module configuration",
    details: {},
  },
  raw: '[4,"7399c59e-1123-4b21-94c4-fbad101988ff","NotSupported","No handler found for action: FirmwareStatusNotification at module configuration",{}]',
  action: "FirmwareStatusNotification",
};

const TRACE = [CALL, CALLRESULT, CALLERROR];

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

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
};

// --------------------------------------------------------------------------
// 1 + 2. What a well-formed trace maps to.
// --------------------------------------------------------------------------

const frames = recordsToFrames(TRACE);
if (!frames) {
  fail("a well-formed trace maps", "recordsToFrames refused three real records");
} else if (frames.length !== TRACE.length) {
  fail("a well-formed trace maps", `expected ${TRACE.length} frames, got ${frames.length}`);
} else {
  const [call, result, error] = frames;

  if (call.kind !== "call" || call.direction !== "sent") {
    fail("cp-to-csms is a sent CALL", `got kind=${call.kind} direction=${call.direction}`);
  } else if (call.action !== "BootNotification" || call.uniqueId !== CALL.messageId) {
    fail("a CALL keeps its action and id", `got action=${call.action} id=${call.uniqueId}`);
  } else if (JSON.stringify(call.payload) !== JSON.stringify(CALL.payload)) {
    fail("a CALL keeps its payload", `got ${JSON.stringify(call.payload)}`);
  } else if (call.raw !== CALL.raw || call.timestamp !== CALL.timestamp) {
    fail("a CALL keeps its raw and timestamp", `got raw=${call.raw}`);
  }

  if (result.kind !== "callresult" || result.direction !== "received") {
    fail("csms-to-cp is a received CALLRESULT", `got kind=${result.kind} direction=${result.direction}`);
  }

  if (error.kind !== "callerror") {
    fail("a CALLERROR maps to a callerror frame", `got kind=${error.kind}`);
  } else if (
    error.errorCode !== CALLERROR.error.code ||
    error.errorDescription !== CALLERROR.error.description ||
    JSON.stringify(error.errorDetails) !== JSON.stringify(CALLERROR.error.details)
  ) {
    fail(
      "a CALLERROR carries error.code/description/details",
      `got code=${error.errorCode} description=${error.errorDescription} details=${JSON.stringify(error.errorDetails)}`,
    );
  }

  // The whole suite is built on this pairing, so map-then-correlate is the
  // property, not map alone.
  const found = findCall(frames, "sent", "BootNotification");
  const answer = found && findResponseFor(frames, found);
  if (!answer || answer.kind !== "callresult" || answer.uniqueId !== CALL.messageId) {
    fail(
      "mapped frames correlate by uniqueId",
      `findResponseFor returned ${answer ? answer.kind : "nothing"}`,
    );
  }
}

// --------------------------------------------------------------------------
// 3 + 4 + 5 + 6. Every refusal, each as one bad record among two good ones --
// which also states that refusal is whole-file rather than per-record.
// --------------------------------------------------------------------------

const refusals: Array<{ name: string; record: unknown }> = [
  {
    name: "a schemaVersion major this module does not know",
    record: tweak(CALL, { schemaVersion: "2.0" }),
  },
  { name: "no schemaVersion at all", record: tweak(CALL, {}, ["schemaVersion"]) },
  { name: "no messageId", record: tweak(CALL, {}, ["messageId"]) },
  { name: "an empty messageId", record: tweak(CALL, { messageId: "" }) },
  { name: "no raw", record: tweak(CALL, {}, ["raw"]) },
  { name: "no timestamp", record: tweak(CALL, {}, ["timestamp"]) },
  { name: "a CALL with no action", record: tweak(CALL, {}, ["action"]) },
  { name: "an unrecognised direction", record: tweak(CALL, { direction: "csms-to-csms" }) },
  { name: "an unrecognised messageType", record: tweak(CALL, { messageType: "CALLBACK" }) },
  { name: "a record that is not an object", record: '[2,"a","Heartbeat",{}]' },
  { name: "a null record", record: null },

  // The envelope disagreeing with the bytes, once per member a check selects
  // by. Each of these is a well-formed record whose `raw` is a well-formed
  // frame -- they are only wrong about each other, which is the one shape a
  // single-parser design can still get wrong.
  {
    name: "a messageId the raw frame does not carry",
    record: tweak(CALL, { messageId: "a-different-id" }),
  },
  {
    name: "an action the raw frame does not carry",
    record: tweak(CALL, { action: "Heartbeat" }),
  },
  {
    name: "a messageType the raw frame contradicts",
    record: tweak(CALL, { messageType: "CALLRESULT" }),
  },

  // What parseFrameMessage itself refuses, reached through `raw`. A CALLERROR
  // with no details is the case the first draft of tck/trace.ts ACCEPTED while
  // parseLog refused it -- the substrates disagreeing about what a frame is,
  // which is the divergence one parser exists to make impossible.
  {
    name: "a CALLERROR whose raw carries no details",
    record: tweak(CALLERROR, {
      raw: '[4,"7399c59e-1123-4b21-94c4-fbad101988ff","NotSupported","nope"]',
    }),
  },
  {
    name: "a CALL whose raw carries no payload",
    record: tweak(CALL, {
      raw: '[2,"07b4312a-594f-4aee-ab01-a015ade45000","BootNotification"]',
    }),
  },
  { name: "a raw that is not an OCPP-J array", record: tweak(CALL, { raw: "hello" }) },
];

for (const { name, record } of refusals) {
  // The bad record LAST, so a mapper that refused only what it had already
  // mapped past would still be caught, and so that "the two good ones came
  // back" is never the answer.
  if (recordsToFrames([CALL, CALLRESULT, record]) !== undefined) {
    fail(`whole-file refusal: ${name}`, "recordsToFrames returned frames");
  }
  if (recordsToFrames([record, CALL, CALLRESULT]) !== undefined) {
    fail(`whole-file refusal, first record: ${name}`, "recordsToFrames returned frames");
  }
}

// A minor version this module has never seen is NOT a refusal: the format adds
// members within a major, and 1.0 -> 1.1 is the bump that already happened.
if (recordsToFrames([tweak(CALL, { schemaVersion: "1.9" })]) === undefined) {
  fail("a newer MINOR schema version still maps", "recordsToFrames refused schemaVersion 1.9");
}

// --------------------------------------------------------------------------
// 7. readTrace: what "nothing usable" means on disk.
// --------------------------------------------------------------------------

let namedFileRefusals = 0;
const dir = mkdtempSync(join(tmpdir(), "tck-trace-"));
try {
  const write = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const jsonl = (records: readonly unknown[]): string =>
    records.map((r) => JSON.stringify(r)).join("\n") + "\n";

  const good = readTrace(write("good.jsonl", jsonl(TRACE)));
  if (good.frames?.length !== TRACE.length) {
    fail("readTrace reads a whole file", `got ${good.frames?.length ?? good.refusal}`);
  }

  // A trailing newline is how appending works, and blank lines between records
  // are not malformed ones.
  const blanks = readTrace(write("blanks.jsonl", "\n" + jsonl(TRACE) + "\n\n"));
  if (blanks.frames?.length !== TRACE.length) {
    fail("readTrace skips blank lines", `got ${blanks.frames?.length ?? blanks.refusal}`);
  }

  // The refusal REASON is part of the answer: the runner says a different
  // thing about a mount that did not work and an image whose records this
  // build does not map, and it must not have to re-stat the file to find out.
  const refusalCases: Array<{ name: string; read: TraceRead; expect: TraceRefusal }> = [
    {
      name: "a malformed JSONL line",
      read: readTrace(write("torn.jsonl", jsonl(TRACE) + '{"schemaVersion":"1.1"')),
      expect: "unreadable",
    },
    {
      name: "a record this build cannot map",
      read: readTrace(
        write("alien.jsonl", jsonl([...TRACE, tweak(CALL, { schemaVersion: "2.0" })])),
      ),
      expect: "unreadable",
    },
    { name: "an empty trace", read: readTrace(write("empty.jsonl", "")), expect: "empty" },
    { name: "an absent trace", read: readTrace(join(dir, "absent.jsonl")), expect: "absent" },
  ];
  namedFileRefusals = refusalCases.length;
  for (const { name, read, expect } of refusalCases) {
    if (read.refusal !== expect) {
      fail(
        `readTrace names its refusal: ${name}`,
        `expected ${expect}, got ${read.refusal ?? `${read.frames.length} frames`}`,
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// --------------------------------------------------------------------------

if (failures > 0) {
  process.stderr.write(
    `\ntck/trace.ts no longer reads the wire trace the way the runner assumes ` +
      `(${failures} check(s) wrong). See the header of this file: the mapped ` +
      `frames must be the frames parseLog would have produced, and anything ` +
      `this module cannot map completely must refuse the WHOLE file so the ` +
      `runner falls back to the log instead of judging a wire with a hole in it.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `tck/trace.ts: ${TRACE.length} real records mapped, ${refusals.length} record refusals, ` +
    `${namedFileRefusals} named file refusals -- OK\n`,
);
