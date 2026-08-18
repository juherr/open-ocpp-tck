/**
 * summary-red-rows.ts -- does this sweep's summary table carry a failing row?
 *
 * WHY IT IS A FILE AND NOT A `grep` IN THE WORKFLOW. It used to be one line of
 * .github/workflows/ci.yml, and a line of YAML is a line nothing can test: the
 * only way to find out what it matched was to run a 15-minute sweep and read
 * the job. In that state it acquired two silent bindings, both of the shape
 * this repository keeps naming -- green on what it no longer covers.
 *
 * WHAT IT ANSWERS, in three parts:
 *   1. THE VERDICT COLUMN IS FOUND BY NAME. `writeSummary` appends a column per
 *      thing a run actually did ("isolated retry" appears only when the flag
 *      ran), and its own doc comment says this table is read from outside the
 *      runtime by header name, "so appending a column is free and renaming or
 *      reordering one is not". The expression this replaces read the THIRD
 *      column, so a column inserted before `verdict` would have left it matching
 *      prose, quietly, with a green job as the only symptom.
 *   2. IT CARRIES NO SCENARIO NAMESPACE. It used to require `cert16-`, so a red
 *      `cert201-` row would not have been a red row at all. The row's SHAPE is
 *      what this is about; which certification namespace a scenario belongs to
 *      is incidental, and a literal here would be the same bug again the first
 *      time a third namespace appears.
 *   3. A TABLE IT CANNOT READ IS REFUSED, never reported as "no red rows". No
 *      header, no `verdict` column, a row with the wrong number of cells, or a
 *      verdict cell spelling nothing `tck/standing.ts` calls a verdict: all exit
 *      2. A failed search is not a passing check (68d3458).
 *
 * WHY TYPESCRIPT, for a question a `grep` used to answer. The vocabulary in
 * part 3 belongs to the runner that wrote the table, and this file holds no copy
 * of it: renaming a verdict in `tck/standing.ts` fails the typecheck there, on
 * `VERDICTS` itself, and then travels here through the import. Spelled out in
 * awk it would be a third copy linked to nothing, and the disagreement would
 * surface only inside the e2e job -- the reachable-only-by-sweeping property
 * this file was extracted to remove, reintroduced one layer down. bun is
 * installed in that job before this runs, so the move costs nothing there.
 *
 * TWO REFACTORS CONSIDERED AND NOT TAKEN, noted where they would be re-proposed:
 *
 *  - EMIT THE ANSWER FROM THE RUNNER instead of reading the artifact.
 *    `tck/main.ts` knows every verdict already. `tools/flake-report.ts` costed
 *    the machine-readable twin and rejected it: it answers nothing about the
 *    artifacts that already exist, and "two parsers for one fact is the drift
 *    tck/standing.ts warns about, one level up". The table is the public
 *    artifact and reading it is the right layer -- and `tck/main.ts` is
 *    `upstream-patched`, so writing there costs a re-pin as well.
 *  - SHARE THE PARSE WITH `tools/flake-report.ts`, whose `parseSummary` finds
 *    the same header the same way. Its reader is welded to that file's
 *    `Observation` shape and to a policy this file does not share (it RECORDS an
 *    unreadable row and continues; this one REFUSES), so lifting it is a
 *    refactor of a file no namespace question touches. Worth doing when a third
 *    reader appears; the vocabulary, which was the part that could drift
 *    silently, is already shared.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: tell an expected failure from an unexpected
 * one. Its caller captures the CSMS log, where over-capturing costs a file
 * nobody reads and under-capturing costs the investigation. That distinction is
 * `standingOf`'s, and it is the sweep's exit code, not this.
 *
 * Usage: bun tools/summary-red-rows.ts <summary.md>
 *   exit 0  at least one failing row, each printed to stdout (grep's answer, so
 *           the caller's `if` reads the way the `grep` it replaces did)
 *   exit 1  none
 *   exit 2  the file or the table could not be read
 */
import { readFileSync } from "node:fs";
import { isFailure, VERDICTS, type Verdict } from "../tck/standing";

function refuse(message: string): never {
  process.stderr.write(`REFUSED: ${message}\n`);
  process.stderr.write(
    "  → the table changed shape under this script. Teach it the new one;\n" +
      "    reporting 'no red rows' for a table nobody read is how a check\n" +
      "    goes green on what it stopped covering.\n",
  );
  process.exit(2);
}

/** The leading verdict of a cell whose tail may carry a NOT APPLICABLE reason
 *  or an expected-failure note, both free prose. */
function leadingVerdict(cell: string): Verdict | null {
  return VERDICTS.find((v) => cell.startsWith(v)) ?? null;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: bun tools/summary-red-rows.ts <summary.md>\n");
  process.exit(2);
}

let text = "";
try {
  text = readFileSync(path, "utf8");
} catch {
  // Not "no red rows": a sweep that died before writing a summary has an answer
  // nobody has, and saying "none" for it is the failure mode above.
  refuse(`${path} could not be read.`);
}
if (text.trim() === "") refuse(`${path} is empty.`);

const lines = text.split("\n");
const cellsOf = (line: string): string[] =>
  line.split("|").map((cell) => cell.trim());

// The header, found by its first column rather than by line number: a title and
// a run line precede the table, free prose follows it.
const headerAt = lines.findIndex((line) => /^\|\s*scenario\s*\|/.test(line));
if (headerAt === -1) {
  refuse("no summary table -- no header row starting `| scenario |`.");
}
const columns = cellsOf(lines[headerAt]);
const verdictAt = columns.indexOf("verdict");
if (verdictAt === -1) refuse("the summary table has no `verdict` column.");

const red: string[] = [];
// +2 skips the `| --- | --- |` rule, which is a row only in Markdown's sense.
for (const line of lines.slice(headerAt + 2)) {
  if (!line.startsWith("|")) continue;
  const cells = cellsOf(line);
  if (cells.length !== columns.length) {
    refuse(
      `a row has ${cells.length} cells where the header has ` +
        `${columns.length}:\n  ${line}`,
    );
  }
  const verdict = leadingVerdict(cells[verdictAt]);
  if (verdict === null) {
    refuse(
      `a verdict cell spells no verdict tck/standing.ts knows:\n  ${cells[verdictAt]}`,
    );
  }
  if (isFailure(verdict)) red.push(line);
}

for (const line of red) process.stdout.write(`${line}\n`);
process.exit(red.length > 0 ? 0 : 1);
