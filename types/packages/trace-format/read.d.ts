/**
 * read.ts -- the two halves composed: text in, validated records out.
 *
 * Its own module rather than a function in `index.ts` because `conformance.ts`
 * needs it, and reaching it through the barrel would make the barrel import
 * one of the things it exports.
 */
import { type ValidatedTrace } from "./validate";
/**
 * Reads a whole JSONL trace: split, then validate, diagnostics concatenated.
 *
 * The two halves stay separately exported because a consumer that already has
 * records -- from a websocket, from a test table, from another tool's output
 * -- has no text to split, and making it invent some to reach the validator is
 * how a reader ends up with two ways in that drift.
 *
 * A LINE THAT WAS NOT JSON IS NOT VALIDATED AGAIN. `splitJsonl` left a hole
 * there and already said why, and running the validator over the hole would
 * add "record is absent, not an object" beside it -- which is true, and is not
 * what happened. So this is the one place that knows both facts, and therefore
 * the only place allowed to suppress the second. `validateRecords` stays
 * total: it is reachable on its own, and an unexplained hole is the one thing
 * a lenient consumer cannot annotate.
 */
export declare function readTraceText(text: string): ValidatedTrace;
