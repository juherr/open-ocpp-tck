// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * boot-quiet.ts -- hold a scenario's first CSMS dispatch until every CALL the
 * station sent at boot has been answered.
 *
 * THE WINDOW THIS CLOSES. The runner's boot gate opens on BootNotification.conf
 * and settles for `bootWaitSecs`; the station's boot-time StatusNotifications
 * go out 1-4 ms after that conf, and a healthy CSMS answers them in ~300 ms.
 * The pinned CitrineOS refuses to dispatch a CSMS-initiated Call while ANY
 * Call of the station's own is still in progress -- `sendCall` throws a retry
 * on `existsAnyInNamespace(Transactions + station)` -- and its broker receiver
 * re-queues the refused Call every ~1 ms, with no backoff, until the entry
 * clears (citrineos/citrineos#223; the mechanism is written up in #119). Three
 * stations booting in 2.0.1 at once exhaust its Postgres pool for the pool's
 * 60 s acquire timeout, the StatusNotification handlers sit in that queue, and
 * a dispatch 4 s after the boot lands inside the window: on `v2.0.0-beta4`, 5
 * of 8 CI shard runs collapsed there (#138).
 *
 * THE CONDITION IS THE CSMS'S OWN, NOT A HEURISTIC. The in-progress entry is
 * set when the station's CALL arrives (`_onCall`, `setIfNotExist`) and removed
 * when the CSMS sends its CALLRESULT or its CALLERROR -- so "every CALL the
 * station sent has a response" is exactly the precondition under which the
 * next dispatch is not refused. It is also OCPP-J bookkeeping any peer keeps,
 * which is what lets this module stay CSMS-neutral: it reads the station's
 * stdout through `tck/ocpp.ts` and names no CSMS.
 *
 * THE BUDGET IS THE MITIGATION'S PARAMETER, and it is worth knowing why. That
 * entry has a TTL of `maxCallLengthSeconds`, 20 s by default, after which the
 * handler's late CALLRESULT is dropped as "missing message id" -- so in the
 * stall case the `.conf` never reaches the wire, and this gate can only reach
 * its budget. An archived local run shows it to the millisecond: two boot
 * StatusNotifications never answered, the Reset received exactly 20.000 s
 * after them. A budget past 20 s therefore ends the retry loop; past 60 s it
 * lets the pool drain before the first dispatch, which is what the runner's
 * constant is set to. In the healthy case the answers are already in `lines`
 * when the gate is asked, and it costs nothing.
 *
 * AFTER THE SETTLE, NOT BEFORE. Asked right after BootNotification.conf the
 * gate can read an empty set -- the StatusNotifications have not been sent yet
 * -- and open. main.ts asks it after `bootWaitSecs`, and tests/boot-quiet.ts
 * cannot pin that placement (it is a fact about timing in the runner), so this
 * paragraph is the note a reviewer proposing the tidier order should meet.
 *
 * The seam is `SimProcess.lines` and `SimProcess.waitForLine`, the same half
 * the boot gate reads, so the guard can hand it a station whose stdout it
 * scripts. A statement, never a throw -- which of its two outcomes ends a run
 * is the runner's decision, and today neither does: the runner warns and
 * dispatches anyway, because after the budget the CSMS's own TTL has cleared
 * the entries and the dispatch is at least not a loop.
 */

import { findResponseFor, parseLogLine, type Frame } from "./ocpp";

/** The half of {@link import("./sim").SimProcess} this needs. */
export interface SimWire {
  readonly lines: readonly string[];
  waitForLine(pattern: RegExp, timeoutMs: number): Promise<string>;
}

/** A CALL the station sent that has no CALLRESULT or CALLERROR after it. */
export interface OutstandingCall {
  action: string;
  uniqueId: string;
}

export type BootQuiet =
  | { kind: "quiet"; waitedMs: number }
  | { kind: "outstanding"; waitedMs: number; calls: OutstandingCall[] };

/** A clock the gate can be handed, so the guard owns time. */
export interface QuietClock {
  now(): number;
}

/**
 * Every CALL in `frames` the station SENT and nobody answered, in wire order.
 * A CALLERROR is an answer; a CALL the station received, and its own response
 * to that, are neither. Deliberately not {@link import("./assert").tallyAnswers}'s
 * rule 3: there, a trailing unanswered CALL is forgiven because the log was
 * truncated; here every unanswered CALL is what the gate is waiting on.
 */
export function outstandingCalls(frames: readonly Frame[]): OutstandingCall[] {
  const open: OutstandingCall[] = [];
  for (const frame of frames) {
    if (frame.kind !== "call" || frame.direction !== "sent") continue;
    if (findResponseFor(frames, frame) !== undefined) continue;
    open.push({ action: frame.action, uniqueId: frame.uniqueId });
  }
  return open;
}

function parseLines(lines: readonly string[]): Frame[] {
  const frames: Frame[] = [];
  for (const line of lines) {
    const frame = parseLogLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Resolves `quiet` once every CALL the station has sent is answered, or
 * `outstanding` -- naming what is still open -- once `timeoutMs` is spent.
 *
 * Each pass re-reads the whole of `lines`, so a CALL the station sends while
 * the gate waits (a Heartbeat) is waited on in turn, from the same budget. The
 * wait is armed on the outstanding uniqueIds and nothing else, and it is
 * served from the lines already read when the answer landed between the read
 * and the wait -- `waitFor` scans existing lines first, and tests/boot-quiet.ts
 * pins that this relies on it.
 */
export async function awaitBootQuiet(
  sim: SimWire,
  timeoutMs: number,
  clock: QuietClock = { now: () => Date.now() },
): Promise<BootQuiet> {
  const started = clock.now();
  for (;;) {
    const open = outstandingCalls(parseLines(sim.lines));
    const waitedMs = clock.now() - started;
    if (open.length === 0) return { kind: "quiet", waitedMs };
    const remaining = timeoutMs - waitedMs;
    if (remaining <= 0) return { kind: "outstanding", waitedMs, calls: open };
    const ids = open.map((call) => escapeRegExp(call.uniqueId)).join("|");
    try {
      await sim.waitForLine(new RegExp(`Received: \\[[34],"(?:${ids})"`), remaining);
    } catch {
      // The budget, or a simulator that exited under the wait. Either way the
      // answer is what is still open now; the runner's next step is what
      // throws on a station that is gone.
      return {
        kind: "outstanding",
        waitedMs: clock.now() - started,
        calls: outstandingCalls(parseLines(sim.lines)),
      };
    }
  }
}
