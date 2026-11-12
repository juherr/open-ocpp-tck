/**
 * trace.ts -- the simulator's JSONL wire trace, read as {@link Frame}s.
 *
 * `ocpp.ts` parses OCPP frames out of the simulator's plain-text log lines,
 * because when it was written that was the only place the frames appeared. It
 * is no longer: the pinned digest documents `--trace-output <path>`, which
 * appends one JSON record per wire message in the format published by
 * open-ocpp-trace/specification, and `SimConfig.tracePath` now carries a host
 * path into the container so the file outlives it.
 *
 * WHY THIS EXISTS, STATED HONESTLY. It is NOT that the log grammar breaks on a
 * second protocol version -- issue #57 measured a 2.0.1 stream through
 * `LOG_LINE_RE`/`FRAME_MESSAGE_RE`: 8 lines, 8 frames, 0 unparsed, because the
 * grammar is over the OCPP-J envelope and the `[<ts>] [<LEVEL>] [<Type>]`
 * prefix, neither of which changed. What the records buy is:
 *
 *  - a VERSIONED, DOCUMENTED output of the pinned image, where the log line is
 *    a format upstream never promised anybody. `ocpp.ts` is vendored
 *    precisely because it tracks that unpromised format;
 *  - `action` on responses. A CALLRESULT's wire frame does not carry one, so a
 *    check about "the GetConfiguration.conf" had to be written as a regex over
 *    the response's TEXT -- which is how three of this suite's member-order
 *    couplings got written (see issue #44).
 *
 * WHAT IS HERE AND WHAT IS IN THE SDK. Reading the FORMAT -- JSONL framing,
 * the schema's members, its two conditionals, the `schemaVersion` rule -- is
 * not specific to this suite and is the format organisation's own SDK:
 * `@open-ocpp-trace/core` validates a record, `@open-ocpp-trace/jsonl` parses
 * a line into one. A record either SDK withholds is off the format, and this
 * file calls it `unreadable` without a second opinion. What is left here is
 * what IS specific to this suite: the one check the SDK does not make, and how
 * a record becomes one of `ocpp.ts`'s frames.
 *
 * That check is `raw` against the envelope beside it, and it has a sharp edge
 * worth stating. The SDK compares nothing between `raw` and the other members;
 * this file compares three of them -- `messageType`, `messageId`, `action` --
 * and lets the rest through. That is deliberate and it is the same rule as
 * when a local reader detected a disagreement on every member: one on a member
 * an assertion SELECTS by silently answers the wrong question, where one on a
 * member that is only ever REPORTED (an error description, say) shows up in
 * the failure detail a human is already reading. Refusing a whole run's
 * evidence is worth it for the first and not the second, so the comparison is
 * ported for those three members only, from the reader it replaces.
 *
 * THE PARSER IS `ocpp.ts`'s, NOT A SECOND ONE. Every record carries `raw`, the
 * OCPP-J array as it went over the wire, which is exactly what
 * {@link parseFrameMessage} already turns into a `Frame`. So this module reads
 * the envelope from the record and hands the bytes to that function.
 *
 * That is the whole point rather than a tidiness: the runner falls back to
 * `parseLog` whenever there is no trace, so a verdict must not depend on which
 * substrate the environment allowed. Two parsers make that a property to
 * measure and re-measure -- and they had already diverged in the first draft of
 * this file, which accepted a CALLERROR carrying no `details` where
 * `parseFrameMessage` refuses one. One parser makes it a property of the code.
 * (Measured anyway, once, on PR #64's CI artifacts: 94 scenarios, 1576
 * records, frame-for-frame identical to `parseLog` on the same runs' logs.)
 *
 * WHAT NO CONSUMER CAN VERIFY, so it is written down here rather than assumed.
 * `direction` is absolute (`cp-to-csms` / `csms-to-cp`), not observer-relative
 * -- measured in #57 against the pinned digest. But it is absolute because of
 * WHO PRODUCED IT: upstream's `logEntryToTrace.ts` maps `Sent:` to
 * `cp-to-csms` unconditionally, so the label is a contract on the producer
 * being a charge point, and nothing in a record lets a reader check it. Here
 * the producer is always our own simulator, so the mapping below is sound. A
 * CSMS-side recorder emitting this same format would have to invert it, and
 * this module would be wrong to consume it.
 *
 * ALL OR NOTHING, and that is the design rather than an omission. A record
 * this module cannot map completely refuses the WHOLE file, and the caller
 * falls back to `parseLog`. The two alternatives are both dishonest: dropping
 * the record silently loses a frame, so assertions go red for a producer quirk
 * with nothing saying so; and synthesising a missing field -- `raw` above all
 * -- produces a failure detail that claims to quote the wire and does not.
 * Refusing hands the run back to a source that reads the same bytes the same
 * way.
 *
 * None of the refusals below fires on those 1576 records. Every one of them is
 * therefore a guard against a FUTURE producer -- a schema that moved, a
 * recorder that omits an optional the schema lets it omit -- which is exactly
 * what a refusal is for. `tests/trace-frames.ts` has one mutation per rule.
 */

