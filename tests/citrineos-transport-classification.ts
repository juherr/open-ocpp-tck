// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * citrineos-transport-classification.ts -- which failures of the CitrineOS
 * clients are `CsmsNotDispatchedError`, and which are not.
 *
 * `warnOpFailed` warns and continues on every error but that one class, which
 * it lets out so the scenario ERRORs. So this classification decides, for every
 * way a request can fail, whether the run reports "the CSMS answered wrongly"
 * or "the charge point was never asked" -- and getting it wrong is expensive in
 * both directions. Too narrow is issue #77's failure on the other driver: one
 * lost dispatch read as five confident FAILs about an idle station. Too broad
 * is the same lie backwards, an honest finding about the CSMS refiled as a
 * finding about this client. Issue #80.
 *
 * PROPERTY, in 8 parts:
 *  1. A `fetch` that rejects -- refused connection, DNS, timeout -- is a
 *     non-dispatch, and the message still names the URL that was posted to.
 *  2. EVERY non-2xx is a non-dispatch, whatever the status. The rule rests on
 *     one fact about CitrineOS: it answers 200 for everything that reaches its
 *     OCPP layer, so a status is proof that nothing did. Asserted across five
 *     of them, because a rule stated for 5xx and tested on 500 is a rule about
 *     500.
 *  3. A 404 carries the unrouted-action hint, and the OCPP version in it is the
 *     REQUEST's -- checked with a 1.6 request and a 2.0.1 one, since "which
 *     protocol did we ask for" is the half of that message a reader needs and
 *     a constant would answer it wrongly for one of the two.
 *  4. THE NEGATIVE HALF, which is what stops this being a blanket conversion: a
 *     2xx whose body stalls, one that will not parse, and one that is not a
 *     confirmation array stay a plain `Error`. The request was ANSWERED in all
 *     three, so whether it dispatched is unknown, and a driver may not claim
 *     what it cannot tell.
 *  5. The GraphQL client draws the same line. An engine that does not answer is
 *     a non-dispatch; so is a status from `/v1/graphql`, which reports anything
 *     it understood in-band and therefore never uses one for that.
 *  6. Its negative half, and the asymmetry that is not one: a 200 carrying
 *     `errors`, a 200 carrying neither data nor errors, a stalled body and a
 *     non-JSON body are all plain `Error`s -- and so is a status from
 *     `/v1/metadata`, which DOES answer a request it understood and refused
 *     with one. The provision hint survives the classification.
 *  7. `warnOpFailed` lets every non-dispatch above out BY IDENTITY and warns
 *     about every plain `Error`. Checked on the real errors the other parts
 *     produced rather than on hand-built ones: `instanceof` would also pass on
 *     a copy, and what the runner needs is the throw to reach it.
 *  8. A 200 whose confirmation says `success: false` is a non-dispatch, and
 *     EVERY refused payload travels with it. CitrineOS answers that for an
 *     unknown station id and for a `connectorId <= 0` on TriggerMessage -- a
 *     request failure wearing a 200 -- and it is the only failure here whose
 *     message names the operation instead of the URL, because the request did
 *     reach CitrineOS. Numbered last, and last to arrive: it is the widest of
 *     the eight, so it landed in a commit of its own that lifts out with this
 *     part if a sweep says it was too wide.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. Every branch above needs a
 * CSMS engineered to refuse a request a chosen way, and most of them cannot be
 * asked for at all -- a 503, a body that stalls mid-stream, a 200 that is not
 * JSON. The pinned CitrineOS produces none of them on demand, and the two that
 * a broken deployment does produce (a refused connection, a 404) would each
 * cost a container and a misconfiguration to stage. Handing the client its
 * `fetch` is the only way in: the same "hand the rule its input" split as
 * `assert-answered.ts`, `trace-frames.ts` and `steve-ui-session-race.ts`.
 *
 * WHY THE ANSWERS ARE THESE ANSWERS. Each one is a failure the clients' own
 * headers cite from the running image -- the `success: false` confirmations,
 * the unrouted-action 404, Hasura's in-band `errors` array -- rather than a
 * catalogue of HTTP invented here. The requests are built by the driver's own
 * mappers for the same reason a literal config would be wrong: a hand-written
 * `CitrineRequest` would make this guard agree with whoever wrote it.
 *
 * Offline: answers every request from a closure. Opens no socket, starts
 * nothing.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../tck/driver";
import { warnOpFailed } from "../tck/op-warn";
import { CitrineMessageApi } from "../drivers/citrineos/api-client";
import { defaultCitrineConfig } from "../drivers/citrineos/config";
import { CitrineGraphQL } from "../drivers/citrineos/graphql-client";
import {
  type CitrineRequest,
  toCitrineRequest,
  toCitrineRequest201,
} from "../drivers/citrineos/requests";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

