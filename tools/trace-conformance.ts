/**
 * trace-conformance.ts -- does `trace-format/` actually implement the format?
 *
 * The comparison half of `tools/trace-conformance.sh`, which does the network.
 * Split that way because the clone is the part that needs pinning and the
 * comparison is the part worth reading.
 *
 * TWO CORPORA, ANSWERING TWO DIFFERENT QUESTIONS.
 *
 *  - THE SPECIFICATION'S FIXTURES answer "is this reader conformant". Each is
 *    a `trace.jsonl` and the `expected.json` view a conformant consumer must
 *    derive from it, so this is the only check anywhere that compares
 *    `validate.ts` and `consumer-view.ts` against the document they transcribe
 *    rather than against our opinion of it. `bun run verify` cannot: the
 *    schema is not vendored here, because `VENDOR.md` is single-upstream by
 *    construction.
 *
 *  - OUR OWN ARCHIVED TRACES answer "did moving the reader change a verdict".
 *    Every record this repository has ever produced must still read cleanly:
 *    no refusal, no diagnostic, and -- where the run archived its log beside
 *    its trace -- the same frames `parseLog` gets from that log, which is the
 *    substrate-agreement property the runner is built on. A corpus of real
 *    bytes catches what a fixture cannot, because nobody wrote it to be read.
 *
 * NEITHER IS A SUBSTITUTE FOR THE OTHER, and neither is a substitute for
 * `tests/trace-format.ts`: the fixtures are all conformant, so they exercise
 * no refusal at all, and the archived corpus exercises none either -- across
 * 94 scenarios and 1576 records not one record is missing a member. Every
 * refusal in the library is reachable only from the offline table.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { parseLog, type Frame } from "../tck/ocpp";
import { readTrace } from "../tck/trace";
import {
  consumerView,
  crossRecordDiagnostics,
  readTraceText,
  type Diagnostic,
  type TraceRecord,
} from "../trace-format";

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  process.stderr.write(`FAIL ${what}: ${detail}\n`);
};

const show = (diagnostics: readonly Diagnostic[]): string =>
  diagnostics
    .slice(0, 5)
    .map((d) => `[${d.index}] ${d.code}${d.member ? `/${d.member}` : ""}`)
    .join(", ");

/**
 * Structural equality through JSON.
 *
 * `expected.json` came from a parser, so a member the reference sets to
 * `undefined` is simply absent there -- and `Object.keys` counts it present on
 * an object literal. Normalising both sides through JSON is what makes
 * "reproduce it exactly" mean the same thing on both.
 */
const normalise = (value: unknown): string => JSON.stringify(value);

// --------------------------------------------------------------------------
// 1. The specification's fixtures.
// --------------------------------------------------------------------------

function checkFixtures(fixturesDir: string): number {
  const names = readdirSync(fixturesDir).filter((name) =>
    statSync(join(fixturesDir, name)).isDirectory(),
  );
  if (names.length === 0) {
    fail("fixtures", `no fixture directories under ${fixturesDir}`);
    return 0;
  }

  for (const name of names.sort()) {
    const dir = join(fixturesDir, name);
    const text = readFileSync(join(dir, "trace.jsonl"), "utf8");
    const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));

    const { records, diagnostics } = readTraceText(text);
    const holes = records.filter((record) => record === undefined).length;
    if (holes > 0) {
      fail(name, `${holes} record(s) the reader refused: ${show(diagnostics)}`);
      continue;
    }
    // A conformant fixture must be silent. A diagnostic here means this reader
    // is STRICTER than the format, which is the failure that matters: it would
    // make a conformant producer look broken.
    const valid = records as readonly TraceRecord[];
    const view = consumerView(valid);
    const all = [...diagnostics, ...crossRecordDiagnostics(valid, view)];
    if (all.length > 0) {
      fail(name, `reader is stricter than the format: ${show(all)}`);
      continue;
    }

    if (normalise(view) !== normalise(expected)) {
      fail(name, "derived consumer view does not match expected.json");
      process.stderr.write(`     got ${normalise(view)}\n`);
      process.stderr.write(`     exp ${normalise(expected)}\n`);
      continue;
    }

    process.stdout.write(
      `ok   ${name} (${view.counts.records} records, ` +
        `${view.unansweredCalls.length} unanswered, ` +
        `${view.orphanResponses.length} orphans)\n`,
    );
  }
  return names.length;
}

