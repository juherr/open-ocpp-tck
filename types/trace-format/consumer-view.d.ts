/**
 * consumer-view.ts -- the derivation every consumer of this format owes the
 * specification.
 *
 * `conformance/README.md` does not merely describe a file layout: it says a
 * conformant consumer must "derive the consumer view by reproducing each
 * fixture's `expected.json` exactly". So this is not one reader's convenience
 * shape, it is the normative output, and `tools/trace-conformance.sh` checks
 * it against the corpus rather than against our opinion of it.
 *
 * THE CORRELATION RULE, quoted: a CALLRESULT or CALLERROR correlates with "the
 * most recent preceding CALL in the trace" that has the same `messageId`,
 * travels in the opposite direction, and "is not already correlated with an
 * earlier response". Unmatched responses are orphans; CALLs left over are
 * unanswered.
 *
 * NOT-ALREADY-ANSWERED IS THE PART THAT IS EASY TO DROP, and dropping it is a
 * bug that hides: with unique `messageId`s -- which every real producer
 * generates -- a search that forgets it returns the same answer, so it passes
 * every trace anyone is likely to hand it. It only diverges on a REUSED id,
 * where forgetting maps two calls onto one response and the rule pairs them
 * one to one. The corpus has an `orphan-response` fixture precisely because
 * the tail is where consumers disagree.
 *
 * ORDER IS THE INPUT'S ORDER, and `index` is the input's index. For a file
 * that means the ordinal among non-blank lines -- `jsonl.ts` keeps that
 * alignment by leaving a hole for an unreadable line rather than closing the
 * gap, because `correlatesWith` is an index and a renumbered trace is a trace
 * of wrong answers.
 */
import type { Diagnostic } from "./diagnostics";
import type { TraceMessageType, TraceRecord } from "./record";
/** One record's place in the derived view. */
export interface ConsumerRecordView {
    index: number;
    messageType: TraceMessageType;
    messageId?: string;
    /**
     * The record's EFFECTIVE action: its own for a CALL, and for a response the
     * action of the CALL it correlates with. A response that correlates with
     * nothing has none, even if it carried one of its own -- the view states
     * what the trace establishes, and an uncorrelated response establishes
     * nothing about which request it answers.
     */
    action?: string;
    /** The index of the CALL this response answers. */
    correlatesWith?: number;
}
/** How many of each, as `expected.json` spells it. */
export interface ConsumerCounts {
    records: number;
    calls: number;
    callResults: number;
    callErrors: number;
}
/** The whole derived view of one trace. */
export interface ConsumerView {
    schemaVersion: string;
    counts: ConsumerCounts;
    records: ConsumerRecordView[];
    unansweredCalls: number[];
    orphanResponses: number[];
}
/**
 * Derives the normative consumer view.
 *
 * Pure, and deliberately reports nothing: a trace where every response is an
 * orphan is a perfectly derivable view, and whether that is alarming is the
 * caller's question. The one cross-record fact that IS a producer-conformance
 * violation lives in {@link crossRecordDiagnostics}, so that this function
 * stays exactly the reference's `buildConsumerView` and can be compared to it
 * line for line.
 */
export declare function consumerView(records: readonly TraceRecord[]): ConsumerView;
/**
 * The one producer rule that needs the whole trace to check.
 *
 * A response MAY carry its own `action`, and when it does the conformance
 * rules oblige it to equal the action of the CALL it correlates with. A
 * disagreement means one of the two is wrong and nothing in the record says
 * which -- which is exactly the shape of fact this library reports and does
 * not act on.
 *
 * Separate from {@link consumerView} so that function stays a transcription of
 * the reference's `buildConsumerView`; the reference checks this rule in its
 * harness, for the same reason.
 */
export declare function crossRecordDiagnostics(records: readonly TraceRecord[], view: ConsumerView): Diagnostic[];