import { readFileSync } from "node:fs";

import {
  validateRecord,
  type Direction as TraceDirection,
  type MessageType,
  type TraceRecord,
} from "@open-ocpp-trace/core";
import { parseRecord } from "@open-ocpp-trace/jsonl/reader";

import { parseFrameMessage, type Direction, type Frame } from "./ocpp";

/** How `ocpp.ts`'s {@link parseFrameMessage} expects each direction spelled. */
const DIRECTION_PREFIX: Record<Direction, string> = {
  sent: "Sent:",
  received: "Received:",
};

/** The `messageType` each OCPP-J message type id must be spelled as. */
const MESSAGE_TYPE_OF_ID: Record<number, MessageType> = {
  2: "CALL",
  3: "CALLRESULT",
  4: "CALLERROR",
};

/**
 * A line with nothing to read, as the SDK's own JSONL reader defines one:
 * spaces, tabs and carriage returns only.
 */
const BLANK_LINE = /^[ \t\r]*$/;

/**
 * Why a set of records produced no frames.
 *
 * `payload-only` is separated from `unreadable` because the two are different
 * news. A trace this module calls `unreadable` is one something is wrong with:
 * a record off the schema, a `raw` that contradicts its envelope, bytes that
 * are not an OCPP-J frame. A `payload-only` trace is CORRECT -- `raw` is
 * optional in the schema and a producer that sets `payload` instead is
 * conformant -- and this runner still cannot judge on it, because its
 * assertions read frames that `parseFrameMessage` produced from bytes and
 * there are no bytes. Telling a user their conformant trace is "unreadable"
 * sends them to look for a bug that is not there.
 *
 * That distinction is the one the format itself does not yet draw: its
 * conformance rules say a consumer must accept any record that validates,
 * which leaves no word for a record that validates and is unusable for what
 * the consumer is FOR. This is that word, spelled locally.
 */
export type MappingRefusal = "unreadable" | "payload-only" | "no-message-id";

/** Why a trace produced no frames -- see {@link readTrace}. */
export type TraceRefusal = "absent" | "empty" | MappingRefusal;

/**
 * Frames, or a reason there are none.
 *
 * Parameterised because the two readings below differ only in which refusals
 * they can produce, and a discriminated union survives being generic here --
 * unlike the `EnvDependent` case `tck/driver.ts` records as rejected, where
 * folding the resolvers together stopped the type narrowing.
 */
type FramesOr<R> =
  | { frames: Frame[]; refusal?: undefined }
  | { frames?: undefined; refusal: R };

/** What mapping a set of records produced. */
export type FrameMapping = FramesOr<MappingRefusal>;

/** A trace read: frames, or the reason there are none. */
export type TraceRead = FramesOr<TraceRefusal>;

/**
 * Maps one whole trace, in file order, or refuses it.
 *
 * File order IS wire order, and it is load-bearing beyond readability:
 * `findResponseFor` only searches STRICTLY AFTER a CALL's own position, so a
 * reordered list would change which response answers which call.
 *
 * Exported for `tests/trace-frames.ts`, which is the only caller that ever has
 * records without a file to put them in -- the same split, and for the same
 * reason, as `classifyForeignSims` in `tck/sim.ts`: the rule is what can be
 * wrong, so the rule is reachable without the I/O around it.
 */
export function recordsToFrames(records: readonly unknown[]): FrameMapping {
  return framesFrom(
    records.map((value) => {
      const result = validateRecord(value);
      return result.ok ? result.record : undefined;
    }),
  );
}

/**
 * The policy, applied to what the SDK read. Both entry points share it rather
 * than each deciding for itself.
 *
 * A record the SDK withheld is off the format -- a member missing or mistyped,
 * a `schemaVersion` that is not `1.<minor>`, where a member NAME may stop
 * meaning what this module reads it as -- and a `raw` that contradicts its
 * envelope is a fact about the file rather than about one record. Either way
 * the whole file goes back, BEFORE any record is mapped, so a conformant
 * refusal further down cannot mask an unreadable record.
 */
function framesFrom(validated: readonly (TraceRecord | undefined)[]): FrameMapping {
  if (validated.some((record) => record === undefined)) {
    return { refusal: "unreadable" };
  }
  const records = validated as readonly TraceRecord[];
  if (records.some(rawContradictsSelectingMember)) return { refusal: "unreadable" };

  const frames: Frame[] = [];
  for (const record of records) {
    const mapped = recordToFrame(record);
    if (mapped.refusal !== undefined) return { refusal: mapped.refusal };
    frames.push(mapped.frame);
  }
  return { frames };
}

