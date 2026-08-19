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
 * WHAT IS HERE AND WHAT IS IN `trace-format/`. Reading the FORMAT -- the
 * schema's members, its two conditionals, `raw` against the members beside it,
 * the normative consumer view -- is not specific to this suite and lives in
 * `trace-format/`, which is destined for the format's own organisation and
 * depends on nothing here. What is left in this file is the two things that
 * ARE specific to this suite: which of the library's facts are worth refusing
 * a run over, and how a record becomes one of `ocpp.ts`'s frames.
 *
 * That split has a sharp edge worth stating. The library reports a `raw` that
 * disagrees with its envelope on EVERY member; this file refuses on three of
 * them -- `messageType`, `messageId`, `action` -- and lets the rest through.
 * That is deliberate and it is the same rule as before the split: a
 * disagreement on a member an assertion SELECTS by silently answers the wrong
 * question, where a disagreement on one that is only ever REPORTED (an error
 * description, say) shows up in the failure detail a human is already reading.
 * Refusing a whole run's evidence is worth it for the first and not the
 * second. Detection is complete; the policy is scoped.
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
  readTraceText,
  validateRecords,
  type Diagnostic,
  type RawEnvelopeMember,
  type TraceDirection,
  type TraceRecord,
} from "../trace-format";
import { parseFrameMessage, type Direction, type Frame } from "./ocpp";

/** How `ocpp.ts`'s {@link parseFrameMessage} expects each direction spelled. */
const DIRECTION_PREFIX: Record<Direction, string> = {
  sent: "Sent:",
  received: "Received:",
};

/** The record members an assertion SELECTS frames by -- see this file's header. */
const SELECTING_MEMBERS: readonly RawEnvelopeMember[] = [
  "messageType",
  "messageId",
  "action",
];

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
  const { records: validated, diagnostics } = validateRecords(records);
  return framesFrom(validated, diagnostics);
}

/**
 * The policy, applied to what the library found. The one place a diagnostic
 * becomes a verdict about the run, so both entry points share it rather than
 * each deciding for itself.
 */
function framesFrom(
  validated: readonly (TraceRecord | undefined)[],
  diagnostics: readonly Diagnostic[],
): FrameMapping {
  // A record the library could not read at all is off the schema, and a
  // diagnostic this suite refuses over is a fact about the file rather than
  // about one record. Either way the whole file goes back.
  if (validated.some((record) => record === undefined)) {
    return { refusal: "unreadable" };
  }
  if (diagnostics.some(refusesOver)) return { refusal: "unreadable" };

  const frames: Frame[] = [];
  for (const record of validated as readonly TraceRecord[]) {
    const mapped = recordToFrame(record);
    if (mapped.refusal !== undefined) return { refusal: mapped.refusal };
    frames.push(mapped.frame);
  }
  return { frames };
}

/**
 * Which of the library's facts cost a whole run's evidence.
 *
 * Everything the library reports about a SCHEMA-VALID record is a judgement
 * call here, and this function is the whole of it:
 *
 *  - an unreadable `schemaVersion` major may move what a member NAME means, so
 *    every frame after it is a guess;
 *  - a `raw` that contradicts its envelope on a member assertions select by
 *    answers the wrong question silently -- and on any other member it does
 *    not, so it is left to show up in the failure detail.
 *
 * AND THAT IS ALL OF IT, deliberately. `raw-not-json` and `raw-not-array` used
 * to be rows here too, on the reasoning that saying so early "costs nothing
 * and reads better". It cost something: neither can become a frame anyway --
 * `parseFrameMessage` refuses both and the mapping below turns that into the
 * same `unreadable` -- so the rows were unfalsifiable. Deleting them left
 * `tests/trace-frames.ts` green, which is the mutation saying the table
 * claimed two judgements it did not make. A policy list whose rows nothing
 * depends on is a policy list a reader cannot trust.
 *
 * A code this suite has no opinion about is NOT refused. That is the safe
 * default in the direction that matters: a new diagnostic in the library turns
 * into a report, never into a silently red sweep.
 */
function refusesOver(diagnostic: Diagnostic): boolean {
  switch (diagnostic.code) {
    case "unsupported-schema-major":
      return true;
    case "raw-envelope-mismatch":
      return (SELECTING_MEMBERS as readonly string[]).includes(
        diagnostic.member ?? "",
      );
    default:
      return false;
  }
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
 * Blank lines are skipped rather than refused -- see `trace-format/jsonl.ts`:
 * a trailing newline is a property of appending to a file, not a malformed
 * record.
 */
export function readTrace(path: string): TraceRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { refusal: "absent" };
  }

  const { records, diagnostics } = readTraceText(text);
  if (records.length === 0) return { refusal: "empty" };

  return framesFrom(records, diagnostics);
}