const API_BASE = "http://citrine.test:8080";
const GQL_BASE = "http://citrine.test:8090";
const CP_ID = "CERTCP1";

/** Resolved, not hand-built: a literal would be a second declaration of what
 *  the driver actually uses, and a changed default would leave this guard
 *  exercising a configuration no run produces. */
const CFG = defaultCitrineConfig({
  CITRINE_API_URL: API_BASE,
  CITRINE_GRAPHQL_URL: GQL_BASE,
});

/**
 * The requests come from the driver's mappers, for both protocols.
 *
 * `refs` throws rather than answering: neither operation below carries an
 * opaque ref, and a mapper that started needing one should stop this guard
 * rather than be handed a number nothing checks.
 */
const REFS = {
  ocppTransactionId: (): Promise<number> => {
    throw new Error("guard: no operation here resolves a transaction ref");
  },
};
const REQ_16 = await toCitrineRequest({ action: "Reset", type: "Soft" }, REFS, CFG.variant);
const REQ_201 = toCitrineRequest201({ action: "Reset", type: "OnIdle" });

// ---------------------------------------------------------------------------
// The answers a CitrineOS deployment can give
// ---------------------------------------------------------------------------

/** A `fetch` that always answers the same way. Which URL was asked for never
 *  changes the answer here -- what varies is the failure, not the routing. */
function serving(answer: () => Promise<Response>): FetchLike {
  return () => answer();
}

/** A connection that never opened, or a request that timed out. Both arrive at
 *  the same place: the promise `fetch` returns rejects. */
function refused(message: string): () => Promise<Response> {
  return () => Promise.reject(new TypeError(message));
}

function answering(status: number, body: string): () => Promise<Response> {
  return () => Promise.resolve(new Response(body, { status }));
}

function json(value: unknown): () => Promise<Response> {
  return answering(200, JSON.stringify(value));
}

/**
 * Headers, then a body that never finishes.
 *
 * The one case the two clients used to disagree about: api-client read the body
 * inside the `fetch` try and graphql-client outside it, so the same stall was a
 * driver error on one and a raw abort naming nothing on the other.
 */
function stalled(): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("the response stream closed"));
          },
        }),
      ),
    );
}

// ---------------------------------------------------------------------------
// Running a case
// ---------------------------------------------------------------------------

/** What a failure is claimed to be. `answered` is the negative half. */
type Classification = "not-dispatched" | "answered";

