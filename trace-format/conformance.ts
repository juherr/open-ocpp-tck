/**
 * conformance.ts -- the corpus self-check, as a function of this reader.
 *
 * THIS IS MEANT TO REPLACE `conformance/validate.mjs` in the specification
 * repository. That script is the format's reference consumer, and it is
 * currently a second implementation of the rules: it compiles the schema with
 * ajv and open-codes `buildConsumerView`, so the document has one
 * implementation for its own CI and every consumer writes another. Two
 * implementations of a normative rule is exactly the thing a conformance
 * corpus exists to prevent, one level up.
 *
 * So the check is expressed here, over the same reader a consumer imports.
 * What the corpus then proves is not "the fixtures are self-consistent" but
 * "the implementation everyone uses reproduces the document" -- which is the
 * claim worth having, and the one a separate script cannot make.
 *
 * WHAT IT GIVES UP, stated because it is a real trade. `validate.mjs`
 * validates with ajv, so it checks the fixtures against the schema FILE; this
 * checks them against `validate.ts`, a transcription of it. A rule dropped
 * from the transcription would be a rule this check stops enforcing, silently.
 * The mitigation is that a dropped rule almost always shows up as a consumer
 * view that no longer matches `expected.json` -- and where it would not, the
 * corpus should grow a fixture, which is a better place for the rule to live
 * than in a validator only the specification runs.
 *
 * NO POLICY HERE EITHER: a fixture fails when the reader disagrees with
 * `expected.json`, or when a CONFORMANT record produced a diagnostic. The
 * second is the direction that matters -- a reader stricter than the format
 * makes correct producers look broken -- and it is why "the reader said
 * nothing" is part of passing rather than an aside.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { consumerView, crossRecordDiagnostics } from "./consumer-view";
import type { Diagnostic } from "./diagnostics";
import { readTraceText } from "./read";
import type { TraceRecord } from "./record";

/** What one fixture directory had to say. */
export interface FixtureResult {
  readonly name: string;
  readonly ok: boolean;
  /** Empty when `ok`. One line per problem, for a human. */
  readonly problems: readonly string[];
  /** Absent when the trace could not be read far enough to derive one. */
  readonly counts?: {
    records: number;
    unansweredCalls: number;
    orphanResponses: number;
  };
}

/**
 * `[index] code/member`, comma separated -- the one rendering of a diagnostic
 * list, exported because every caller that prints one wants this and a second
 * copy is how two of them drift apart.
 */
export function formatDiagnostics(
  diagnostics: readonly Diagnostic[],
  limit = Number.POSITIVE_INFINITY,
): string {
  const shown = diagnostics.slice(0, limit);
  const rest = diagnostics.length - shown.length;
  return (
    shown
      .map((d) => `[${d.index}] ${d.code}${d.member ? `/${d.member}` : ""}`)
      .join(", ") + (rest > 0 ? `, and ${rest} more` : "")
  );
}

/**
 * Structural equality through JSON.
 *
 * `expected.json` came out of a parser, so a member a derivation leaves
 * `undefined` is simply absent there -- while `Object.keys` counts it present
 * on an object literal. Normalising both sides is what makes "reproduce it
 * exactly" mean the same thing on each.
 */
const normalise = (value: unknown): string => JSON.stringify(value);

/** Checks one `trace.jsonl` + `expected.json` pair. */
export function checkFixture(dir: string, name: string): FixtureResult {
  const problems: string[] = [];

  let text: string;
  let expected: unknown;
  try {
    text = readFileSync(join(dir, "trace.jsonl"), "utf8");
    expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  } catch (error) {
    return {
      name,
      ok: false,
      problems: [`could not be read: ${(error as Error).message}`],
    };
  }

  const { records, diagnostics } = readTraceText(text);
  const holes = records.filter((record) => record === undefined).length;
  if (holes > 0) {
    return {
      name,
      ok: false,
      problems: [
        `${holes} record(s) this reader refused: ${formatDiagnostics(diagnostics)}`,
      ],
    };
  }

  const valid = records as readonly TraceRecord[];
  const view = consumerView(valid);
  const all = [...diagnostics, ...crossRecordDiagnostics(valid, view)];
  if (all.length > 0) {
    problems.push(`this reader is stricter than the format: ${formatDiagnostics(all)}`);
  }
  if (normalise(view) !== normalise(expected)) {
    problems.push("the derived consumer view does not match expected.json");
  }

  return {
    name,
    ok: problems.length === 0,
    problems,
    counts: {
      records: view.counts.records,
      unansweredCalls: view.unansweredCalls.length,
      orphanResponses: view.orphanResponses.length,
    },
  };
}

/**
 * Checks every fixture directory under `fixturesDir`, in name order.
 *
 * An empty corpus is a FAILED run, not a passing one with nothing in it: a
 * check that silently passes when it found no work is how a moved directory
 * turns into a green build.
 */
export function checkFixtures(fixturesDir: string): FixtureResult[] {
  let names: string[];
  try {
    names = readdirSync(fixturesDir).filter((name) =>
      statSync(join(fixturesDir, name)).isDirectory(),
    );
  } catch (error) {
    return [
      {
        name: fixturesDir,
        ok: false,
        problems: [`no fixtures here: ${(error as Error).message}`],
      },
    ];
  }

  if (names.length === 0) {
    return [
      { name: fixturesDir, ok: false, problems: ["no fixture directories"] },
    ];
  }

  return names
    .sort()
    .map((name) => checkFixture(join(fixturesDir, name), name));
}

/** One line per fixture, in the shape a corpus self-check usually prints. */
export function formatResults(results: readonly FixtureResult[]): string[] {
  return results.flatMap((result) => {
    if (!result.ok) {
      return result.problems.map((problem) => `FAIL ${result.name}: ${problem}`);
    }
    const counts = result.counts;
    const detail = counts
      ? ` (${counts.records} records, ${counts.unansweredCalls} unanswered, ` +
        `${counts.orphanResponses} orphans)`
      : "";
    return [`ok   ${result.name}${detail}`];
  });
}
