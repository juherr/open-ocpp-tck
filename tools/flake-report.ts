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
 *   - In every artifact archived before this was written, a flake's wire log
 *     is the RETRY's: both attempts wrote `results/<template-id>.log` and the
 *     re-run replaced the attempt it was adjudicating. So the rows this report
 *     is most confident about are exactly the ones whose evidence is gone.
 *     Runs from here on keep both -- `<template-id>.log` for the sweep,
 *     `<template-id>.retry.log` for the re-run -- and a red sweep also carries
 *     the CSMS's own `csms-<driver>.log`. Neither is read here; they are what
 *     makes a row in this table answerable once it is found.
 *
 * NO SILENT CAPS: a row this parser cannot read is reported as unparsed, by
 * file. A report that quietly dropped what it could not understand would read
 * as "nothing to see here", which is the failure mode of every flake
 * impression it exists to replace.
 *
 * WHY IT PARSES MARKDOWN INSTEAD OF READING A MACHINE-READABLE TWIN, since
 * that is the obvious objection and it has been costed. Emitting
 * `results/outcomes.json` beside the summary would archive for free -- CI
 * uploads `results/` wholesale -- but it answers nothing about the ~119
 * artifacts that already exist, which are the entire corpus this file was
 * written for. The markdown path would have to be written and kept anyway,
 * and two parsers for one fact is the drift `tck/standing.ts` warns about,
 * one level up. Revisit when most of the corpus carries both; until then the
 * defence against a reordered column is reading cells by header NAME, below.
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
import {
  effectivelyFailed,
  isFailure,
  type Verdict,
} from "../tck/standing";

// The verdict vocabulary and the flake rule come from the runner that wrote
// these tables, never from a second copy here. `tck/standing.ts` says why in
// its own words -- "ONE definition, deliberately ... written twice they would
// drift, and the drift would be silent in the worst possible place" -- and a
// flake record that disagreed with the sweep that produced it is exactly that
// place. `tools/answered-report.ts` already imports from `../tck/`.
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
  /** Seconds this scenario's observation window ran past its holdSecs. `null`
   *  on every run archived before the runner grew that column, which is most
   *  of the corpus -- so it reads as "not recorded", never as zero. */
  extraHoldSecs: number | null;
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
  // BY NAME, NOT BY POSITION. `writeSummary` appends a column per thing a run
  // actually did -- "isolated retry" when it retried, "held past floor" when a
  // window outlived its holdSecs -- so the corpus is already several table
  // shapes and will grow more. Reading `cells[7]` would make every one of
  // those a silent misparse of the column that moved into it; reading the
  // header makes an unknown shape a row this file reports as unparsed.
  const columns = lines[headerIdx].split("|").map((c) => c.trim());
  const at = (name: string): number => columns.indexOf(name);
  const [verdictAt, templateAt, cpAt, retryAt, heldAt] = [
    at("verdict"),
    at("scenario"),
    at("cp"),
    at("isolated retry"),
    at("held past floor"),
  ];
  if (verdictAt === -1 || templateAt === -1 || cpAt === -1) return null;

  /** A cell that a run of this shape may not have, or may have left as "-". */
  const optional = (cells: string[], index: number): string | null => {
    if (index === -1) return null;
    const cell = cells[index];
    return cell === "-" || cell === "" ? null : cell;
  };

  const observations: Observation[] = [];
  const unparsed: string[] = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length !== columns.length) {
      unparsed.push(line);
      continue;
    }
    const verdict = leadingVerdict(cells[verdictAt]);
    if (verdict === null) {
      unparsed.push(line);
      continue;
    }
    // The retry cell reads "VERDICT (flake)" or "VERDICT (confirmed)". Only
    // the verdict is taken: the parenthetical is the runner's adjudication
    // rendered as prose, and re-deriving it through `effectivelyFailed` keeps
    // this file to one reading of that rule rather than trusting a word.
    const retryCell = optional(cells, retryAt);
    const heldCell = optional(cells, heldAt);

    observations.push({
      run: runLabel,
      group,
      timestamp,
      load,
      cores,
      saturated,
      templateId: cells[templateAt],
      cpId: cells[cpAt],
      verdict,
      retryVerdict: retryCell === null ? null : leadingVerdict(retryCell),
      extraHoldSecs: heldCell === null ? null : Number(heldCell.replace(/[+s]/g, "")),
    });
  }
  return { run: runLabel, observations, unparsed };
}

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
    const flakes = adjudicated.filter(
      (o) => !effectivelyFailed(o.verdict, o.retryVerdict ?? undefined),
    );
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
interface Corpus {
  runs: ParsedRun[];
  withoutSummary: string[];
  unreadable: string[];
}

function collect(root: string): Corpus {
  const runs: ParsedRun[] = [];
  const withoutSummary: string[] = [];
  const unreadable: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    // By name, rather than as a stack trace out of node:fs. A mistyped path is
    // the most likely way to run this wrong, and the whole file is written so
    // that reading nothing never looks like finding nothing.
    throw new Error(`cannot read the corpus directory '${root}'`);
  }
  for (const entry of entries) {
    const dir = join(root, entry);
    let isDir: boolean;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      // A dangling symlink is not a run and is not a reason to abandon the
      // other 118.
      unreadable.push(entry);
      continue;
    }
    if (!isDir) continue;
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
  corpus: Corpus,
  stats: ScenarioStats[],
  observations: Observation[],
  minRuns: number,
): string {
  const { runs, withoutSummary, unreadable } = corpus;
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
  // ONE PASS, so that a flag's VALUE is consumed rather than left to be
  // mistaken for the corpus path. Filtering out `--`-prefixed words and taking
  // the first survivor reads correctly and resolves `--min-runs 5 corpus` to a
  // corpus directory named "5" -- an argument order this usage line does not
  // forbid, failing in a way it does not mention.
  const positional: string[] = [];
  let asJson = false;
  let minRuns = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") asJson = true;
    else if (argv[i] === "--min-runs") minRuns = Number(argv[++i]);
    else if (argv[i].startsWith("--")) {
      process.stderr.write(`Unknown argument: ${argv[i]}\n`);
      return 2;
    } else positional.push(argv[i]);
  }
  const root = positional[0];

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

  let collected;
  try {
    collected = collect(root);
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n` +
        "  → the argument is the directory holding one subdirectory per run,\n" +
        "    not a run directory and not a summary.md.\n",
    );
    return 2;
  }
  const { runs, withoutSummary, unreadable } = collected;
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

  process.stdout.write(renderMarkdown(collected, stats, observations, minRuns));
  return 0;
}

process.exit(main(process.argv.slice(2)));
