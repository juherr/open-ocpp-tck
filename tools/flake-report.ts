// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * flake-report.ts -- which scenarios flake, how often, and under what load.
 *
 * WHY IT EXISTS. Every sweep publishes `results/` and nothing has ever read two
 * of them together. So "this scenario is flaky" has only ever been an
 * impression formed by whoever happened to watch the same red row twice, and
 * the one time it was acted on (#4) it was acted on for a single scenario
 * family: the tuning was right and it generalised to nothing, because nobody
 * could see the class. This reads a directory of downloaded run artifacts and
 * answers the question the impression was standing in for.
 *
 * WHAT COUNTS AS A FLAKE, and it is not this tool's invention. The runner
 * already models it: `--retry-failed-isolated` re-runs a parallel FAIL/ERROR
 * sequentially against the same CSMS, and a non-failing retry means the
 * parallel verdict was contention rather than a finding (`tck/standing.ts`,
 * `effectivelyFailed`). Every run that carries the `isolated retry` column
 * carries that adjudication, and this tool reports it rather than re-deciding
 * it.
 *
 * The second signal is weaker and reported separately: a scenario that FAILED
 * in one run and PASSED in another, with nothing else distinguishing the two.
 * That is not an adjudication -- the CSMS may simply have been fixed between
 * them -- which is exactly why the two columns stay apart instead of being
 * added together into one number nobody can act on.
 *
 * WHAT IT CANNOT SEE, stated because the corpus is more partial than it looks:
 *
 *   - `summary.md` is the ONLY artifact carrying verdicts. The per-scenario
 *     `results/<template-id>.log` is the simulator wire log; the PASS/FAIL
 *     lines went to stdout and were never captured. So a run whose sweep died
 *     before the summary was written contributes nothing, and this tool says
 *     how many did rather than quietly averaging over the rest.
 *   - A sweep that ran GROUP BY GROUP overwrote `results/summary.md` once per
 *     group, so its artifact records only the last group. Those runs are read
 *     for the scenarios they do contain and counted as partial; the header of
 *     the report names them. This is not hypothetical -- more than half of
 *     this repository's archived sweeps are in that shape.
 *   - The driver, the branch and the run id are not in `summary.md`. They are
 *     in the artifact NAME, which is the caller's directory layout, so this
 *     tool treats each run directory's name as an opaque label, prints it, and
 *     leaves grouping to whoever knows what the labels mean. `--json` emits
 *     every observation individually for exactly that.
 *
 * NO SILENT CAPS: a row this parser cannot read is reported as unparsed, by
 * file. A report that quietly dropped what it could not understand would read
 * as "nothing to see here", which is the failure mode of every flake
 * impression it exists to replace.
 *
 * Offline: reads a directory. It downloads nothing -- fetching the corpus is
 * `gh run download`, which is the operator's business and not this tool's.
 *
 * Usage:
 *   bun tools/flake-report.ts <corpus-dir> [--json] [--min-runs N]
 *
 * Fetching the corpus, for the reader who wants to reproduce a number rather
 * than take one -- one directory per artifact, which is the layout above:
 *
 *   gh api --paginate 'repos/<owner>/<repo>/actions/artifacts?per_page=100' \
 *     -q '.artifacts[] | [.id, .name, .workflow_run.id, .created_at] | @tsv' \
 *   | while IFS=$'\t' read -r id name run created; do
 *       dest="corpus/${created%T*}__${run}__${name%%-results-*}"
 *       mkdir -p "$dest"
 *       gh api "repos/<owner>/<repo>/actions/artifacts/$id/zip" > "$dest/a.zip"
 *       unzip -qo "$dest/a.zip" -d "$dest" && rm "$dest/a.zip"
 *     done
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "ERROR" | "NOT APPLICABLE";

const VERDICTS: readonly Verdict[] = [
  "NOT APPLICABLE",
  "PARTIAL",
  "PASS",
  "FAIL",
  "ERROR",
];

/** One scenario row of one run. */
interface Observation {
  run: string;
  group: string;
  timestamp: string;
  /** Host load as the sweep measured it, or null when the line predates it. */
  load: number | null;
  cores: number | null;
  saturated: boolean;
  templateId: string;
  cpId: string;
  verdict: Verdict;
  /** Present only when the run passed --retry-failed-isolated AND this row
   *  failed in its lane. `null` everywhere else -- including a run that used
   *  the flag and where this row simply did not fail. */
  retryVerdict: Verdict | null;
}

interface ParsedRun {
  run: string;
  observations: Observation[];
  /** Rows the table shape says are there and this parser could not read. */
  unparsed: string[];
}

/** The leading verdict of a summary's verdict cell, whose tail may carry a
 *  NOT APPLICABLE reason or an expected-failure note, both free prose. */
function leadingVerdict(cell: string): Verdict | null {
  for (const v of VERDICTS) if (cell.startsWith(v)) return v;
  return null;
}

function parseSummary(runLabel: string, text: string): ParsedRun | null {
  const lines = text.split("\n");
  const title = lines.find((l) => l.startsWith("# OCPP verification results"));
  if (!title) return null;
  const group = title.replace(/.*group: /, "").trim();

  const meta = lines.find((l) => l.startsWith("Run at "));
  const timestamp = meta?.match(/Run at (\S+?)\./)?.[1] ?? "";
  const loadMatch = meta?.match(/Host load ([\d.]+) over (\d+) core/);
  const load = loadMatch ? Number(loadMatch[1]) : null;
  const cores = loadMatch ? Number(loadMatch[2]) : null;
  const saturated = meta?.includes("SATURATED") ?? false;

  const headerIdx = lines.findIndex((l) => l.startsWith("| scenario |"));
  if (headerIdx === -1) return null;
  const columns = lines[headerIdx].split("|").length;
  const hasRetry = lines[headerIdx].includes("isolated retry");

  const observations: Observation[] = [];
  const unparsed: string[] = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length !== columns) {
      unparsed.push(line);
      continue;
    }
    const verdict = leadingVerdict(cells[3]);
    if (verdict === null) {
      unparsed.push(line);
      continue;
    }
    // "-" when the run retried nothing for this row; "VERDICT (flake)" or
    // "VERDICT (confirmed)" when it did. The parenthetical is the runner's own
    // adjudication and is re-derived here from the verdict rather than trusted
    // as prose -- one reading of `effectivelyFailed`, not two.
    const retryCell = hasRetry ? cells[7] : "-";
    const retryVerdict =
      retryCell === "-" || retryCell === "" ? null : leadingVerdict(retryCell);

    observations.push({
      run: runLabel,
      group,
      timestamp,
      load,
      cores,
      saturated,
      templateId: cells[1],
      cpId: cells[2],
      verdict,
      retryVerdict,
    });
  }
  return { run: runLabel, observations, unparsed };
}

