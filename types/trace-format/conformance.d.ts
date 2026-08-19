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
/** Checks one `trace.jsonl` + `expected.json` pair. */
export declare function checkFixture(dir: string, name: string): FixtureResult;
/**
 * Checks every fixture directory under `fixturesDir`, in name order.
 *
 * An empty corpus is a FAILED run, not a passing one with nothing in it: a
 * check that silently passes when it found no work is how a moved directory
 * turns into a green build.
 */
export declare function checkFixtures(fixturesDir: string): FixtureResult[];
/** One line per fixture, in the shape a corpus self-check usually prints. */
export declare function formatResults(results: readonly FixtureResult[]): string[];
