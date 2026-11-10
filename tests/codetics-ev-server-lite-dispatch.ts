// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * codetics-ev-server-lite-dispatch.ts -- when the ev-server-lite driver says a
 * request never became an OCPP CALL, and when its one login is spent.
 *
 * `warnOpFailed` warns and continues on every error but
 * `CsmsNotDispatchedError`, which it lets out so the scenario ERRORs. This
 * driver queues every operation through one endpoint and then polls the
 * command's state, so the line runs through a STATE TABLE rather than through
 * HTTP statuses alone: the POST can be refused (nothing queued), accepted and
 * then never sent, accepted and sent, or accepted and then lost from view. Only
 * the first two are the class's claim. The fourth is the one the driver used to
 * get wrong: a poll read that failed after the server had queued the command was
 * reported as a non-dispatch, for a command the server would go on to send.
 *
 * The login is the other half, because it is the one call the server rate
 * counts: ten signins per account per fifteen minutes, in its database. The
 * session is cached per process, and a cached FAILURE is the dangerous half --
 * every later lane and scenario inherits it.
 *
 * PROPERTY, in 6 parts:
 *  1. The command states, both directions. SENT, SUCCEEDED and FAILED with a
 *     result are dispatched and resolve. FAILED with no result, TIMED_OUT,
 *     CANCELLED and QUEUED past the wait are `CsmsNotDispatchedError`. A state
 *     the driver does not know is a plain `Error`.
 *  2. The POST itself. A `fetch` that rejects and a non-2xx are non-dispatches
 *     -- nothing was queued. A 2xx without a command id is a plain `Error`:
 *     the server answered, and what it queued is unknown.
 *  3. AFTER AN ACCEPTED POST, A READ FAILURE IS NOT A NON-DISPATCH. A poll that
 *     fails once and then sees SENT resolves; one that keeps failing (a 5xx, a
 *     rejected `fetch`, a body that is not a list) ends in a plain `Error` that
 *     names the command; a command the list never shows is a plain `Error` too.
 *  4. Concurrent callers share one login: three clients, one csrf read, one
 *     signin.
 *  5. Every login failure but a kept signin refusal is forgotten, and the next
 *     call logs in again: the csrf read refused by transport, by a 5xx or
 *     answered without a token; the signin refused by transport, by a 5xx or
 *     answered 2xx without a token. The csrf read is never counted; a signin
 *     5xx is, and is retried anyway as the server's transient fault.
 *  6. A signin refused 401, 403 or 429 is kept: a retry would only get the
 *     same answer (and, for 401 and 429, spend budget). The next call makes no
 *     request at all, and the message says the process will not retry -- a
 *     message a 5xx must not carry, because the process will.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. Every row needs the server to
 * answer a chosen way at a chosen moment -- a poll that fails once, a signin
 * that 503s, a command that sits QUEUED -- and the pinned server produces none
 * of them on demand; a refused signin also spends a budget only a restart
 * gives back. So the client takes its `fetch`, the same seam
 * `citrineos-transport-classification.ts` rides, and each row is a closure.
 *
 * Each row gets its own server URL because the session cache is module-level
 * and keyed by server and account: a shared key would let one row's cached
 * refusal decide the next row's verdict.
 *
 * Offline: answers every request from a closure. Opens no socket, starts
 * nothing.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../tck/driver";
import { EvslApi } from "../drivers/codetics-ev-server-lite/api-client";
import { defaultEvslConfig, type EvslConfig } from "../drivers/codetics-ev-server-lite/config";
import { dispatch, toCommand } from "../drivers/codetics-ev-server-lite/requests";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

let rowSeq = 0;

/** A configuration no other row shares -- see the header. */
function freshConfig(): EvslConfig {
  rowSeq++;
  return defaultEvslConfig({ EVSL_URL: `http://evsl-row-${rowSeq}.test` });
}

type Classification = "dispatched" | "not-dispatched" | "plain-error";