interface Case {
  /** What the CSMS did, in the words the failure report would use. */
  readonly what: string;
  readonly answer: () => Promise<Response>;
  readonly expect: Classification;
  /** Substrings the message must still carry. These are the diagnosis -- a URL,
   *  a status, a hint naming what to run -- and the conversion must not eat
   *  them. */
  readonly carries: readonly string[];
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Every error a case produced, kept for part 7. */
const produced: { err: unknown; expect: Classification; what: string }[] = [];

async function check(label: string, kase: Case, run: () => Promise<unknown>) {
  const settled = await Promise.allSettled([run()]);
  const outcome = settled[0]!;
  if (outcome.status === "fulfilled") {
    fail(
      `${label}: ${kase.what} did not fail at all`,
      `it resolved with ${JSON.stringify(outcome.value)} -- a client that ` +
        `returns a receipt for a request that failed reports the scenario as ` +
        `having driven an operation it never drove`,
    );
    return;
  }

  const err = outcome.reason;
  produced.push({ err, expect: kase.expect, what: `${label}: ${kase.what}` });

  const isTyped = err instanceof CsmsNotDispatchedError;
  if (isTyped && kase.expect === "answered") {
    fail(
      `${label}: ${kase.what} was reported as a non-dispatch`,
      `the request WAS answered, so whether it dispatched is unknown -- ` +
        `claiming otherwise ERRORs the scenario and refiles a finding about ` +
        `the CSMS as one about this client. Got ${describe(err)}`,
    );
  } else if (!isTyped && kase.expect === "not-dispatched") {
    fail(
      `${label}: ${kase.what} was reported as an ordinary failure`,
      `got ${describe(err)} -- warnOpFailed warns and continues on anything ` +
        `but CsmsNotDispatchedError, so this becomes a WARN and every ` +
        `assertion below it measures a charge point nobody asked`,
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  for (const fragment of kase.carries) {
    if (!message.includes(fragment)) {
      fail(
        `${label}: ${kase.what} lost part of its diagnosis`,
        `the message does not carry ${JSON.stringify(fragment)}, which is ` +
          `what a reader needs to tell a broken deployment from a CSMS ` +
          `finding. Got: ${message}`,
      );
    }
  }
}

const sendWith =
  (answer: () => Promise<Response>, req: CitrineRequest = REQ_16) =>
  () =>
    new CitrineMessageApi(CFG, serving(answer)).send(CP_ID, req);

/** Where every message-API failure names its request. Derived, not spelled:
 *  the client builds the URL and this guard must not declare it a second
 *  time. */
const apiUrlPrefix = (req: CitrineRequest) =>
  `${API_BASE}/ocpp/${req.ocppVersion}/${req.module}/${req.action}`;

// ---- 1, 2, 3, 4, 8. The message API.

const API_CASES: Case[] = [
  {
    what: "a connection that never opened",
    answer: refused("Unable to connect. Is the computer able to access the url?"),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "Unable to connect"],
  },
  {
    what: "a request that timed out",
    answer: refused("The operation timed out."),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "timed out"],
  },
  // Part 2. Five statuses, not one: the rule is "every non-2xx", and a rule
  // tested on a single status is a rule about that status.
  {
    what: "a 400",
    answer: answering(400, "bad request"),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "returned 400", "bad request"],
  },
  {
    what: "a 401",
    answer: answering(401, "unauthorized"),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "returned 401"],
  },
  {
    what: "a 404 on an unrouted action",
    answer: answering(404, "Not Found"),
    expect: "not-dispatched",
    carries: [
      apiUrlPrefix(REQ_16),
      "returned 404",
      // Part 3, first half: the version named is this request's.
      `no OCPP ${REQ_16.ocppVersion} route is registered`,
    ],
  },
  {
    what: "a 500",
    answer: answering(500, "boom"),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "returned 500"],
  },
  {
    what: "a 503",
    answer: answering(503, "unavailable"),
    expect: "not-dispatched",
    carries: [apiUrlPrefix(REQ_16), "returned 503"],
  },
  // Part 8. Two confirmations, because CitrineOS answers one per identifier
  // and batches GetConfiguration -- so the message has to carry every refusal,
  // not the first.
  {
    what: "a 200 confirming success: false",
    answer: json([
      { success: false, payload: "Unknown identifier CERTCP1" },
      { success: false, payload: { reason: "connectorId must be > 0" } },
    ]),
    expect: "not-dispatched",
    carries: [
      // The operation, not the URL: the request reached CitrineOS.
      `${REQ_16.module}/${REQ_16.action} for ${CP_ID}`,
      "Unknown identifier CERTCP1",
      "connectorId must be > 0",
    ],
  },
  // Part 4, the negative half.
  {
    what: "a 200 whose body stalls",
    answer: stalled(),
    expect: "answered",
    carries: [apiUrlPrefix(REQ_16), "could not"],
  },
  {
    what: "a 200 whose body will not parse",
    answer: answering(200, "<html>a proxy answered instead</html>"),
    expect: "answered",
    carries: [apiUrlPrefix(REQ_16), "unparseable body", "a proxy answered"],
  },
  {
    what: "a 200 carrying a scalar instead of a confirmation",
    answer: json(42),
    expect: "answered",
    carries: [apiUrlPrefix(REQ_16), "not a confirmation array"],
  },
];

for (const kase of API_CASES) {
  await check("message API", kase, sendWith(kase.answer));
}

// Part 3, second half: the same 404 on a 2.0.1 request names 2.0.1. A constant
// in that hint would pass the case above and fail here.
await check(
  "message API",
  {
    what: "a 404 on a 2.0.1 request",
    answer: answering(404, "Not Found"),
    expect: "not-dispatched",
    carries: [
      apiUrlPrefix(REQ_201),
      `no OCPP ${REQ_201.ocppVersion} route is registered`,
    ],
  },
  sendWith(answering(404, "Not Found"), REQ_201),
);

if (REQ_16.ocppVersion === REQ_201.ocppVersion) {
  fail(
    "the two requests do not differ in protocol",
    `both are OCPP ${REQ_16.ocppVersion}, so part 3 cannot tell a hint that ` +
      `names the request's version from one that names a constant`,
  );
}

// A dispatched operation must still come back with its receipt: a guard that
// only ever asserts failures passes for a client that fails everything.
{
  const receipt = await new CitrineMessageApi(
    CFG,
    serving(json([{ success: true }])),
  ).send(CP_ID, REQ_16);
  if (!receipt.includes('"success":true')) {
    fail(
      "a dispatched operation lost its receipt",
      `got ${JSON.stringify(receipt)} -- the receipt is what a human reading ` +
        `results/ uses to tell a dispatched operation from a reshaped one`,
    );
  }
}

// ---- 5, 6. The GraphQL client.

const QUERY = "query Newest { Transactions { id } }";

