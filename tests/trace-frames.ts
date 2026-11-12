/**
 * tests/trace-frames.ts -- guard over tck/trace.ts, the JSONL wire trace read
 * as frames.
 *
 * WHAT THIS GUARDS SINCE THE FORMAT READER MOVED OUT. Reading the format --
 * the schema and its `schemaVersion` rule -- is `@open-ocpp-trace/core`'s and
 * `@open-ocpp-trace/jsonl`'s, and the SDK's own suite guards it. What is left
 * here is this suite's POLICY over what that reader found, the one check the
 * SDK does not make (`raw` against the envelope members a check selects by),
 * and the mapping onto ocpp.ts's frames. So these rows are not "the library
 * detects X"; they are "this runner refuses over X, and names the refusal
 * correctly".
 *
 * PROPERTY, in eight parts.
 *
 *  1. A well-formed trace maps IN FILE ORDER onto the frames ocpp.ts defines,
 *     with `cp-to-csms` -> "sent" and `csms-to-cp` -> "received", and the
 *     result correlates: findResponseFor pairs a CALLRESULT to its CALL, which
 *     is the only thing every assertion in the suite is built on. And it pairs
 *     them the way the FORMAT says to: tck/trace-correlation.ts's `correlate`
 *     is held to a table of pairs written out by hand, one row per clause of
 *     the rule -- same `messageId`, opposite direction, not already answered
 *     -- plus orphans and unanswered calls. The last two clauses only bite on a
 *     REUSED `messageId`, so those rows build one: with unique ids a wrong
 *     implementation passes. findResponseFor's own rows then hold the frame
 *     adaptation to the same answers.
 *  2. A CALLERROR carries its code, description and details onto errorCode /
 *     errorDescription / errorDetails.
 *  3. A `schemaVersion` that is not `1.<minor>` refuses, through BOTH entry
 *     points -- `recordsToFrames` and `readTrace` validate separately. The
 *     SDK withholds such a record outright (`unsupported-version` for a
 *     well-formed other major, `format` for `"1"`, `"1.01"`, `"v1.1"`...),
 *     and a withheld record is `unreadable`: a major bump is where a member
 *     name may stop meaning what this module reads it as. `"1"`, `"1.01"` and
 *     `"1.1.0"` were accepted before the SDK replaced the local reader, which
 *     only compared the text before the first dot; their rows are the
 *     CHANGELOG's claim that they no longer are.
 *  4. A missing or empty `messageId` refuses rather than yielding an empty
 *     uniqueId. The schema makes that member OPTIONAL, so again the library is
 *     right to pass it and this suite is right to refuse it: an empty uniqueId
 *     would make findResponseFor answer every id-less CALL with every id-less
 *     response -- a wrong verdict, where refusing is a missing one.
 *  5. A record off the schema refuses: no `schemaVersion`, no `timestamp`, a
 *     CALL with no `action`, an unrecognised `direction` or `messageType`, a
 *     record that is not an object.
 *  6. THE ENVELOPE MUST AGREE WITH THE BYTES on the three members a check
 *     SELECTS by -- `messageId`, `messageType`, `action` -- and only those.
 *     The SDK does not compare `raw` with the envelope at all, so tck/trace.ts
 *     makes that comparison itself, on those three members only, because a
 *     disagreement there silently answers the
 *     wrong question where one on a member that is merely REPORTED shows up in
 *     the failure detail a human is already reading. `raw` itself must also be
 *     a frame `ocpp.ts` accepts: two of these cases are what the first draft
 *     got wrong by parsing records itself -- it accepted a CALLERROR with no
 *     `details` and a CALL with no payload, both of which parseLog refuses, so
 *     the fallback and the trace disagreed about what a frame IS.
 *  7. A CONFORMANT record this runner cannot use refuses under ITS OWN NAME,
 *     never as `unreadable`. Two of them: `payload-only` for a record with no
 *     `raw`, and `no-message-id` for one with no `messageId`. Both members are
 *     optional in the schema, so a producer that omits either is correct and
 *     this runner still cannot judge on the result -- its assertions read
 *     frames parseFrameMessage made from bytes, correlated by id. Collapsing
 *     them into `unreadable` sends a user to look for a bug that is not there,
 *     which is exactly what the second one did until the class was named
 *     rather than the one instance.
 *  8. Refusal is WHOLE-FILE, and readTrace NAMES ITS REASON: `absent`,
 *     `empty`, `unreadable`, `payload-only`, `no-message-id`. One unmappable
 *     record among good ones refuses all of them, so the caller falls back to a complete log
 *     rather than judging a wire with a hole in it -- and it can say which
 *     happened without going back to the filesystem, where the answer may have
 *     changed. A blank line is skipped rather than refused: a trailing newline
 *     is a property of appending to a file. Two more of the SDK reader's
 *     framing rules are mirrored -- a CRLF terminator and a leading BOM are
 *     accepted -- and `empty` means no non-blank line, so a file whose only
 *     line is torn is `unreadable`, not `empty`.
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

import {
  findCall,
  findResponseFor,
  type CallFrame,
  type Frame,
} from "../tck/ocpp";
import { correlate, type Correlatable } from "../tck/trace-correlation";
import {
  readTrace,
  recordsToFrames,
  type MappingRefusal,
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
let correlationRows = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
};

/** Where `call`'s answer sits in `frames`, or -1 for "it has none". */
function indexOfAnswer(frames: readonly Frame[], call: CallFrame): number {
  const answer = findResponseFor(frames, call);
  return answer === undefined ? -1 : frames.indexOf(answer);
}

