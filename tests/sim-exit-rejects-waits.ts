// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/sim-exit-rejects-waits.ts -- a simulator that has exited is not one
 * that is slow to answer.
 *
 * PROPERTY, in five parts:
 *   1. a `call()` pending when the simulator's stdout closes is rejected as
 *      soon as the exit code is known -- not when its timeout runs out -- and
 *      the rejection names the exit code, what was being waited for, and the
 *      simulator's recent stderr, which is where `docker run` writes why;
 *   2. a wait armed AFTER the close is refused on the spot, with the same
 *      information, rather than parked until its timeout;
 *   3. a response that was already in the buffered output when the close
 *      arrived still resolves its call -- the close drains before it rejects,
 *      so an answer the CLI managed to write on its way out is not lost;
 *   4. an exit code that never arrives is waited for only as long as the exit
 *      grace, after which the rejection says the code is unknown;
 *   5. the control: while stdout stays open, the same call is rejected by its
 *      TIMEOUT and by nothing else. This is what tells rows 1 and 2 from a
 *      pump that rejects everything -- the two failure messages are different
 *      sentences, and the guard reads them.
 *
 * WHY. The first call `startSim` makes is a `status` probe with a 120s budget,
 * because on a runner that has never seen the image the pull happens between
 * `docker run` returning and the CLI's first read of stdin. Until this held, a
 * `docker run` that failed in its first second -- a tag the registry does not
 * have, a CLI that crashed on start -- left that probe parked for the whole
 * budget and every later wait for its own: 120 seconds of "timed out" for a
 * container that had said "not found" in the first one. Measured live against
 * a tag that does not exist: 120s before, 2s after.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. The rule lives in the pump
 * `startSim` builds over its `Bun.spawn` result, and reaching it from the CLI
 * means a docker daemon and an image chosen to fail -- a network-dependent
 * test of a property that is entirely about two streams closing. So the pump
 * takes its streams: `attachSimStreams` reads a `SimIo`, `startSim` hands it
 * the process, and this guard hands it `ReadableStream`s it closes itself, an
 * exit it resolves itself, and a grace it shortens. Every row here is
 * deterministic, offline, and finishes in well under a second.
 */

import { attachSimStreams } from "../tck/sim";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

function pass(what: string): void {
  process.stderr.write(`ok: ${what}\n`);
}

const encoder = new TextEncoder();

/** A stream the guard feeds and closes by hand. */
function stream(): {
  readable: ReadableStream<Uint8Array>;
  write(text: string): void;
  close(): void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    readable,
    write: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

/** A stream already closed, with `text` in it. */
function closedStream(text = ""): ReadableStream<Uint8Array> {
  const s = stream();
  if (text) s.write(text);
  s.close();
  return s.readable;
}

/** Resolves with the settled outcome and the time it took. */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ outcome: "resolved" | "rejected"; value?: T; message: string; ms: number }> {
  const started = performance.now();
  try {
    const value = await promise;
    return { outcome: "resolved", value, message: "", ms: performance.now() - started };
  } catch (err) {
    return {
      outcome: "rejected",
      message: err instanceof Error ? err.message : String(err),
      ms: performance.now() - started,
    };
  }
}

/** "Promptly" is under a second -- generous for CI -- against a budget three
 *  times that. The budget is deliberately SHORT rather than startSim's 120s:
 *  a row that fails by falling through to its timeout must fail in seconds, or
 *  a red guard reads as a hung one. */
const PROMPT_MS = 1_000;
const CALL_BUDGET_MS = 3_000;

// ---------------------------------------------------------------------------
// 1. A pending call is rejected when stdout closes, naming exit code and stderr.
// ---------------------------------------------------------------------------

