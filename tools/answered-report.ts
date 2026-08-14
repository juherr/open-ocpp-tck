/**
 * tools/answered-report.ts -- how the CSMS answered every request the charge
 * point sent, per scenario, read back from a sweep's wire logs.
 *
 * WHY THIS EXISTS. Issue #11 rested on a claim worth keeping and impossible to
 * re-check: "scanning every captured wire log, FirmwareStatusNotification is
 * the only action answered with a CALLERROR anywhere in the suite". True when
 * it was written, and unverifiable a month later -- the logs are gitignored
 * and survive only as CI artifacts with a retention window. The claim had
 * become prose in two driver files.
 *
 * This turns it back into a measurement. Point it at a results/ directory and
 * it prints, per scenario and per action, how many charge-point requests were
 * answered, how many drew a CALLERROR, how many were never answered, and how
 * many were still in flight when the log ended.
 *
 * It is a REPORT, not a guard: it has no expectations and never exits
 * non-zero for what it finds. The guard is assertAllAnswered, per scenario,
 * against the obligations OCA-COVERAGE.md lists. This is for the questions
 * that come before writing a check -- does this scenario even send that
 * action, and does anything else in the suite have the same problem.
 *
 * Offline: reads files, talks to nothing.
 *
 *   bun tools/answered-report.ts [results-dir] [--csv]
 *
 * Default results-dir is ./results, matching the runner's own default.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { findResponseFor, parseLog, type CallFrame, type Frame } from "../tck/ocpp";

/** Actions a charge point initiates. A CALL sent in the other direction is
 *  the CSMS asking for something, which this report is not about. */
const CP_INITIATED = new Set([
  "Authorize",
  "BootNotification",
  "DataTransfer",
  "DiagnosticsStatusNotification",
  "FirmwareStatusNotification",
  "Heartbeat",
  "MeterValues",
  "StartTransaction",
  "StatusNotification",
  "StopTransaction",
]);

interface Tally {
  answered: number;
  callerror: number;
  unanswered: number;
  outstanding: number;
  /** First distinct CALLERROR seen, verbatim -- the actionable part. */
  errorSample?: string;
}

function tally(frames: readonly Frame[]): Map<string, Tally> {
  const byAction = new Map<string, Tally>();

  // Same rule as assertAllAnswered's rule 3, and it must stay the same rule:
  // an unanswered CALL is only damning if the CSMS answered something after
  // it. Anything past the last response it sent was cut off when the runner
  // stopped the container, not ignored.
  let lastResponseIndex = -1;
  frames.forEach((frame, index) => {
    if (frame.kind !== "call" && frame.direction === "received") {
      lastResponseIndex = index;
    }
  });

  frames.forEach((frame, index) => {
    if (frame.kind !== "call" || frame.direction !== "sent") return;
    const call = frame as CallFrame;
    if (!CP_INITIATED.has(call.action)) return;

    let t = byAction.get(call.action);
    if (!t) {
      t = { answered: 0, callerror: 0, unanswered: 0, outstanding: 0 };
      byAction.set(call.action, t);
    }

    const response = findResponseFor(frames, call);
    if (!response) {
      if (index < lastResponseIndex) t.unanswered++;
      else t.outstanding++;
      return;
    }
    if (response.kind === "callerror") {
      t.callerror++;
      t.errorSample ??= `${response.errorCode}: ${response.errorDescription}`;
      return;
    }
    t.answered++;
  });

  return byAction;
}

const args = process.argv.slice(2);
const csv = args.includes("--csv");
const dir = args.find((a) => !a.startsWith("--")) ?? "results";

let files: string[];
try {
  files = readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .sort();
} catch (err) {
  process.stderr.write(
    `cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}\n` +
      `Run a sweep first (bun run e2e), or pass the directory holding its .log files.\n`,
  );
  process.exit(1);
}

if (files.length === 0) {
  process.stderr.write(`no .log files in ${dir}\n`);
  process.exit(1);
}

const problems: string[] = [];
const out: string[] = [];

if (csv) {
  out.push("scenario,action,answered,callerror,unanswered,outstanding,error_sample");
}

for (const file of files) {
  const scenario = basename(file, ".log");
  const byAction = tally(parseLog(readFileSync(join(dir, file), "utf8")));

  if (!csv) out.push(`\n${scenario}`);

  for (const action of [...byAction.keys()].sort()) {
    const t = byAction.get(action)!;
    if (csv) {
      out.push(
        [
          scenario,
          action,
          t.answered,
          t.callerror,
          t.unanswered,
          t.outstanding,
          // CSV quoting, not JSON: a `"` inside the sample doubles, it does
          // not backslash-escape. Error descriptions come from the CSMS, so
          // this field is the only one that can carry either character.
          `"${(t.errorSample ?? "").replace(/"/g, '""')}"`,
        ].join(","),
      );
    } else {
      const flags = [
        t.callerror > 0 ? `${t.callerror} CALLERROR` : "",
        t.unanswered > 0 ? `${t.unanswered} unanswered` : "",
        t.outstanding > 0 ? `${t.outstanding} outstanding` : "",
      ].filter(Boolean);
      out.push(
        `  ${action.padEnd(30)} ${String(t.answered).padStart(3)} answered` +
          (flags.length ? `   <-- ${flags.join(", ")}` : ""),
      );
      if (t.errorSample) out.push(`  ${" ".repeat(30)} ${t.errorSample}`);
    }
    if (t.callerror > 0 || t.unanswered > 0) {
      problems.push(
        `${scenario}: ${action} (${t.callerror} CALLERROR, ${t.unanswered} unanswered)`,
      );
    }
  }
}

process.stdout.write(out.join("\n") + "\n");

if (!csv) {
  process.stdout.write(
    problems.length === 0
      ? `\nEvery charge-point request in ${files.length} scenarios was answered with a CALLRESULT.\n`
      : `\n${problems.length} action(s) not answered as the OCA cases require:\n` +
          problems.map((p) => `  ${p}\n`).join("") +
          `\nCross-check against OCA-COVERAGE.md: an entry there means a scenario ` +
          `should already be red, and an entry NOT there is a scenario that needs ` +
          `an assertAllAnswered it does not have.\n`,
  );
}
