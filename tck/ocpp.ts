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

import { correlate, type Correlatable } from "../trace-format/correlate";

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

// `[<timestamp>] [<LEVEL>] [<Type>] <rest>` -- the Logger's plain-format
// line (src/cp/shared/Logger.ts formatLogEntry). Only WebSocket-typed lines
// ever carry "Sent:"/"Received:", but matching on the prefix generally
// keeps this parser agnostic to which LogType wrote it.
const LOG_LINE_RE = /^\[([^\]]+)\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s+(.*)$/;
const FRAME_MESSAGE_RE = /^(Sent|Received):\s+(\[.*\])\s*$/;

/**
 * Parses just the `Sent:/Received: [...]` frame message half (no log-line
 * prefix) into a {@link Frame}. `raw` is what ends up in the returned
 * frame's `raw` field -- callers that only have the bare message (e.g.
 * {@link TranscriptBuffer}, which subscribes to structured {@link LogEntry}s
 * rather than formatted lines) can pass it explicitly; it defaults to
 * `message` itself. {@link parseLogLine} passes the full formatted line so
 * its frames' `raw` stays the whole line, matching prior behavior.
 */
export function parseFrameMessage(
  message: string,
  timestamp: string,
  raw: string = message,
): Frame | null {
  const frameMatch = FRAME_MESSAGE_RE.exec(message);
  if (!frameMatch) return null;
  const direction: Direction = frameMatch[1] === "Sent" ? "sent" : "received";

  let parsed: unknown;
  try {
    parsed = JSON.parse(frameMatch[2]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || typeof parsed[0] !== "number") return null;

  const messageTypeId = parsed[0];
  const uniqueId = String(parsed[1] ?? "");
  if (!uniqueId) return null;

  switch (messageTypeId) {
    case 2: {
      if (parsed.length < 4 || typeof parsed[2] !== "string") return null;
      return {
        kind: "call",
        direction,
        uniqueId,
        action: parsed[2],
        payload: parsed[3],
        timestamp,
        raw,
      };
    }
    case 3: {
      if (parsed.length < 3) return null;
      return {
        kind: "callresult",
        direction,
        uniqueId,
        payload: parsed[2],
        timestamp,
        raw,
      };
    }
    case 4: {
      if (parsed.length < 5 || typeof parsed[2] !== "string") return null;
      return {
        kind: "callerror",
        direction,
        uniqueId,
        errorCode: parsed[2],
        errorDescription: String(parsed[3] ?? ""),
        errorDetails: parsed[4],
        timestamp,
        raw,
      };
    }
    default:
      return null;
  }
}

/**
 * Parses a single stdout line from the simulator CLI into a {@link Frame},
 * or returns null for anything that isn't an OCPP-J Sent/Received line
 * (structured JSON events, JSON command responses, other log lines, blank
 * lines).
 */
export function parseLogLine(line: string): Frame | null {
  const lineMatch = LOG_LINE_RE.exec(line);
  if (!lineMatch) return null;
  const [, timestamp, rest] = lineMatch;
  return parseFrameMessage(rest, timestamp, line);
}

/** Parses a whole multi-line log (or stdout capture), preserving order. */
export function parseLog(text: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of text.split("\n")) {
    const frame = parseLogLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

/**
 * Finds the `occurrence`-th (0-indexed, default 0) CALL frame matching
 * `direction` + `action`, in log order.
 */
export function findCall(
  frames: readonly Frame[],
  direction: Direction,
  action: string,
  occurrence = 0,
): CallFrame | undefined {
  let seen = 0;
  for (const frame of frames) {
    if (
      frame.kind === "call" &&
      frame.direction === direction &&
      frame.action === action
    ) {
      if (seen === occurrence) return frame;
      seen++;
    }
  }
  return undefined;
}

/** Returns every CALL frame matching `direction` + `action`, in log order. */
export function findAllCalls(
  frames: readonly Frame[],
  direction: Direction,
  action: string,
): CallFrame[] {
  return frames.filter(
    (f): f is CallFrame =>
      f.kind === "call" && f.direction === direction && f.action === action,
  );
}

/**
 * Finds the CALLRESULT/CALLERROR that answers `call`, correlated strictly
 * by OCPP-J `uniqueId` and reply direction (a response to a sent CALL must
 * be received, and vice versa) -- never by adjacency in the log.
 *
 * THIS IS THE open-ocpp-trace CORRELATION RULE, and it is not implemented
 * here. `trace-format/correlate.ts` owns it -- three clauses whose failure
 * modes are argued in that file's header -- and this function does the two
 * things that ARE local: spell a `Frame` in the format's vocabulary, and turn
 * the whole-trace pairing into the per-call question every assertion asks.
 *
 * Writing the rule out again here is the obvious thing and it was the first
 * shape of this function. It is wrong for the reason `tck/trace.ts` gives
 * about parsers, one layer up: this suite reads the same wire two ways, and
 * `tools/trace-conformance.sh` proves the LIBRARY reproduces the
 * specification. A second copy of the rule means that proof says nothing about
 * the assertions, and agreement between the two becomes a property to measure
 * and re-measure. One copy makes it a property of the code.
 *
 * It is not a local question, either: which response answers this call depends
 * on which calls the OTHER responses have already claimed, so the pairing is
 * computed whole and then indexed. That is O(n^2) per lookup where a forward
 * scan was O(n) -- measured at 0.03 ms for this repository's largest scenario
 * and 3 ms at 1000 frames, against sweeps that take minutes, so the shape that
 * states the rule wins over the shape that saves the microseconds.
 *
 * A `call` that is not in `frames` has no position, so the rule has nothing to
 * anchor on and this returns undefined rather than guessing from index 0.
 */
export function findResponseFor(
  frames: readonly Frame[],
  call: CallFrame,
): ResponseFrame | undefined {
  const callIndex = frames.indexOf(call);
  if (callIndex === -1) return undefined;

  const { answers } = correlate(frames.map(asCorrelatable));
  const at = answers.findIndex((match) => match === callIndex);
  if (at === -1) return undefined;

  const response = frames[at];
  return response.kind === "call" ? undefined : response;
}

/** A `Frame` in the interchange format's vocabulary -- the whole adaptation. */
function asCorrelatable(frame: Frame): Correlatable {
  return {
    messageType: MESSAGE_TYPE_OF_KIND[frame.kind],
    messageId: frame.uniqueId,
    direction: frame.direction === "sent" ? "cp-to-csms" : "csms-to-cp",
  };
}

/**
 * How the format spells each of this module's frame kinds.
 *
 * The `direction` mapping above is the same contract `tck/trace.ts` documents
 * in the other direction, and it holds for the same reason: the producer is a
 * charge point, so what it SENT travelled cp-to-csms. Correlation only ever
 * asks whether two directions differ, so even a recorder that inverted both
 * would pair the same frames -- but spelling it truthfully costs nothing and
 * keeps the adaptation readable as a translation rather than a trick.
 */
const MESSAGE_TYPE_OF_KIND: Record<Frame["kind"], Correlatable["messageType"]> =
  {
    call: "CALL",
    callresult: "CALLRESULT",
    callerror: "CALLERROR",
  };