// --------------------------------------------------------------------------
// 1 + 2. What a well-formed trace maps to.
// --------------------------------------------------------------------------

const frames = recordsToFrames(TRACE).frames;
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
// 1, continued. The mapped frames correlate the way the FORMAT correlates.
//
// Two exchanges reuse one messageId. The normative rule pairs them one to one,
// most recent call first: response 2 answers call 1, response 3 answers call
// 0. An implementation that scans forward for the first matching response --
// which is what this repository did until the format's rule was adopted --
// hands BOTH calls response 2 and leaves call 0 looking unanswered. Every
// trace with unique ids agrees with both, so this is the only shape that can
// tell them apart.
// --------------------------------------------------------------------------

{
  const reused = [
    CALL,
    tweak(CALL, { timestamp: "2026-08-17T19:53:03.000Z" }),
    CALLRESULT,
    tweak(CALLRESULT, { timestamp: "2026-08-17T19:53:03.010Z" }),
  ];
  const mapped = recordsToFrames(reused).frames;
  if (!mapped) {
    fail("a reused messageId still maps", "recordsToFrames refused it");
  } else {
    const calls = mapped.filter((f): f is CallFrame => f.kind === "call");
    const paired = calls.map((call) => indexOfAnswer(mapped, call));
    if (paired[0] !== 3 || paired[1] !== 2) {
      fail(
        "findResponseFor pairs a reused messageId one to one",
        `expected call 0 -> frame 3 and call 1 -> frame 2, got ${JSON.stringify(paired)}`,
      );
    }

  }
}

// --------------------------------------------------------------------------
// 1, continued. The rule itself, against pairs written out by hand.
//
// `correlate` is driven directly rather than through findResponseFor, because
// the per-call question hides one of the clauses: for [CALL, RESULT, RESULT]
// a rule that forgot "not already answered" hands BOTH responses call 0, and
// findResponseFor still finds the first of them. The oracle is a table and not
// another implementation -- the reader this repository used to ship derived
// the same pairs from the same function, which made agreement a tautology.
// Each of the three clauses has a row that only it decides; the header of
// tck/trace-correlation.ts says why each one hides.
// --------------------------------------------------------------------------

