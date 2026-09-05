// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/csms-readiness-gate.ts -- what the preflight readiness gate waits on,
 * what it refuses, and what it lets past.
 *
 * PROPERTY, in five parts:
 *   1. a probe that answers ends the gate on its first attempt, with no pause,
 *      whatever budget it was given -- the gate costs one round trip on a CSMS
 *      that is up, which is the only state CI is ever in;
 *   2. `CsmsNotDispatchedError` is the one rejection the gate WAITS on: it
 *      keeps asking across the budget and reports ready as soon as an attempt
 *      answers;
 *   3. every other rejection -- a declined method, a `create()` that throws for
 *      want of a credential, a plain `Error` -- ends the gate as `unavailable`
 *      on the FIRST attempt, spending none of the budget;
 *   4. a budget that runs out with the CSMS still not answering reports
 *      `no-answer`, which is the runner's refusal -- it does not fall through
 *      to a run;
 *   5. a probe that never settles is abandoned at the deadline and reported,
 *      rather than becoming a runner that never returns.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD, and it is the same split
 * `tck/standing.ts` and `classifyForeignSims` are. Every row above needs a
 * CSMS engineered a chosen way: one that accepts a connection and never
 * answers, one whose driver declines a core method, one whose probe hangs for
 * good. Not one is a state either bundled CSMS can be asked for, and reaching
 * even the ordinary rows through the CLI means starting a sweep -- so a shell
 * version of this guard would cost a container and a misconfiguration per row,
 * on the daemon this repository's own sweeps share. `awaitCsmsReady` takes its
 * probe and its clock as arguments for exactly this; what is left in the runner
 * is `Date.now`, `setTimeout` and one call into the driver contract.
 *
 * WHY PARTS 3 AND 5 ARE THE ONES WORTH HAVING. Part 3 is the direction that
 * fails silently: a gate that waited on every rejection would spend the whole
 * budget on a driver that was never going to answer -- 150 seconds of nothing,
 * per run, looking exactly like a slow CSMS. Part 5 is the direction that
 * fails loudly and is unreachable by reading: a probe whose client has no
 * timeout of its own turns a preflight into a hang, and the bound the gate
 * advertises is only real if losing the race is a reported outcome rather than
 * an abandoned promise nobody reads.
 *
 * Offline: no clock, no timers, no network. The clock is a fake whose `pause`
 * advances a counter and whose `deadline` fires only where a row asks it to.
 */
import {
  CsmsNotDispatchedError,
  UnsupportedOperationError,
} from "../tck/driver";
import { awaitCsmsReady, type ReadinessClock } from "../tck/readiness";

/**
 * A clock with no time in it.
 *
 * `deadline` returns a promise that never settles unless the row asks for it,
 * which is what makes every non-deadline row deterministic: the race has
 * exactly one settleable side. Keying a single fake timer on its millisecond
 * argument instead would collide on the last attempt of any budget that is a
 * whole multiple of the interval, which is most of them.
 */
function fakeClock(deadlineFires: boolean): ReadinessClock & {
  pauses: number[];
} {
  let elapsed = 0;
  const pauses: number[] = [];
  return {
    pauses,
    now: () => elapsed,
    pause: async (ms: number) => {
      pauses.push(ms);
      elapsed += ms;
    },
    deadline: (ms: number) =>
      deadlineFires ? Promise.resolve() : new Promise<void>(() => void ms),
  };
}

/** A probe that answers or throws according to a script, one entry per call. */
function scriptedProbe(script: readonly (unknown | "answers")[]) {
  let call = 0;
  return async (): Promise<unknown> => {
    // Past the end of the script the last entry repeats, so a row that never
    // succeeds does not have to spell the budget out.
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    if (step === "answers") return "";
    throw step;
  };
}

const notDispatched = new CsmsNotDispatchedError(
  "records.latestTransaction",
  "The operation timed out.",
);
const declined = new UnsupportedOperationError(
  "records.latestTransaction",
  "this driver reads no transactions",
);
const noCredential = new Error("SOME_TOKEN is unset");

