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
 *      wait is not missed: the wait is served from the lines already read;
 *   8. a line that MATCHES the wake pattern and parses to nothing -- a
 *      `Received: [3,"<id>"]` with no payload -- is passed over once, not
 *      served again on every pass. The wake pattern is looser than the
 *      parser and the pump serves a wait from the lines it already has, so a
 *      wait that started from 0 would resolve from that line for the whole
 *      budget: the tight loop this module exists to prevent, in the module;
 *   9. a uniqueId carrying a `"` or a `\` is waited on as the line spells it,
 *      JSON-encoded, because `parseLogLine` decodes what the wire carries;
 *  10. `settleBoot` asks the quiet gate AFTER the settle: the boot-time CALLs
 *      that land during the settle are what it waits on, and a gate moved
 *      ahead of the settle reads an empty set and opens. This is the
 *      placement row, the one the runner's comment used to hold alone;
 *  11. `settleBoot`'s boot gate is soft: a conf that never comes is reported
 *      through the callback, and the settle and the quiet gate still run.
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

import { awaitBootQuiet, settleBoot } from "../tck/boot-quiet";

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
// The id is JSON-encoded as the wire carries it (row 9 is the one where that
// differs from the raw string).
const J = (id: string): string => JSON.stringify(id);
const sent = (id: string, action: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Sent: [2,${J(id)},"${action}",${payload}]`;
const received = (id: string, action: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Received: [2,${J(id)},"${action}",${payload}]`;
const result = (id: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Received: [3,${J(id)},${payload}]`;
const error = (id: string): string =>
  `[${T}] [INFO] [WebSocket] Received: [4,${J(id)},"InternalError","Call failed",{}]`;
const ownResult = (id: string, payload = "{}"): string =>
  `[${T}] [INFO] [WebSocket] Sent: [3,${J(id)},${payload}]`;
/** Matches the wake pattern, parses to nothing: a CALLRESULT with no payload. */
const malformedResult = (id: string): string =>
  `[${T}] [INFO] [WebSocket] Received: [3,${J(id)}]`;

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

  /** The station's stdout, from the station's side: a line arriving. */
  emit(...lines: string[]): void {
    this.backing.push(...lines);
  }

  waitForLine(pattern: RegExp, timeoutMs: number, fromIndex = 0): Promise<string> {
    const wait = { pattern, timeoutMs };
    this.waits.push(wait);
    // A gate whose wait resolves from a line it already read spins here
    // forever, on the real pump as on this fake -- a hang, not a red row. Cap
    // it, so that mutation is reported as one.
    if (this.waits.length > RUNAWAY_WAITS) {
      return Promise.reject(new Error(`runaway: ${this.waits.length} waits armed`));
    }
    // The real pump's rule, fromIndex included: existing lines from there
    // on, then future ones.
    const existing = this.backing.find((line, i) => i >= fromIndex && pattern.test(line));
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

// ---------------------------------------------------------------------------
// 8. A matching-but-unparseable line is passed over once, not served forever.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // The malformed line is already there when the gate is asked; the station
  // then stays silent. A gate waiting from 0 is woken by that line on every
  // pass and never reaches the script -- the fake's runaway cap is what
  // turns that into a red row instead of a hang.
  const station = new FakeStation([...booted(), result(SN0), malformedResult(SN1)], clock, NEVER);
  const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  if (
    quiet.kind === "outstanding" &&
    quiet.waitedMs === BUDGET_MS &&
    station.waits.length === 1 &&
    JSON.stringify(named) === JSON.stringify([`StatusNotification(${SN1})`])
  ) {
    pass("a line that matches the wake pattern and parses to nothing is passed over, not re-served");
  } else {
    fail(
      "a line that matches the wake pattern and parses to nothing is passed over, not re-served",
      `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 9. A uniqueId with a `"` or a `\` is waited on as the wire spells it.
// ---------------------------------------------------------------------------

{
  const rows: Array<[string, string]> = [
    ["a double quote", 'id"with"quotes'],
    ["a backslash", "id\\with\\backslashes"],
  ];
  for (const [what, id] of rows) {
    const clock = new FakeClock();
    const station = new FakeStation(
      [...booted(), result(SN0), result(SN1), sent(id, "Heartbeat")],
      clock,
      () => ({ lines: [result(id)], ms: 10 }),
    );
    const quiet = await awaitBootQuiet(station, BUDGET_MS, clock);
    const wait = station.waits[0];
    if (quiet.kind === "quiet" && station.waits.length === 1 && wait?.pattern.test(result(id))) {
      pass(`a uniqueId carrying ${what} is waited on JSON-encoded, as the line carries it`);
    } else {
      fail(
        `a uniqueId carrying ${what} is waited on JSON-encoded, as the line carries it`,
        `got ${JSON.stringify(quiet)}, waits: ${station.waits.map((w) => w.pattern.source).join(" | ")}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 10. settleBoot asks the gate AFTER the settle -- the placement row.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // The conf is there; the StatusNotifications are NOT -- they land during
  // the settle, as on the wire (1-4 ms after the conf, i.e. after the boot
  // gate has returned and before any settle is over). A gate asked before the
  // settle sees Boot answered and nothing else, and opens.
  const station = new FakeStation(booted().slice(0, 2), clock, NEVER);
  const slept: number[] = [];
  const quiet = await settleBoot(station, {
    bootGateMs: 30_000,
    bootWaitMs: 4_000,
    quietTimeoutMs: BUDGET_MS,
    clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock.advance(ms);
      station.emit(...booted().slice(2));
    },
    onBootGateTimeout: () => fail("settleBoot asks the gate after the settle", "the boot gate timed out on a conf that was there"),
  });
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  if (
    quiet.kind === "outstanding" &&
    JSON.stringify(slept) === "[4000]" &&
    JSON.stringify(named) === JSON.stringify([`StatusNotification(${SN0})`, `StatusNotification(${SN1})`])
  ) {
    pass("settleBoot asks the gate after the settle: the CALLs that land during it are what it waits on");
  } else {
    fail(
      "settleBoot asks the gate after the settle: the CALLs that land during it are what it waits on",
      `got ${JSON.stringify(quiet)}, slept ${JSON.stringify(slept)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 11. settleBoot's boot gate is soft.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // BootNotification sent, never answered: the boot gate's wait is the first
  // one armed and the script keeps the station silent for it.
  const station = new FakeStation([sent(BOOT, "BootNotification")], clock, NEVER);
  let reported: unknown;
  const slept: number[] = [];
  const quiet = await settleBoot(station, {
    bootGateMs: 30_000,
    bootWaitMs: 4_000,
    quietTimeoutMs: BUDGET_MS,
    clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock.advance(ms);
    },
    onBootGateTimeout: (err) => {
      reported = err;
    },
  });
  const bootGate = station.waits[0];
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  if (
    reported instanceof Error &&
    bootGate?.timeoutMs === 30_000 &&
    JSON.stringify(slept) === "[4000]" &&
    quiet.kind === "outstanding" &&
    JSON.stringify(named) === JSON.stringify([`BootNotification(${BOOT})`])
  ) {
    pass("settleBoot's boot gate is soft: reported through the callback, then the settle and the gate still run");
  } else {
    fail(
      "settleBoot's boot gate is soft: reported through the callback, then the settle and the gate still run",
      `reported=${String(reported)}, waits=${station.waits.map((w) => w.timeoutMs).join(",")}, slept=${JSON.stringify(slept)}, got ${JSON.stringify(quiet)}`,
    );
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} failure(s)\n`);
  process.exit(1);
}
process.stderr.write("boot quiet: OK\n");
