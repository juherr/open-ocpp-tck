// Derived from shiv3/ocpp-cp-simulator src/cp/application/verification/assert.ts (re-exported upstream as scripts/steve-verify/runner/assert.ts) @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: added the UNVERIFIABLE_PREFIX sentinel, a third SKIPPED check outcome, and the AssertRecorder.skipped counter; assertEq/assertNonEmpty short-circuit to SKIPPED when a value carries the sentinel; added assertAllAnswered and AnsweredOptions, which have no upstream counterpart. Everything else is unchanged.

/**
 * assert.ts -- typed assertion DSL for scenario specs, mirroring lib.sh's
 * check_* helpers but operating on parsed {@link Frame}s (see ocpp.ts)
 * instead of grep windows, so response-status assertions correlate by
 * OCPP-J uniqueId rather than log adjacency.
 */

import {
  findAllCalls,
  findCall,
  findResponseFor,
  type CallFrame,
  type Direction,
  type Frame,
} from "./ocpp";

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
export const UNVERIFIABLE_PREFIX = " CSMS_UNVERIFIABLE:";

/** The reason carried by an UNVERIFIABLE sentinel, or undefined if `value`
 *  is an ordinary value that must be compared normally. */
function unverifiableReason(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith(UNVERIFIABLE_PREFIX)) {
    return value.slice(UNVERIFIABLE_PREFIX.length).trim();
  }
  return undefined;
}

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
export class AssertRecorder {
  private checks: CheckResult[] = [];

  pass(description: string): void {
    this.checks.push({ description, pass: true, status: "PASS" });
  }

  fail(description: string, detail?: string): void {
    this.checks.push({ description, pass: false, detail, status: "FAIL" });
  }

  /** Records a check that could not be evaluated at all -- neither a pass
   *  nor a failure. `reason` explains what the driver could not obtain. */
  skip(description: string, reason: string): void {
    this.checks.push({
      description,
      pass: false,
      detail: reason,
      status: "SKIPPED",
    });
  }

  get results(): readonly CheckResult[] {
    return this.checks;
  }

  get total(): number {
    return this.checks.length;
  }

  get failed(): number {
    return this.checks.filter((c) => c.status === "FAIL").length;
  }

  /** Count of checks degraded to SKIPPED, exposed to the runner so it can
   *  render the `skipped` summary column and derive the PARTIAL verdict. */
  get skipped(): number {
    return this.checks.filter((c) => c.status === "SKIPPED").length;
  }

  get verdict(): "PASS" | "FAIL" {
    return this.failed > 0 ? "FAIL" : "PASS";
  }
}

/** check_log_contains equivalent: at least one CALL exists for direction+action. */
export function assertSent(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  description = `${action}.req sent`,
): CallFrame | undefined {
  const call = findCall(frames, "sent", action);
  if (call) {
    rec.pass(description);
  } else {
    rec.fail(description, `no Sent CALL found for action=${action}`);
  }
  return call;
}

export function assertReceived(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  description = `${action}.req received`,
): CallFrame | undefined {
  const call = findCall(frames, "received", action);
  if (call) {
    rec.pass(description);
  } else {
    rec.fail(description, `no Received CALL found for action=${action}`);
  }
  return call;
}

