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
 *    `upstream-verbatim` precisely because it tracks that unpromised format;
 *  - `action` on responses. A CALLRESULT's wire frame does not carry one, so a
 *    check about "the GetConfiguration.conf" had to be written as a regex over
 *    the response's TEXT -- which is how three of this suite's member-order
 *    couplings got written (see issue #44).
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
 * WHAT THE RECORD STILL DECIDES, and what it does not. `direction` comes from
 * the record -- the log line's `Sent:`/`Received:` is the only other source and
 * it is the thing being replaced. Everything else is read from `raw`, and the
 * record's own copy is used to CHECK it: a record whose envelope disagrees with
 * its bytes is refused.
 *
 * That check is scoped, deliberately, to the three members an assertion SELECTS
 * frames by -- `messageType`, `messageId` and `action`. A disagreement there
 * silently answers the wrong question; a disagreement in a member that is only
 * ever REPORTED (an error description, say) shows up in the failure detail a
 * human is already reading. Refusing on the first is worth a whole run's
 * evidence; refusing on the second is not.
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
import { type Frame } from "./ocpp";
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
export declare function recordsToFrames(records: readonly unknown[]): Frame[] | undefined;
/** Why a trace produced no frames -- see {@link readTrace}. */
export type TraceRefusal = "absent" | "empty" | "unreadable";
/** A trace read: frames, or the reason there are none. */
export type TraceRead = {
    frames: Frame[];
    refusal?: undefined;
} | {
    frames?: undefined;
    refusal: TraceRefusal;
};
/**
 * Reads a JSONL trace file into frames, or says why it could not.
 *
 * THE REASON IS PART OF THE ANSWER. The three refusals are three different
 * facts about the run -- the container never wrote the file, wrote an empty
 * one, or wrote records this build does not understand -- and the caller has a
 * different thing to say about each. Collapsing them to `undefined` and
 * letting the runner re-`stat` the path to work out which is a second, later
 * observation of a file the container may still be touching, so the branch
 * taken and the branch reported could disagree. One read, one answer.
 *
 * AN EMPTY TRACE IS A REFUSAL, NOT "ZERO FRAMES". The file is created by the
 * container, so it exists and is empty in exactly the situations the runner
 * warns about (a mount the docker daemon declined, a runner that is itself
 * containerised). Returning `[]` there would hand the assertions an empty wire
 * and fail every check in the scenario for a reason that has nothing to do
 * with the CSMS; refusing hands them the log, which is where the frames are.
 *
 * Blank lines are skipped rather than refused: a trailing newline is a
 * property of appending to a file, not a malformed record.
 */
export declare function readTrace(path: string): TraceRead;
