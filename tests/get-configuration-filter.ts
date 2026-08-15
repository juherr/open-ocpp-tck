/**
 * tests/get-configuration-filter.ts -- guard over what TC_019_1 measures.
 *
 * PROPERTY, in six parts. A GetConfiguration that asks for NO filter passes
 * whichever way the CSMS spells it -- an ABSENT `key` member, an EMPTY `key`
 * array, or a null one, which is how some CSMSs write an unset optional member
 * and is NOT the same encoding as omitting it -- while a request carrying a
 * NON-EMPTY filter fails, and so does
 * a run where no GetConfiguration ever reached the charge point. A MALFORMED
 * payload is not a witness either: an OCPP-J CALL carries a JSON object, and
 * `null` or an array in that position reads back as an absent `key` unless
 * something checks the shape. And ONE unfiltered request is enough, however
 * many filtered ones the CSMS sent beside it.
 *
 * Why the two spellings are one request. OCPP 1.6 makes GetConfiguration.req's
 * `key` 0..N optional and defines its ABSENCE as "return every key". `{}` and
 * `{"key":[]}` therefore ask for exactly the same thing, and a CSMS is free to
 * pick either. TC_019_1 used to check the wire text for the second one, so a
 * conformant CSMS sending the first was failed on its serialisation while the
 * three neighbouring assertions -- request received, CALLRESULT returned, key
 * list complete -- all passed (issue #31).
 *
 * Why this is a guard and not a sweep. The bug is invisible from here: both
 * bundled drivers send `{"key":[]}`, so no offline or live run this repository
 * can perform ever produces the `{}` shape. Reaching it means handing the
 * helper the frames, which is the same reason tests/assert-answered.ts is
 * TypeScript rather than shell -- an assertion whose only witness is a CSMS
 * nobody here runs is exactly the assertion worth pinning.
 *
 * The third part matters as much as the first two, and it is why this is not
 * simply "match GetConfiguration and stop": TC_019_2 sends
 * `{"key":["HeartbeatInterval"]}` and the two scenarios have to stay
 * distinguishable. A helper that forgave a non-empty filter would turn TC_019_1
 * green on TC_019_2's request, which is a vacuous pass wearing a conformance
 * verdict.
 *
 * Offline: parses fixture lines, runs nothing.
 */

import { AssertRecorder } from "../tck/assert";
import { parseLog } from "../tck/ocpp";
import { assertGetConfigurationUnfiltered } from "../tck/specs/core";

const DESCRIPTION = "GetConfiguration(no filter).req received";

/**
 * A Logger frame line in the shape ocpp.ts parses (see its LOG_LINE_RE).
 *
 * Only RECEIVED CALLs, and no responses: unlike tests/assert-answered.ts,
 * whose fixtures pair a request with its answer because assertAllAnswered
 * correlates by uniqueId, nothing here reads a response or an id. Carrying
 * them anyway would state a property this guard does not check.
 */
const received = (frame: unknown) =>
  `[2026-08-14T00:00:00Z] [INFO] [ws] Received: ${JSON.stringify(frame)}`;

const req = (payload: unknown) =>
  received([2, "a", "GetConfiguration", payload]);
const unrelated = () => received([2, "zz", "TriggerMessage", {}]);

const cases: Array<{
  name: string;
  lines: string[];
  expect: "PASS" | "FAIL";
}> = [
  {
    // The issue #31 case, and the only one no driver here can produce.
    name: "the key member is omitted -- the idiomatic 'no filter'",
    lines: [req({})],
    expect: "PASS",
  },
  {
    // What both bundled drivers send. Was the ONLY accepted spelling.
    name: "the key member is an empty array -- the same request",
    lines: [req({ key: [] })],
    expect: "PASS",
  },
  {
    // NOT the same encoding as an omitted member: `{"key":null}` puts the
    // member on the wire with a null value, and OCPP 1.6 types `key` as an
    // array, so it is not strictly schema-valid either. Accepted as "no
    // filter" all the same -- a CSMS that writes its unset optional members as
    // explicit nulls is asking for every key, and failing it would be the same
    // spelling-over-substance verdict issue #31 is about.
    //
    // The asymmetry with the malformed-payload cases below is deliberate. A
    // CALL payload MUST be an object: that is the OCPP-J envelope, and reading
    // a member off a non-object means the frame was never a GetConfiguration
    // request at all. A null MEMBER inside a well-formed payload is one CSMS's
    // way of spelling "unset", which is a different thing entirely.
    name: "the key member is null",
    lines: [req({ key: null })],
    expect: "PASS",
  },
  {
    // TC_019_2's request. The two scenarios measure different things and this
    // is the assertion that keeps them apart.
    name: "a non-empty filter is NOT an unfiltered request",
    lines: [req({ key: ["HeartbeatInterval"] })],
    expect: "FAIL",
  },
  {
    name: "the CSMS never sent GetConfiguration at all",
    lines: [unrelated()],
    expect: "FAIL",
  },
  {
    // `(null)?.key` is undefined, which is indistinguishable from an omitted
    // member unless the shape is checked first -- so without that check this
    // case reports a conformance PASS for a request that is not one.
    name: "a null payload is malformed, not unfiltered",
    lines: [req(null)],
    expect: "FAIL",
  },
  {
    // Same hole through the other opening: an array has no `key` property
    // either, and typeof [] === "object" gets past a null check alone.
    name: "an array payload is malformed, not unfiltered",
    lines: [req([])],
    expect: "FAIL",
  },
  {
    // And the third opening, which is the one a null-check alone misses:
    // typeof "foo" is not "object", and ("foo").key is undefined all the same.
    // This case is why the shape check tests the type and not just null and
    // Array.isArray -- without it those two clauses cover the two above and
    // the typeof clause is unprotected.
    name: "a scalar payload is malformed, not unfiltered",
    lines: [req("HeartbeatInterval")],
    expect: "FAIL",
  },
  {
    // Malformed is "not a witness", NOT "poison": a CSMS that also made a
    // proper unfiltered request has satisfied TC_019_1.
    name: "a malformed request beside a well-formed one still passes",
    lines: [req(null), req({})],
    expect: "PASS",
  },
  {
    // Same any-frame semantics the log-line regex had: the scenario asks once,
    // but a CSMS that batches or retries must not be failed for the requests
    // it made besides the unfiltered one.
    name: "an unfiltered request among filtered ones still passes",
    lines: [req({ key: ["HeartbeatInterval"] }), req({})],
    expect: "PASS",
  },
];

let failures = 0;
for (const { name, lines, expect } of cases) {
  const rec = new AssertRecorder();
  assertGetConfigurationUnfiltered(
    rec,
    parseLog(lines.join("\n")),
    DESCRIPTION,
  );
  const result = rec.results[0];
  if (result?.status === expect) continue;
  failures++;
  process.stderr.write(
    `FAIL: ${name}\n  expected ${expect}, got ${result?.status}` +
      `${result?.detail ? ` (${result.detail})` : ""}\n`,
  );
}

if (failures > 0) {
  process.stderr.write(
    `\nTC_019_1 no longer measures "unfiltered", it measures a spelling ` +
      `(${failures}/${cases.length} cases wrong). See the header of this file: ` +
      `an omitted key member and an empty key array are the same OCPP 1.6 ` +
      `request, and a non-empty filter is TC_019_2's.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `assertGetConfigurationUnfiltered: ${cases.length} cases OK\n`,
);