// --------------------------------------------------------------------------
// 2. Our own archived traces.
// --------------------------------------------------------------------------

/** What a frame is, for comparison: everything an assertion can read. */
const frameKey = (frame: Frame): string =>
  JSON.stringify([
    frame.kind,
    frame.direction,
    frame.uniqueId,
    frame.timestamp,
    frame.kind === "call" ? frame.action : null,
    frame.kind === "callerror"
      ? [frame.errorCode, frame.errorDescription, frame.errorDetails]
      : null,
    frame.kind === "callerror" ? null : frame.payload,
  ]);

function checkArchive(dir: string): { traces: number; records: number } {
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  let records = 0;

  for (const file of files.sort()) {
    const path = join(dir, file);
    const text = readFileSync(path, "utf8");

    // The library's view first: a real record that produces a diagnostic is
    // news whether or not the runner would have refused over it.
    const read = readTraceText(text);
    if (read.diagnostics.length > 0) {
      fail(file, `real records produced diagnostics: ${show(read.diagnostics)}`);
      continue;
    }
    records += read.records.length;

    const trace = readTrace(path);
    if (!trace.frames) {
      fail(file, `the runner would refuse this real trace (${trace.refusal})`);
      continue;
    }

    // And the property the runner is actually built on: the trace and the log
    // are two readings of the same wire, so they must agree frame for frame.
    const logPath = join(dir, `${basename(file, ".jsonl")}.log`);
    let fromLog: Frame[] | undefined;
    try {
      fromLog = parseLog(readFileSync(logPath, "utf8"));
    } catch {
      fromLog = undefined;
    }
    if (fromLog === undefined) {
      process.stdout.write(`ok   ${file} (${trace.frames.length} frames, no log beside it)\n`);
      continue;
    }
    const a = trace.frames.map(frameKey);
    const b = fromLog.map(frameKey);
    if (a.length !== b.length || a.some((key, i) => key !== b[i])) {
      fail(
        file,
        `trace and log disagree: ${a.length} frames vs ${b.length} from the log`,
      );
      const at = a.findIndex((key, i) => key !== b[i]);
      if (at >= 0) {
        process.stderr.write(`     first difference at frame ${at}\n`);
        process.stderr.write(`       trace ${a[at]}\n`);
        process.stderr.write(`       log   ${b[at]}\n`);
      }
      continue;
    }
    process.stdout.write(
      `ok   ${file} (${trace.frames.length} frames, identical to its log)\n`,
    );
  }
  return { traces: files.length, records };
}

// --------------------------------------------------------------------------

const [fixturesDir, archiveDir] = process.argv.slice(2);
if (!fixturesDir) {
  process.stderr.write("usage: trace-conformance.ts <fixtures-dir> [archive-dir]\n");
  process.exit(2);
}

process.stdout.write("== the specification's conformance fixtures\n");
const fixtureCount = checkFixtures(fixturesDir);

let archive = { traces: 0, records: 0 };
if (archiveDir) {
  process.stdout.write("\n== this repository's archived traces\n");
  archive = checkArchive(archiveDir);
} else {
  process.stdout.write(
    "\n== this repository's archived traces: SKIPPED (no directory given)\n" +
      "   The fixtures say this reader is conformant; only the archive says\n" +
      "   moving it changed no verdict. See tools/trace-conformance.sh --help.\n",
  );
}

process.stdout.write("\n");
if (failures > 0) {
  process.stderr.write(`${failures} problem(s) found\n`);
  process.exit(1);
}
process.stdout.write(
  `all ${fixtureCount} fixtures conform` +
    (archive.traces > 0
      ? `, and ${archive.traces} archived trace(s) / ${archive.records} records read clean\n`
      : "\n"),
);