{
  const CP = "cp-to-csms" as const;
  const CS = "csms-to-cp" as const;
  // [messageType, messageId, direction], in trace order.
  type Row = readonly [Correlatable["messageType"], string, Correlatable["direction"]];
  const table: Array<{
    name: string;
    trace: readonly Row[];
    // One entry per record: the CALL index a response answers, or null.
    answers: readonly (number | null)[];
    unanswered: readonly number[];
    orphans: readonly number[];
  }> = [
    {
      name: "a response answers its call",
      trace: [["CALL", "a", CP], ["CALLRESULT", "a", CS]],
      answers: [null, 0],
      unanswered: [],
      orphans: [],
    },
    {
      name: "a CALLERROR answers its call",
      trace: [["CALL", "a", CS], ["CALLERROR", "a", CP]],
      answers: [null, 0],
      unanswered: [],
      orphans: [],
    },
    {
      // The messageId clause: two calls outstanding, answered in call order.
      name: "interleaved exchanges pair by messageId",
      trace: [["CALL", "a", CP], ["CALL", "b", CP], ["CALLRESULT", "a", CS], ["CALLRESULT", "b", CS]],
      answers: [null, null, 0, 1],
      unanswered: [],
      orphans: [],
    },
    {
      // The not-already-answered clause, as a reused id.
      name: "a reused messageId pairs one to one, most recent first",
      trace: [["CALL", "a", CP], ["CALL", "a", CP], ["CALLRESULT", "a", CS], ["CALLRESULT", "a", CS]],
      answers: [null, null, 1, 0],
      unanswered: [],
      orphans: [],
    },
    {
      // The not-already-answered clause, as a second answer to one call.
      name: "an already-answered call answers nothing else",
      trace: [["CALL", "a", CP], ["CALLRESULT", "a", CS], ["CALLRESULT", "a", CS]],
      answers: [null, 0, null],
      unanswered: [],
      orphans: [2],
    },
    {
      // The opposite-direction clause: the nearer same-id call travels the
      // response's own way, so it is passed over for the farther one.
      name: "the nearer same-id call travelling the wrong way is passed over",
      trace: [["CALL", "a", CP], ["CALL", "a", CS], ["CALLRESULT", "a", CS]],
      answers: [null, null, 0],
      unanswered: [1],
      orphans: [],
    },
    {
      name: "a response travelling its call's own way is no answer",
      trace: [["CALL", "a", CP], ["CALLRESULT", "a", CP]],
      answers: [null, null],
      unanswered: [0],
      orphans: [1],
    },
    {
      name: "a response before its call is an orphan",
      trace: [["CALLRESULT", "a", CS], ["CALL", "a", CP]],
      answers: [null, null],
      unanswered: [1],
      orphans: [0],
    },
  ];

  for (const row of table) {
    const got = correlate(
      row.trace.map(([messageType, messageId, direction]) => ({ messageType, messageId, direction })),
    );
    const actual = {
      answers: got.answers.map((a) => a ?? null),
      unanswered: got.unansweredCalls,
      orphans: got.orphanResponses,
    };
    const expected = { answers: row.answers, unanswered: row.unanswered, orphans: row.orphans };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(
        `correlation: ${row.name}`,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  correlationRows = table.length;
}

// A CALL THAT IS NOT IN `frames` HAS NO ANSWER. This is the behaviour change
// this branch declares as breaking -- the old forward scan started from index 0
// when `indexOf` missed, correlating against a wire the call is not on. The
// frame below is structurally identical to a real one and is a different
// object, which is exactly the case `indexOf` cannot find.
{
  const mapped = recordsToFrames([CALL, CALLRESULT]).frames;
  if (!mapped) {
    fail("the fixture maps", "recordsToFrames refused two real records");
  } else {
    const stranger: CallFrame = { ...(mapped[0] as CallFrame) };
    if (findResponseFor(mapped, stranger) !== undefined) {
      fail(
        "a CALL absent from the frames has no answer",
        "findResponseFor correlated against a wire the call is not on",
      );
    }
    // ...and the identical frame that IS in the array still has one, or the
    // row above would pass for a findResponseFor that answers nothing.
    if (indexOfAnswer(mapped, mapped[0] as CallFrame) !== 1) {
      fail(
        "the same CALL present in the frames still correlates",
        "the control case for the row above did not hold",
      );
    }
  }
}

// The OPPOSITE-DIRECTION clause, which needs its own shape to bite. The block
// above cannot test it: with every CALL travelling one way and every response
// the other, dropping the clause changes nothing and the guard stays green --
// measured, on the mutation that was supposed to prove it. So: the CSMS opens
// a call reusing the id of one the charge point already has outstanding, and
// the nearer of the two candidates is the WRONG-direction one. The response
// answers the charge point's call at index 0; a reader that only looks for
// "most recent, same id" answers the CSMS's at index 1.
{
  const incoming = tweak(CALL, {
    direction: "csms-to-cp",
    action: "TriggerMessage",
    payload: {},
    raw: '[2,"07b4312a-594f-4aee-ab01-a015ade45000","TriggerMessage",{}]',
    timestamp: "2026-08-17T19:53:02.690Z",
  });
  const mapped = recordsToFrames([CALL, incoming, CALLRESULT]).frames;
  if (!mapped) {
    fail("a same-id call in each direction still maps", "recordsToFrames refused it");
  } else {
    const outgoing = mapped[0];
    const arriving = mapped[1];
    if (outgoing.kind !== "call" || arriving.kind !== "call") {
      fail("the fixture is two calls and a response", "it is not");
    } else {
      if (indexOfAnswer(mapped, outgoing) !== 2) {
        fail(
          "a response answers the call travelling the OTHER way",
          "the cp-to-csms CALL was not answered by the csms-to-cp CALLRESULT",
        );
      }
      if (findResponseFor(mapped, arriving) !== undefined) {
        fail(
          "a response does not answer a call travelling its own way",
          "the csms-to-cp CALL was given a csms-to-cp CALLRESULT as its answer",
        );
      }
    }
  }
}

// --------------------------------------------------------------------------
// 3 + 4 + 5 + 6. Every refusal, each as one bad record among two good ones --
// which also states that refusal is whole-file rather than per-record.
// --------------------------------------------------------------------------

const refusals: Array<{
  name: string;
  record: unknown;
  expect: MappingRefusal;
}> = [
  {
    name: "a schemaVersion major this module does not know",
    record: tweak(CALL, { schemaVersion: "2.0" }),
    expect: "unreadable",
  },
  // The SDK requires `1.<minor>`, digits only, no leading zero. The reader this
  // suite used before it only asked that the text before the first dot be
  // "1", so it ACCEPTED the next three -- they are the behaviour change the
  // CHANGELOG states, measured by running these rows red against it.
  {
    name: 'a schemaVersion with no minor, "1"',
    record: tweak(CALL, { schemaVersion: "1" }),
    expect: "unreadable",
  },
  {
    name: 'a zero-padded schemaVersion minor, "1.01"',
    record: tweak(CALL, { schemaVersion: "1.01" }),
    expect: "unreadable",
  },
  {
    name: 'a three-part schemaVersion, "1.1.0"',
    record: tweak(CALL, { schemaVersion: "1.1.0" }),
    expect: "unreadable",
  },
  // ...and two the old reader refused too, by its major alone. Kept because
  // they are what a lenient replacement rule ("contains 1.") would let in.
  {
    name: 'a prefixed schemaVersion, "v1.1"',
    record: tweak(CALL, { schemaVersion: "v1.1" }),
    expect: "unreadable",
  },
  {
    name: 'a zero-padded schemaVersion major, "01.1"',
    record: tweak(CALL, { schemaVersion: "01.1" }),
    expect: "unreadable",
  },
  {
    name: "no schemaVersion at all",
    record: tweak(CALL, {}, ["schemaVersion"]),
    expect: "unreadable",
  },
  // The OTHER conformant-but-unusable record, and it must not be spelled
  // `unreadable` either: `messageId` is optional in the schema, so a producer
  // that omits it is correct and this runner simply has nothing to correlate
  // on. It used to fall through to `unreadable`, which handed a conformant
  // trace the runner's advice about broken mounts.
  {
    name: "no messageId, which the schema permits",
    record: tweak(CALL, {}, ["messageId"]),
    expect: "no-message-id",
  },
  {
    name: "an empty messageId",
    record: tweak(CALL, { messageId: "" }),
    expect: "unreadable",
  },

  // The one refusal that is not about something being WRONG: `raw` is optional
  // in the schema, so this record is conformant and this runner still cannot
  // use it. Naming it apart from `unreadable` is property 7.
  {
    name: "no raw, which the schema permits",
    record: tweak(CALL, {}, ["raw"]),
    expect: "payload-only",
  },

  {
    name: "no timestamp",
    record: tweak(CALL, {}, ["timestamp"]),
    expect: "unreadable",
  },
  {
    name: "a CALL with no action",
    record: tweak(CALL, {}, ["action"]),
    expect: "unreadable",
  },
  {
    name: "an unrecognised direction",
    record: tweak(CALL, { direction: "csms-to-csms" }),
    expect: "unreadable",
  },
  {
    name: "an unrecognised messageType",
    record: tweak(CALL, { messageType: "CALLBACK" }),
    expect: "unreadable",
  },
  {
    name: "a record that is not an object",
    record: '[2,"a","Heartbeat",{}]',
    expect: "unreadable",
  },
  { name: "a null record", record: null, expect: "unreadable" },

  // The envelope disagreeing with the bytes, once per member a check selects
  // by. Each of these is a well-formed record whose `raw` is a well-formed
  // frame -- they are only wrong about each other, which is the one shape a
  // single-parser design can still get wrong.
  {
    name: "a messageId the raw frame does not carry",
    record: tweak(CALL, { messageId: "a-different-id" }),
    expect: "unreadable",
  },
  {
    name: "an action the raw frame does not carry",
    record: tweak(CALL, { action: "Heartbeat" }),
    expect: "unreadable",
  },
  {
    name: "a messageType the raw frame contradicts",
    record: tweak(CALL, { messageType: "CALLRESULT" }),
    expect: "unreadable",
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
    expect: "unreadable",
  },
  {
    name: "a CALL whose raw carries no payload",
    record: tweak(CALL, {
      raw: '[2,"07b4312a-594f-4aee-ab01-a015ade45000","BootNotification"]',
    }),
    expect: "unreadable",
  },
  {
    name: "a raw that is not an OCPP-J array",
    record: tweak(CALL, { raw: "hello" }),
    expect: "unreadable",
  },
];

for (const { name, record, expect } of refusals) {
  // The bad record LAST, so a mapper that refused only what it had already
  // mapped past would still be caught, and so that "the two good ones came
  // back" is never the answer.
  for (const [where, records] of [
    ["last", [CALL, CALLRESULT, record]],
    ["first", [record, CALL, CALLRESULT]],
  ] as const) {
    const got = recordsToFrames(records);
    if (got.refusal !== expect) {
      fail(
        `whole-file refusal (${where}): ${name}`,
        `expected ${expect}, got ${got.refusal ?? `${got.frames.length} frames`}`,
      );
    }
  }
}

// A minor version this module has never seen is NOT a refusal: the format adds
// members within a major, and 1.0 -> 1.1 is the bump that already happened.
if (recordsToFrames([tweak(CALL, { schemaVersion: "1.9" })]).frames === undefined) {
  fail("a newer MINOR schema version still maps", "recordsToFrames refused schemaVersion 1.9");
}

// And an envelope disagreeing with the bytes on a member no check SELECTS by
// is NOT refused here -- property 6's other half.
// Without this row the guard would pass on a policy that refused everything,
// which is the failure mode of scoping a rule by naming what it covers.
const describedDifferently = tweak(CALLERROR, {
  error: { ...CALLERROR.error, description: "a description the bytes do not carry" },
});
if (recordsToFrames([CALL, CALLRESULT, describedDifferently]).frames === undefined) {
  fail(
    "a mismatch on a member no check selects by still maps",
    "recordsToFrames refused a disagreement on error.description",
  );
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

  // Two of the SDK reader's framing rules: a CR before the LF is part of
  // the terminator, and a BOM is dropped at the start of the file only. The
  // BOM row is the one that bites -- `JSON.parse` refuses a leading U+FEFF --
  // while the CRLF row also held under the reader this replaced, because
  // `JSON.parse` tolerates the trailing CR on its own.
  const crlf = readTrace(write("crlf.jsonl", jsonl(TRACE).replaceAll("\n", "\r\n")));
  if (crlf.frames?.length !== TRACE.length) {
    fail("readTrace reads CRLF-terminated lines", `got ${crlf.frames?.length ?? crlf.refusal}`);
  }
  const bom = readTrace(write("bom.jsonl", "\uFEFF" + jsonl(TRACE)));
  if (bom.frames?.length !== TRACE.length) {
    fail("readTrace drops a leading BOM", `got ${bom.frames?.length ?? bom.refusal}`);
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
      // `empty` counts non-blank LINES, not records read: a file whose one
      // line is torn has something in it, and something wrong with it.
      name: "a file whose only line is torn",
      read: readTrace(write("torn-only.jsonl", '{"schemaVersion":"1.1"\n')),
      expect: "unreadable",
    },
    {
      // A BOM is dropped at the START of the file only; anywhere else it is
      // content, and a line that starts with one is not JSON.
      name: "a BOM that does not start the file",
      read: readTrace(write("inner-bom.jsonl", jsonl([CALL]) + "\uFEFF" + jsonl([CALLRESULT]))),
      expect: "unreadable",
    },
    {
      name: "a record this build cannot map",
      read: readTrace(
        write("alien.jsonl", jsonl([...TRACE, tweak(CALL, { schemaVersion: "2.0" })])),
      ),
      expect: "unreadable",
    },
    {
      // The other refusal path through the file reader: "1" is a `format`
      // issue in the SDK, where "2.0" above is `unsupported-version`.
      name: 'a record whose schemaVersion is "1"',
      read: readTrace(
        write("bare-major.jsonl", jsonl([...TRACE, tweak(CALL, { schemaVersion: "1" })])),
      ),
      expect: "unreadable",
    },
    {
      // Conformant records, no wire bytes. A different fact about the run from
      // every other row here, and the runner says a different thing about it.
      name: "a conformant trace with no raw in it",
      read: readTrace(
        write(
          "payload-only.jsonl",
          jsonl(TRACE.map((record) => tweak(record, {}, ["raw"]))),
        ),
      ),
      expect: "payload-only",
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
  `tck/trace.ts: ${TRACE.length} real records mapped, ${correlationRows} correlation rows, ` +
    `${refusals.length} record refusals, ${namedFileRefusals} named file refusals -- OK\n`,
);