const isFailure = (v: Verdict): boolean => v === "FAIL" || v === "ERROR";

interface ScenarioStats {
  templateId: string;
  runs: number;
  failed: number;
  /** Failed in a lane, did not fail on the isolated retry: the runner's own
   *  verdict that the failure was contention. */
  adjudicatedFlakes: number;
  /** Failed in a lane and failed again isolated. */
  confirmed: number;
  /** Failed with no retry to adjudicate it -- a sequential run, or a sweep
   *  that did not pass the flag. Neither flake nor finding, and kept in its
   *  own column rather than folded into one of them. */
  unadjudicated: number;
  /** FAILED in at least one run and PASSED in at least one other. Weaker than
   *  an adjudication and reported as such. */
  bothWays: boolean;
  flakeRuns: Observation[];
}

function aggregate(observations: Observation[]): ScenarioStats[] {
  const byScenario = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = byScenario.get(o.templateId);
    if (list) list.push(o);
    else byScenario.set(o.templateId, [o]);
  }

  const stats: ScenarioStats[] = [];
  for (const [templateId, list] of byScenario) {
    const failures = list.filter((o) => isFailure(o.verdict));
    const adjudicated = failures.filter((o) => o.retryVerdict !== null);
    const flakes = adjudicated.filter((o) => !isFailure(o.retryVerdict!));
    stats.push({
      templateId,
      runs: list.length,
      failed: failures.length,
      adjudicatedFlakes: flakes.length,
      confirmed: adjudicated.length - flakes.length,
      unadjudicated: failures.length - adjudicated.length,
      bothWays:
        failures.length > 0 && list.some((o) => o.verdict === "PASS"),
      flakeRuns: flakes,
    });
  }
  stats.sort(
    (a, b) =>
      b.adjudicatedFlakes - a.adjudicatedFlakes ||
      b.failed - a.failed ||
      a.templateId.localeCompare(b.templateId),
  );
  return stats;
}

/** Every directory under `root` that holds a summary.md, plus the ones that
 *  hold artifacts and no summary -- the second count is part of the answer. */
function collect(root: string): {
  runs: ParsedRun[];
  withoutSummary: string[];
  unreadable: string[];
} {
  const runs: ParsedRun[] = [];
  const withoutSummary: string[] = [];
  const unreadable: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, "summary.md"), "utf8");
    } catch {
      withoutSummary.push(entry);
      continue;
    }
    const parsed = parseSummary(entry, text);
    if (parsed === null) unreadable.push(entry);
    else runs.push(parsed);
  }
  return { runs, withoutSummary, unreadable };
}