/** check_log_not_contains equivalent, scoped to CALLs for one action/direction. */
export function assertNotSent(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  direction: Direction = "sent",
  description = `no ${action} ${direction}`,
): void {
  const call = findCall(frames, direction, action);
  if (call) {
    rec.fail(description, `unexpected ${direction} CALL found: ${call.raw}`);
  } else {
    rec.pass(description);
  }
}

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
export function assertResponseStatus(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  expectedStatus: string,
  description = `${action} -> status ${expectedStatus}`,
  options: ResponseStatusOptions = {},
): void {
  const direction = options.direction ?? "received";
  const occurrence = options.occurrence ?? 0;

  const call = findCall(frames, direction, action, occurrence);
  if (!call) {
    rec.fail(
      description,
      `no ${direction} CALL found for action=${action} (occurrence ${occurrence})`,
    );
    return;
  }

  const response = findResponseFor(frames, call);
  if (!response) {
    rec.fail(
      description,
      `no response frame found for uniqueId=${call.uniqueId} (${action})`,
    );
    return;
  }
  if (response.kind === "callerror") {
    rec.fail(
      description,
      `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }

  const status = (response.payload as { status?: unknown } | null)?.status;
  if (status === expectedStatus) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `expected status=${expectedStatus}, got status=${String(status)} (uniqueId=${call.uniqueId})`,
    );
  }
}

/**
 * Variant of {@link assertResponseStatus} for CALLRESULTs that nest their
 * status under `idTagInfo.status` (StartTransaction.conf, Authorize.conf)
 * rather than a top-level `status` field. Same uniqueId-paired correlation.
 */
export function assertIdTagInfoStatus(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  expectedStatus: string,
  description: string,
  options: ResponseStatusOptions = {},
): void {
  const direction = options.direction ?? "sent";
  const occurrence = options.occurrence ?? 0;

  const call = findCall(frames, direction, action, occurrence);
  if (!call) {
    rec.fail(
      description,
      `no ${direction} CALL found for action=${action} (occurrence ${occurrence})`,
    );
    return;
  }

  const response = findResponseFor(frames, call);
  if (!response) {
    rec.fail(
      description,
      `no response frame found for uniqueId=${call.uniqueId} (${action})`,
    );
    return;
  }
  if (response.kind === "callerror") {
    rec.fail(
      description,
      `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }

  const status = (
    response.payload as { idTagInfo?: { status?: unknown } } | null
  )?.idTagInfo?.status;
  if (status === expectedStatus) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `expected idTagInfo.status=${expectedStatus}, got status=${String(status)} (uniqueId=${call.uniqueId})`,
    );
  }
}

export interface AnsweredOptions {
  /** Which side sent the CALLs being answered (default "sent": the charge
   *  point, which is the direction every OCA `_CSMS` obligation is in). */
  direction?: Direction;
  /** How many such CALLs the scenario requires. Default 1. Zero CALLs is a
   *  FAIL, never a vacuous pass -- see the note on emptiness below. */
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
 * 1. Fewer than `minimum` CALLs for `action` -- FAIL. An "every X was
 *    answered" check over zero Xs passes trivially, and a check that passes
 *    when the scenario did nothing is worse than no check: it reads as
 *    coverage. If a scenario legitimately may not send `action`, it does not
 *    want this helper.
 *
 * 2. A response that is a CALLERROR -- FAIL, naming errorCode and
 *    errorDescription. A CALLERROR is a response, but it is not the `.conf`
 *    the test case asks for.
 *
 * 3. A CALL with no response AND no frame of any kind after it in the log is
 *    OUTSTANDING, not unanswered, and does NOT fail. The runner stops the
 *    simulator container after `holdSecs` (see main.ts), which truncates the
 *    wire log at an arbitrary point -- frequently mid-exchange, because the
 *    charge point keeps sending Heartbeats and StatusNotifications until the
 *    moment it is killed. Failing on that trailing CALL would make this
 *    helper measure `holdSecs` rather than the CSMS, and it would do it
 *    intermittently, which is the worst kind of red. A CALL with no response
 *    but with later frames IS a failure: the conversation demonstrably
 *    continued without it being answered.
 */
export function assertAllAnswered(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  description = `every ${action}.req answered with a ${action}.conf`,
  options: AnsweredOptions = {},
): void {
  const direction = options.direction ?? "sent";
  const minimum = options.minimum ?? 1;

  const calls = findAllCalls(frames, direction, action);
  if (calls.length < minimum) {
    rec.fail(
      description,
      `expected at least ${minimum} ${direction} CALL for action=${action}, found ${calls.length}`,
    );
    return;
  }

  const errored: string[] = [];
  let unanswered = 0;
  let outstanding = 0;

  for (const call of calls) {
    const response = findResponseFor(frames, call);
    if (!response) {
      // Rule 3: only a CALL the wire log outlived counts as unanswered.
      const isLast = frames.indexOf(call) === frames.length - 1;
      if (isLast) outstanding++;
      else unanswered++;
      continue;
    }
    if (response.kind === "callerror") {
      errored.push(
        `${response.errorCode}: ${response.errorDescription} (uniqueId=${call.uniqueId})`,
      );
    }
  }

  if (errored.length === 0 && unanswered === 0) {
    const tail =
      outstanding > 0
        ? ` (${calls.length - outstanding}/${calls.length} answered; ${outstanding} still outstanding when the log ended)`
        : ` (${calls.length}/${calls.length} answered)`;
    rec.pass(`${description}${tail}`);
    return;
  }

  const parts: string[] = [];
  if (errored.length > 0) {
    parts.push(
      `${errored.length}/${calls.length} answered with a CALLERROR -- ${errored.join("; ")}`,
    );
  }
  if (unanswered > 0) {
    parts.push(
      `${unanswered}/${calls.length} never answered (the log continued past them)`,
    );
  }
  rec.fail(description, parts.join("; "));
}

export function assertEq(
  rec: AssertRecorder,
  actual: unknown,
  expected: unknown,
  description: string,
): void {
  const reason = unverifiableReason(actual) ?? unverifiableReason(expected);
  if (reason !== undefined) {
    rec.skip(description, reason);
    return;
  }
  if (actual === expected) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `expected '${String(expected)}', got '${String(actual)}'`,
    );
  }
}

