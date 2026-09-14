// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/boot-quiet.ts -- the boot gate holds a scenario's first CSMS dispatch
 * until every CALL the station sent at boot has been answered.
 *
 * PROPERTY, in seven parts:
 *   1. a station whose CALLs are all answered before the gate is asked is
 *      `quiet` at once: no wait is armed and no time is spent. This is the
 *      control row -- the healthy sweep pays nothing for the mechanism;
 *   2. a CALL that is outstanding when the gate is asked and answered while
 *      it waits ends `quiet`, and the wait was armed on THAT CALL's uniqueId,
 *      not on a fixed action or on "any response";
 *   3. a CALL that is never answered ends `outstanding` at the budget, naming
 *      the action and the uniqueId, so the WARN the runner prints can be
 *      matched against the CSMS's own log;
 *   4. a CALLERROR is an answer. The CSMS's own bookkeeping clears the
 *      in-progress entry on either response, and a gate that waited for a
 *      CALLRESULT alone would sit through the budget on a station the CSMS
 *      had already released;
 *   5. a CALL the station sends WHILE the gate waits is waited on in turn (a
 *      Heartbeat, a StatusNotification for a connector that settled late),
 *      and the budget is one total, not one per wait;
 *   6. a CALL the station RECEIVED -- answered by the station or not yet --
 *      the station's own CALLRESULT to one, and a response for some other
 *      uniqueId count for nothing: neither as an outstanding CALL nor as an
 *      answer;
 *   7. a response that lands between the gate's read of the lines and its
 *      wait is not missed: the wait is served from the lines already read.
 *
 * WHY. The pinned CitrineOS refuses to dispatch a CSMS-initiated Call while
 * any Call of the station's own is still in progress, and re-queues it every
 * millisecond until the entry clears (citrineos/citrineos#223, #119). Three
 * stations booting in 2.0.1 at once exhaust its Postgres pool for ~60 s, the
 * boot StatusNotifications stay in progress, and the runner -- gated on
 * BootNotification.conf alone and settled for 4 s -- dispatched into exactly
 * that window: 5 of 8 CI shard runs on beta4 collapsed there (#138). The
 * in-progress entry is set when the station's CALL arrives and removed when
 * the CSMS sends its response, so "every CALL the station sent has been
 * answered" is the CSMS's own precondition, read off the simulator's stdout.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. Reaching the branch means a
 * CSMS that answers the BootNotification and then stalls the
 * StatusNotifications, which no bundled CSMS can be asked for on demand: CI
 * produces it on 60 % of beta4 shard runs and never when wanted, and staging
 * it locally means exhausting a database pool on purpose. So `awaitBootQuiet`
 * takes the station's `lines` and `waitForLine` as its seam -- the same half
 * of SimProcess the runner's boot gate reads -- and the fake here is a station
 * whose stdout the row scripts. Every line the fake emits is in the pinned
 * simulator's Logger format, which `tck/ocpp.ts` parses; that format is the
 * one assumption, and `tests/trace-frames.ts` and every scenario assertion
 * share it.
 *
 * Offline: no container, no CSMS, no file, no real clock.
 */

import { awaitBootQuiet } from "../tck/boot-quiet";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

function pass(what: string): void {
  process.stderr.write(`ok: ${what}\n`);
}

// ---------------------------------------------------------------------------
// The wire, in the pinned simulator's Logger format.
// ---------------------------------------------------------------------------

const T = "2026-09-12T19:16:54.000Z";
const sent = (id: string, action: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Sent: [2,"${id}","${action}",${payload}]`;
const received = (id: string, action: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Received: [2,"${id}","${action}",${payload}]`;
const result = (id: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Received: [3,"${id}",${payload}]`;
const error = (id: string): string =>
  `[${T}] [INFO] [WebSocket] Received: [4,"${id}","InternalError","Call failed",{}]`;
const ownResult = (id: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Sent: [3,"${id}",${payload}]`;

const BOOT = "1814e4d9-3135-4dc8-b305-52a305f293a7";
const SN0 = "b85ccf23-bb56-4aca-bc20-0309f8a000e8";
const SN1 = "90839755-d3b5-4db1-89bf-7612eca82965";
const HB = "0cf5a2b0-08ca-4e9c-91b6-67baa9ed0219";
const RESET = "b75f1f58-b016-49d8-9a70-159f933681e6";
const GETVARS = "318b8bad-0376-4736-bda7-5cbd59c718d1";

/** The boot every row starts from: BootNotification answered, both
 *  StatusNotifications sent 1 ms later -- the shape of every archived 2.0.1
 *  run, healthy or stalled. */
const booted = (): string[] => [
  sent(BOOT, "BootNotification"),
  result(BOOT, '{"currentTime":"2026-09-12T19:16:54.120Z","status":"Accepted","interval":60}'),
  sent(SN0, "StatusNotification", '{"connectorStatus":"Available","evseId":0,"connectorId":0}'),
  sent(SN1, "StatusNotification", '{"connectorStatus":"Available","evseId":1,"connectorId":1}'),
];

interface Wait {
  pattern: RegExp;
  timeoutMs: number;
}

/** What a row makes the station do when the gate arms a wait: emit lines
 *  (and take `ms`), or stay silent until the wait's budget is spent. */
type Script = (wait: Wait, turn: number) => { lines: string[]; ms: number } | "silence";

class FakeClock {
  private t = 1_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** A station whose stdout the row scripts. Models the one property of the
 *  real `waitFor` the gate relies on (row 7): a line already in `lines` when
 *  the wait is armed resolves it at once. */
class FakeStation {
  readonly waits: Wait[] = [];
  protected readonly backing: string[];
  constructor(
    lines: string[],
    private readonly clock: FakeClock,
    private readonly script: Script,
  ) {
    this.backing = lines;
  }

  /** What the gate reads. A getter so row 7 can put a line between the
   *  gate's read and its wait. */
  get lines(): readonly string[] {
    return this.backing;
  }

  waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
    const wait = { pattern, timeoutMs };
    this.waits.push(wait);
    // A gate whose wait resolves from a line it already read spins here
    // forever, on the real pump as on this fake -- a hang, not a red row. Cap
    // it, so that mutation is reported as one.
    if (this.waits.length > RUNAWAY_WAITS) {
      return Promise.reject(new Error(`runaway: ${this.waits.length} waits armed`));
    }
    const existing = this.backing.find((line) => pattern.test(line));
    if (existing !== undefined) return Promise.resolve(existing);
    const turn = this.script(wait, this.waits.length);
    if (turn === "silence") {
      this.clock.advance(timeoutMs);
      return Promise.reject(
        new Error(`timed out after ${timeoutMs}ms waiting for /${pattern.source}/ on fake`),
      );
    }
    this.clock.advance(turn.ms);
    this.backing.push(...turn.lines);
    const landed = this.backing.find((line) => pattern.test(line));
    if (landed !== undefined) return Promise.resolve(landed);
    // The script emitted lines the wait was not about; the real pump keeps
    // waiting, and this fake has nothing further scripted -- so the budget.
    this.clock.advance(timeoutMs - turn.ms);
    return Promise.reject(
      new Error(`timed out after ${timeoutMs}ms waiting for /${pattern.source}/ on fake`),
    );
  }
}

const BUDGET_MS = 90_000;
const RUNAWAY_WAITS = 8;
const NEVER: Script = () => "silence";

// ---------------------------------------------------------------------------
// 1. Control: a healthy boot is quiet at once, and costs nothing.
// ---------------------------------------------------------------------------

{
  // A clock that ticks on every read, as the real one does across a parse:
  // "no time spent" has to mean no WAIT, not a clock that stood still.
  const clock = new (class extends FakeClock {
    override now(): number {
      this.advance(1);
      return super.now();
    }
  })();
  const station = new FakeStation([...booted(), result(SN1), result(SN0)], clock, NEVER);
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  if (quiet.kind === "quiet" && quiet.waitedMs === 0 && station.waits.length === 0) {
    pass("a boot whose CALLs are all answered is quiet at once, with no wait armed");
  } else {
    fail(
      "a boot whose CALLs are all answered is quiet at once, with no wait armed",
      `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s) armed`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. A late answer ends quiet, and the wait named the outstanding uniqueId.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  const station = new FakeStation([...booted(), result(SN0)], clock, () => ({
    lines: [result(SN1)],
    ms: 300,
  }));
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  const wait = station.waits[0];
  const namesTheId =
    wait !== undefined && wait.pattern.test(result(SN1)) && !wait.pattern.test(result(SN0)) &&
    !wait.pattern.test(result(HB));
  if (quiet.kind === "quiet" && quiet.waitedMs === 300 && station.waits.length === 1 && namesTheId) {
    pass("a CALL answered during the wait ends quiet, waited on by its uniqueId");
  } else {
    fail(
      "a CALL answered during the wait ends quiet, waited on by its uniqueId",
      `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s): ${station.waits.map((w) => w.pattern.source).join(" | ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Never answered: outstanding at the budget, naming what is still open.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  const station = new FakeStation(booted(), clock, NEVER);
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  const expected = [`StatusNotification(${SN0})`, `StatusNotification(${SN1})`];
  if (
    quiet.kind === "outstanding" &&
    quiet.waitedMs === BUDGET_MS &&
    JSON.stringify(named) === JSON.stringify(expected)
  ) {
    pass("a CALL never answered is reported outstanding at the budget, by action and uniqueId");
  } else {
    fail(
      "a CALL never answered is reported outstanding at the budget, by action and uniqueId",
      `got ${JSON.stringify(quiet)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. A CALLERROR is an answer.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  const station = new FakeStation([...booted(), result(SN0)], clock, () => ({
    lines: [error(SN1)],
    ms: 50,
  }));
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  if (quiet.kind === "quiet" && station.waits.length === 1) {
    pass("a CALLERROR answers the CALL it names");
  } else {
    fail("a CALLERROR answers the CALL it names", `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s)`);
  }
}

// ---------------------------------------------------------------------------
// 5. A CALL sent during the wait is waited on in turn, from one budget.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  const station = new FakeStation([...booted(), result(SN0)], clock, (_wait, turn) =>
    turn === 1
      ? { lines: [result(SN1), sent(HB, "Heartbeat")], ms: 1_000 }
      : { lines: [result(HB)], ms: 200 },
  );
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  const [first, second] = station.waits;
  const secondNamesHb = second !== undefined && second.pattern.test(result(HB));
  const oneBudget =
    first !== undefined && second !== undefined && first.timeoutMs === BUDGET_MS &&
    second.timeoutMs === BUDGET_MS - 1_000;
  if (quiet.kind === "quiet" && quiet.waitedMs === 1_200 && station.waits.length === 2 && secondNamesHb && oneBudget) {
    pass("a CALL sent during the wait is waited on next, and the budget is one total");
  } else {
    fail(
      "a CALL sent during the wait is waited on next, and the budget is one total",
      `got ${JSON.stringify(quiet)}, waits: ${station.waits.map((w) => `${w.timeoutMs}ms /${w.pattern.source}/`).join(" | ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Negatives: a received CALL, our CALLRESULT to it, and a response for
//    another id are neither outstanding nor an answer.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  const station = new FakeStation(
    [
      ...booted(),
      result(SN0),
      received(RESET, "Reset", '{"type":"Immediate"}'),
      ownResult(RESET, '{"status":"Accepted"}'),
      // Received and not yet answered by the station: the one a direction
      // mistake would report as outstanding.
      received(GETVARS, "GetVariables", '{"getVariableData":[]}'),
      result(HB),
    ],
    clock,
    NEVER,
  );
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  if (quiet.kind === "outstanding" && JSON.stringify(named) === JSON.stringify([`StatusNotification(${SN1})`])) {
    pass("a received CALL, our own CALLRESULT and a stranger's response count for nothing");
  } else {
    fail(
      "a received CALL, our own CALLRESULT and a stranger's response count for nothing",
      `got ${JSON.stringify(quiet)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 7. A response landing between the read and the wait is served from the
//    lines already there.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // `lines` answers the gate's FIRST read with a snapshot, then lets the
  // response land -- so it is in the array by the time the wait is armed and
  // was not in what the gate parsed.
  class RacyStation extends FakeStation {
    private reads = 0;
    override get lines(): readonly string[] {
      this.reads++;
      if (this.reads === 1) {
        const snapshot = [...this.backing];
        this.backing.push(result(SN1));
        return snapshot;
      }
      return this.backing;
    }
  }
  const station = new RacyStation([...booted(), result(SN0)], clock, NEVER);
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  if (quiet.kind === "quiet" && quiet.waitedMs === 0 && station.waits.length === 1) {
    pass("a response that landed before the wait was armed is not waited for again");
  } else {
    fail(
      "a response that landed before the wait was armed is not waited for again",
      `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s)`,
    );
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} failure(s)\n`);
  process.exit(1);
}
process.stderr.write("boot quiet: OK\n");
