/**
 * trace-correlation.ts -- the open-ocpp-trace correlation rule, once.
 *
 * `conformance/README.md` states it from the response's side: a CALLRESULT or
 * CALLERROR correlates with "the most recent preceding CALL in the trace" that
 * has the same `messageId`, travels in the opposite direction, and "is not
 * already correlated with an earlier response". Unmatched responses are
 * orphans; CALLs left over are unanswered.
 *
 * WHY IT LIVES HERE. `@open-ocpp-trace/core` reads and validates records and
 * stops there: correlation is a consumer rule, and the SDK leaves it out on
 * purpose. This suite is such a consumer, so the rule is written here -- once.
 * It used to sit in the trace reader this repository shipped, beside a
 * consumer view that applied it to records, while `findResponseFor` in
 * `ocpp.ts` applied it to frames. The first extraction left `findResponseFor`
 * open-coding the same three clauses, so agreement between the two became a
 * property to test rather than a property of the code; one module over a
 * structural shape is what ended that, and it is the shape an upstream `core`
 * export would take.
 *
 * THE THIRD CLAUSE IS THE ONE THAT HIDES. With unique `messageId`s -- which
 * every real producer generates -- a reader that forgets "not already
 * answered" returns the same answers, so it passes every trace anyone is
 * likely to hand it and every fixture in the specification's own corpus. It
 * only diverges on a REUSED id, where forgetting maps two calls onto one
 * response and the rule pairs them one to one, most recent first. The
 * opposite-direction clause hides the same way, and needs a shape the corpus
 * also lacks: the nearer of two same-id calls travelling the WRONG way.
 * `tests/trace-frames.ts` holds each clause to a row of its own.
 *
 * ORDER IS THE INPUT'S ORDER and indices are the input's indices.
 */
import type { Direction, MessageType } from "@open-ocpp-trace/core";
/**
 * The three members the rule reads, and nothing else.
 *
 * Structural on purpose: a caller with its own frame type satisfies this by
 * having the members, without converting to `TraceRecord`.
 */
export interface Correlatable {
    readonly messageType: MessageType;
    readonly messageId?: string | undefined;
    readonly direction: Direction;
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