export function assertTrue(
  rec: AssertRecorder,
  condition: boolean,
  description: string,
  detail?: string,
): void {
  if (condition) {
    rec.pass(description);
  } else {
    rec.fail(description, detail);
  }
}

/**
 * check_log_contains equivalent for checks that aren't about a specific
 * OCPP frame (scenario lifecycle structured events, free-text log
 * messages) -- scans raw stdout lines rather than parsed frames.
 */
export function assertLineMatches(
  rec: AssertRecorder,
  lines: readonly string[],
  pattern: RegExp,
  description: string,
): void {
  if (lines.some((line) => pattern.test(line))) {
    rec.pass(description);
  } else {
    rec.fail(description, `no line matched pattern: ${pattern}`);
  }
}

/** check_log_not_contains equivalent over raw stdout lines. */
export function assertNoLineMatches(
  rec: AssertRecorder,
  lines: readonly string[],
  pattern: RegExp,
  description: string,
): void {
  const hit = lines.find((line) => pattern.test(line));
  if (hit) {
    rec.fail(description, `unexpected line matched pattern ${pattern}: ${hit}`);
  } else {
    rec.pass(description);
  }
}

/**
 * check_log_order equivalent: passes if the FIRST line matching `patternA`
 * appears before the FIRST line matching `patternB`.
 */
export function assertLineOrder(
  rec: AssertRecorder,
  lines: readonly string[],
  patternA: RegExp,
  patternB: RegExp,
  description: string,
): void {
  const indexA = lines.findIndex((line) => patternA.test(line));
  const indexB = lines.findIndex((line) => patternB.test(line));
  if (indexA === -1 || indexB === -1) {
    rec.fail(
      description,
      `one or both patterns not found (A=${patternA} found=${indexA !== -1}, B=${patternB} found=${indexB !== -1})`,
    );
  } else if (indexA < indexB) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `A (line ${indexA}) did not precede B (line ${indexB})`,
    );
  }
}

/**
 * check_log_after equivalent: passes if `pattern` matches some line
 * strictly after the LAST line matching `afterPattern`. Use this instead of
 * {@link assertLineOrder} when `pattern` could also match an earlier,
 * unrelated occurrence (e.g. a connector's automatic post-boot "Available"
 * StatusNotification, which always precedes any scenario-driven state
 * change and would make a first-match order check pass trivially).
 */
export function assertLineAfter(
  rec: AssertRecorder,
  lines: readonly string[],
  afterPattern: RegExp,
  pattern: RegExp,
  description: string,
): void {
  let afterIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (afterPattern.test(lines[i])) afterIndex = i;
  }
  if (afterIndex === -1) {
    rec.fail(description, `reference pattern not found: ${afterPattern}`);
    return;
  }
  const found = lines.slice(afterIndex + 1).some((line) => pattern.test(line));
  if (found) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `pattern not found after line ${afterIndex} (${afterPattern}): ${pattern}`,
    );
  }
}

/**
 * check_db_nonempty equivalent, generic over an already-fetched value
 * (keeps assert.ts free of any SteveDb/SQL coupling -- callers fetch via
 * `db.scalar(...)` and pass the result in).
 */
export function assertNonEmpty(
  rec: AssertRecorder,
  value: string,
  description: string,
): void {
  const reason = unverifiableReason(value);
  if (reason !== undefined) {
    rec.skip(description, reason);
    return;
  }
  if (value !== "") {
    rec.pass(`${description} (got '${value}')`);
  } else {
    rec.fail(description, "value was empty");
  }
}