{
  const stdout = stream();
  let exit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => (exit = resolve));
  const streams = attachSimStreams({
    container: "simts-guard",
    stdout: stdout.readable,
    stderr: closedStream(
      'docker: Error response from daemon: failed to resolve reference "ghcr.io/x:nope": not found\n',
    ),
    exited,
    write: async () => {},
  });
  const call = settle(streams.call("status", undefined, CALL_BUDGET_MS));
  // Give the write a tick, then the container dies before answering.
  await new Promise((r) => setTimeout(r, 10));
  stdout.close();
  exit(125);
  const got = await call;
  if (
    got.outcome === "rejected" &&
    got.ms < PROMPT_MS &&
    got.message.includes("exit code 125") &&
    got.message.includes("the response to status") &&
    got.message.includes("not found")
  ) {
    pass(`a pending call is rejected on exit, promptly (${got.ms.toFixed(0)}ms), naming the exit code, the wait and stderr`);
  } else {
    fail(
      "a pending call is rejected on exit with the exit code and stderr",
      `${got.outcome} after ${got.ms.toFixed(0)}ms: ${got.message || JSON.stringify(got.value)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. A wait armed after the close is refused on the spot.
// ---------------------------------------------------------------------------

{
  const streams = attachSimStreams({
    container: "simts-guard",
    stdout: closedStream(),
    stderr: closedStream("bun: command not found\n"),
    exited: Promise.resolve(127),
    write: async () => {},
  });
  await streams.drained;
  await new Promise((r) => setTimeout(r, 10));
  const got = await settle(streams.waitForLine(/"event":"scenario_started"/, CALL_BUDGET_MS));
  if (
    got.outcome === "rejected" &&
    got.ms < PROMPT_MS &&
    got.message.includes("exit code 127") &&
    got.message.includes("command not found")
  ) {
    pass(`a wait armed after the exit is refused on the spot (${got.ms.toFixed(0)}ms)`);
  } else {
    fail("a wait armed after the exit is refused on the spot", `${got.outcome} after ${got.ms.toFixed(0)}ms: ${got.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. A response already buffered at the close still resolves its call.
// ---------------------------------------------------------------------------

{
  const stdout = stream();
  const streams = attachSimStreams({
    container: "simts-guard",
    stdout: stdout.readable,
    stderr: closedStream(),
    exited: Promise.resolve(0),
    write: async () => {},
  });
  const call = settle(streams.call("status", undefined, CALL_BUDGET_MS));
  await new Promise((r) => setTimeout(r, 10));
  // The CLI answers and exits in one breath: response, then EOF.
  stdout.write('{"id":"tck-1","ok":true,"data":{"status":"Unavailable"}}\n');
  stdout.close();
  const got = await call;
  if (got.outcome === "resolved" && JSON.stringify(got.value) === '{"status":"Unavailable"}') {
    pass("a response buffered before the close still resolves its call");
  } else {
    fail("a response buffered before the close still resolves its call", `${got.outcome}: ${got.message || JSON.stringify(got.value)}`);
  }
}

// ---------------------------------------------------------------------------
// 4. An exit code that never comes is waited for only as long as the grace.
// ---------------------------------------------------------------------------

{
  const stdout = stream();
  const streams = attachSimStreams({
    container: "simts-guard",
    stdout: stdout.readable,
    stderr: closedStream(),
    exited: new Promise<number | null>(() => {}),
    write: async () => {},
    exitGraceMs: 50,
  });
  const call = settle(streams.call("status", undefined, CALL_BUDGET_MS));
  await new Promise((r) => setTimeout(r, 10));
  stdout.close();
  const got = await call;
  if (got.outcome === "rejected" && got.ms < PROMPT_MS && got.message.includes("exit code unknown")) {
    pass(`an exit that never reports its code is given the grace and no more (${got.ms.toFixed(0)}ms)`);
  } else {
    fail("an exit that never reports its code is given the grace and no more", `${got.outcome} after ${got.ms.toFixed(0)}ms: ${got.message}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Control: with stdout open, the timeout is the only thing that rejects.
// ---------------------------------------------------------------------------

{
  const stdout = stream();
  const streams = attachSimStreams({
    container: "simts-guard",
    stdout: stdout.readable,
    stderr: closedStream(),
    exited: new Promise<number | null>(() => {}),
    write: async () => {},
  });
  const got = await settle(streams.call("status", undefined, 50));
  if (got.outcome === "rejected" && got.message.startsWith("timed out after 50ms") && !got.message.includes("exited")) {
    pass("control: an open stdout leaves the timeout as the only rejection");
  } else {
    fail(
      "control: an open stdout leaves the timeout as the only rejection",
      `${got.outcome}: ${got.message} -- if this says 'exited', the pump rejects regardless of the close and rows 1-2 measure nothing`,
    );
  }
  stdout.close();
}

if (failures > 0) {
  process.stderr.write(`\n${failures} failure(s)\n`);
  process.exit(1);
}
process.stderr.write("simulator exit rejects its waits: OK\n");
