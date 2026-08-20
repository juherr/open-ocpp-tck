// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * steve-ui-session-race.ts -- SteVe's manager-UI client is driven by every lane
 * of a parallel sweep at once, and its session is the thing they share.
 *
 * Both halves of issue #77 are here, because they are one defect: an operation
 * that never reached the wire must not happen, and must not be quiet when it
 * does. Parts 1-5 are the client, part 6 is what the scenarios do with it.
 *
 * PROPERTY, in 7 parts:
 *  1. Concurrent `postForm`s on one instance all succeed. The GET that reads a
 *     CSRF token and the POST that spends it are atomic against other lanes.
 *  2. N concurrent first-time `postForm`s perform EXACTLY ONE login. The
 *     `ensureLogin` check is inside the critical section, not in front of it --
 *     `login()` starts with `cookies.clear()`, so two of them racing is the
 *     defect itself rather than a wasted round trip.
 *  3. Every POST carries the cookies of the session whose GET issued its token.
 *  4. A signin that fails is reported, not swallowed.
 *  5. A request the transport refused is a `CsmsNotDispatchedError`; a form that
 *     came back with validation errors is not. Those are different findings --
 *     one is about this client, the other about the CSMS.
 *  6. `warnOpFailed` lets a `CsmsNotDispatchedError` out and warns about
 *     everything else. Swallowing the first is what turned one undispatched
 *     Reset into five confident FAILs about an idle charge point.
 *  7. One lane's failure is that lane's. A rejected `postForm` must not fail
 *     the calls queued behind it -- a lock whose queue a single failure
 *     poisons would convert one flaky scenario into every later one.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD.
 * What is under test is an interleaving. The CLI can only run a whole scenario
 * against a live CSMS, and there the property is a 45%-of-the-time event: it
 * took 91 archived sweep artifacts and a preserved wire trace to see it once
 * (issue #77). Handing the class a fake server is the only way to make the
 * pathological ordering happen every time and in-process -- the same
 * "hand the rule its input" split as `assert-answered.ts` and `trace-frames.ts`.
 *
 * WHY THE FAKE MODELS SPRING AND NOT A GUESS.
 * The fake below is the guard's load-bearing assumption, so it is built from
 * what SteVe actually runs -- Spring Boot 4.1.0, so Spring Security 7.0, with
 * `SecurityConfiguration.java` leaving both CSRF defaults in place:
 *  - `HttpSessionCsrfTokenRepository`: the raw token lives in the SESSION and
 *    is never rotated per request;
 *  - `XorCsrfTokenRequestAttributeHandler` (BREACH): the rendered `_csrf`
 *    string is freshly masked on every GET, so it LOOKS per-request while every
 *    rendering unmasks to the same session token. That illusion is exactly what
 *    makes this bug read as a token race when it is a session race;
 *  - session-fixation protection at its default `changeSessionId`, so the
 *    JSESSIONID is replaced at authentication -- inside `login()`, and nowhere
 *    else.
 * `tools/steve-csrf-race.ts` is how that reading gets re-checked against the
 * real image when the SteVe pin moves.
 *
 * Offline: serves every request from a Map. Opens no socket, starts nothing.
 */
import { CsmsNotDispatchedError } from "../tck/driver";
import { warnOpFailed } from "../tck/op-warn";
import {
  defaultSteveConfig,
  type FetchLike,
  SteveUiOps,
} from "../drivers/steve/ui-client";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

const BASE = "http://steve.test/manager";

/** Resolved, not hand-built: a literal here would be a second declaration of
 *  what the driver actually uses, and a changed default would leave this guard
 *  exercising a configuration no run produces. */
const CFG = defaultSteveConfig({ STEVE_URL: BASE });

// ---------------------------------------------------------------------------
// The fake SteVe
// ---------------------------------------------------------------------------

interface Session {
  /** The raw CSRF token, session-scoped and never rotated per request. */
  raw: string;
  authenticated: boolean;
}

/**
 * Spring's BREACH masking, in miniature: a fresh salt on every render, the same
 * token underneath. Only the shape matters here -- that the rendered string
 * differs per GET while unmasking to one session-scoped token -- so the salt is
 * prefixed rather than XORed in. Reproducing the real encoding would add
 * arithmetic no assertion below can observe.
 */
function maskToken(raw: string, salt: string): string {
  return `${salt}.${raw}`;
}

function unmaskToken(masked: string): string | undefined {
  const dot = masked.indexOf(".");
  return dot < 1 ? undefined : masked.slice(dot + 1);
}

interface Observation {
  /** Every POST, and whether its token belonged to the session it arrived on. */
  posts: { path: string; status: number; tokenMatchedSession: boolean }[];
  /** Signin POSTs ATTEMPTED, not survived: counting only the winner would make
   *  N lanes racing into login() look like the one login the property wants. */
  loginAttempts: number;
  /** Distinct masked `_csrf` strings handed out, to show they vary per GET. */
  rendered: Set<string>;
}

interface Fake {
  fetch: FetchLike;
  seen: Observation;
}

function makeFake(): Fake {
  const sessions = new Map<string, Session>();
  const seen: Observation = { posts: [], loginAttempts: 0, rendered: new Set() };
  let ids = 0;

  function newSession(authenticated: boolean): string {
    const id = `S${++ids}`;
    sessions.set(id, { raw: `token-${id}`, authenticated });
    return id;
  }

  function sessionOf(init?: RequestInit): { id?: string; session?: Session } {
    const header = new Headers(init?.headers).get("cookie") ?? "";
    const found = /JSESSIONID=([^;]+)/.exec(header);
    const id = found?.[1];
    return { id, session: id ? sessions.get(id) : undefined };
  }

  function page(session: Session): string {
    const masked = maskToken(session.raw, `salt${++ids}`);
    seen.rendered.add(masked);
    return `<form><input type="hidden" name="_csrf" value="${masked}"/></form>`;
  }

  function redirect(location: string, setCookie?: string): Response {
    const headers = new Headers({ location });
    if (setCookie) headers.append("set-cookie", `JSESSIONID=${setCookie}; Path=/`);
    return new Response(null, { status: 302, headers });
  }

  const fetchImpl: FetchLike = async (input, init) => {
    // One microtask per request. Single-threaded JS then interleaves N
    // concurrent postForms in lockstep, which is the pathological ordering --
    // deterministic here, and a coin flip on a real server.
    await Promise.resolve();

    const path = input.slice(BASE.length + 1);
    const method = (init?.method ?? "GET").toUpperCase();
    const { id, session } = sessionOf(init);

    if (path === "signin" && method === "GET") {
      const fresh = newSession(false);
      const body = page(sessions.get(fresh)!);
      const headers = new Headers({ "content-type": "text/html" });
      headers.append("set-cookie", `JSESSIONID=${fresh}; Path=/`);
      return new Response(body, { status: 200, headers });
    }

    if (path === "signin" && method === "POST") {
      seen.loginAttempts++;
      const sent = new URLSearchParams(String(init?.body ?? "")).get("_csrf");
      const ok = !!session && unmaskToken(sent ?? "") === session.raw;
      seen.posts.push({ path, status: ok ? 302 : 403, tokenMatchedSession: ok });
      if (!ok) return new Response("Forbidden", { status: 403 });
      // Spring's session-fixation protection: new id, and a new CSRF token
      // with it. The old id stops existing.
      sessions.delete(id!);
      return redirect(`${BASE}/home`, newSession(true));
    }

    if (method === "GET") {
      if (!session?.authenticated) return redirect(`${BASE}/signin`);
      return new Response(page(session), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    // POST to a manager page.
    const sent = new URLSearchParams(String(init?.body ?? "")).get("_csrf");
    const matched = !!session && unmaskToken(sent ?? "") === session.raw;
    const ok = !!session?.authenticated && matched;
    seen.posts.push({
      path,
      status: ok ? 302 : 403,
      tokenMatchedSession: matched,
    });
    if (!ok) return new Response("Forbidden", { status: 403 });
    return redirect(`${BASE}/tasks/1`);
  };

  return { fetch: fetchImpl, seen };
}

/** True for a POST to `path`, which is the only request any part below rigs. */
function isPostTo(path: string): (input: string, init?: RequestInit) => boolean {
  return (input, init) =>
    input === `${BASE}/${path}` && (init?.method ?? "GET").toUpperCase() === "POST";
}

/**
 * A fake with one request answered by hand.
 *
 * `once` is what parts 4, 5 and 7 differ by: whether the rigged answer stands
 * for every matching request or only the first. Doing this as a wrapper rather
 * than an option on makeFake keeps the fake a model of SteVe, with nothing in
 * it that exists only for a test.
 */
function intercept(
  fake: Fake,
  matches: (input: string, init?: RequestInit) => boolean,
  answer: () => Response,
  opts: { once?: boolean } = {},
): FetchLike {
  let spent = false;
  return async (input, init) => {
    if (matches(input, init) && !spent) {
      if (opts.once) spent = true;
      return answer();
    }
    return fake.fetch(input, init);
  };
}

const forbidden = (): Response => new Response("Forbidden", { status: 403 });

const isRejected = (r: PromiseSettledResult<unknown>): r is PromiseRejectedResult =>
  r.status === "rejected";

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// ---- 1 & 2 & 3. Concurrent postForms: all succeed, one login, tokens matched
{
  const lanes = 4;
  const fake = makeFake();
  const ui = new SteveUiOps(CFG, fake.fetch);

  const results = await Promise.allSettled(
    Array.from({ length: lanes }, (_, i) =>
      ui.postForm("operations/v1.6/Reset", { chargePointSelectList: `CP${i}` }),
    ),
  );

  const rejected = results.filter(isRejected);
  if (rejected.length > 0) {
    fail(
      `${lanes} concurrent postForms: ${rejected.length} of them failed`,
      `expected every lane to get its redirect; first failure was ` +
        `${describe(rejected[0]!.reason)}\n  ` +
        `(the GET that reads a CSRF token and the POST that spends it must be ` +
        `atomic against the other lanes sharing this instance)`,
    );
  }

  if (fake.seen.loginAttempts !== 1) {
    fail(
      `${lanes} concurrent first-time postForms attempted ${fake.seen.loginAttempts} logins`,
      `expected exactly 1 -- login() begins with cookies.clear(), so a second ` +
        `one racing a lane mid-postForm is the defect, not an optimisation`,
    );
  }

  const mismatched = fake.seen.posts.filter((p) => !p.tokenMatchedSession);
  if (mismatched.length > 0) {
    fail(
      `${mismatched.length} POST(s) carried a token from another session`,
      `every POST must arrive on the session whose GET issued its token; ` +
        `first offender: ${mismatched[0]!.path} (status ${mismatched[0]!.status})`,
    );
  }

  const refused = fake.seen.posts.filter((p) => p.status === 403);
  if (refused.length > 0) {
    fail(
      `${refused.length} POST(s) were answered 403`,
      `a 403 here means Spring rejected a _csrf that no longer matched its ` +
        `cookie -- the operation never reached the wire`,
    );
  }

  // The masking is what makes this look like a token race; if the fake ever
  // stops varying the rendered token, parts 1-3 would pass for a weaker reason.
  if (fake.seen.rendered.size < 2) {
    fail(
      "the fake rendered the same _csrf string twice",
      `expected BREACH masking to vary it per GET, got ${fake.seen.rendered.size} ` +
        `distinct value(s) -- without that variation this guard is not modelling Spring`,
    );
  }
}

// ---- 4. A signin that fails is reported, not swallowed
{
  // The fake accepts any password on a valid token, so refuse the signin POST
  // outright -- which is what SteVe does to the loser of the session race.
  const ui = new SteveUiOps(
    CFG,
    intercept(makeFake(), isPostTo("signin"), forbidden),
  );

  const [result] = await Promise.allSettled([
    ui.postForm("operations/v1.6/Reset", {}),
  ]);
  if (!isRejected(result!)) {
    fail(
      "a refused signin was swallowed",
      "postForm resolved even though the signin POST was answered 403; " +
        "login() must check its own result, or the real failure surfaces later " +
        "as an unrelated-looking error",
    );
  } else if (!/signin/i.test(describe(result.reason))) {
    fail(
      "a refused signin was reported as something else",
      `expected the error to name the signin step, got ${describe(result.reason)}`,
    );
  }
}

// ---- 5. Refused-before-dispatch vs answered-with-errors are different findings
{
  const path = "operations/v1.6/Reset";
  const post = (answer: () => Response): Promise<PromiseSettledResult<string>[]> =>
    Promise.allSettled([
      new SteveUiOps(
        CFG,
        intercept(makeFake(), isPostTo(path), answer),
      ).postForm(path, {}),
    ]);

  const [a] = await post(forbidden);
  if (!isRejected(a!)) {
    fail(
      "a 403 form post was reported as success",
      "postForm resolved on a request the transport refused",
    );
  } else if (!(a.reason instanceof CsmsNotDispatchedError)) {
    fail(
      "a refused request was not a CsmsNotDispatchedError",
      `got ${describe(a.reason)} -- the runner recognises the class with ` +
        `instanceof, so a plain Error is a scenario reporting confident FAILs ` +
        `about a charge point that was never asked anything`,
    );
  }

  // A form that came back carrying validation errors: answered, not refused.
  const [b] = await post(
    () => new Response("<form>field is required</form>", { status: 200 }),
  );
  if (!isRejected(b!)) {
    fail(
      "a form returned with validation errors was reported as success",
      "a 200 with no Location means the form came back rejected",
    );
  } else if (b.reason instanceof CsmsNotDispatchedError) {
    fail(
      "a rejected form was classified as never dispatched",
      "the request reached the CSMS and was answered; calling that a " +
        "non-dispatch would hide a real finding about the CSMS behind a " +
        "finding about this client",
    );
  }
}

// ---- 6. warnOpFailed lets a non-dispatch out and warns about everything else
{
  /** warnOpFailed writes to stderr by design; keep that out of this report. */
  function quietly(work: () => void): string {
    const original = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stderr.write;
    try {
      work();
    } finally {
      process.stderr.write = original;
    }
    return captured;
  }

  let escaped: unknown;
  const notDispatched = new CsmsNotDispatchedError("operations/v1.6/Reset", "status 403");
  quietly(() => {
    try {
      warnOpFailed("Reset(Soft)", notDispatched);
    } catch (err) {
      escaped = err;
    }
  });
  if (escaped !== notDispatched) {
    fail(
      "warnOpFailed swallowed a CsmsNotDispatchedError",
      "it must escape, so the scenario ERRORs instead of asserting about a " +
        "charge point that was never asked -- warning and continuing here is " +
        "the whole of issue #77's diagnosis cost",
    );
  }

  let wrongly: unknown;
  const refusal = new Error("CSMS rejected the operation");
  const warned = quietly(() => {
    try {
      warnOpFailed("Reset(Soft)", refusal);
    } catch (err) {
      wrongly = err;
    }
  });
  if (wrongly !== undefined) {
    fail(
      "warnOpFailed rethrew a plain operation failure",
      `a CSMS refusing an operation is not the scenario's answer -- the ` +
        `assertions below the call are. Got ${describe(wrongly)}`,
    );
  } else if (!warned.includes("CSMS operation Reset(Soft) failed (continuing)")) {
    fail(
      "warnOpFailed did not warn about an ordinary failure",
      `expected the usual WARN line on stderr, got ${JSON.stringify(warned)}`,
    );
  }
}

// ---- 7. A rejected call does not poison the queue behind it
{
  const path = "operations/v1.6/Reset";
  // Refuse exactly the first form POST, then behave.
  const ui = new SteveUiOps(
    CFG,
    intercept(makeFake(), isPostTo(path), forbidden, { once: true }),
  );

  const [first, ...later] = await Promise.allSettled([
    ui.postForm(path, {}),
    ui.postForm(path, {}),
    ui.postForm(path, {}),
  ]);

  if (!isRejected(first!)) {
    fail(
      "the rigged first call was expected to fail",
      "part 7 cannot say anything unless the call it queues behind actually failed",
    );
  }
  for (const [n, result] of later.entries()) {
    if (isRejected(result)) {
      fail(
        `the call queued behind a failure also failed (queue position ${n + 2})`,
        `a lane's failure must stay that lane's; got ${describe(result.reason)}`,
      );
    }
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). SteVe's manager-UI client is shared by every lane ` +
      `of a parallel sweep, and its cookie jar is the shared mutable state. When ` +
      `postForm stops being atomic, a Reset is answered 403, never reaches the ` +
      `wire, and the scenario reports five FAILs about a charge point nobody asked.\n`,
  );
  process.exit(1);
}
process.stdout.write("steve manager-UI session race: OK\n");
