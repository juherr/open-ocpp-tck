/**
 * tests/get-configuration-filter.ts -- guard over what TC_019_1 measures.
 *
 * PROPERTY, in four parts. A GetConfiguration that asks for NO filter passes
 * whichever way the CSMS spells it -- both an ABSENT `key` member and an EMPTY
 * `key` array -- while a request carrying a NON-EMPTY filter fails, and so does
 * a run where no GetConfiguration ever reached the charge point.
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
 * The last part matters as much as the first two, and it is why this is not
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

/** A Logger frame line in the shape ocpp.ts parses (see its LOG_LINE_RE). */
function line(direction: "Sent" | "Received", frame: unknown): string {
  return `[2026-08-14T00:00:00Z] [INFO] [ws] ${direction}: ${JSON.stringify(frame)}`;
}

const req = (id: string, payload: unknown) =>
  line("Received", [2, id, "GetConfiguration", payload]);
const conf = (id: string) =>
  line("Sent", [3, id, { configurationKey: [{ key: "HeartbeatInterval", value: "60" }] }]);
const unrelated = () => line("Received", [2, "zz", "TriggerMessage", {}]);

const cases: Array<{
  name: string;
  lines: string[];
  expect: "PASS" | "FAIL";
}> = [
  {
    // The issue #31 case, and the only one no driver here can produce.
    name: "the key member is omitted -- the idiomatic 'no filter'",
    lines: [req("a", {}), conf("a")],
    expect: "PASS",
  },
  {
    // What both bundled drivers send. Was the ONLY accepted spelling.
    name: "the key member is an empty array -- the same request",
    lines: [req("a", { key: [] }), conf("a")],
    expect: "PASS",
  },
  {
    // Absent and null are the same absence over the wire: a CSMS that
    // serialises its optional members as explicit nulls is still asking for
    // everything.
    name: "the key member is null",
    lines: [req("a", { key: null }), conf("a")],
    expect: "PASS",
  },
  {
    // TC_019_2's request. The two scenarios measure different things and this
    // is the assertion that keeps them apart.
    name: "a non-empty filter is NOT an unfiltered request",
    lines: [req("a", { key: ["HeartbeatInterval"] }), conf("a")],
    expect: "FAIL",
  },
  {
    name: "the CSMS never sent GetConfiguration at all",
    lines: [unrelated()],
    expect: "FAIL",
  },
  {
    // Same any-frame semantics the log-line regex had: the scenario asks once,
    // but a CSMS that batches or retries must not be failed for the requests
    // it made besides the unfiltered one.
    name: "an unfiltered request among filtered ones still passes",
    lines: [req("a", { key: ["HeartbeatInterval"] }), req("b", {}), conf("b")],
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