const GQL_QUERY_CASES: Case[] = [
  {
    what: "an engine that does not answer",
    answer: refused("Unable to connect. Is the computer able to access the url?"),
    expect: "not-dispatched",
    carries: [GQL_BASE, "graphql-engine", "CITRINE_GRAPHQL_URL"],
  },
  {
    what: "a 401 from the query endpoint",
    answer: answering(401, "invalid x-hasura-admin-secret"),
    expect: "not-dispatched",
    carries: ["/v1/graphql", "returned 401", "invalid x-hasura-admin-secret"],
  },
  {
    what: "a 502 from the query endpoint",
    answer: answering(502, "bad gateway"),
    expect: "not-dispatched",
    carries: ["/v1/graphql", "returned 502"],
  },
  // Part 6, the negative half. Hasura reports what it understood in-band.
  {
    what: "a 200 carrying an errors array",
    answer: json({ errors: [{ message: "field 'Transactions' not found" }] }),
    expect: "answered",
    carries: [
      "field 'Transactions' not found",
      // The hint is the whole value of this message, and it is two halves --
      // what an unknown field means, and what to run about it. Asserting only
      // the command leaves the diagnosis free to be deleted; a mutation
      // removing it stayed green until this line named it too.
      "the tables are not tracked yet",
      "ocpp-tck driver provision",
    ],
  },
  {
    what: "a 200 carrying neither data nor errors",
    answer: json({ extensions: {} }),
    expect: "answered",
    carries: ["neither data nor errors"],
  },
  {
    what: "a 200 whose body stalls",
    answer: stalled(),
    expect: "answered",
    carries: ["/v1/graphql", "could not"],
  },
  {
    what: "a 200 whose body is not JSON",
    answer: answering(200, "<html>a proxy answered instead</html>"),
    expect: "answered",
    carries: ["/v1/graphql", "unparseable body", "a proxy answered"],
  },
];

for (const kase of GQL_QUERY_CASES) {
  await check("graphql query", kase, () =>
    new CitrineGraphQL(CFG, serving(kase.answer)).query(QUERY),
  );
}

// Part 6, the asymmetry: the SAME status on the metadata endpoint is the
// server answering. `ensureTracked` is the reachable caller of it; it reads
// before it writes, so one answer serves both reads and the guard only has to
// make that answer a refusal.
await check(
  "graphql metadata",
  {
    what: "a 400 from the metadata endpoint",
    answer: answering(400, '{"error":"unknown table"}'),
    expect: "answered",
    carries: ["/v1/metadata", "returned 400", "unknown table"],
  },
  () =>
    new CitrineGraphQL(
      CFG,
      serving(answering(400, '{"error":"unknown table"}')),
    ).ensureTracked(),
);

// ---- 7. What warnOpFailed does with each of them.

if (produced.length !== API_CASES.length + GQL_QUERY_CASES.length + 2) {
  fail(
    "part 7 did not see every failure",
    `${produced.length} error(s) reached it -- a case that stopped failing ` +
      `leaves this part asserting about a shorter list than it reads as`,
  );
}

for (const { err, expect, what } of produced) {
  const written: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;

  let escaped: unknown;
  let threw = false;
  try {
    warnOpFailed("Reset(Soft)", err);
  } catch (caught) {
    threw = true;
    escaped = caught;
  } finally {
    process.stderr.write = realWrite;
  }

  if (expect === "not-dispatched") {
    if (!threw) {
      fail(
        `warnOpFailed swallowed ${what}`,
        "the scenario would carry on past a request that never reached the " +
          "CSMS, which is the whole failure issues #77 and #80 exist for",
      );
    } else if (escaped !== err) {
      fail(
        `warnOpFailed re-wrapped ${what}`,
        `the runner has no handler for this class and reports it as ERROR by ` +
          `letting it out unchanged; a copy would still satisfy instanceof ` +
          `while losing the throw the runner needs`,
      );
    }
  } else if (threw) {
    fail(
      `warnOpFailed let ${what} out`,
      `it is a plain Error -- the CSMS answered, so the assertions below the ` +
        `call are still the finding and a refusal is worth a WARN and nothing ` +
        `more. Got ${describe(escaped)}`,
    );
  } else if (!written.join("").includes("CSMS operation Reset(Soft) failed")) {
    fail(
      `warnOpFailed said nothing about ${what}`,
      `a failure that neither ends the scenario nor appears on stderr is a ` +
        `finding nobody can read. Wrote: ${JSON.stringify(written.join(""))}`,
    );
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). The line this guard holds is the one warnOpFailed ` +
      `reads: a request that never reached the CSMS must ERROR the scenario, ` +
      `and a request the CSMS answered must not. Wrong in the first direction ` +
      `is issue #77 -- one lost dispatch reported as five confident FAILs ` +
      `about an idle charge point. Wrong in the second is the same lie ` +
      `backwards, a finding about the CSMS refiled as a finding about this ` +
      `client.\n`,
  );
  process.exit(1);
}
process.stdout.write("CitrineOS transport classification: OK\n");
