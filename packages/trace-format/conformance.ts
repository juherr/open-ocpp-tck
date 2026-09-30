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
 * from the transcription would be a rule this check stops enforcing.
 *
 * That gap is NOT closed by the fixtures, and an earlier draft of this comment
 * claimed it mostly was -- on the reasoning that a dropped rule would surface
 * as a consumer view no longer matching `expected.json`. It does not: every
 * fixture is conformant, so a validator that accepts too much reproduces all
 * of them. What closes it is the differential in
 * `tools/trace-conformance.sh`, which runs invalid and boundary records
 * through this reader and through the specification's ajv and requires the
 * two to agree. Keep that table growing with the transcription.
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
 * Structural equality, and structural is the load-bearing word.
 *
 * TWO THINGS HAVE TO BE TRUE AT ONCE. A member a derivation leaves `undefined`
 * is simply ABSENT in `expected.json`, because that file came out of a parser
 * -- while `Object.keys` counts it present on an object literal, so the two
 * must be compared as if the undefined one were not there. And JSON member
 * ORDER is not semantic, so a harmless reordering of `expected.json` must not
 * fail a conformant reader.
 *
 * `JSON.stringify` on both sides satisfies the first and breaks the second: it
 * preserves insertion order, so it compares a rendering rather than a
 * structure. This walks instead.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  // `undefined` members are absent as far as this comparison goes, on either
  // side, which is what lets a derived view meet a parsed one.
  const defined = (o: object): string[] =>
    Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  const ka = defined(a);
  const kb = defined(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
  );
}

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
  if (!deepEqual(view, expected)) {
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