function classify(err: unknown): Exclude<Classification, "dispatched"> | "not-an-error" {
  if (err instanceof CsmsNotDispatchedError) return "not-dispatched";
  if (err instanceof Error) return "plain-error";
  return "not-an-error";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// The fake server
// ---------------------------------------------------------------------------

type Handler = () => Response | Promise<Response>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

const CSRF_OK: Handler = () => json({ token: "csrf-1", headerName: "X-XSRF-TOKEN" });
const SIGNIN_OK: Handler = () => json({ token: "bearer-1" });
const REFUSED: Handler = () => Promise.reject(new TypeError("connect ECONNREFUSED"));

interface Server {
  readonly fetch: FetchLike;
  readonly count: { csrf: number; signin: number; post: number; poll: number };
}

/**
 * Routes by method and path. Each route is a queue of handlers; the last one
 * repeats, so `[fail, ok]` is "fails once, then answers".
 */
function server(routes: {
  csrf?: Handler[];
  signin?: Handler[];
  post?: Handler[];
  poll?: Handler[];
  other?: Handler[];
}): Server {
  const count = { csrf: 0, signin: 0, post: 0, poll: 0 };
  const take = (queue: Handler[] | undefined, n: number, fallback: Handler): Handler => {
    if (queue === undefined || queue.length === 0) return fallback;
    return queue[Math.min(n, queue.length - 1)]!;
  };
  const fetchImpl: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(input).pathname;
    if (method === "GET" && path === "/api/v1/auth/csrf") {
      return take(routes.csrf, count.csrf++, CSRF_OK)();
    }
    if (method === "POST" && path === "/api/v1/auth/app/signin") {
      return take(routes.signin, count.signin++, SIGNIN_OK)();
    }
    if (method === "POST" && /^\/api\/v1\/stations\/[^/]+\/commands$/.test(path)) {
      return take(routes.post, count.post++, () => json({ id: "cmd-1", state: "QUEUED" }))();
    }
    if (method === "GET" && path === "/api/v1/commands") {
      return take(routes.poll, count.poll++, () => json([]))();
    }
    return take(routes.other, 0, () => json([]))();
  };
  return { fetch: fetchImpl, count };
}

function row(state: string, result: unknown = null): Handler {
  return () =>
    json([
      { id: "someone-else", station_id: "CERTCP1", action: "Reset", state: "SENT", result: null },
      { id: "cmd-1", station_id: "CERTCP1", action: "Reset", state, result },
    ]);
}

// ---------------------------------------------------------------------------
// Parts 1-3: dispatch
// ---------------------------------------------------------------------------

interface DispatchCase {
  readonly what: string;
  readonly routes: Parameters<typeof server>[0];
  readonly expect: Classification;
  /** Substrings the message must carry. */
  readonly carries?: readonly string[];
  /** The wait. Small, because the poll runs on the real clock. */
  readonly timeoutMs?: number;
}

const COMMAND = toCommand({ action: "Reset", type: "Soft" });

async function checkDispatch(part: string, kase: DispatchCase): Promise<void> {
  const what = `${part}: ${kase.what}`;
  const srv = server(kase.routes);
  const api = new EvslApi(freshConfig(), srv.fetch);
  let outcome: Classification | "not-an-error";
  let err: unknown;
  try {
    await dispatch(api, "CERTCP1", COMMAND, kase.timeoutMs ?? 400);
    outcome = "dispatched";
  } catch (e) {
    err = e;
    outcome = classify(e);
  }
  if (outcome !== kase.expect) {
    fail(what, `expected ${kase.expect}, got ${outcome}${err ? ` (${message(err)})` : ""}`);
    return;
  }
  for (const s of kase.carries ?? []) {
    if (!message(err).includes(s)) {
      fail(what, `message lacks ${JSON.stringify(s)}: ${message(err)}`);
    }
  }
}

