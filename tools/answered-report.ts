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

import { tallyAnswers, type AnswerTally } from "../tck/assert";
import { parseLog, type Frame } from "../tck/ocpp";

/**
 * Every action the charge point sent a CALL for, in log order of first
 * appearance then sorted for a stable report.
 *
 * Derived rather than listed: a CALL the CP SENT is a CP-initiated request by
 * definition, so an allowlist of the ten OCPP 1.6 actions would only be a
 * second place to maintain that vocabulary -- and anything missing from it
 * (a vendor DataTransfer variant, an action a new scenario starts sending)
 * would vanish from the report, which is exactly the question this tool
 * exists to answer.
 */
function actionsSentBy(frames: readonly Frame[]): string[] {
  const actions = new Set<string>();
  for (const frame of frames) {
    if (frame.kind === "call" && frame.direction === "sent") {
      actions.add(frame.action);
    }
  }
  return [...actions].sort();
}

interface Row {
  scenario: string;
  action: string;
  tally: AnswerTally;
}

function renderCsv(rows: readonly Row[]): string {
  const out = [
    "scenario,action,answered,callerror,unanswered,outstanding,error_sample",
  ];
  for (const { scenario, action, tally } of rows) {
    // CSV quoting, not JSON: a `"` inside the sample doubles, it does not
    // backslash-escape. Error descriptions come from the CSMS, so this field
    // is the only one that can carry either character.
    const sample = tally.errors[0]
      ? `${tally.errors[0].errorCode}: ${tally.errors[0].errorDescription}`
      : "";
    out.push(
      [
        scenario,
        action,
        tally.answered,
        tally.errors.length,
        tally.unanswered,
        tally.outstanding,
        `"${sample.replace(/"/g, '""')}"`,
      ].join(","),
    );
  }
  return out.join("\n");
}

function renderHuman(rows: readonly Row[], scenarioCount: number): string {
  const out: string[] = [];
  let scenario = "";
  for (const row of rows) {
    if (row.scenario !== scenario) {
      scenario = row.scenario;
      out.push(`\n${scenario}`);
    }
    const { tally } = row;
    const flags = [
      tally.errors.length > 0 ? `${tally.errors.length} CALLERROR` : "",
      tally.unanswered > 0 ? `${tally.unanswered} unanswered` : "",
      tally.outstanding > 0 ? `${tally.outstanding} outstanding` : "",
    ].filter(Boolean);
    out.push(
      `  ${row.action.padEnd(30)} ${String(tally.answered).padStart(3)} answered` +
        (flags.length ? `   <-- ${flags.join(", ")}` : ""),
    );
    const first = tally.errors[0];
    if (first) {
      out.push(
        `  ${" ".repeat(30)} ${first.errorCode}: ${first.errorDescription}`,
      );
    }
  }

  const problems = rows.filter(
    (r) => r.tally.errors.length > 0 || r.tally.unanswered > 0,
  );
  out.push(
    problems.length === 0
      ? `\nEvery charge-point request in ${scenarioCount} scenarios was answered with a CALLRESULT.`
      : `\n${problems.length} action(s) not answered as the OCA cases require:\n` +
          problems
            .map(
              (r) =>
                `  ${r.scenario}: ${r.action} (${r.tally.errors.length} CALLERROR, ${r.tally.unanswered} unanswered)\n`,
            )
            .join("") +
          `\nCross-check against OCA-COVERAGE.md: an entry there means a scenario ` +
          `should already be red, and an entry NOT there is a scenario that needs ` +
          `an assertAllAnswered it does not have.`,
  );
  return out.join("\n");
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

const rows: Row[] = [];
for (const file of files) {
  const scenario = basename(file, ".log");
  const frames = parseLog(readFileSync(join(dir, file), "utf8"));
  for (const action of actionsSentBy(frames)) {
    rows.push({ scenario, action, tally: tallyAnswers(frames, action) });
  }
}

process.stdout.write(
  (csv ? renderCsv(rows) : renderHuman(rows, files.length)) + "\n",
);
