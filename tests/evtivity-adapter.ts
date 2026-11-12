// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * evtivity-adapter.ts -- what the EVtivity driver still owns on top of the
 * library it adapts: its own REST client's login, and the prepare hook's
 * reading of a leftover session it cannot end.
 *
 * The OPERATIONS are not here. `drivers/evtivity/index.ts` takes them from
 * `createEvtivityCsmsDriver` in `@ovarilo/csms-drivers`, and that library's
 * own `tests/evtivity-driver.ts` holds every line this guard used to hold
 * about them -- which command answers are non-dispatches (202, 404, 400, a
 * send failure's 502, a 504 nobody can place, a timeout), which are answers
 * (a 200 Rejected, a 502 CALLERROR, a 504 for an unanswered CALL, a 500), and
 * the 400 version mismatch that is a capability gap. Each of those rows was
 * checked by name against that file at 0.0.3 before it left this one.
 *
 * What the library does not export is its REST client, so records.ts,
 * provision.ts and the prepare hook ride a client of their own
 * (`drivers/evtivity/api-client.ts`), with a login cache of its own. Its rules
 * are the library's, and this guard holds them here because nothing upstream
 * runs this copy:
 *
 * PROPERTY, in 10 parts:
 *  1. ONE LOGIN PER PROCESS. Concurrent clients share one
 *     `POST /v1/auth/login`, and a token near its JWT `exp` (EVtivity's lives
 *     one hour) is replaced before use.
 *  2. A TOKEN OUTLIVED. A request answered 401 renews the session and is sent
 *     once more, only when the session is at least a minute old; a second 401
 *     is the request's answer, a non-dispatch like every refused REST call. A
 *     401 on a younger session renews nothing, so a 401 the server keeps
 *     sending costs at most one login a minute.
 *  3. WHICH LOGIN FAILURES ARE KEPT. A 401 (INVALID_CREDENTIALS -- each one
 *     counts toward the account's sign-in backoff), a 403 (an MFA policy the
 *     account cannot meet) and a 200 `{"mustResetPassword":true}` are kept: the
 *     next call makes no request, and the message says the process will not
 *     try again soon. A 429, a 5xx, a 2xx without a token and a `fetch` that
 *     rejects or times out are forgotten, and the next call logs in again.
 *     Kept or forgotten, every one is a `CsmsNotDispatchedError`, on every
 *     call it answers: nothing was asked of the server.
 *  4. A kept refusal expires after fifteen minutes.
 *  5. THE SESSION IS BOUND TO THE CREDENTIAL. Two clients of one server and
 *     account with different passwords do not share a session, and a refusal
 *     kept for one password does not block a corrected one.
 *  6. A LEFTOVER SESSION THE PREPARE HOOK CANNOT END IS NAMED. Ending a session
 *     an interrupted run left active answers 409 two ways: SESSION_NOT_ACTIVE
 *     (it ended since the list was read) is quiet; STATION_ONLINE
 *     (the station is connected, so the session stays, and its tag will be
 *     answered ConcurrentTx) warns with the cp id and the session. Any other
 *     refusal is a non-dispatch. Source: packages/api/src/routes/sessions.ts,
 *     `/sessions/:id/end`, at v0.1.51.
 *  9. AN ACCEPTED END IS WAITED FOR. The route only records and publishes the
 *     request; the OCPP server ends the session later, and ConcurrentTx keys
 *     on its status. So the hook polls the station's open sessions until
 *     every session it ended has left them -- and only those: one the CSMS
 *     refused is not waited for. Still active at the bound, it is named in
 *     one warning rather than thrown; a poll that fails is that read's
 *     failure, not a timeout.
 *  7. A 2XX WHOSE BODY CANNOT BE READ IS AN ERROR. Not an empty result, which
 *     a read would take for "no such record", and not a non-dispatch, since
 *     the server answered. A non-2xx answered so keeps its status-based
 *     outcome: an allowed status still returns null, another is still a
 *     non-dispatch.
 *  8. A LIVE READ IS NOT ANSWERED FROM THE RESPONSE CACHE. EVtivity replays a
 *     GET of `/v1/stations*` and `/v1/sessions*` for the same full URL, and
 *     an OCPP event clears none of it; so `latestTransaction`,
 *     `openSessions` and the stop reason see a change the station made since
 *     their previous read. The fake models that cache, keyed as upstream
 *     keys it; the cache itself is the guard's one assumption.
 * 10. AN EXACT ID PAST THE FIRST PAGE IS FOUND. Every list route's `search` is
 *     a substring match, so a station or tag can sit behind a full first page
 *     of near misses. The lookups of records.ts and provision.ts share one
 *     paged helper; the rows reach it through a station and a tag read and
 *     through `ensureStation`, which would otherwise create a station that
 *     exists.
 *
 * WHAT IT DOES NOT CLAIM. That the two caches -- this client's and the
 * library's -- are one: they are not, so a process logs in twice, and a wrong
 * password is refused twice. drivers/evtivity/README.md states the cost. Nor
 * that the charging-profile lookup index.ts hands the library is wired: the
 * factory builds its client with the global `fetch`, and reaching it offline
 * would mean patching that global or exporting the factory call, the two
 * seams capability-parity.ts already declined. The live SetChargingProfile
 * scenarios are its evidence.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. Every row needs the CSMS to
 * answer a chosen way -- a token refused mid-sweep, a login lockout, a
 * station still connected -- none of which the pinned stack produces on
 * demand, and the lockout spends the account's sign-in budget. So the client
 * takes its `fetch`, the seam `codetics-ev-server-lite-dispatch.ts` rides, and
 * each row is a closure.
 *
 * Each row gets its own API URL because the session cache is module-level and
 * keyed by server and account: a shared key would let one row's cached refusal
 * decide the next row's verdict.
 *
 * Offline: answers every request from a closure. Opens no socket, starts
 * nothing.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../tck/driver";
import { EvtivityApi } from "../drivers/evtivity/api-client";
import { defaultEvtivityConfig, type EvtivityConfig } from "../drivers/evtivity/config";
import { endLeftoverSessions, ensureStation } from "../drivers/evtivity/provision";
import { EvtivityRecords } from "../drivers/evtivity/records";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

let rowSeq = 0;

/** A configuration no other row shares -- see the header. */
function freshConfig(password?: string): EvtivityConfig {
  rowSeq++;
  return defaultEvtivityConfig({
    EVTIVITY_API_URL: `http://evtivity-row-${rowSeq}.test`,
    ...(password === undefined ? {} : { EVTIVITY_PASSWORD: password }),
  });
}

/** Another password on the same server and account as `cfg`. */
function withPassword(cfg: EvtivityConfig, password: string): EvtivityConfig {
  return { ...cfg, password };
}

type Classification = "not-dispatched" | "plain-error" | "not-an-error";

function classify(err: unknown): Classification {
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

/** A JWT whose payload carries `exp`, seconds from now. Unsigned: the client
 *  only reads the expiry, it never verifies. */
function jwt(expInSecs = 3600, n = 1): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: "HS256" })}.${part({ sub: `usr_${n}`, iat: now, exp: now + expInSecs })}.sig`;
}

const LOGIN_OK: Handler = () => json({ token: jwt(), user: { id: "usr_1" } });
const REFUSED: Handler = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
const ABORTED: Handler = () =>
  Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
const UNAUTHORIZED: Handler = () => json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
const READ_OK: Handler = () => json({ data: [], total: 0 });
const INVALID_CREDENTIALS: Handler = () =>
  json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" }, 401);

interface Server {
  readonly fetch: FetchLike;
  readonly count: { login: number; read: number };
  /** The authorization header of every read, in order. */
  readonly authorizations: (string | null)[];
}

interface Routes {
  login?: Handler[];
  read?: Handler[];
}

/**
 * Login on `POST /v1/auth/login`, every other request is "a read". Each route
 * is a queue of handlers; the last one repeats, so `[fail, ok]` is "fails
 * once, then answers".
 */
function server(routes: Routes): Server {
  const count = { login: 0, read: 0 };
  const authorizations: (string | null)[] = [];
  const take = (queue: Handler[] | undefined, n: number, fallback: Handler): Handler => {
    if (queue === undefined || queue.length === 0) return fallback;
    return queue[Math.min(n, queue.length - 1)]!;
  };
  const fetchImpl: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    if (init?.method === "POST" && path === "/v1/auth/login") {
      return take(routes.login, count.login++, LOGIN_OK)();
    }
    authorizations.push(new Headers(init?.headers).get("authorization"));
    return take(routes.read, count.read++, READ_OK)();
  };
  return { fetch: fetchImpl, count, authorizations };
}

/** One authenticated REST read, the shape records.ts and provision.ts use. */
function read(cfg: EvtivityConfig, srv: Server): Promise<unknown> {
  return new EvtivityApi(cfg, srv.fetch).get("/v1/stations?search=CERTCP1");
}

async function outcomeOf(p: Promise<unknown>): Promise<{ ok: boolean; err?: unknown }> {
  try {
    await p;
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

/** Runs `body` with `Date.now` moved by whatever `body` sets through `move`. */
async function withClock(body: (move: (ms: number) => void) => Promise<void>): Promise<void> {
  const realNow = Date.now;
  let offsetMs = 0;
  Date.now = () => realNow() + offsetMs;
  try {
    await body((ms) => {
      offsetMs = ms;
    });
  } finally {
    Date.now = realNow;
  }
}

// ---------------------------------------------------------------------------
// Part 1: one login, renewed when it runs out
// ---------------------------------------------------------------------------

{
  const what = "part 1: three concurrent clients";
  const cfg = freshConfig();
  const srv = server({});
  const results = await Promise.all([0, 1, 2].map(() => outcomeOf(read(cfg, srv))));
  if (!results.every((r) => r.ok)) {
    fail(what, `expected all three to succeed: ${results.map((r) => message(r.err)).join("; ")}`);
  }
  if (srv.count.login !== 1) fail(what, `expected one login, got ${srv.count.login}`);
}
{
  const what = "part 1: a token about to expire is replaced before use";
  const cfg = freshConfig();
  const srv = server({
    login: [() => json({ token: jwt(30, 1) }), () => json({ token: jwt(3600, 2) })],
  });
  const first = await outcomeOf(read(cfg, srv));
  const second = await outcomeOf(read(cfg, srv));
  if (!first.ok || !second.ok) {
    fail(what, `expected both to succeed: ${message(first.err)} / ${message(second.err)}`);
  }
  if (srv.count.login !== 2) fail(what, `expected two logins, got ${srv.count.login}`);
}

// ---------------------------------------------------------------------------
// Part 2: a token the server stopped honouring
// ---------------------------------------------------------------------------

await withClock(async (move) => {
  const what = "part 2: a read answered 401 once the session is a minute old";
  const cfg = freshConfig();
  const srv = server({
    login: [() => json({ token: jwt(3600, 1) }), () => json({ token: jwt(3600, 2) })],
    read: [READ_OK, UNAUTHORIZED, READ_OK],
  });
  const first = await outcomeOf(read(cfg, srv));
  move(60_000);
  const second = await outcomeOf(read(cfg, srv));
  if (!first.ok || !second.ok) {
    fail(what, `expected a fresh login and a resent read: ${message(first.err)} / ${message(second.err)}`);
  }
  if (srv.count.login !== 2 || srv.count.read !== 3) {
    fail(what, `expected 2 logins and 3 reads, got ${srv.count.login} and ${srv.count.read}`);
  }
  if (srv.authorizations[2] === srv.authorizations[1]) {
    fail(what, "the resent read must carry the new token");
  }
});
await withClock(async (move) => {
  const what = "part 2: a read answered 401 twice";
  const cfg = freshConfig();
  const srv = server({ read: [READ_OK, UNAUTHORIZED] });
  await outcomeOf(read(cfg, srv));
  move(60_000);
  const result = await outcomeOf(read(cfg, srv));
  if (result.ok || classify(result.err) !== "not-dispatched") {
    fail(what, `expected a non-dispatch, got ${result.ok ? "success" : classify(result.err)}`);
  }
  if (srv.count.login !== 2 || srv.count.read !== 3) {
    fail(what, `expected one retry, got ${srv.count.login} logins and ${srv.count.read} reads`);
  }
});
{
  const what = "part 2: a 401 on a session younger than a minute renews nothing";
  const cfg = freshConfig();
  const srv = server({ read: [UNAUTHORIZED] });
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await outcomeOf(read(cfg, srv)));
  if (!results.every((r) => !r.ok && classify(r.err) === "not-dispatched")) {
    fail(
      what,
      `expected three non-dispatches, got ${results.map((r) => (r.ok ? "success" : classify(r.err))).join(", ")}`,
    );
  }
  if (srv.count.login !== 1 || srv.count.read !== 3) {
    fail(what, `expected 1 login over 3 reads, got ${srv.count.login} and ${srv.count.read}`);
  }
}

// ---------------------------------------------------------------------------
// Part 3: kept and forgotten login failures
// ---------------------------------------------------------------------------

/** Two clients of one fresh configuration in turn: the second sees whatever
 *  the first left in the session cache. */
async function twoReads(routes: Routes) {
  const cfg = freshConfig();
  const srv = server(routes);
  const first = await outcomeOf(read(cfg, srv));
  const second = await outcomeOf(read(cfg, srv));
  return { first, second, srv };
}

const FORGOTTEN: { what: string; handler: Handler }[] = [
  { what: "login whose fetch rejects", handler: REFUSED },
  { what: "login aborted by its own timeout", handler: ABORTED },
  { what: "login refused 429", handler: () => json({ error: "Too Many Requests" }, 429) },
  { what: "login refused 503", handler: () => new Response("down", { status: 503 }) },
  { what: "login answered 200 without a token", handler: () => json({ user: {} }) },
];
for (const { what: name, handler } of FORGOTTEN) {
  const what = `part 3: ${name} is forgotten`;
  const { first, second, srv } = await twoReads({ login: [handler, LOGIN_OK] });
  if (first.ok) {
    fail(what, "the first call was expected to fail");
    continue;
  }
  // Nothing was asked of the server, so the scenario must ERROR rather than
  // assert.
  if (classify(first.err) !== "not-dispatched") {
    fail(what, `expected a non-dispatch, got ${classify(first.err)} (${message(first.err)})`);
  }
  if (message(first.err).includes("will not try again")) {
    fail(what, `the first failure claims it will not retry: ${message(first.err)}`);
  }
  if (!second.ok) fail(what, `the second call did not log in again: ${message(second.err)}`);
  if (srv.count.login !== 2) fail(what, `expected 2 logins, got ${srv.count.login}`);
}

const KEPT: { what: string; handler: Handler }[] = [
  { what: "login refused 401", handler: INVALID_CREDENTIALS },
  {
    what: "login refused 403",
    handler: () => json({ error: "Required MFA cannot be set up", code: "MFA_SETUP_UNAVAILABLE" }, 403),
  },
  { what: "login answered mustResetPassword", handler: () => json({ mustResetPassword: true }) },
];
for (const { what: name, handler } of KEPT) {
  const what = `part 3: ${name} is kept`;
  const { first, second, srv } = await twoReads({ login: [handler, LOGIN_OK] });
  if (first.ok || second.ok) {
    fail(what, "both calls were expected to fail");
    continue;
  }
  // Neither call reached the server: the kept refusal is a non-dispatch both
  // times, not only when it is first raised.
  for (const [which, err] of [["first", first.err], ["second", second.err]] as const) {
    if (classify(err) !== "not-dispatched") {
      fail(what, `the ${which} call: expected a non-dispatch, got ${classify(err)} (${message(err)})`);
    }
  }
  if (!message(first.err).includes("will not try again")) {
    fail(what, `the message does not say the process will not retry: ${message(first.err)}`);
  }
  if (srv.count.login !== 1 || srv.count.read !== 0) {
    fail(what, `expected 1 login and no read, got ${srv.count.login} and ${srv.count.read}`);
  }
}

// ---------------------------------------------------------------------------
// Part 4: a kept refusal expires
// ---------------------------------------------------------------------------

await withClock(async (move) => {
  const what = "part 4: a kept 401 login refusal after fifteen minutes";
  const cfg = freshConfig();
  const srv = server({ login: [INVALID_CREDENTIALS, LOGIN_OK] });
  const first = await outcomeOf(read(cfg, srv));
  move(14 * 60_000);
  const within = await outcomeOf(read(cfg, srv));
  if (first.ok || within.ok || srv.count.login !== 1) {
    fail(what, `the refusal must hold within the window, got ${srv.count.login} logins`);
  }
  move(15 * 60_000);
  const after = await outcomeOf(read(cfg, srv));
  if (!after.ok || srv.count.login !== 2) {
    fail(
      what,
      `expected a new login after the window, got ${srv.count.login} logins` +
        (after.ok ? "" : `: ${message(after.err)}`),
    );
  }
});

// ---------------------------------------------------------------------------
// Part 5: the session is bound to the credential
// ---------------------------------------------------------------------------

{
  const what = "part 5: a second password does not reuse the first one's session";
  const cfg = freshConfig("right");
  const srv = server({});
  const first = await outcomeOf(read(cfg, srv));
  const second = await outcomeOf(read(withPassword(cfg, "wrong"), srv));
  if (!first.ok || !second.ok) fail(what, `${message(first.err)} / ${message(second.err)}`);
  if (srv.count.login !== 2) fail(what, `expected 2 logins, got ${srv.count.login}`);
}
{
  const what = "part 5: a refusal kept for one password does not block another";
  const cfg = freshConfig("wrong");
  const srv = server({ login: [INVALID_CREDENTIALS, LOGIN_OK] });
  const wrong = await outcomeOf(read(cfg, srv));
  const right = await outcomeOf(read(withPassword(cfg, "right"), srv));
  if (wrong.ok) fail(what, "the refused password was expected to fail");
  if (!right.ok || srv.count.login !== 2) {
    fail(
      what,
      `expected the corrected password to log in, got ${srv.count.login} logins` +
        (right.ok ? "" : `: ${message(right.err)}`),
    );
  }
}

// ---------------------------------------------------------------------------
// Part 6: the prepare hook ending a session an interrupted run left active
// ---------------------------------------------------------------------------

interface EndCase {
  readonly what: string;
  readonly answer: Handler;
  /** Substrings the one warning must carry; absent means no warning at all. */
  readonly warns?: readonly string[];
  readonly expect: "resolves" | Classification;
}

const END_CASES: EndCase[] = [
  { what: "ended", answer: () => json({ status: "ended" }), expect: "resolves" },
  {
    // A session can end between the list and the request, so one that
    // ended since is expected, and says nothing.
    what: "409 SESSION_NOT_ACTIVE is quiet",
    answer: () => json({ error: "The session is not active", code: "SESSION_NOT_ACTIVE" }, 409),
    expect: "resolves",
  },
  {
    // The session stays active, and the next Authorize of its tag is answered
    // ConcurrentTx: the scenario will fail for a reason the run must name.
    what: "409 STATION_ONLINE warns, naming the station and the session",
    answer: () => json({ error: "The station is connected", code: "STATION_ONLINE" }, 409),
    warns: ["CERTCP1", "ses_left", "STATION_ONLINE"],
    expect: "resolves",
  },
  {
    what: "a 500 is a non-dispatch",
    answer: () => json({ error: "Internal server error" }, 500),
    expect: "not-dispatched",
  },
];
for (const kase of END_CASES) {
  const what = `part 6: ${kase.what}`;
  const posted: string[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    if (init?.method === "POST" && path === "/v1/auth/login") return LOGIN_OK();
    posted.push(`${init?.method ?? "GET"} ${path}`);
    return kase.answer();
  };
  const warnings: string[] = [];
  const result = await outcomeOf(
    endLeftoverSessions(new EvtivityApi(freshConfig(), fetchImpl), "CERTCP1", ["ses_left"], {
      stillOpen: async () => [],
      warn: (line) => warnings.push(line),
    }),
  );
  const got = result.ok ? "resolves" : classify(result.err);
  if (got !== kase.expect) {
    fail(what, `expected ${kase.expect}, got ${got}${result.ok ? "" : ` (${message(result.err)})`}`);
  }
  if (posted.join() !== "POST /v1/sessions/ses_left/end") fail(what, `posted ${posted.join(", ")}`);
  if (kase.warns === undefined) {
    if (warnings.length > 0) fail(what, `expected no warning, got ${warnings.join(" | ")}`);
  } else if (warnings.length !== 1) {
    fail(what, `expected one warning, got ${warnings.length}: ${warnings.join(" | ")}`);
  } else {
    for (const s of kase.warns) {
      if (!warnings[0]!.includes(s)) fail(what, `the warning lacks ${JSON.stringify(s)}: ${warnings[0]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Part 9: an accepted end is waited for
// ---------------------------------------------------------------------------

interface WaitCase {
  readonly what: string;
  /** What the end request is answered. */
  readonly answer: Handler;
  /** The station's open sessions, per poll; the last one repeats. A thrown
   *  value is thrown by that poll. */
  readonly polls: readonly (readonly string[] | Error)[];
  readonly expect: "resolves" | Classification;
  readonly expectPolls: number;
  /** Substrings the one warning must carry; absent means no warning at all. */
  readonly warns?: readonly string[];
}

const ENDED: Handler = () => json({ sessionId: "ses_left", transactionId: "7" });
const WAIT_CASES: WaitCase[] = [
  { what: "a session gone at the first poll", answer: ENDED, polls: [[]], expect: "resolves", expectPolls: 1 },
  {
    what: "a session that ends after two more polls",
    answer: ENDED,
    polls: [["ses_left"], ["ses_left", "ses_other"], ["ses_other"]],
    expect: "resolves",
    expectPolls: 3,
  },
  {
    // Bounded, and named: the CSMS accepted the end and its OCPP server has
    // not acted on it, so the tag will meet ConcurrentTx until it does.
    what: "a session still active at the bound warns, naming the station and the session",
    answer: ENDED,
    polls: [["ses_left"]],
    expect: "resolves",
    expectPolls: -1,
    warns: ["CERTCP1", "ses_left", "accepted ending"],
  },
  {
    what: "a poll whose read fails is that read's failure",
    answer: ENDED,
    polls: [new CsmsNotDispatchedError("evtivity: GET /v1/stations", "returned 503")],
    expect: "not-dispatched",
    expectPolls: 1,
  },
  {
    // Control: a session the CSMS refused to end is not waited for.
    what: "409 STATION_ONLINE is not waited for",
    answer: () => json({ error: "The station is connected", code: "STATION_ONLINE" }, 409),
    polls: [["ses_left"]],
    expect: "resolves",
    expectPolls: 0,
    warns: ["STATION_ONLINE"],
  },
];
for (const kase of WAIT_CASES) {
  const what = `part 9: ${kase.what}`;
  const fetchImpl: FetchLike = async (input, init) => {
    if (init?.method === "POST" && new URL(input).pathname === "/v1/auth/login") return LOGIN_OK();
    return kase.answer();
  };
  let polls = 0;
  const stillOpen = async (): Promise<readonly string[]> => {
    const next = kase.polls[Math.min(polls, kase.polls.length - 1)]!;
    polls++;
    if (next instanceof Error) throw next;
    return next;
  };
  const warnings: string[] = [];
  const result = await outcomeOf(
    endLeftoverSessions(new EvtivityApi(freshConfig(), fetchImpl), "CERTCP1", ["ses_left"], {
      stillOpen,
      warn: (line) => warnings.push(line),
      timeoutMs: 100,
      intervalMs: 5,
    }),
  );
  const got = result.ok ? "resolves" : classify(result.err);
  if (got !== kase.expect) {
    fail(what, `expected ${kase.expect}, got ${got}${result.ok ? "" : ` (${message(result.err)})`}`);
  }
  if (kase.expectPolls === -1 ? polls < 2 : polls !== kase.expectPolls) {
    fail(what, `expected ${kase.expectPolls === -1 ? "several" : kase.expectPolls} polls, got ${polls}`);
  }
  if (kase.warns === undefined) {
    if (warnings.length > 0) fail(what, `expected no warning, got ${warnings.join(" | ")}`);
  } else if (warnings.length !== 1) {
    fail(what, `expected one warning, got ${warnings.length}: ${warnings.join(" | ")}`);
  } else {
    for (const sub of kase.warns) {
      if (!warnings[0]!.includes(sub)) fail(what, `the warning lacks ${JSON.stringify(sub)}: ${warnings[0]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Part 7: a 2xx whose body cannot be read
// ---------------------------------------------------------------------------

/** A response whose status line arrived and whose body stream then fails. */
function brokenBody(status: number): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    }),
    { status },
  );
}

interface BodyCase {
  readonly what: string;
  readonly status: number;
  readonly allow: readonly number[];
  readonly expect: "null" | Classification;
}

const BODY_CASES: BodyCase[] = [
  // The silent one: an empty result, read as "no such record".
  { what: "a 200 whose body fails is an error, not an empty result", status: 200, allow: [], expect: "plain-error" },
  // Controls: a non-2xx keeps its status-based answer.
  { what: "an allowed 404 whose body fails is still null", status: 404, allow: [404], expect: "null" },
  { what: "a 500 whose body fails is still a non-dispatch", status: 500, allow: [], expect: "not-dispatched" },
];
for (const kase of BODY_CASES) {
  const what = `part 7: ${kase.what}`;
  const srv = server({ read: [() => brokenBody(kase.status)] });
  let got: string;
  try {
    const parsed = await new EvtivityApi(freshConfig(), srv.fetch).get("/v1/sessions/ses_1", kase.allow);
    got = parsed === null ? "null" : `parsed ${JSON.stringify(parsed)}`;
  } catch (err) {
    got = classify(err);
  }
  if (got !== kase.expect) fail(what, `expected ${kase.expect}, got ${got}`);
}

// ---------------------------------------------------------------------------
// A store-backed fake, for the parts that read records
// ---------------------------------------------------------------------------

interface FakeSession {
  id: string;
  stationName: string;
  transactionId: string;
  status: "active" | "completed";
  stoppedReason: string | null;
  tokenId?: string;
}

/**
 * The routes records.ts and provision.ts read, over a mutable store. Its one
 * model of the server is the RESPONSE CACHE: a 200 of a `/v1/stations*` or
 * `/v1/sessions*` GET is replayed for a later GET of the same full URL, query
 * included -- the key EVtivity hashes (packages/api/src/plugins/
 * response-cache.ts, `buildCacheKey(..., request.url)`, at v0.1.51). A write
 * through the API clears it, as a write busts its tag there; a change made
 * from outside -- an OCPP event -- does not, which is the lag the model is for.
 * The TTL is not modelled: every row runs well inside five seconds.
 */
class FakeEvtivity {
  readonly stations = [{ id: "sta_1", stationId: "CERTCP1" }];
  readonly tokens = [{ id: "dtk_1", idToken: "CERT01" }];
  sessions: FakeSession[] = [];
  readonly urls: string[] = [];
  private readonly cache = new Map<string, string>();

  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.pathname === "/v1/auth/login") return LOGIN_OK();
    this.urls.push(`${method} ${url.pathname}${url.search}`);
    const cacheable = method === "GET" && /^\/v1\/(stations|sessions)/.test(url.pathname);
    if (method !== "GET") this.cache.clear();
    const key = `${url.pathname}${url.search}`;
    const hit = cacheable ? this.cache.get(key) : undefined;
    if (hit !== undefined) return new Response(hit, { status: 200 });
    const res = this.answer(method, url);
    if (cacheable && res.status === 200) this.cache.set(key, await res.clone().text());
    return res;
  };

  private answer(method: string, url: URL): Response {
    const p = url.searchParams;
    const page = <T>(rows: T[]): Response => {
      const limit = Number(p.get("limit") ?? 10);
      const from = (Number(p.get("page") ?? 1) - 1) * limit;
      return json({ data: rows.slice(from, from + limit), total: rows.length });
    };
    const search = (s: string) => s.toLowerCase().includes((p.get("search") ?? "").toLowerCase());
    if (method !== "GET") return json({ error: "not modelled" }, 500);
    if (url.pathname === "/v1/stations") return page(this.stations.filter((s) => search(s.stationId)));
    const stationSessions = /^\/v1\/stations\/([^/]+)\/sessions$/.exec(url.pathname);
    if (stationSessions) {
      const station = this.stations.find((s) => s.id === stationSessions[1]);
      return page(
        this.sessions
          .filter((s) => s.stationName === station?.stationId)
          .filter((s) => p.get("status") === null || s.status === p.get("status")),
      );
    }
    if (url.pathname === "/v1/sessions") return page(this.sessions.filter((s) => search(s.transactionId)));
    if (url.pathname === "/v1/tokens") return page(this.tokens.filter((t) => search(t.idToken)));
    const tokenSessions = /^\/v1\/tokens\/([^/]+)\/sessions$/.exec(url.pathname);
    if (tokenSessions) return page(this.sessions.filter((s) => s.tokenId === tokenSessions[1]));
    const detail = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
    const session = this.sessions.find((s) => s.id === detail?.[1]);
    if (session) return json({ ...session, endedAt: session.status === "active" ? null : "2026-11-12T00:00:00Z" });
    return json({ error: "Not found" }, 404);
  }
}

function fakeSession(n: number, status: FakeSession["status"] = "active"): FakeSession {
  return { id: `ses_${n}`, stationName: "CERTCP1", transactionId: String(n), status, stoppedReason: null };
}

// ---------------------------------------------------------------------------
// Part 8: a live read is not answered from the response cache
// ---------------------------------------------------------------------------

{
  const what = "part 8: latestTransaction sees a transaction started since its last read";
  const fake = new FakeEvtivity();
  fake.sessions = [fakeSession(7)];
  const records = new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch));
  const before = await records.latestTransaction("CERTCP1");
  fake.sessions.push(fakeSession(8));
  const after = await records.latestTransaction("CERTCP1");
  if (before !== "7" || after !== "8") fail(what, `expected 7 then 8, got ${before} then ${after}`);
}
{
  const what = "part 8: openSessions drops a session ended since its last read";
  const fake = new FakeEvtivity();
  fake.sessions = [fakeSession(7)];
  const records = new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch));
  const before = await records.openSessions("CERTCP1");
  fake.sessions[0]!.status = "completed";
  const after = await records.openSessions("CERTCP1");
  if (before.join() !== "ses_7" || after.length !== 0) {
    fail(what, `expected [ses_7] then [], got [${before.join()}] then [${after.join()}]`);
  }
}
{
  const what = "part 8: transactionStopReason sees a stop made since its last read";
  const fake = new FakeEvtivity();
  fake.sessions = [fakeSession(7)];
  const records = new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch));
  const before = await records.transactionStopReason("7");
  Object.assign(fake.sessions[0]!, { status: "completed", stoppedReason: "Remote" });
  const after = await records.transactionStopReason("7");
  if (before !== "" || after !== "Remote") fail(what, `expected "" then Remote, got "${before}" then "${after}"`);
}
{
  // The other half of the same lookup: the search that finds the session.
  const what = "part 8: a transaction looked up before it existed is found once it does";
  const fake = new FakeEvtivity();
  const records = new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch));
  const before = await records.transactionStopTimestamp("8");
  fake.sessions.push(fakeSession(8, "completed"));
  const after = await records.transactionStopTimestamp("8");
  if (before !== "" || after === "") fail(what, `expected "" then a timestamp, got "${before}" then "${after}"`);
}

// ---------------------------------------------------------------------------
// Part 10: an exact id past the first page of a substring search
// ---------------------------------------------------------------------------

/** A fake whose station and token searches answer a first page of 100 near
 *  misses -- `search` is a substring match -- with the exact row on page 2. */
function crowdedFake(): FakeEvtivity {
  const fake = new FakeEvtivity();
  for (let i = 99; i >= 0; i--) {
    fake.stations.unshift({ id: `sta_x${i}`, stationId: `CERTCP1${i}` });
    fake.tokens.unshift({ id: `dtk_x${i}`, idToken: `CERT01${i}` });
  }
  return fake;
}

{
  const what = "part 10: stationRestId finds a station on the second page";
  const fake = crowdedFake();
  const got = await new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch)).stationRestId("CERTCP1");
  if (got !== "sta_1") fail(what, `expected sta_1, got ${String(got)}`);
}
{
  const what = "part 10: a tag's sessions are found through a token on the second page";
  const fake = crowdedFake();
  fake.sessions = [{ ...fakeSession(7), tokenId: "dtk_1" }];
  const got = await new EvtivityRecords(new EvtivityApi(freshConfig(), fake.fetch)).transactionCountForIdTag(
    "CERTCP1",
    "CERT01",
  );
  if (got !== "1") fail(what, `expected 1, got ${got}`);
}
{
  // Provisioning's lookups share the rule: a station past the first page is
  // there, so ensureStation creates nothing.
  const what = "part 10: ensureStation finds a station on the second page";
  const fake = crowdedFake();
  const result = await outcomeOf(ensureStation(new EvtivityApi(freshConfig(), fake.fetch), "CERTCP1"));
  const writes = fake.urls.filter((u) => !u.startsWith("GET "));
  if (!result.ok || writes.length > 0) {
    fail(what, `expected no write, got ${writes.join(", ") || "none"}${result.ok ? "" : ` (${message(result.err)})`}`);
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). This guard holds what the EVtivity driver owns ` +
      `on top of @ovarilo/csms-drivers: its own REST client's login -- one per ` +
      `process, renewed on a stale token, which failures it remembers and for ` +
      `how long, bound to the password -- and when a leftover session the ` +
      `prepare hook could not end is named, an accepted end waited for, and a 2xx body that cannot be read ` +
      `is an error, a live read is not served from the response cache, and an exact id is ` +
      `looked for past the first page. The command classification is ` +
      `the library's, and its tests hold it.\n`,
  );
  process.exit(1);
}
process.stdout.write("evtivity adapter: OK\n");