interface Case {
  name: string;
  probe: () => Promise<unknown>;
  timeoutMs: number;
  intervalMs: number;
  deadlineFires: boolean;
  kind: "ready" | "unavailable" | "no-answer";
  attempts: number;
  pauses: number;
}

const cases: Case[] = [
  {
    // Part 1. A budget three orders of magnitude larger than the interval, to
    // make it visible that none of it is spent.
    name: "a CSMS that answers costs one round trip and no wait",
    probe: scriptedProbe(["answers"]),
    timeoutMs: 150_000,
    intervalMs: 5_000,
    deadlineFires: false,
    kind: "ready",
    attempts: 1,
    pauses: 0,
  },
  {
    // Part 2. Two refusals, then an answer: the state a CSMS mid-boot is
    // actually in, and the one the gate exists to sit through.
    name: "a CSMS that is not answering yet is waited for, then run against",
    probe: scriptedProbe([notDispatched, notDispatched, "answers"]),
    timeoutMs: 30_000,
    intervalMs: 1_000,
    deadlineFires: false,
    kind: "ready",
    attempts: 3,
    pauses: 2,
  },
  {
    // Part 3, and the row that keeps the gate from being a contract change: a
    // driver is entitled to decline a method.
    name: "a driver that declines the probe is unavailable, not late",
    probe: scriptedProbe([declined]),
    timeoutMs: 30_000,
    intervalMs: 1_000,
    deadlineFires: false,
    kind: "unavailable",
    attempts: 1,
    pauses: 0,
  },
  {
    // Part 3 again, and the case that reaches the gate first in practice:
    // `create()` may demand a credential, and the scope table is reviewable
    // offline only because the preflight has never needed one.
    name: "a driver whose create() throws is unavailable on the first attempt",
    probe: scriptedProbe([noCredential]),
    timeoutMs: 30_000,
    intervalMs: 1_000,
    deadlineFires: false,
    kind: "unavailable",
    attempts: 1,
    pauses: 0,
  },
  {
    // Part 4. Five attempts fit in five seconds at a one-second interval: the
    // fifth starts with the budget spent, so it is the last.
    name: "a budget that runs out refuses instead of running",
    probe: scriptedProbe([notDispatched]),
    timeoutMs: 5_000,
    intervalMs: 1_000,
    deadlineFires: false,
    kind: "no-answer",
    attempts: 5,
    pauses: 4,
  },
  {
    // Part 5. A probe with no timeout of its own -- which the contract does
    // not require a driver to have -- against a deadline that fires.
    name: "a probe that never settles is abandoned, not awaited forever",
    probe: () => new Promise<unknown>(() => {}),
    timeoutMs: 150_000,
    intervalMs: 5_000,
    deadlineFires: true,
    kind: "no-answer",
    attempts: 1,
    pauses: 0,
  },
];

let failures = 0;
for (const row of cases) {
  const clock = fakeClock(row.deadlineFires);
  const got = await awaitCsmsReady(row.probe, {
    timeoutMs: row.timeoutMs,
    intervalMs: row.intervalMs,
    clock,
  });
  if (
    got.kind === row.kind &&
    got.attempts === row.attempts &&
    clock.pauses.length === row.pauses
  ) {
    continue;
  }
  failures++;
  process.stderr.write(
    `FAIL: ${row.name}\n` +
      `  expected ${row.kind} after ${row.attempts} attempt(s) and ` +
      `${row.pauses} pause(s)\n` +
      `  got      ${got.kind} after ${got.attempts} attempt(s) and ` +
      `${clock.pauses.length} pause(s)` +
      (got.detail ? ` -- ${got.detail}` : "") +
      "\n",
  );
}

if (failures > 0) {
  process.stderr.write(
    `\nthe readiness gate no longer decides what its header claims ` +
      `(${failures}/${cases.length} rows wrong). Read it: the two directions ` +
      `that cost something are a gate that waits on a rejection waiting ` +
      `cannot fix -- 150 seconds of nothing, per run, wearing a slow CSMS's ` +
      `clothes -- and a bound that is advertised and not kept.\n`,
  );
  process.exit(1);
}

process.stdout.write(`awaitCsmsReady: ${cases.length} rows OK\n`);
