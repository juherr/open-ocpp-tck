/**
 * redelivery-loops.ts -- did this CSMS start redelivering a message forever?
 *
 * WHAT IT COUNTS, AND WHY THAT NUMBER IS THE ONE WORTH HAVING. When a
 * CSMS-initiated OCPP request is dispatched to a charge point that is no longer
 * there, this deployment re-enqueues it and logs it again, and does not stop.
 * The message never expires, so the loop lasts for the rest of the run and the
 * loops ACCUMULATE. Measured across three archived sweeps of this repository's
 * own CI, counting messages whose envelope is logged more than
 * {@link LOOP_THRESHOLD} times:
 *
 *   | run        | log lines | looping messages | outcome                     |
 *   |------------|-----------|------------------|-----------------------------|
 *   | 33987454099|   839,195 |  1 (Reset)       | healthy, 0 boot timeouts    |
 *   | 33993183786| 1,080,471 |  2 (Reset x2)    | healthy, 1 boot timeout     |
 *   | 33989256500|15,045,568 | 11               | dead, 38 boot timeouts      |
 *
 * One is survivable and eleven is not, and nothing between the two is visible
 * from a verdict table: the sweep that died still exited 0, because every
 * scenario it killed was reclassified by `--retry-failed-isolated` or was one of
 * the four declared expected failures. That is the gap this file fills -- a
 * number that moves BEFORE the sweep stops being able to measure anything.
 *
 * WHY THE ENVELOPE LINE AND NOT THE CORRELATION ID ALONE. Both identify a loop;
 * the envelope also carries the action and the station, which is what turns a
 * count into a lead. Every loop observed so far starts on a request to a station
 * that was about to disappear -- `Reset` in the two healthy runs, because a
 * station that resets is a station that disconnects BY DESIGN, and in the dead
 * run six `ChangeAvailability`, two `Reset` and one `SetChargingProfile`, which
 * is the collapse rather than its cause: the first loop degrades the CSMS, the
 * degradation makes more stations time out mid-request, and each of those adds a
 * loop of its own.
 *
 * A LOG IT CANNOT READ IS REFUSED, never reported as "no loops". The pattern
 * below is bound to this deployment's envelope, key order included, and an
 * upstream that renames a member or reorders two would leave this file matching
 * nothing -- green, with the CSMS looping exactly as before. So a non-empty log
 * with ZERO recognisable envelopes exits 2 and says so. This is the failure
 * `tools/summary-red-rows.ts`'s header calls "green on what it no longer
 * covers", and the only defence a format-bound reader has against it is to know
 * the difference between "nothing matched" and "nothing was there".
 *
 * WHY IT IS NOT IN `tools/`. It reads one CSMS's log format. `AGENTS.md`'s
 * boundary lets a driver name itself and nothing else name it, and a generic
 * name over a CitrineOS-shaped parser would be the kind of false generality that
 * boundary exists to stop. The price is a `.d.ts` in the committed public API
 * for a diagnostic; the diff makes that visible, which is the same trade the
 * types/ directory is already making.
 *
 * ASYNC FOR A COMPUTATION THAT IS NOT. `for await` accepts a plain array as
 * readily as a stream, so the guard hands it a literal and the CLI hands it a
 * 1.5 GB file; a synchronous reader would have forced the CLI to hold that file
 * in memory, which is the one input size this file exists for.
 *
 * WHY IT TAKES LINES AND NOT A PATH. The property worth testing is the reading,
 * and the input that exercises it is a 1.5 GB log from a CI run that cannot be
 * committed or reproduced offline. So the reader takes an iterable of lines and
 * the guard hands it a fixture -- the same split `tck/standing.ts` and
 * `drivers/citrineos/api-client.ts` are, for the same reason.
 *
 * REFACTOR CONSIDERED AND NOT TAKEN, noted here because here is where it gets
 * re-proposed: make this a per-driver hook on the contract so the workflow can
 * call it without naming a driver. There is one driver with a log format anyone
 * has read and one question anyone has asked of it. A hook would be an interface
 * with a single implementation and a single caller, and the thing it would
 * abstract over -- what a CSMS's log looks like -- is exactly what no contract
 * can describe. Worth doing when a second driver answers a second question.
 *
 * Exit codes mirror `tools/summary-red-rows.ts`, whose caller reads them the
 * same way: 0 the answer is yes (loops found), 1 the answer is no, 2 the input
 * could not be read.
 */
/**
 * How many times one message's envelope may legitimately be logged.
 *
 * MEASURED, NOT CHOSEN. Across the three archived sweeps above, a message that
 * was delivered once appears at most TWICE -- there are two log sites on the
 * dispatch path -- and the smallest loop observed appears 3,808 times. Ten sits
 * two orders of magnitude from both, so this number is not a tuning knob and
 * moving it is a sign that something else changed.
 */
export declare const LOOP_THRESHOLD = 10;
export interface RedeliveryLoop {
    action: string;
    station: string;
    correlationId: string;
    /** How many times this message's envelope was logged. */
    logged: number;
}
export type LoopScan = {
    loops: RedeliveryLoop[];
    envelopes: number;
} | {
    unreadable: string;
};
/**
 * Every message logged more than `threshold` times, worst first.
 *
 * `envelopes` is returned beside the loops because zero of them is the only
 * thing that separates a healthy sweep from a reader that stopped working, and a
 * caller that cannot tell those apart is the caller this file exists to avoid
 * being.
 */
export declare function findRedeliveryLoops(lines: Iterable<string> | AsyncIterable<string>, threshold?: number): Promise<LoopScan>;
/** The report a caller prints. Kept out of the reader so the guard asserts the
 *  finding rather than its wording. */
export declare function describeLoops(scan: LoopScan): string;