/**
 * Whether `raw` disagrees with the envelope on a member an assertion SELECTS
 * frames by: `messageType`, `messageId` or `action`. See this file's header
 * for why those three and no other.
 *
 * Ported from `checkRawFidelity` in `packages/trace-format/validate.ts`, which
 * transcribes the specification's reference consumer member for member,
 * INCLUDING which comparisons are conditional: `messageId` is optional, so it
 * is compared only when the record carries one, and only a CALL's frame has an
 * action. Only the three selecting members' rows were kept.
 *
 * A `raw` that is not JSON, or not an array, is NOT a contradiction here. It
 * used to be refused in its own right, on the reasoning that saying so early
 * "costs nothing and reads better". It cost something: neither can become a
 * frame anyway -- `parseFrameMessage` refuses both and {@link recordToFrame}
 * turns that into the same `unreadable` -- so the rows were unfalsifiable.
 * Deleting them left `tests/trace-frames.ts` green, which is the mutation
 * saying the policy claimed two judgements it did not make.
 */
function rawContradictsSelectingMember(record: TraceRecord): boolean {
  if (record.raw === undefined) return false;

  let frame: unknown;
  try {
    frame = JSON.parse(record.raw);
  } catch {
    return false;
  }
  if (!Array.isArray(frame)) return false;

  if (MESSAGE_TYPE_OF_ID[frame[0] as number] !== record.messageType) return true;
  if (record.messageId !== undefined && frame[1] !== record.messageId) return true;
  if (record.messageType === "CALL" && frame[2] !== record.action) return true;
  return false;
}

/**
 * One record as a frame, or which kind of "no" it is.
 *
 * THE TWO CONFORMANT REFUSALS COME FIRST, and they are the same fact twice:
 * the schema makes both `raw` and `messageId` optional, so a producer that
 * omits either is correct and this runner still cannot judge on the result.
 * Naming them apart from `unreadable` is the whole point -- see
 * {@link MappingRefusal}. They were not always both named: `payload-only` was
 * a special case tested above this function while a missing `messageId` fell
 * through to `unreadable`, which handed a conformant producer the runner's
 * advice about broken mounts and stale images. One special case is a bug
 * waiting for its second instance; the second instance was already here.
 */
function recordToFrame(
  record: TraceRecord,
): { frame: Frame; refusal?: undefined } | { frame?: undefined; refusal: MappingRefusal } {
  // No wire bytes, and the assertions read frames made from bytes.
  if (record.raw === undefined) return { refusal: "payload-only" };

  // No id to correlate on. An empty uniqueId would make `findResponseFor`
  // answer every id-less CALL with every id-less response, which is a wrong
  // verdict where refusing is a missing one.
  if (record.messageId === undefined) return { refusal: "no-message-id" };

  const direction = directionOf(record.direction);
  const frame = parseFrameMessage(
    `${DIRECTION_PREFIX[direction]} ${record.raw}`,
    record.timestamp,
    record.raw,
  );
  return frame ? { frame } : { refusal: "unreadable" };
}

function directionOf(value: TraceDirection): Direction {
  return value === "cp-to-csms" ? "sent" : "received";
}

/**
 * Reads a JSONL trace file into frames, or says why it could not.
 *
 * THE REASON IS PART OF THE ANSWER. The refusals are different facts about the
 * run -- the container never wrote the file, wrote an empty one, wrote records
 * this build does not understand, or wrote conformant records with no wire
 * bytes in them -- and the caller has a different thing to say about each.
 * Collapsing them to `undefined` and letting the runner re-`stat` the path to
 * work out which is a second, later observation of a file the container may
 * still be touching, so the branch taken and the branch reported could
 * disagree. One read, one answer.
 *
 * AN EMPTY TRACE IS A REFUSAL, NOT "ZERO FRAMES". The file is created by the
 * container, so it exists and is empty in exactly the situations the runner
 * warns about (a mount the docker daemon declined, a runner that is itself
 * containerised). Returning `[]` there would hand the assertions an empty wire
 * and fail every check in the scenario for a reason that has nothing to do
 * with the CSMS; refusing hands them the log, which is where the frames are.
 *
 * THREE OF THE SDK READER'S FRAMING RULES ARE MIRRORED HERE: a BOM is dropped
 * at the start of the file only, a CR before the LF is part of the
 * terminator, and a blank line (spaces, tabs and CRs) -- a trailing newline is
 * a property of appending to a file, not a malformed record -- is skipped
 * rather than refused. The SDK's streaming reader is async and this function
 * is not, so each line goes through its synchronous `parseRecord` instead, and
 * the rules are restated for that reason. Its other two are NOT applied: no
 * line-length bound, and the file is decoded with `readFileSync`'s lenient
 * UTF-8, which replaces a bad byte rather than reporting it. `empty` counts
 * non-blank LINES, not records read, so a file whose only line is torn is
 * `unreadable`.
 */
export function readTrace(path: string): TraceRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { refusal: "absent" };
  }

  const records: (TraceRecord | undefined)[] = [];
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  for (const line of body.split("\n")) {
    if (BLANK_LINE.test(line)) continue;
    const read = parseRecord(line.endsWith("\r") ? line.slice(0, -1) : line);
    records.push(read.ok ? read.record : undefined);
  }
  if (records.length === 0) return { refusal: "empty" };

  return framesFrom(records);
}