function renderMarkdown(
  stats: ScenarioStats[],
  runs: ParsedRun[],
  withoutSummary: string[],
  unreadable: string[],
  minRuns: number,
): string {
  const observations = runs.flatMap((r) => r.observations);
  const partialRuns = runs.filter((r) => r.observations.length < 10);
  const withRetry = runs.filter((r) =>
    r.observations.some((o) => o.retryVerdict !== null),
  );
  const unparsedRows = runs.reduce((n, r) => n + r.unparsed.length, 0);

  const out: string[] = [
    "# Scenario flake record",
    "",
    `${runs.length} run(s) with a summary, ${observations.length} scenario ` +
      `observation(s), ${stats.length} distinct scenario(s).`,
    "",
    `- ${withoutSummary.length} artifact dir(s) carry logs and NO summary.md ` +
      "— a sweep that died before writing one contributes no verdicts at all.",
    `- ${partialRuns.length} run(s) report fewer than 10 scenarios: a ` +
      "group-by-group sweep overwrote results/summary.md once per group, so " +
      "only its last group survives. Read for what they do contain.",
    `- ${withRetry.length} run(s) carry an isolated retry, which is the only ` +
      "column that ADJUDICATES a failure as contention rather than a finding.",
    `- ${unreadable.length} summary file(s) had no table this parser could ` +
      `find; ${unparsedRows} row(s) inside readable tables were not parsed.`,
    "",
    "| scenario | runs | failed | flake (adjudicated) | confirmed | unadjudicated | passed elsewhere |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const s of stats) {
    if (s.runs < minRuns) continue;
    if (s.failed === 0) continue;
    out.push(
      `| ${s.templateId} | ${s.runs} | ${s.failed} | ${s.adjudicatedFlakes} ` +
        `| ${s.confirmed} | ${s.unadjudicated} | ${s.bothWays ? "yes" : "no"} |`,
    );
  }

  const clean = stats.filter((s) => s.failed === 0 && s.runs >= minRuns);
  out.push(
    "",
    `${clean.length} scenario(s) never failed in this corpus and are omitted ` +
      "from the table above.",
  );

  const flakes = stats.filter((s) => s.adjudicatedFlakes > 0);
  if (flakes.length > 0) {
    out.push("", "## Load at the moment each adjudicated flake happened", "");
    out.push("| scenario | run | host load | cores | saturated |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const s of flakes) {
      for (const o of s.flakeRuns) {
        out.push(
          `| ${s.templateId} | ${o.run} | ${o.load ?? "-"} | ${o.cores ?? "-"} ` +
            `| ${o.saturated ? "yes" : "no"} |`,
        );
      }
    }
  }
  return out.join("\n") + "\n";
}

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith("--"));
  const asJson = argv.includes("--json");
  const minRunsIdx = argv.indexOf("--min-runs");
  const minRuns = minRunsIdx === -1 ? 1 : Number(argv[minRunsIdx + 1]);
  const root = args[0];

  if (!root || Number.isNaN(minRuns)) {
    process.stderr.write(
      "Usage: bun tools/flake-report.ts <corpus-dir> [--json] [--min-runs N]\n" +
        "\n" +
        "  <corpus-dir> holds one directory per run, each the unzipped\n" +
        "  results/ of a sweep. Fetch them with `gh run download`; this tool\n" +
        "  reads what is already on disk.\n",
    );
    return 2;
  }

  const { runs, withoutSummary, unreadable } = collect(root);
  if (runs.length === 0) {
    process.stderr.write(
      `No run under ${root} had a readable summary.md. That is not an empty ` +
        "answer, it is no corpus: check the layout is one directory per run.\n",
    );
    return 1;
  }

  const observations = runs.flatMap((r) => r.observations);
  const stats = aggregate(observations);

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          corpus: {
            runsWithSummary: runs.length,
            runsWithoutSummary: withoutSummary,
            unreadableSummaries: unreadable,
            unparsedRows: runs.flatMap((r) =>
              r.unparsed.map((row) => ({ run: r.run, row })),
            ),
          },
          scenarios: stats.map(({ flakeRuns, ...rest }) => ({
            ...rest,
            flakeRuns: flakeRuns.map((o) => o.run),
          })),
          observations,
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stdout.write(
    renderMarkdown(stats, runs, withoutSummary, unreadable, minRuns),
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
