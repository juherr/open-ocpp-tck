/**
 * tools/lib/ocpp-handshake.ts reads the status line a CSMS answers a
 * WebSocket upgrade with -- and the two live SteVe tools decide on it.
 *
 * WHY THIS IS A GUARD AND NOT A LIVE RUN. What it pins is how the probe reads
 * a TCP stream, and the cases that matter are ones a healthy CSMS on loopback
 * never produces on demand: a status line split across segments, a peer that
 * closes before answering. Both are ordinary on a real network, and both used
 * to be silent -- a split `101` read as status 0, i.e. as a refusal, which is
 * exactly the answer tools/steve-provisioned-reset.ts's control is looking
 * for, and a close left the promise pending until the run's own timeout. So
 * the guard plays the CSMS on a loopback socket and writes the bytes itself.
 *
 * THE CLAIMS:
 *   1. a status line in one segment is read (the control the others need);
 *   2. a status line split across segments, even inside `HTTP/1.1`, is read
 *      whole -- the segments are written with a pause and Nagle off, so they
 *      arrive apart;
 *   3. a peer that closes before a status line rejects, never hangs, and
 *      never resolves -- with nothing sent, and after half a line;
 *   4. a first line that is not an HTTP status line rejects rather than
 *      reading as status 0 -- and so does one longer than the probe's
 *      1024-byte maximum, terminated or not, even when it starts like one;
 *      a line of exactly the maximum is still read, its CRLF split or not;
 *   5. TLS is refused up front, in both functions, because the probe speaks
 *      plain TCP: a `wss:` endpoint would otherwise be dialled in clear on
 *      port 80, and an https manager URL would turn into that endpoint.
 */
import { createServer, type Socket } from "node:net";
import { handshakeStatus, onManagerHost } from "../tools/lib/ocpp-handshake";

let failures = 0;

function fail(what: string, detail: string): void {
  failures += 1;
  process.stderr.write(`FAIL: ${what}\n      ${detail}\n`);
}

function pass(what: string): void {
  process.stdout.write(`  ok: ${what}\n`);
}

/** A loopback "CSMS" that answers the first request with `answer`. */
async function csms(answer: (socket: Socket) => Promise<void>): Promise<{ url: string; close: () => void }> {
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    socket.once("data", () => void answer(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  return { url: `ws://127.0.0.1:${address.port}/ocpp`, close: () => server.close() };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes each segment on its own, with a pause, so they reach the probe apart. */
function segments(...parts: string[]): (socket: Socket) => Promise<void> {
  return async (socket) => {
    for (const part of parts) {
      socket.write(part);
      await pause(30);
    }
  };
}

type Outcome = { kind: "resolved"; status: number } | { kind: "rejected"; message: string } | { kind: "pending" };

/** The probe's outcome against `answer`, or `pending` if it has none after two seconds. */
async function probe(
  answer: (socket: Socket) => Promise<void>,
  dial: (url: string) => string = (url) => url,
): Promise<Outcome> {
  const server = await csms(answer);
  try {
    return await Promise.race([
      handshakeStatus(dial(server.url), "CP-1").then(
        (status): Outcome => ({ kind: "resolved", status }),
        (error: unknown): Outcome => ({ kind: "rejected", message: error instanceof Error ? error.message : String(error) }),
      ),
      pause(2_000).then((): Outcome => ({ kind: "pending" })),
    ]);
  } finally {
    server.close();
  }
}

function expectStatus(what: string, outcome: Outcome, status: number): void {
  if (outcome.kind === "resolved" && outcome.status === status) pass(what);
  else fail(what, `expected status ${status}, got ${JSON.stringify(outcome)}`);
}

function expectRejected(what: string, outcome: Outcome): void {
  if (outcome.kind === "rejected") pass(`${what} (${outcome.message})`);
  else fail(what, `expected a rejection, got ${JSON.stringify(outcome)}`);
}

const SWITCHING = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";

// 1. The control.
expectStatus("a status line in one segment", await probe(segments(SWITCHING)), 101);

// 2. Split status lines.
expectStatus(
  "a 101 split inside its status code",
  await probe(segments("HTTP/1.1 1", "01 Switching Protocols\r\n", "Upgrade: websocket\r\n\r\n")),
  101,
);
expectStatus(
  "a 404 split inside the protocol version",
  await probe(segments("HT", "TP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")),
  404,
);

// 3. A peer that closes first.
expectRejected("a close before any byte", await probe(async (socket) => void socket.end()));
expectRejected(
  "a close after half a status line",
  await probe(async (socket) => {
    socket.write("HTTP/1.1 1");
    await pause(30);
    socket.end();
  }),
);

// 4. Not HTTP at all.
expectRejected("a first line that is not an HTTP status line", await probe(segments("SSH-2.0-OpenSSH_9.6\r\n")));
const LIMIT = 1024;
const overlong = "HTTP/1.1 101 " + "x".repeat(LIMIT);
expectRejected("an over-long first line with no CRLF that starts like a status line", await probe(segments(overlong)));
expectRejected("an over-long status line whose CRLF arrives past the maximum", await probe(segments(`${overlong}\r\n\r\n`)));
const atLimit = "HTTP/1.1 101 " + "x".repeat(LIMIT - "HTTP/1.1 101 ".length);
expectStatus("a status line of exactly the maximum, its CRLF split", await probe(segments(`${atLimit}\r`, "\n\r\n")), 101);

// 5. TLS, refused up front.
// Dialled at a loopback port that WOULD answer 101 in clear, so only a refusal
// made before connecting can pass.
expectRejected("a wss: endpoint", await probe(segments(SWITCHING), (url) => url.replace(/^ws:/, "wss:")));
try {
  const derived = onManagerHost("ws://steve:8180/steve/websocket/CentralSystemService", "https://steve.example/steve/manager");
  fail("an https manager URL", `derived ${derived} instead of refusing`);
} catch (error) {
  pass(`an https manager URL (${error instanceof Error ? error.message : String(error)})`);
}
const derived = onManagerHost("ws://steve:8180/steve/websocket/CentralSystemService", "http://127.0.0.1:18257/steve/manager");
if (derived === "ws://127.0.0.1:18257/steve/websocket/CentralSystemService") pass("an http manager URL keeps the endpoint's path");
else fail("an http manager URL keeps the endpoint's path", `derived ${derived}`);
// The port is the manager's, including its absence: `host` assigned from a
// URL without a port keeps the endpoint's 8180.
const portless = onManagerHost("ws://steve:8180/steve/websocket/CentralSystemService", "http://steve.example/steve/manager");
if (portless === "ws://steve.example/steve/websocket/CentralSystemService") pass("a manager URL without a port means port 80");
else fail("a manager URL without a port means port 80", `derived ${portless}`);

if (failures > 0) {
  process.stderr.write(`\n${failures} handshake claim(s) do not hold.\n`);
  process.exit(1);
}
console.log("The handshake probe reads a status line however it is segmented, and never hangs on a close.");
