/**
 * tests/assert-answered.ts -- guard over assertAllAnswered's three rules.
 *
 * PROPERTY: a CSMS that answers a charge-point request with a CALLERROR, or
 * that never answers it at all, produces a FAILED check -- and a wire log
 * truncated mid-exchange does not.
 *
 * Why this is a guard and not a unit test. The three rules are unreachable
 * through the CLI: reaching rule 2 needs a CSMS that emits a CALLERROR, and
 * reaching rule 3 needs a run whose container was killed between a CALL and
 * its response. Both are real (rule 2 is CitrineOS answering
 * FirmwareStatusNotification; rule 3 is every scenario whose charge point was
 * still talking at holdSecs), and neither is reproducible offline except by
 * handing the helper the frames directly. Same reasoning as
 * tests/driver-env-scope.ts, and the same reason this one is TypeScript.
 *
 * Rule 3 is the one worth protecting. It is the difference between a check
 * that measures the CSMS and one that measures holdSecs, and getting it
 * backwards produces intermittent red rather than an obvious break -- which
 * is exactly the failure a guard is cheap insurance against.
 */

import { AssertRecorder, assertAllAnswered, type AnsweredOptions } from "../tck/assert";
import { parseLog } from "../tck/ocpp";

const ACTION = "FirmwareStatusNotification";

/** A Logger frame line in the shape ocpp.ts parses (see its LOG_LINE_RE). */
function line(direction: "Sent" | "Received", frame: unknown): string {
  return `[2026-08-14T00:00:00Z] [INFO] [ws] ${direction}: ${JSON.stringify(frame)}`;
}

const req = (id: string, status: string) =>
  line("Sent", [2, id, ACTION, { status }]);
const conf = (id: string) => line("Received", [3, id, {}]);
const callerror = (id: string) =>
  line("Received", [
    4,
    id,
    "NotSupported",
    `No handler found for action: ${ACTION} at module configuration`,
    {},
  ]);
const unrelated = () => line("Sent", [2, "zz", "Heartbeat", {}]);

const cases: Array<{
  name: string;
  lines: string[];
  expect: "PASS" | "FAIL";
  options?: AnsweredOptions;
}> = [
  {
    name: "every request answered",
    lines: [req("a", "Downloading"), conf("a"), req("b", "Installed"), conf("b")],
    expect: "PASS",
  },
  {
    name: "rule 2: one CALLERROR among answers",
    lines: [req("a", "Downloading"), conf("a"), req("b", "Installed"), callerror("b")],
    expect: "FAIL",
  },
  {
    name: "rule 2: every request answered with a CALLERROR",
    lines: [req("a", "Downloading"), callerror("a"), req("b", "Installed"), callerror("b")],
    expect: "FAIL",
  },
  {
    name: "rule 1: the action was never sent -- not a vacuous pass",
    lines: [unrelated()],
    expect: "FAIL",
  },
  {
    name: "rule 1: minimum is honoured",
    lines: [req("a", "Downloading"), conf("a")],
    expect: "FAIL",
    options: { minimum: 2 },
  },
  {
    name: "rule 3: a trailing CALL is outstanding, not unanswered",
    lines: [req("a", "Downloading"), conf("a"), req("b", "Installed")],
    expect: "PASS",
  },
  {
    name: "rule 3: an unanswered CALL the log outlived is a failure",
    lines: [req("a", "Downloading"), req("b", "Installed"), conf("b")],
    expect: "FAIL",
  },
  {
    name: "responses correlate by uniqueId, not by adjacency",
    lines: [req("a", "Downloading"), req("b", "Installed"), conf("b"), conf("a")],
    expect: "PASS",
  },
];

let failures = 0;
for (const { name, lines, expect, options } of cases) {
  const rec = new AssertRecorder();
  assertAllAnswered(rec, parseLog(lines.join("\n")), ACTION, undefined, options);
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
    `\nassertAllAnswered no longer enforces its own contract ` +
      `(${failures}/${cases.length} cases wrong). See the header of this file: ` +
      `rule 2 is what makes a CALLERROR red, rule 3 is what keeps a truncated ` +
      `log from being red.\n`,
  );
  process.exit(1);
}

process.stdout.write(`assertAllAnswered: ${cases.length} cases OK\n`);
