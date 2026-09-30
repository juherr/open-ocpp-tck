/**
 * correlate.ts -- the format's correlation rule, once.
 *
 * `conformance/README.md` states it from the response's side: a CALLRESULT or
 * CALLERROR correlates with "the most recent preceding CALL in the trace" that
 * has the same `messageId`, travels in the opposite direction, and "is not
 * already correlated with an earlier response". Unmatched responses are
 * orphans; CALLs left over are unanswered.
 *
 * WHY IT IS ITS OWN MODULE, over a structural shape rather than over
 * `TraceRecord`. Two callers need this rule and they hold different objects:
 * `consumer-view.ts` has records, and a consumer that has already mapped a
 * trace onto its own frame type has those. Writing the rule twice is what a
 * shared library exists to prevent -- and it is not a hypothetical, it is what
 * happened: the first extraction left `findResponseFor` in the consuming suite
 * open-coding the same three clauses, so agreement between the two substrates
 * that suite reads became a property to test rather than a property of the
 * code.
 *
 * THE THIRD CLAUSE IS THE ONE THAT HIDES. With unique `messageId`s -- which
 * every real producer generates -- a reader that forgets "not already
 * answered" returns the same answers, so it passes every trace anyone is
 * likely to hand it and every fixture in the specification's own corpus. It
 * only diverges on a REUSED id, where forgetting maps two calls onto one
 * response and the rule pairs them one to one, most recent first. The
 * opposite-direction clause hides the same way, and needs a shape the corpus
 * also lacks: the nearer of two same-id calls travelling the WRONG way.
 *
 * ORDER IS THE INPUT'S ORDER and indices are the input's indices. See
 * `jsonl.ts`, which keeps that alignment by leaving a hole for an unreadable
 * line rather than closing the gap.
 */
import type { TraceDirection, TraceMessageType } from "./record";
/**
 * The three members the rule reads, and nothing else.
 *
 * Structural on purpose: a caller with its own frame type satisfies this by
 * having the members, without converting to `TraceRecord` and without this
 * library learning about its model.
 */
export interface Correlatable {
    readonly messageType: TraceMessageType;
    readonly messageId?: string | undefined;
    readonly direction: TraceDirection;
}
/** Which CALL each response answers, by index; `undefined` where none does. */
export interface Correlation {
    /**
     * One entry per input record. For a response, the index of the CALL it
     * correlates with, or `undefined` if it is an orphan. Always `undefined`
     * for a CALL.
     */
    readonly answers: readonly (number | undefined)[];
    /** Indices of CALLs no response correlated with, ascending. */
    readonly unansweredCalls: readonly number[];
    /** Indices of responses that correlated with no CALL, ascending. */
    readonly orphanResponses: readonly number[];
}
/** Applies the correlation rule to a whole trace, in one pass. */
export declare function correlate(records: readonly Correlatable[]): Correlation;
