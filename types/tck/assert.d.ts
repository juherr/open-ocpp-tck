/**
 * assert.ts -- typed assertion DSL for scenario specs, mirroring lib.sh's
 * check_* helpers but operating on parsed {@link Frame}s (see ocpp.ts)
 * instead of grep windows, so response-status assertions correlate by
 * OCPP-J uniqueId rather than log adjacency.
 */
import { type CallFrame, type Direction, type Frame } from "./ocpp";
/**
 * Sentinel a driver returns INSTEAD of a value it genuinely cannot obtain
 * from the CSMS under test (no equivalent API, no DB access). Any string
 * starting with this prefix, passed as either side of {@link assertEq} or
 * as {@link assertNonEmpty}'s value, degrades that ONE check to SKIPPED
 * instead of comparing -- the rest of the scenario's checks still run and
 * still PASS/FAIL normally.
 *
 * The text after the prefix is the human-readable reason and is recorded
 * as the check's `detail`.
 *
 * The leading space is deliberate: it keeps the sentinel from ever
 * colliding with a real CSMS value (no identifier, timestamp, status or
 * count this harness compares starts with whitespace).
 *
 * Declared HERE, in the lowest layer, on purpose: assert.ts is vendored and
 * must not depend on the driver modules. A driver that wants the literal for
 * its own convenience must RE-EXPORT this one -- never redeclare it. Two
 * copies of a sentinel string are two chances to drift, and the drift is
 * silent: a check that should degrade to SKIPPED turns into a FAIL instead.
 * unverifiable.ts re-exports it, which is the import a driver should use.
 */
export declare const UNVERIFIABLE_PREFIX = " CSMS_UNVERIFIABLE:";
/**
 * Marker opening the SKIPPED reason when a check could not be evaluated
 * because THE SCENARIO never made the request, as opposed to
 * {@link UNVERIFIABLE_PREFIX}'s "this CSMS could not tell us".
 *
 * Both degrade a check to SKIPPED and both make the scenario PARTIAL, so
 * without a marker the summary's `skipped` column would merge two facts that
 * point at different work:
 *
 *   UNVERIFIABLE  -- varies per driver. A limitation of the CSMS under test.
 *   UNEXERCISED   -- identical for every driver. A gap in OUR scenarios,
 *                    and a TODO for this suite rather than for the CSMS.
 *
 * A prefix rather than a fourth CheckStatus on purpose: the distinction is
 * worth recording, not worth widening the public verdict vocabulary and the
 * summary schema for. If the unexercised set ever grows past what
 * OCA-COVERAGE.md can carry, promote it then.
 */
