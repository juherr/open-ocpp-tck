/**
 * trace-conformance.ts -- do this repository's archived traces still read the
 * way its logs do?
 *
 * The comparison half of `tools/trace-conformance.sh`, which validates the
 * argument and documents the recipe for getting a corpus out of CI.
 *
 * WHAT IT ANSWERS: "did changing how the trace is read change a verdict".
 * Every trace this repository has archived must still read cleanly through
 * `tck/trace.ts`'s `readTrace` -- no refusal -- and, where the run archived
 * its log beside its trace, map onto the same frames `parseLog` gets from
 * that log. That is the substrate-agreement property the runner is built on:
 * the trace and the log are two readings of one wire, and an assertion must
 * not be able to tell which one it was handed. A corpus of real bytes catches
 * what a fixture cannot, because nobody wrote it to be read.
 *
 * WHAT IT NO LONGER ANSWERS: whether the reader implements the format. This
 * script used to clone the specification and run the reader this repository
 * shipped against its fixtures and its schema, through ajv. That reader is
 * gone; `@open-ocpp-trace/core` and `@open-ocpp-trace/jsonl` replaced it, and
 * the SDK's own CI runs both of those passes on the same pinned specification
 * commit. Running them again here would test the SDK, not this suite.
 *
 * NOT A SUBSTITUTE FOR `tests/trace-frames.ts`: the archived corpus exercises
 * no refusal at all -- across 94 scenarios and 1576 records not one record is
 * missing a member -- so every refusal is reachable only from that offline
 * table.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { parseLog, type Frame } from "../tck/ocpp";
import { readTrace } from "../tck/trace";

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  process.stderr.write(`FAIL ${what}: ${detail}\n`);
};

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

function checkArchive(dir: string): { traces: number; frames: number; logs: number } {
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  let frames = 0;
  let logs = 0;

  for (const file of files.sort()) {
    const trace = readTrace(join(dir, file));
    if (!trace.frames) {
      fail(file, `the runner would refuse this real trace (${trace.refusal})`);
      continue;
    }
    frames += trace.frames.length;

    // The property the runner is actually built on: the trace and the log are
    // two readings of the same wire, so they must agree frame for frame.
    const logPath = join(dir, `${basename(file, ".jsonl")}.log`);
    // Only an ABSENT log means "nothing to compare": a log that is there and
    // cannot be read would otherwise pass the trace as compared when it was
    // not. `parseLog` itself does not throw -- a log it cannot parse yields
    // fewer frames and fails the comparison below.
    let fromLog: Frame[] | undefined;
    try {
      fromLog = parseLog(readFileSync(logPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail(file, `the log beside it cannot be read (${(error as Error).message})`);
        continue;
      }
      fromLog = undefined;
    }
    if (fromLog === undefined) {
      process.stdout.write(`ok   ${file} (${trace.frames.length} frames, no log beside it)\n`);
      continue;
    }
    logs++;
    const a = trace.frames.map(frameKey);
    const b = fromLog.map(frameKey);
    const at = a.findIndex((key, i) => key !== b[i]);
    if (a.length !== b.length || at >= 0) {
      fail(
        file,
        `trace and log disagree: ${a.length} frames vs ${b.length} from the log`,
      );
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
  return { traces: files.length, frames, logs };
}

// --------------------------------------------------------------------------

const [archiveDir] = process.argv.slice(2);
if (!archiveDir) {
  process.stderr.write("usage: trace-conformance.ts <archive-dir>\n");
  process.exit(2);
}

const archive = checkArchive(archiveDir);

process.stdout.write("\n");
if (archive.traces === 0) {
  // An empty directory reads as a clean corpus otherwise -- the run would
  // claim an agreement it never measured.
  process.stderr.write(`no *.jsonl trace in ${archiveDir}: nothing was compared\n`);
  process.exit(1);
}
if (failures > 0) {
  process.stderr.write(`${failures} problem(s) found\n`);
  process.exit(1);
}
process.stdout.write(
  `${archive.traces} archived trace(s) / ${archive.frames} frames read clean, ` +
    `${archive.logs} of them identical to the log beside them\n`,
);
