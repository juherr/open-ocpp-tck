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
 * constant is set to. And the budget is not the whole rule: a CALL the station
 * sends late in it -- a Heartbeat at t=89s -- has an entry the CSMS set at
 * t=89s, so the gate gives up on a CALL only once THAT CALL has been open for
 * `staleAfterMs`, the TTL plus a margin, whatever the budget says. In the
 * healthy case the answers are already in `lines` when the gate is asked, and
 * it costs nothing.
 *
 * AFTER THE SETTLE, NOT BEFORE. Asked right after BootNotification.conf the
 * gate can read an empty set -- the StatusNotifications have not been sent yet
 * -- and open. That order is `settleBoot`'s, below: it owns the conf wait, the
 * settle and the gate, takes the settle as an injected `sleep`, and
 * tests/boot-quiet.ts makes the CALLs land inside it, so the tidier-looking
 * order goes red there rather than surviving as a comment in the runner.
 *
 * The seam is `SimProcess.lines` and `SimProcess.waitForLine`, the same half
 * the boot gate reads, so the guard can hand it a station whose stdout it
 * scripts. A statement, never a throw -- which of its two outcomes ends a run
 * is the runner's decision, and today neither does: the runner warns and
 * dispatches anyway, because after the budget the CSMS's own TTL has cleared
 * the entries and the dispatch is at least not a loop.
 */
import { type Frame } from "./ocpp";
/** The half of {@link import("./sim").SimProcess} this needs. */
export interface SimWire {
    readonly lines: readonly string[];
    waitForLine(pattern: RegExp, timeoutMs: number, fromIndex?: number): Promise<string>;
}
/** A CALL the station sent that has no CALLRESULT or CALLERROR after it. */
export interface OutstandingCall {
    action: string;
    uniqueId: string;
}
export type BootQuiet = {
    kind: "quiet";
    waitedMs: number;
} | {
    kind: "outstanding";
    waitedMs: number;
    calls: OutstandingCall[];
};
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
export declare function outstandingCalls(frames: readonly Frame[]): OutstandingCall[];
/** What {@link awaitBootQuiet} needs beyond the station. */
export interface QuietOptions {
    /** The budget: how long the gate waits for the CALLs it found at the start
     *  before giving up on them. */
    timeoutMs: number;
    /** How long an unanswered CALL has to have been outstanding before the gate
     *  may give up on IT -- the CSMS's in-progress TTL plus a margin. Applies
     *  to every CALL, including one the station sends late in the budget: the
     *  budget alone is measured from the first wait, and a Heartbeat at t=89s
     *  returned at t=90s is one second old, with the entry that refuses a
     *  dispatch still nineteen seconds from expiring. */
    staleAfterMs: number;
    clock?: QuietClock;
}
/**
 * Resolves `quiet` once every CALL the station has sent is answered, or
 * `outstanding` -- naming what is still open -- once the budget is spent AND
 * every open CALL has been outstanding for `staleAfterMs`.
 *
 * Each pass re-reads the whole of `lines`, so a CALL the station sends while
 * the gate waits (a Heartbeat) is waited on in turn -- and AGED in turn: a
 * CALL first seen at t is not given up on before t + staleAfterMs, whatever
 * the budget says, because the property the runner relies on is that the
 * CSMS's in-progress entry for every open CALL has expired by the time it
 * dispatches, and that entry's clock starts when the CALL arrives, not when
 * the gate does. The age is measured from the gate's first sight of the CALL,
 * which is after the station sent it, so it under-reads the CSMS's and is
 * conservative. Termination: every extension needs the station to emit a NEW
 * CALL the CSMS does not answer, and a station idling after its boot emits
 * one per heartbeat interval -- the extension is one `staleAfterMs`, once.
 *
 * The wait is armed on the outstanding uniqueIds and nothing else, and it is
 * served from the lines already read when the answer landed between the read
 * and the wait -- `waitFor` scans existing lines first, and tests/boot-quiet.ts
 * pins that this relies on it.
 */
export declare function awaitBootQuiet(sim: SimWire, options: QuietOptions): Promise<BootQuiet>;
/** What {@link settleBoot} needs beyond the station. */
export interface BootSettleOptions {
    /** How long to wait for BootNotification.conf before going on without it. */
    bootGateMs: number;
    /** The scenario's settle after the conf, `bootWaitSecs` in milliseconds. */
    bootWaitMs: number;
    /** The quiet gate's budget -- see the runner's constants for the numbers. */
    quietTimeoutMs: number;
    /** How long every open CALL must have been outstanding before the quiet
     *  gate gives up on it -- see {@link QuietOptions.staleAfterMs}. */
    staleAfterMs: number;
    /** The wait itself, injected so the guard can make lines land DURING it. */
    sleep: (ms: number) => Promise<void>;
    /** Called with the error when the boot gate gives up; the runner warns. */
    onBootGateTimeout: (err: unknown) => void;
    clock?: QuietClock;
}
/**
 * BootNotification.conf, then the settle, THEN the quiet gate -- the runner's
 * whole post-`connect` boot, in the one order that works.
 *
 * Upstream matched `"status":"Accepted","currentTime"` -- SteVe's key order.
 * JSON object key order carries no meaning, and a CSMS serialises the same
 * payload as {currentTime, interval, status}, so the wait always timed out:
 * 30s burned per scenario, and the event-driven gate silently degraded back
 * into the fixed sleep it exists to replace. Both keys, any order.
 *
 * REJECTED, and it will be re-proposed because the assertions read trace
 * records and this is the last frame pattern left outside the parser: gate
 * on the trace instead. It cannot work. This is a LIVE wait on a stream that
 * is still arriving, and the trace is a file the CONTAINER appends to --
 * serving this wait from it means polling a file for a record that may never
 * come, i.e. reimplementing waitForLine's timeout around a worse source. The
 * frames this gate waits on are stdout's, which we are already reading line
 * by line. Nothing about the coupling issue #44 is about applies here either:
 * no member order is pinned, which is exactly what the lookaheads are for.
 *
 * THE ORDER IS THE PROPERTY, and it is why this function exists as a seam
 * rather than as three lines in the runner. The station's boot-time
 * StatusNotifications go out 1-4 ms after the conf: a quiet gate asked as the
 * conf lands reads an empty set and opens onto the window it exists to close,
 * and every row of tests/boot-quiet.ts stays green while it does, because
 * they exercise the gate and not its placement. So the settle is injected,
 * the guard makes the CALLs land inside it, and a gate moved ahead of the
 * settle -- the tidier-looking order -- goes red there.
 */
export declare function settleBoot(sim: SimWire, options: BootSettleOptions): Promise<BootQuiet>;