export declare const UNEXERCISED_PREFIX = "scenario does not exercise this:";
export type CheckStatus = "PASS" | "FAIL" | "SKIPPED";
export interface CheckResult {
    description: string;
    pass: boolean;
    detail?: string;
    /** PASS/FAIL as before, plus SKIPPED for a check the driver could not
     *  evaluate (see {@link UNVERIFIABLE_PREFIX}). A SKIPPED check has
     *  `pass === false` but does NOT count towards {@link
     *  AssertRecorder.failed} and never turns the verdict into FAIL. */
    status: CheckStatus;
}
/** Accumulates PASS/FAIL/SKIPPED check results for one scenario run. */
export declare class AssertRecorder {
    private checks;
    pass(description: string): void;
    fail(description: string, detail?: string): void;
    /** Records a check that could not be evaluated at all -- neither a pass
     *  nor a failure. `reason` explains what the driver could not obtain. */
    skip(description: string, reason: string): void;
    get results(): readonly CheckResult[];
    get total(): number;
    get failed(): number;
    /** Count of checks degraded to SKIPPED, exposed to the runner so it can
     *  render the `skipped` summary column and derive the PARTIAL verdict. */
    get skipped(): number;
    /** The subset of {@link skipped} that no driver can ever turn green,
     *  because the SCENARIO does not make the request (see
     *  {@link UNEXERCISED_PREFIX}). Exposed so the runner can report the two
     *  causes apart: without it, a scenario already PARTIAL for an unexercised
     *  obligation hides a NEW driver limitation appearing beside it -- the
     *  count does not move and the verdict was already orange. */
    get unexercised(): number;
    get verdict(): "PASS" | "FAIL";
}
/** check_log_contains equivalent: at least one CALL exists for direction+action. */
export declare function assertSent(rec: AssertRecorder, frames: readonly Frame[], action: string, description?: string): CallFrame | undefined;
export declare function assertReceived(rec: AssertRecorder, frames: readonly Frame[], action: string, description?: string): CallFrame | undefined;
/** check_log_not_contains equivalent, scoped to CALLs for one action/direction. */
export declare function assertNotSent(rec: AssertRecorder, frames: readonly Frame[], action: string, direction?: Direction, description?: string): void;
/**
 * Asserts that SOME CALL for `action`+`direction` carries every member of
 * `expected`, compared by value.
 *
 * This is the frame-level replacement for a regex that matched several payload
 * members in one pattern. Written as text, `"errorCode":"X".*"status":"Y"`
 * asserts a conformance property AND the order in which the producer's
 * `JSON.stringify` happened to emit two members -- an order nothing declares
 * and nothing checks, which a bump of the pinned simulator digest can change
 * (issue #44). Both sites this replaced carried a comment saying they matched
 * the members "independently rather than assuming an order", which the regex
 * did not do.
 *
 * ANY matching CALL is enough, matching the any-line semantics of the
 * assertLineMatches calls this replaced: a scenario whose connector also
 * reports other states is not failed for them. A malformed payload is not a
 * witness -- an OCPP-J CALL carries a JSON object, and reading a member off
 * `null`, an array or a scalar yields undefined, which is the shape an absent
 * member has.
 *
 * SCALARS ONLY, enforced by the type rather than by prose. Deep-comparing an
 * object member would need a structural comparison, and the obvious one --
 * `JSON.stringify(a) === JSON.stringify(b)` -- is itself member-order
 * dependent, which would put this helper back where the regexes were. A member
 * whose value is an object or an array wants a check written out in the
 * scenario -- `assertConfigurationKeyListed` (specs/core.ts) is the worked
 * example, and the rejected-refactor note beside {@link assertIdTagInfoStatus}
 * says why it is not a fourth helper here.
 */
export declare function assertCallPayload(rec: AssertRecorder, frames: readonly Frame[], direction: Direction, action: string, expected: Readonly<Record<string, string | number | boolean | null>>, description: string): void;
export interface ResponseStatusOptions {
    /** Which side sent the CALL being answered (default "received": a
     *  CSMS-initiated op like RemoteStartTransaction). Pass "sent" for a
     *  CP-initiated op like BootNotification. */
    direction?: Direction;
    /** 0-indexed occurrence of `action`, for scenarios that repeat it
     *  (e.g. a Full then a Differential SendLocalList). */
    occurrence?: number;
}
/**
 * check_response_status / check_sent_result equivalent, upgraded to
 * uniqueId correlation: finds the `occurrence`-th CALL for `action` in
 * `direction`, then its response PAIRED BY uniqueId (not the next
 * CALLRESULT line in the log), and asserts payload.status === expected.
 */
export declare function assertResponseStatus(rec: AssertRecorder, frames: readonly Frame[], action: string, expectedStatus: string, description?: string, options?: ResponseStatusOptions): void;
/**
 * Variant of {@link assertResponseStatus} for CALLRESULTs that nest their
 * status under `idTagInfo.status` (StartTransaction.conf, Authorize.conf)
 * rather than a top-level `status` field. Same uniqueId-paired correlation.
 */
