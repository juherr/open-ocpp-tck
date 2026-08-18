/**
 * ocpp.ts -- OCPP-J wire-frame parser + uniqueId correlation.
 *
 * The simulator CLI (src/cli/main.ts --json) does not emit a structured
 * event carrying raw OCPP frames: ChargePointEvents declares `messageSent`
 * / `messageReceived` payloads shaped exactly for this, but nothing in the
 * codebase ever emits them (see the Task 1 investigation notes in
 * .superpowers/sdd/tsr-task-1-report.md). What IS always present, JSON
 * mode or not, is the plain-text line the shared Logger writes straight to
 * console for every WebSocket frame:
 *
 *   [<iso-timestamp>] [<LEVEL>] [WebSocket] Sent: [2,"<uniqueId>","<Action>",{...}]
 *   [<iso-timestamp>] [<LEVEL>] [WebSocket] Received: [3,"<uniqueId>",{...}]
 *
 * This module parses that line format into typed frames and correlates a
 * request to its response by OCPP-J `uniqueId` -- not by "next matching
 * line within N lines of the request" (the bash predecessor's
 * check_response_status / check_sent_result window-scan), which can pick
 * up the wrong CALLRESULT when other traffic (StatusNotification, a second
 * concurrent op, ...) is interleaved on the wire between a request and its
 * own response.
 */
export type Direction = "sent" | "received";
export interface CallFrame {
    kind: "call";
    direction: Direction;
    uniqueId: string;
    action: string;
    payload: unknown;
    timestamp: string;
    raw: string;
}
export interface CallResultFrame {
    kind: "callresult";
    direction: Direction;
    uniqueId: string;
    payload: unknown;
    timestamp: string;
    raw: string;
}
export interface CallErrorFrame {
    kind: "callerror";
    direction: Direction;
    uniqueId: string;
    errorCode: string;
    errorDescription: string;
    errorDetails: unknown;
    timestamp: string;
    raw: string;
}
export type ResponseFrame = CallResultFrame | CallErrorFrame;
export type Frame = CallFrame | CallResultFrame | CallErrorFrame;
/**
 * Parses just the `Sent:/Received: [...]` frame message half (no log-line
 * prefix) into a {@link Frame}. `raw` is what ends up in the returned
 * frame's `raw` field -- callers that only have the bare message (e.g.
 * {@link TranscriptBuffer}, which subscribes to structured {@link LogEntry}s
 * rather than formatted lines) can pass it explicitly; it defaults to
 * `message` itself. {@link parseLogLine} passes the full formatted line so
 * its frames' `raw` stays the whole line, matching prior behavior.
 */
export declare function parseFrameMessage(message: string, timestamp: string, raw?: string): Frame | null;
/**
 * Parses a single stdout line from the simulator CLI into a {@link Frame},
 * or returns null for anything that isn't an OCPP-J Sent/Received line
 * (structured JSON events, JSON command responses, other log lines, blank
 * lines).
 */
export declare function parseLogLine(line: string): Frame | null;
/** Parses a whole multi-line log (or stdout capture), preserving order. */
export declare function parseLog(text: string): Frame[];
/**
 * Finds the `occurrence`-th (0-indexed, default 0) CALL frame matching
 * `direction` + `action`, in log order.
 */
export declare function findCall(frames: readonly Frame[], direction: Direction, action: string, occurrence?: number): CallFrame | undefined;
/** Returns every CALL frame matching `direction` + `action`, in log order. */
export declare function findAllCalls(frames: readonly Frame[], direction: Direction, action: string): CallFrame[];
/**
 * Finds the CALLRESULT/CALLERROR that answers `call`, correlated strictly
 * by OCPP-J `uniqueId` and reply direction (a response to a sent CALL must
 * be received, and vice versa) -- never by adjacency in the log.
 *
 * THIS IS THE open-ocpp-trace CORRELATION RULE, stated from the call's side.
 * The format's `conformance/README.md` defines it from the response's: a
 * response correlates with "the most recent preceding CALL in the trace" that
 * has the same `messageId`, travels in the opposite direction, and "is not
 * already correlated with an earlier response". The three clauses are why this
 * computes the whole pairing rather than scanning forward for a match: the
 * answer to "which response is this call's" depends on which calls the OTHER
 * responses have already claimed, so it is not a local question.
 *
 * THE THIRD CLAUSE IS THE ONE THAT MATTERS, and it is invisible almost always.
 * uniqueIds are effectively unique in practice -- both the CP
 * (OCPPWebSocket) and every CSMS here generate one per outstanding request --
 * and while they are, a forward scan for the first match returns exactly what
 * this returns. The two only diverge on a REUSED id, where a forward scan maps
 * two calls onto the same response and the rule pairs them one to one, most
 * recent first. So the cheap implementation passes every trace anyone is
 * likely to hand it, and is wrong about the one it is not.
 *
 * The suite reads the same wire two ways -- the JSONL trace and the simulator
 * log -- and `trace-format/consumer-view.ts` derives the format's view from
 * the first. Correlating differently here would mean the conformance run
 * proves the library agrees with the specification while the assertions
 * quietly do not, which is the divergence a single reading exists to make
 * impossible.
 *
 * A `call` that is not in `frames` has no position, so the rule has nothing to
 * anchor on and this returns undefined rather than guessing from index 0.
 */
export declare function findResponseFor(frames: readonly Frame[], call: CallFrame): ResponseFrame | undefined;
