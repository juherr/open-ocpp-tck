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
 *      through the callback, and the settle and the quiet gate still run;
 *  12. a CALL the station sends LATE in the budget is aged on its own clock:
 *      the gate does not give up on it until it has been open `staleAfterMs`,
 *      so a Heartbeat at t=89s holds the gate past t=90s. The budget alone is
 *      measured from the first wait, and the CSMS's in-progress entry for
 *      that CALL is measured from the CALL -- the property the runner relies
 *      on is about the entry, and it is the entry's clock that has to run
 *      out. Its control is row 3: a CALL open since the start is given up on
 *      at the budget, not a moment later;
 *  13. the REAL pump honours `fromIndex`: `attachSimStreams`'s `waitForLine`
 *      ignores a matching line buffered before it and resolves on a matching
 *      line that arrives after. Row 8 holds the gate to the fake's model of
 *      that rule; this row holds the model to the pump, so a pump that went
 *      back to scanning from 0 goes red here and not only in a sweep;
 *  14. a wait the pump rejects BEFORE its deadline -- the station gone, on
 *      the real pump -- ends the gate at once with what is open, where a
 *      rejection at the deadline goes round once more;
 *  15. the gate has a TERMINAL bound. Each new unanswered CALL extends the
 *      deadline by `staleAfterMs`, and nothing makes a station send them less
 *      often than that: a station that does holds the gate -- and the
 *      scenario's cleanup behind it -- for ever. At `hardCapMs` the gate
 *      answers, and reached with a CALL still inside the window the answer
 *      is `unsettled`, never `outstanding`: the runner aborts on it rather
 *      than dispatch over a live entry;
 *  16. the cap does not shorten a deadline that fits under it: a late CALL
 *      whose window ends before the cap is aged out and reported
 *      `outstanding`, the same as row 12. Rows 15 and 16 are each other's
 *      control -- one holds that the cap binds, the other that it binds
 *      nothing it need not.
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
import { attachSimStreams } from "../tck/sim";

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
    // A gate whose wait resolves from a line it already read, or whose
    // deadline keeps moving, spins here forever -- on the real pump as on
    // this fake, and a hang is not a red row. So the fake ENDS the run: a
    // rejection would be caught by the gate and spun on, a throw likewise,
    // and the property under test is precisely that the gate terminates.
    if (this.waits.length > RUNAWAY_WAITS) {
      fail("the gate terminates", `runaway: ${this.waits.length} waits armed on /${pattern.source}/`);
      process.stderr.write(`\n${failures} failure(s)\n`);
      process.exit(1);
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
    const landed = this.backing.find((line, i) => i >= fromIndex && pattern.test(line));
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
const STALE_MS = 25_000;
const CAP_MS = 150_000;
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
  // `waitedMs === 50`: woken BY the CALLERROR, not found on a re-read after
  // sitting out the budget -- a wake pattern that only knows `[3,` reaches
  // quiet too, ninety seconds late.
  if (quiet.kind === "quiet" && quiet.waitedMs === 50 && station.waits.length === 1) {
    pass("a CALLERROR answers the CALL it names, and wakes the wait");
  } else {
    fail("a CALLERROR answers the CALL it names, and wakes the wait", `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s)`);
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
    const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
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
    staleAfterMs: STALE_MS,
    hardCapMs: CAP_MS,
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
    staleAfterMs: STALE_MS,
    hardCapMs: CAP_MS,
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

// ---------------------------------------------------------------------------
// 12. A CALL sent late in the budget is aged on its own clock.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // SN1 open from the start; at t=89s the station sends a Heartbeat nobody
  // answers. The gate first sees it at t=90s, when the budget's wait times
  // out, and may not give up on it before t=115s.
  const station = new FakeStation([...booted(), result(SN0)], clock, (_wait, turn) =>
    turn === 1 ? { lines: [sent(HB, "Heartbeat")], ms: 89_000 } : "silence",
  );
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  const timeouts = station.waits.map((w) => w.timeoutMs);
  if (
    quiet.kind === "outstanding" &&
    quiet.waitedMs === BUDGET_MS + STALE_MS &&
    JSON.stringify(timeouts) === JSON.stringify([BUDGET_MS, STALE_MS]) &&
    JSON.stringify(named) === JSON.stringify([`StatusNotification(${SN1})`, `Heartbeat(${HB})`])
  ) {
    pass("a CALL sent late in the budget holds the gate until it has aged staleAfterMs");
  } else {
    fail(
      "a CALL sent late in the budget holds the gate until it has aged staleAfterMs",
      `got ${JSON.stringify(quiet)}, waits ${JSON.stringify(timeouts)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 13. The real pump honours fromIndex.
// ---------------------------------------------------------------------------

{
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stdout = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const streams = attachSimStreams({
    container: "simts-guard-boot-quiet",
    stdout,
    stderr: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
    exited: new Promise<number | null>(() => {}),
    write: async () => {},
  });
  const before = `${malformedResult(SN1)}\n`;
  controller.enqueue(encoder.encode(before));
  // Let the pump read the buffered line, then wait from PAST it: a scan from
  // 0 resolves at once on that line; a scan from 1 must wait.
  await new Promise((r) => setTimeout(r, 20));
  const pattern = /Received: \[[34],"90839755-d3b5-4db1-89bf-7612eca82965"/;
  const from0 = streams.waitForLine(pattern, 500, 0);
  const from1 = streams.waitForLine(pattern, 2_000, 1);
  const first = await from0.then(
    (line) => ({ resolved: line }),
    (err) => ({ rejected: String(err) }),
  );
  let settledEarly = false;
  const settledFlag = from1.then(() => (settledEarly = true), () => (settledEarly = true));
  await new Promise((r) => setTimeout(r, 50));
  const heldPastBuffered = !settledEarly;
  controller.enqueue(encoder.encode(`${result(SN1)}\n`));
  const second = await Promise.race([
    from1.then((line) => ({ resolved: line })),
    new Promise<{ rejected: string }>((r) => setTimeout(() => r({ rejected: "not resolved by the future line" }), 1_000)),
  ]);
  await settledFlag.catch(() => {});
  controller.close();
  await streams.drained;
  if (
    "resolved" in first && first.resolved === malformedResult(SN1) &&
    heldPastBuffered &&
    "resolved" in second && second.resolved === result(SN1)
  ) {
    pass("attachSimStreams.waitForLine ignores a match buffered before fromIndex and resolves on one after");
  } else {
    fail(
      "attachSimStreams.waitForLine ignores a match buffered before fromIndex and resolves on one after",
      `from 0: ${JSON.stringify(first)}; held past the buffered line: ${heldPastBuffered}; from 1: ${JSON.stringify(second)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 14. A rejection before the deadline is the station gone: answer at once.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // A station whose wait rejects without the clock moving -- what the pump
  // does once stdout has closed. The gate must not go round until t=90s on
  // a wait that can never be served.
  class GoneStation extends FakeStation {
    override waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
      this.waits.push({ pattern, timeoutMs });
      // A gate that goes round on this rejection spins with the clock still:
      // let it out past the deadline after a few turns, so it fails on the
      // wait count rather than hanging.
      if (this.waits.length >= RUNAWAY_WAITS) clock.advance(BUDGET_MS + STALE_MS);
      return Promise.reject(new Error("simulator container simts-gone exited (exit code 137) before /…/"));
    }
  }
  const station = new GoneStation([...booted(), result(SN0)], clock, NEVER);
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
  const named =
    quiet.kind === "outstanding" ? quiet.calls.map((c) => `${c.action}(${c.uniqueId})`) : [];
  if (
    quiet.kind === "outstanding" &&
    quiet.waitedMs === 0 &&
    station.waits.length === 1 &&
    JSON.stringify(named) === JSON.stringify([`StatusNotification(${SN1})`])
  ) {
    pass("a wait rejected before its deadline ends the gate at once with what is open");
  } else {
    fail(
      "a wait rejected before its deadline ends the gate at once with what is open",
      `got ${JSON.stringify(quiet)}, ${station.waits.length} wait(s)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 15. The terminal bound: fresh unanswered CALLs for ever end at the cap,
//     as `unsettled`.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // Every wait the gate arms, the station answers with a NEW unanswered
  // CALL ten seconds in -- always inside the window, so the deadline never
  // arrives. A gate without a cap arms waits until the fake's runaway cap
  // stops it; a gate that dispatches at the cap answers `outstanding`.
  let n = 0;
  const station = new FakeStation([...booted(), result(SN0)], clock, () => ({
    lines: [sent(`fresh-${++n}`, "Heartbeat")],
    ms: 10_000,
  }));
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
  const youngest = quiet.kind === "unsettled" ? quiet.calls[quiet.calls.length - 1]?.action : undefined;
  if (
    quiet.kind === "unsettled" &&
    quiet.waitedMs === CAP_MS &&
    youngest === "Heartbeat" &&
    station.waits.length < RUNAWAY_WAITS
  ) {
    pass("fresh unanswered CALLs for ever end the gate at the cap, as unsettled");
  } else {
    fail(
      "fresh unanswered CALLs for ever end the gate at the cap, as unsettled",
      `got ${JSON.stringify(quiet).slice(0, 200)}, ${station.waits.length} wait(s)`,
    );
  }
}

// ---------------------------------------------------------------------------
// 16. The cap binds nothing that fits under it.
// ---------------------------------------------------------------------------

{
  const clock = new FakeClock();
  // Two late CALLs: one at t=80s (first seen at t=90s, when the budget's
  // wait times out; window to t=115s), one at t=110s (first seen at t=115s;
  // window to t=140s). The last window ends under the 150s cap, so the gate
  // ages it out and answers `outstanding` at t=140s -- not `unsettled` at
  // the cap, and not before the window.
  const station = new FakeStation([...booted(), result(SN0)], clock, (_wait, turn) =>
    turn === 1
      ? { lines: [sent(HB, "Heartbeat")], ms: 80_000 }
      : turn === 2
        ? { lines: [sent(RESET, "Heartbeat")], ms: 20_000 }
        : "silence",
  );
  const quiet = await awaitBootQuiet(station, { timeoutMs: BUDGET_MS, staleAfterMs: STALE_MS, hardCapMs: CAP_MS, clock });
  const timeouts = station.waits.map((w) => w.timeoutMs);
  if (
    quiet.kind === "outstanding" &&
    quiet.waitedMs === 140_000 &&
    JSON.stringify(timeouts) === JSON.stringify([BUDGET_MS, STALE_MS, STALE_MS])
  ) {
    pass("a late CALL whose window ends under the cap is aged out and reported outstanding");
  } else {
    fail(
      "a late CALL whose window ends under the cap is aged out and reported outstanding",
      `got ${JSON.stringify(quiet).slice(0, 200)}, waits ${JSON.stringify(timeouts)}`,
    );
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} failure(s)\n`);
  process.exit(1);
}
process.stderr.write("boot quiet: OK\n");