export declare function assertIdTagInfoStatus(rec: AssertRecorder, frames: readonly Frame[], action: string, expectedStatus: string, description: string, options?: ResponseStatusOptions): void;
/**
 * REJECTED REFACTOR, noted here because this is where it will be proposed
 * again -- and it was written, measured and reverted rather than merely
 * considered. A third sibling of {@link assertResponseStatus} and
 * {@link assertIdTagInfoStatus} -- `assertResponsePayload(rec, frames, action,
 * predicate, description)`, same correlation, the check on the answering
 * CALLRESULT's payload supplied by the caller -- is the obvious way to
 * de-duplicate `assertConfigurationKeyListed` (specs/core.ts) and
 * `assertCompositeSchedulePeriodLimit`
 * (specs/remotetrigger-smartcharging.ts), which each repeat this file's
 * find-then-correlate-then-report spine.
 *
 * It costs more than it saves, and the cost is in a different file.
 * tools/extract-assert-inventory.ts renders every non-literal argument as `·`,
 * so a predicate passed as an argument disappears: those two helpers rendered
 * as a single `assertResponsePayload(·, ·, "GetConfiguration", ·, ·)` line,
 * and relaxing what the predicate accepts would then move nothing in
 * ASSERT-INVENTORY.txt. Spelled out in the scenario file instead, the same
 * logic renders as IF / RETURN / ·.fail control flow and any relaxation shows
 * up in the diff -- which is the entire job of that artifact. The extractor's
 * own header names this limit ("a non-literal argument is `·`... no spec does
 * this today"); the fix is to keep it true, not to be the first exception.
 *
 * THE WEAKER SHAPE IS ALSO REJECTED, and it is the one to re-propose next: a
 * value-returning `correlatedResult(rec, frames, action, description)` that
 * fails-and-returns-undefined on the three plumbing branches, leaving each
 * scenario's own distinguishing check written out. That one keeps the artifact
 * honest -- the branches it absorbs are the ones every caller shares, and the
 * ones that differ stay visible. It is declined here for scope, not for
 * principle: this pull request already moves those two helpers twice, and a
 * third pass would put a pure refactor in the same ASSERT-INVENTORY.txt diff
 * as six checks that genuinely changed, which is precisely what makes such a
 * diff unreadable. Worth doing in a commit whose only job is that refactor.
 */
export interface AnsweredOptions {
    /** Which side sent the CALLs being answered (default "sent": the charge
     *  point, which is the direction every OCA `_CSMS` obligation is in). */
    direction?: Direction;
    /** How many such CALLs the scenario requires. Default 1. Fewer is SKIPPED
     *  and tagged {@link UNEXERCISED_PREFIX} -- see rule 1 on
     *  {@link assertAllAnswered}. */
    minimum?: number;
}
/**
 * Asserts that EVERY CALL the charge point sent for `action` was answered by
 * the CSMS with a CALLRESULT. This is the check for the right-hand column of
 * an OCA `_CSMS` test case: "The Central System responds with a X.conf".
 *
 * It exists because asserting what the CHARGE POINT sent -- which is what
 * most of this file's helpers do -- cannot see a CSMS that answers with a
 * CALLERROR or with nothing. A suite made only of those assertions reports
 * green for a CSMS that never answered anything, and did: see OCA-COVERAGE.md.
 *
 * Correlation is {@link findResponseFor}'s, i.e. by OCPP-J uniqueId, so a
 * scenario that sends the same action four times (TC_044's
 * FirmwareStatusNotification train) gets four independent verdicts rather
 * than one lucky match.
 *
 * THREE RULES, and the third is the one to read:
 *
 * 1. Fewer than `minimum` CALLs for `action` -- SKIPPED, tagged
 *    {@link UNEXERCISED_PREFIX}, which makes the scenario PARTIAL rather than
 *    FAIL. An "every X was answered" check over zero Xs passes trivially, so
 *    it must not pass; but it must not go red either, because red here would
 *    say "the CSMS did not answer" about a question the scenario never asked.
 *    Several OCA obligations land exactly there -- a locally-driven case
 *    mandates Authorize.conf and the remote-start scenario carrying that case
 *    never sends Authorize.req. Orange states the gap without blaming the
 *    CSMS for it; OCA-COVERAGE.md lists what closing each would take.
 *
 *    This is deliberately independent of whether the CP *should* have sent
 *    it. Scenarios that require the request assert that separately (TC_013
 *    has its own "CP reconnects and sends a fresh BootNotification" check),
 *    which keeps this helper about one thing: did the CSMS answer.
 *
 * 2. A response that is a CALLERROR -- FAIL, naming errorCode and
 *    errorDescription. A CALLERROR is a response, but it is not the `.conf`
 *    the test case asks for.
 *
 * 3. A CALL with no response is OUTSTANDING, not unanswered, unless the peer
 *    answered something LATER in the log. The runner stops the simulator
 *    container after `holdSecs` (see main.ts), which truncates the wire log at
 *    an arbitrary point -- frequently mid-exchange, because the charge point
 *    keeps sending Heartbeats and StatusNotifications until the moment it is
 *    killed. Failing on those trailing CALLs would make this helper measure
 *    `holdSecs` rather than the CSMS, intermittently, which is the worst kind
 *    of red.
 *
 *    The test is "did the peer keep answering after this CALL", NOT "is this
 *    the very last frame". The last-frame version was wrong and quietly so: a
 *    charge point that fires two requests back to back before the container
 *    dies leaves the FIRST of them with a later frame after it, so it was
 *    reported unanswered while its identical twin was forgiven. What makes an
 *    unanswered CALL damning is that the CSMS demonstrably had the chance and
 *    took it for someone else.
 */