// Part 1: the state table, both directions.
const STATE_CASES: DispatchCase[] = [
  { what: "SENT", routes: { poll: [row("SENT")] }, expect: "dispatched" },
  { what: "SUCCEEDED", routes: { poll: [row("SUCCEEDED", { status: "Accepted" })] }, expect: "dispatched" },
  {
    what: "FAILED with the station's CALLERROR as result",
    routes: { poll: [row("FAILED", [4, "cmd-1", "NotImplemented", "", {}])] },
    expect: "dispatched",
  },
  { what: "QUEUED, then SENT", routes: { poll: [row("QUEUED"), row("SENT")] }, expect: "dispatched" },
  {
    what: "FAILED with no result",
    routes: { poll: [row("FAILED", null)] },
    expect: "not-dispatched",
    carries: ["command cmd-1", "FAILED with no result"],
  },
  {
    what: "TIMED_OUT",
    routes: { poll: [row("TIMED_OUT")] },
    expect: "not-dispatched",
    carries: ["command cmd-1", "TIMED_OUT"],
  },
  {
    what: "CANCELLED",
    routes: { poll: [row("CANCELLED")] },
    expect: "not-dispatched",
    carries: ["command cmd-1", "CANCELLED"],
  },
  {
    what: "QUEUED past the wait",
    routes: { poll: [row("QUEUED")] },
    expect: "not-dispatched",
    carries: ["command cmd-1", "still QUEUED"],
  },
  {
    what: "a state the driver does not know",
    routes: { poll: [row("PAUSED")] },
    expect: "plain-error",
    carries: ["PAUSED"],
  },
];
for (const kase of STATE_CASES) await checkDispatch("part 1", kase);

// Part 2: the POST.
const POST_CASES: DispatchCase[] = [
  {
    what: "a POST whose fetch rejects",
    routes: { post: [REFUSED] },
    expect: "not-dispatched",
    carries: ["/commands", "ECONNREFUSED"],
  },
  {
    what: "a POST refused 400",
    routes: { post: [() => json({ message: "payload invalide" }, 400)] },
    expect: "not-dispatched",
    carries: ["returned 400", "payload invalide"],
  },
  {
    what: "a POST refused 503",
    routes: { post: [() => new Response("down", { status: 503 })] },
    expect: "not-dispatched",
    carries: ["returned 503"],
  },
  {
    what: "a POST answered 200 without a command id",
    routes: { post: [() => json({ state: "QUEUED" })] },
    expect: "plain-error",
    carries: ["without a command id"],
  },
];
for (const kase of POST_CASES) await checkDispatch("part 2", kase);

// Part 3: the POST was accepted; what follows is a read, not a dispatch.
const READ_CASES: DispatchCase[] = [
  {
    what: "a poll refused 503 once, then SENT",
    routes: { poll: [() => new Response("busy", { status: 503 }), row("SENT")] },
    expect: "dispatched",
  },
  {
    what: "a poll whose fetch rejects once, then SENT",
    routes: { poll: [REFUSED, row("SENT")] },
    expect: "dispatched",
  },
  {
    what: "a poll refused 503 for the whole wait",
    routes: { poll: [() => new Response("busy", { status: 503 })] },
    expect: "plain-error",
    carries: ["command cmd-1", "returned 503"],
  },
  {
    what: "a poll whose fetch rejects for the whole wait",
    routes: { poll: [REFUSED] },
    expect: "plain-error",
    carries: ["command cmd-1", "ECONNREFUSED"],
  },
  {
    what: "a poll answered with something that is not a list",
    routes: { poll: [() => json({ content: [] })] },
    expect: "plain-error",
    carries: ["command cmd-1"],
  },
  {
    what: "a QUEUED command whose later reads fail",
    routes: { poll: [row("QUEUED"), () => new Response("busy", { status: 503 })] },
    expect: "plain-error",
    carries: ["command cmd-1", "returned 503"],
  },
  {
    what: "a command the list never shows",
    routes: { poll: [() => json([])] },
    expect: "plain-error",
    carries: ["command cmd-1", "last 100 commands"],
  },
];
for (const kase of READ_CASES) await checkDispatch("part 3", kase);

// ---------------------------------------------------------------------------
// Parts 4-6: the login
// ---------------------------------------------------------------------------

/** One authenticated read, which is the cheapest way to reach the login. */
function read(api: EvslApi): Promise<unknown> {
  return api.get("/api/v1/stations");
}