/** One CALLERROR the peer answered with, already rendered for a message. */
export interface AnswerError {
    errorCode: string;
    errorDescription: string;
    uniqueId: string;
}
/** How a peer answered every CALL for one action. See {@link tallyAnswers}. */
export interface AnswerTally {
    /** Total CALLs found for the action+direction asked about. */
    total: number;
    /** Answered with a CALLRESULT. */
    answered: number;
    /** Answered with a CALLERROR, in log order. */
    errors: AnswerError[];
    /** Unanswered, with the peer demonstrably still answering afterwards. */
    unanswered: number;
    /** Unanswered, with nothing answered after them -- the log was truncated. */
    outstanding: number;
}
/**
 * Classifies every CALL for `action`+`direction` by how the peer answered it.
 * The three rules on {@link assertAllAnswered} are implemented HERE, once.
 *
 * Separate from the assertion so that anything else reading a wire log gets
 * the same verdicts -- `tools/answered-report.ts` is the reason it exists.
 * That tool used to carry its own copy of this loop, kept in step with a
 * comment saying it must be; rule 3 had already been wrong once, only
 * `assert.ts`'s copy was guarded, and the two had already drifted (the copy
 * hardcoded the response direction). A report whose job is to explain the
 * checks must not be able to disagree with them.
 */
export declare function tallyAnswers(frames: readonly Frame[], action: string, direction?: Direction): AnswerTally;
export declare function assertAllAnswered(rec: AssertRecorder, frames: readonly Frame[], action: string, description?: string, options?: AnsweredOptions): void;
export declare function assertEq(rec: AssertRecorder, actual: unknown, expected: unknown, description: string): void;
export declare function assertTrue(rec: AssertRecorder, condition: boolean, description: string, detail?: string): void;
/**
 * check_log_contains equivalent for checks that aren't about a specific
 * OCPP frame (scenario lifecycle structured events, free-text log
 * messages) -- scans raw stdout lines rather than parsed frames.
 */
export declare function assertLineMatches(rec: AssertRecorder, lines: readonly string[], pattern: RegExp, description: string): void;
/** check_log_not_contains equivalent over raw stdout lines. */
export declare function assertNoLineMatches(rec: AssertRecorder, lines: readonly string[], pattern: RegExp, description: string): void;
/**
 * check_log_order equivalent: passes if the FIRST line matching `patternA`
 * appears before the FIRST line matching `patternB`.
 */
export declare function assertLineOrder(rec: AssertRecorder, lines: readonly string[], patternA: RegExp, patternB: RegExp, description: string): void;
/**
 * check_log_after equivalent: passes if `pattern` matches some line
 * strictly after the LAST line matching `afterPattern`. Use this instead of
 * {@link assertLineOrder} when `pattern` could also match an earlier,
 * unrelated occurrence (e.g. a connector's automatic post-boot "Available"
 * StatusNotification, which always precedes any scenario-driven state
 * change and would make a first-match order check pass trivially).
 */
export declare function assertLineAfter(rec: AssertRecorder, lines: readonly string[], afterPattern: RegExp, pattern: RegExp, description: string): void;
/**
 * check_db_nonempty equivalent, generic over an already-fetched value
 * (keeps assert.ts free of any SteveDb/SQL coupling -- callers fetch via
 * `db.scalar(...)` and pass the result in).
 */
export declare function assertNonEmpty(rec: AssertRecorder, value: string, description: string): void;