async function outcomeOf(p: Promise<unknown>): Promise<{ ok: boolean; err?: unknown }> {
  try {
    await p;
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

// Part 4: three clients, one login.
{
  const what = "part 4: three concurrent clients";
  const cfg = freshConfig();
  const srv = server({});
  const results = await Promise.all(
    [0, 1, 2].map(() => outcomeOf(read(new EvslApi(cfg, srv.fetch)))),
  );
  if (!results.every((r) => r.ok)) {
    fail(what, `expected all three to succeed: ${results.map((r) => message(r.err)).join("; ")}`);
  }
  if (srv.count.csrf !== 1 || srv.count.signin !== 1) {
    fail(what, `expected one csrf read and one signin, got ${srv.count.csrf} and ${srv.count.signin}`);
  }
}

// Part 5: a failure the server did not count is forgotten.
interface RetryCase {
  readonly what: string;
  readonly routes: Parameters<typeof server>[0];
  /** Signins the server should have seen after the second call. */
  readonly signins: number;
  /** Substrings the FIRST failure's message must NOT carry. */
  readonly omits?: readonly string[];
}

const RETRY_CASES: RetryCase[] = [
  { what: "csrf read whose fetch rejects", routes: { csrf: [REFUSED, CSRF_OK] }, signins: 1 },
  {
    what: "csrf read refused 503",
    routes: { csrf: [() => new Response("booting", { status: 503 }), CSRF_OK] },
    signins: 1,
  },
  { what: "csrf read answered 200 without a token", routes: { csrf: [() => json({}), CSRF_OK] }, signins: 1 },
  { what: "signin whose fetch rejects", routes: { signin: [REFUSED, SIGNIN_OK] }, signins: 2 },
  {
    what: "signin refused 503",
    routes: { signin: [() => new Response("down", { status: 503 }), SIGNIN_OK] },
    signins: 2,
    omits: ["will not try again"],
  },
  {
    what: "signin answered 200 without a token",
    routes: { signin: [() => json({ user: {} }), SIGNIN_OK] },
    signins: 2,
  },
];

for (const kase of RETRY_CASES) {
  const what = `part 5: ${kase.what}`;
  const cfg = freshConfig();
  const srv = server(kase.routes);
  const first = await outcomeOf(read(new EvslApi(cfg, srv.fetch)));
  if (first.ok) {
    fail(what, "the first call was expected to fail");
    continue;
  }
  for (const s of kase.omits ?? []) {
    if (message(first.err).includes(s)) {
      fail(what, `the first failure claims ${JSON.stringify(s)}: ${message(first.err)}`);
    }
  }
  const second = await outcomeOf(read(new EvslApi(cfg, srv.fetch)));
  if (!second.ok) {
    fail(what, `the second call did not log in again: ${message(second.err)}`);
    continue;
  }
  if (srv.count.signin !== kase.signins) {
    fail(what, `expected ${kase.signins} signin(s), got ${srv.count.signin}`);
  }
}

// Part 6: a refusal the server counted is kept.
for (const status of [401, 403, 429]) {
  const what = `part 6: signin refused ${status}`;
  const cfg = freshConfig();
  const srv = server({ signin: [() => json({ message: "Identifiants incorrects." }, status), SIGNIN_OK] });
  const first = await outcomeOf(read(new EvslApi(cfg, srv.fetch)));
  const second = await outcomeOf(read(new EvslApi(cfg, srv.fetch)));
  if (first.ok || second.ok) {
    fail(what, "both calls were expected to fail");
    continue;
  }
  if (classify(first.err) !== "not-dispatched") {
    fail(what, `expected a non-dispatch, got ${classify(first.err)}: ${message(first.err)}`);
  }
  if (!message(first.err).includes("will not try again")) {
    fail(what, `the message does not say the process will not retry: ${message(first.err)}`);
  }
  if (srv.count.csrf !== 1 || srv.count.signin !== 1) {
    fail(what, `expected one csrf read and one signin, got ${srv.count.csrf} and ${srv.count.signin}`);
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). This guard holds two lines of the ev-server-lite ` +
      `driver: which failures say the charge point was never asked -- an ` +
      `accepted command whose state could not be read is not one -- and which ` +
      `login failures the process remembers. Remembering one the server did ` +
      `not count fails every later lane; forgetting one it did walks the ` +
      `account into its ten-per-fifteen-minutes lockout.\n`,
  );
  process.exit(1);
}
process.stdout.write("codetics-ev-server-lite dispatch and login: OK\n");
