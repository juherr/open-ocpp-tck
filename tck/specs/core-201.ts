/**
 * specs/core-201.ts -- the OCPP 2.0.1 scenarios, and the first in this suite
 * that were not ported from anything.
 *
 * WHICH CASES MAY BE HERE IS NOT THIS FILE'S DECISION. `OCA-201-SELECTION.md`
 * states the rule -- role CSMS, status `M`, on every certification profile --
 * and `OCA-201-SLICE.txt` is the resulting list, one row per case, guarded by
 * tests/oca-201-slice.sh in both directions. Adding a scenario here for a case
 * that is not in that file fails the build, which is the point: "a small
 * representative set" was a judgement each reviewer made differently.
 *
 * WRITTEN, NOT COPIED. OCPP 2.0.1 Parts 5 and 6 are CC BY-ND 4.0, and `ND` is
 * a limit on modification: their prose, tables and step text brought into ours
 * would be the Licensed Material "arranged" or "otherwise modified", which is
 * the Adapted Material §2(a)(1)(B) withholds. So none of it is here and none of
 * it can be. Case identifiers are not that -- they are facts about the
 * specification, and OCA-201-SELECTION.md's licensing section is where that is
 * argued. Every assertion below says what we decided to measure, in our words,
 * exactly as the OCPP 1.6 scenarios do.
 *
 * WHICH OUTCOME IS WHICH CASE IS OUR READING. `ResetStatusEnumType` has three
 * values and the Reset block has three mandatory CSMS cases, so the three are
 * mapped onto Accepted / Scheduled / Rejected in that order -- and the OCA 1.6
 * suite's habit of pairing an accepted case with a rejected one (TC_026,
 * TC_028, TC_055 are all in this tree) is the reason for reading them as
 * outcomes rather than as use cases. It is an inference, it is the one thing
 * here that a reader of Part 6 can falsify in a minute, and correcting it
 * moves three templateIds and three rows of `OCA-201-SLICE.txt` and nothing
 * else.
 *
 * NO SIMULATOR TEMPLATE, which is what `runsSimTemplate: false` says on every
 * scenario below. The pinned image ships 60 templates and not one of them is
 * `cert201-`, so the wait for `scenario_started` could only ever time out --
 * and none of these needs one anyway: two are what a charge point does on
 * `connect`, and the rest are driven entirely from the CSMS side. A template
 * would be a thing to maintain upstream before a single case could be measured
 * here.
 *
 * A FAILING CSMS OPERATION IS NOT SWALLOWED HERE, which is where these differ
 * from the 1.6 scenarios: those wrap `execute` in a try/catch that warns and
 * carries on, so a CSMS that refused to dispatch is reported as a missing
 * frame. Two reasons not to inherit it. That catch also swallows
 * `UnsupportedOperationError`, which is the runner's second line of defence --
 * a driver whose scope table missed a scenario should land NOT APPLICABLE, and
 * for a protocol most drivers do not speak that backstop is the common case
 * rather than the exotic one. And a CSMS that answers "not dispatched" has said
 * something specific, which reaches the log intact as an ERROR and is exactly
 * the question these scenarios' scope rows are open on; as a FAIL it becomes
 * "no Received CALL found", which is true and says nothing.
 *
 * THE SETUP IS NO LONGER INLINE, and what replaced it is `tck/states-201.ts`.
 * OCPP 2.0.1 Part 6 defines 14 `Reusable State` fixtures for the CSMS role --
 * 13 was this paragraph's first count, corrected when the reference was re-read
 * for the operation measurement -- and a case declares the ones it takes as its
 * precondition. Issue #63 said to write that setup inline and note where it
 * duplicated rather than build a mechanism from five scenarios' evidence; the
 * evidence arrived when the selection rule turned out to pick 147 cases, at
 * which point a handful of copies becomes a class of copies that drift while
 * each one still reads reasonably. Three scenarios declare a state today --
 * TC_B_21, TC_G_03 and TC_G_04 -- and their `states:` field is what the
 * mechanism reads. TC_G_03 is the one whose state IS the case: Part 6 gives it
 * no tool validation of its own, so it has no drive() at all and the fixture's
 * traffic is what its assertions read.
 *
 * WHAT STILL DUPLICATES, deliberately: `ocppVersion` plus
 * `runsSimTemplate: false` on every scenario, the three Reset scenarios'
 * shared drive-then-check shape with one member changed, and the six
 * ChangeAvailability ones' with two. Those are not
 * fixtures. Factoring either into a shared constant renders it `·` in
 * `ASSERT-INVENTORY.txt` and stops it being pinned, which is the trade TC_B_22
 * spells out for its two literals and which applies to every declaration in
 * this file.
 */

import {
  assertAllAnswered,
  assertCallPayload,
  assertEq,
  assertLineAfter,
  assertNonEmpty,
  assertNotSent,
  assertReceived,
  assertResponseStatus,
  assertSent,
  UNEXERCISED_PREFIX,
  type AssertRecorder,
} from "../assert";
import type { CsmsRecords } from "../driver";
import { findAllCalls, findCall, findResponseFor, type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
import { assertStateEstablished } from "../states-201";
import { sleep } from "../util";

/**
 * The CSMS answered a charge-point-sent `action` with a CALLRESULT carrying a
 * `member` that parses as a timestamp.
 *
 * HERE AND NOT IN assert.ts, by the rule core.ts states for
 * `assertGetConfigurationUnfiltered`: "a Heartbeat.conf carries a currentTime"
 * is message knowledge, and assert.ts is message-agnostic by construction.
 * assertResponseStatus is the shape next door and does not fit -- it reads
 * `payload.status`, and a HeartbeatResponse has no status to read. What it
 * owes the CSMS is a clock.
 *
 * A value that is not a string, or is a string Date cannot parse, FAILS rather
 * than being skipped: this is the whole obligation of the case, so "the member
 * was there but was not a time" is the answer the case is asking about.
 */
function assertResponseTimestamp(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  member: string,
  description: string,
): void {
  const call = findCall(frames, "sent", action);
  if (!call) {
    rec.fail(description, `no Sent CALL found for action=${action}`);
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
  if (response.kind !== "callresult") {
    rec.fail(
      description,
      `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }
  const value = (response.payload as Record<string, unknown> | null)?.[member];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    rec.fail(
      description,
      `${member} is ${JSON.stringify(value)}, which does not parse as a timestamp`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * Every status the charge point reported is one the CSMS actually recorded.
 *
 * THE ONLY CHECK IN THIS FILE THAT DOES NOT COME OFF THE WIRE, and it exists
 * because for this message the wire has nothing to say. A
 * `StatusNotificationResponse` is empty -- no status member, nothing that could
 * be wrong -- so `assertAllAnswered` is satisfied by a CSMS that parsed the
 * request and threw it away. That is not hypothetical: issue #86 measured a
 * CitrineOS answering two statuses, logging four warnings, and storing neither.
 *
 * ADDRESSED FROM THE FRAMES RATHER THAN FROM A TABLE. The station decides which
 * `(evseId, connectorId)` pairs it reports -- a station-scope `(0, 0)` plus one
 * per connector, on the pinned simulator -- and a list written here would be
 * this suite's belief about that rather than a measurement of it. Reading the
 * requests back means a station that reports a third connector is checked for a
 * third connector, and a scenario whose fixture covers fewer pairs than the
 * station uses FAILS instead of quietly checking the subset that happens to
 * work.
 *
 * TWO CHECKS PER STATUS, because a CSMS can lose it in two places and one
 * answer would hide which: the connector ENTITY an operator would see, and the
 * DEVICE MODEL that `GetVariables` reads. Only the second is compared against
 * the reported value -- the first is whatever vocabulary the CSMS keeps
 * connector states in, and demanding the OCPP spelling there would be asserting
 * an implementation rather than an obligation.
 *
 * HERE AND NOT IN assert.ts, by the rule assertResponseTimestamp above states:
 * `evseId`, `connectorId` and `connectorStatus` are members of one 2.0.1
 * message, and assert.ts is message-agnostic by construction.
 */
async function assertStatusesRecorded(
  rec: AssertRecorder,
  records: CsmsRecords,
  cpId: string,
  frames: readonly Frame[],
): Promise<void> {
  const calls = findAllCalls(frames, "sent", "StatusNotification");
  if (calls.length === 0) {
    // A FAIL rather than a silent pass over an empty list: this scenario boots
    // a station that reports its connectors, so no StatusNotification at all is
    // the run having gone wrong upstream of anything here.
    rec.fail(
      "the charge point reported at least one connector status",
      "no Sent CALL found for action=StatusNotification",
    );
    return;
  }
  // THE LAST STATUS PER ADDRESS, NOT EVERY STATUS. What the CSMS holds is one
  // state per connector, so a station that reported the same connector twice --
  // Available, then Occupied -- would otherwise be asserted against its own
  // superseded value and fail on a CSMS that did exactly the right thing. This
  // scenario reports each address once, so the reduction changes nothing it
  // does today; it is what stops the next scenario to use this helper from
  // inheriting a check that only works by accident.
  const latest = new Map<string, { evseId: number; connectorId: number; reported: string }>();
  for (const call of calls) {
    const payload = call.payload as Record<string, unknown> | null;
    const evseId = payload?.evseId;
    const connectorId = payload?.connectorId;
    const reported = payload?.connectorStatus;
    if (
      typeof evseId !== "number" ||
      typeof connectorId !== "number" ||
      typeof reported !== "string"
    ) {
      rec.fail(
        "StatusNotification.req addresses a connector and names a status",
        `payload is ${JSON.stringify(call.payload)}`,
      );
      continue;
    }
    // findAllCalls answers in log order, so the last write wins is the last
    // status sent.
    latest.set(`${evseId}:${connectorId}`, { evseId, connectorId, reported });
  }

  for (const { evseId, connectorId, reported } of latest.values()) {
    const where = `EVSE ${evseId} connector ${connectorId}`;
    assertNonEmpty(
      rec,
      await records.deviceModel.connectorStatus(cpId, evseId, connectorId),
      `CSMS: ${where} exists and carries a state`,
    );
    assertEq(
      rec,
      await records.deviceModel.availabilityState(cpId, evseId, connectorId),
      reported,
      `CSMS: ${where} is ${reported} in the device model`,
    );
  }
}

/**
 * One entry of a `getVariableData` / `setVariableData` array, read as loosely
 * as the wire allows: every member optional and `unknown`, because what the
 * assertions below are for is precisely the case where the CSMS sent
 * something other than what was asked for.
 */
interface VariableSubject {
  component?: { name?: unknown };
  variable?: { name?: unknown };
}

/**
 * Renders a subject array for a failure message.
 *
 * FAILURE PATH ONLY, which is why it is a function rather than a `const`
 * computed before the checks: the passing call is the common one and has no
 * message to build. It also removes the empty-array ternary that an eagerly
 * joined string needed, because `[].join()` is `""` and `""` reads as though
 * the array had one nameless entry.
 *
 * NOT NAMED `assert*`, and that is safe here rather than the hole
 * tools/extract-assert-inventory.ts warns about: the warning is about a
 * non-`assert*` helper that WRAPS ASSERTIONS, and this one takes no recorder
 * and makes no `rec` call. It formats.
 */
function describeSubjects(rows: readonly VariableSubject[]): string {
  return rows.length === 0
    ? "an empty array"
    : rows
        .map(
          (row) =>
            `${JSON.stringify(row?.component?.name)}/${JSON.stringify(row?.variable?.name)}`,
        )
        .join(", ");
}

/**
 * The CSMS put a request on the wire asking about exactly one
 * `component`/`variable` pair, inside `member`.
 *
 * HERE AND NOT IN assert.ts, for `assertResponseTimestamp`'s reason one step
 * further out. `assertCallPayload` is the shape next door and cannot be made
 * to fit: it compares members with `Object.is`, so every value it can check is
 * a scalar, and `getVariableData` is an array of objects. Widening it to walk
 * nested structures would give every 1.6 scenario a matcher none of them asked
 * for, and the knowledge being applied here -- that a GetVariables request
 * carries its subject in an array rather than in a member -- is message
 * knowledge, which assert.ts is built not to hold.
 *
 * WHAT THIS MEASURES IS THE CSMS, not the station. The driver asked for one
 * pair; a CSMS that dropped it, renamed it or added an entry of its own has
 * reshaped an operation on the way to the wire, and that is the finding. It is
 * the same measurement `Reset.req asks for type=Immediate` makes, against a
 * request whose subject is not a scalar.
 *
 * EXACTLY ONE ENTRY, ASSERTED, and it is the load-bearing half. An earlier
 * draft matched ANY entry so that a CSMS batching legally would not be filed
 * against -- which read reasonably and was wrong twice over. `itemsPerMessage`
 * can only SPLIT a batch, never add to one, so no legal batching decision
 * produces an entry the driver did not ask for; and matching any entry made
 * "added a second entry of its own" a claim in the paragraph above that the
 * code did not check, which is the shape of silent pass this suite exists to
 * refuse. It also makes the reads at `[0]` in the two helpers below sound,
 * where before they rested on a count nothing enforced.
 *
 * A SCENARIO SENDING SEVERAL VARIABLES therefore may not use this helper as
 * it stands. That is deliberate rather than a limitation to route around: it
 * would need a different assertion -- a set comparison, or a per-pair one --
 * and getting there by relaxing this one puts the silent pass straight back.
 */
function assertVariableRequested(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  member: string,
  component: string,
  variable: string,
  description: string,
): void {
  const call = findCall(frames, "received", action);
  if (!call) {
    rec.fail(description, `no Received CALL found for action=${action}`);
    return;
  }
  const entries = (call.payload as Record<string, unknown> | null)?.[member];
  if (!Array.isArray(entries)) {
    rec.fail(
      description,
      `${member} is ${JSON.stringify(entries)}, which is not the array the wire calls for`,
    );
    return;
  }
  const rows = entries as readonly VariableSubject[];
  if (rows.length !== 1) {
    rec.fail(
      description,
      `${member} carries ${rows.length} entries where the driver asked for 1: ${describeSubjects(rows)}`,
    );
    return;
  }
  const row = rows[0];
  if (row?.component?.name !== component || row?.variable?.name !== variable) {
    rec.fail(
      description,
      `${member}[0] asks about ${describeSubjects(rows)}, expected ${component}/${variable}`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * The station answered `action` with a `member` whose first result carries
 * `attributeStatus`.
 *
 * `assertResponseStatus` is again the shape next door and again does not fit:
 * it reads `payload.status`, and a GetVariablesResponse has none -- its
 * outcome is per requested variable, one `attributeStatus` per result.
 *
 * READING `[0]` IS SOUND ONLY BECAUSE `assertVariableRequested` RAN, and both
 * scenarios call it first. The results correlate with the request
 * positionally, so `[0]` is ours exactly as long as the request carried one
 * entry -- which that helper asserts rather than assumes. Dropping it from a
 * scenario, or relaxing it, silently turns this into "some result was
 * Accepted".
 *
 * WHAT A NON-`Accepted` STATUS MEANS IS NOT THIS ASSERTION'S BUSINESS, and the
 * reason is worth having: `UnknownComponent` and `UnknownVariable` are
 * statements about the STATION's device model, so a red here is only a finding
 * against the CSMS once the pair is known to be one the station has. That is
 * what picking a pair the pinned simulator's own map spells buys, and it is
 * the assumption to re-check when the simulator digest moves.
 */
function assertVariableResultStatus(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  member: string,
  expectedStatus: string,
  description: string,
): void {
  const call = findCall(frames, "received", action);
  if (!call) {
    rec.fail(description, `no Received CALL found for action=${action}`);
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
  if (response.kind !== "callresult") {
    rec.fail(
      description,
      `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }
  const results = (response.payload as Record<string, unknown> | null)?.[member];
  if (!Array.isArray(results) || results.length === 0) {
    rec.fail(
      description,
      `${member} is ${JSON.stringify(results)}, so the answer names no result to read`,
    );
    return;
  }
  const status = (results[0] as { attributeStatus?: unknown } | null)
    ?.attributeStatus;
  if (status !== expectedStatus) {
    rec.fail(
      description,
      `${member}[0].attributeStatus is ${JSON.stringify(status)}, expected ${expectedStatus}`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * The sole entry of `member` carries `expected`, AS A STRING.
 *
 * Separate from `assertVariableRequested` rather than a fourth argument to it,
 * because the two say different things: that one is about the subject and is
 * shared with `GetVariables`, which has no value to carry. Folding them would
 * give the read scenario a parameter it must pass as undefined.
 *
 * ACTION AND MEMBER ARE PARAMETERS, not the literals an earlier draft spelled
 * inline, and the reason is the guarded artifact rather than reuse. The
 * extractor renders every non-literal argument as `·`, so a fully spelled-out
 * version recorded as `assertVariableValueSent(·, ·, ·, ·)` -- every argument
 * blind. Repointing it at another action or member would then move nothing in
 * ASSERT-INVENTORY.txt, where the identical change one line above moves a
 * literal. Passing them costs two arguments the caller already has and buys
 * back the pinning; `assert.ts`'s rejected-refactor note states the same rule
 * from the other direction.
 *
 * Reading `[0]` rests on the same exactly-one assertion the helper above
 * makes, and this one does not repeat it.
 */
function assertVariableValueSent(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  member: string,
  expected: string,
  description: string,
): void {
  const call = findCall(frames, "received", action);
  if (!call) {
    rec.fail(description, `no Received CALL found for action=${action}`);
    return;
  }
  const entries = (call.payload as Record<string, unknown> | null)?.[member];
  if (!Array.isArray(entries) || entries.length === 0) {
    rec.fail(
      description,
      `${member} is ${JSON.stringify(entries)}, so there is no value to read`,
    );
    return;
  }
  const value = (entries[0] as { attributeValue?: unknown } | null)
    ?.attributeValue;
  if (value !== expected) {
    rec.fail(
      description,
      `attributeValue is ${JSON.stringify(value)}, expected the string ${JSON.stringify(expected)}`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * The CSMS's verdict on an idToken the charge point presented: the CALLRESULT
 * answering `action` carries an `idTokenInfo` whose `status` is one of
 * `expected`.
 *
 * A SIBLING OF assertIdTagInfoStatus RATHER THAN A REUSE OF IT, and the two
 * are one letter apart in a way that would fail quietly. OCPP 1.6 spells the
 * member `idTagInfo` and 2.0.1 spells it `idTokenInfo`; assert.ts's helper
 * reads the 1.6 name, so pointed at a 2.0.1 frame it reports "expected
 * idTagInfo.status=Accepted, got status=undefined" -- true, and a statement
 * about a member the message does not have rather than about the CSMS.
 *
 * A SET RATHER THAN ONE VALUE, because the cases this serves are written that
 * way: an unknown token may be reported `Invalid` OR `Unknown`, and which of
 * the two a conformant CSMS picks is its own business. Collapsing the set to
 * whichever one the CSMS in front of us happens to send would turn an
 * obligation into a measurement of one implementation, and the next CSMS would
 * be filed against for a legal answer.
 *
 * SENT, NOT RECEIVED, and there is no option to change it: every case that
 * asks this question asks it about a request the CHARGE POINT made -- an
 * Authorize, a TransactionEvent -- which is the direction every OCA `_CSMS`
 * obligation is in. A direction parameter would be a member with one caller.
 *
 * HERE AND NOT IN assert.ts, by the rule assertResponseTimestamp above states:
 * `idTokenInfo` is a member of two 2.0.1 messages, and assert.ts is
 * message-agnostic by construction.
 */
function assertIdTokenInfoStatus(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  expected: readonly string[],
  description: string,
): void {
  const call = findCall(frames, "sent", action);
  if (!call) {
    rec.fail(description, `no Sent CALL found for action=${action}`);
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
  if (response.kind !== "callresult") {
    rec.fail(
      description,
      `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }
  const status = (
    response.payload as { idTokenInfo?: { status?: unknown } } | null
  )?.idTokenInfo?.status;
  if (typeof status !== "string" || !expected.includes(status)) {
    rec.fail(
      description,
      `idTokenInfo.status is ${JSON.stringify(status)}, expected one of ${expected.join(" or ")} (uniqueId=${call.uniqueId})`,
    );
    return;
  }
  rec.pass(`${description} (got ${status})`);
}

/**
 * The first CALL the charge point sent for `action` presents `expected` as its
 * `idToken.idToken`.
 *
 * WHAT IT PINS IS THE QUESTION, WHERE THE HELPER ABOVE PINS THE ANSWER. A
 * scenario carrying only the verdict check can be answered `Unknown` about a
 * token nobody asked about -- a mistyped `tagId` produces exactly that, green,
 * and the artifact records a conformance claim the run never made. The two
 * belong together and every caller here writes both.
 *
 * IT MEASURES THE STATION AND IS HERE ANYWAY, which is the same argument
 * TC_B_01's `reason: "PowerUp"` check rests on: the value is the scenario's
 * own input travelling back through the simulator, so what it actually
 * establishes is that this run put the token we believe it put on the wire.
 *
 * `assertCallPayload` is the shape next door and cannot be made to fit: it
 * compares members with `Object.is`, so every value it can check is a scalar,
 * and `idToken` is an object.
 */
function assertIdTokenSent(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  expected: string,
  description: string,
): void {
  const call = findCall(frames, "sent", action);
  if (!call) {
    rec.fail(description, `no Sent CALL found for action=${action}`);
    return;
  }
  const token = (call.payload as { idToken?: { idToken?: unknown } } | null)
    ?.idToken?.idToken;
  if (token !== expected) {
    rec.fail(
      description,
      `idToken.idToken is ${JSON.stringify(token)}, expected ${JSON.stringify(expected)}`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * The first CALL the charge point sent for `action` addresses an EVSE and
 * carries at least one sampled value.
 *
 * WHY A SHAPE CHECK AND NOT A VALUE ONE. What a meter reports is the station's
 * business, and this suite has no opinion about kWh. What it does have an
 * opinion about is which PROTOCOL produced the frame: OCPP 1.6's
 * MeterValues.req addresses a `connectorId` and carries its readings as
 * strings, 2.0.1's addresses an `evseId` and carries them as numbers under
 * `meterValue[].sampledValue[]`. A scenario that ran on the wrong version
 * would otherwise reach its answered-check and pass it -- the failure
 * `ScenarioSpec.ocppVersion` exists for, arriving in the one message this
 * scenario has.
 *
 * `evseId` IS NOT COMPARED TO A NUMBER, deliberately. Which EVSE the pinned
 * image maps a connector onto is the station's topology, and a literal here
 * would be this suite's belief about it rather than a measurement --
 * assertStatusesRecorded's note above makes the same choice for the same
 * reason.
 */
function assertMeterValueSampled(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  description: string,
): void {
  const call = findCall(frames, "sent", action);
  if (!call) {
    rec.fail(description, `no Sent CALL found for action=${action}`);
    return;
  }
  const payload = call.payload as Record<string, unknown> | null;
  if (typeof payload?.evseId !== "number") {
    rec.fail(
      description,
      `evseId is ${JSON.stringify(payload?.evseId)}, so the request addresses no EVSE`,
    );
    return;
  }
  const meterValue = payload.meterValue;
  const first = Array.isArray(meterValue)
    ? (meterValue[0] as { sampledValue?: unknown } | null)
    : null;
  const sampled = first?.sampledValue;
  if (!Array.isArray(sampled) || sampled.length === 0) {
    rec.fail(
      description,
      `meterValue[0].sampledValue is ${JSON.stringify(sampled)}, so the request reports no reading`,
    );
    return;
  }
  rec.pass(description);
}

/**
 * The CSMS put a `ChangeAvailability` on the wire in one of the three scopes
 * 2.0.1 gives it, and asked for the availability the scenario asked for.
 *
 * THREE SCOPES, TOLD APART BY ABSENCE. The request carries `operationalStatus`
 * and an optional `evse` object; `evse` absent means the whole charging
 * station, `evse` with `id` alone means that EVSE, and `evse` with
 * `connectorId` as well means that connector. Nothing else distinguishes them
 * -- so a check that read `operationalStatus` alone would pass identically on
 * all three, and two pairs of the six scenarios below would be measuring one
 * request each while claiming two cases.
 *
 * HERE AND NOT IN assert.ts, for `assertVariableRequested`'s reason:
 * `assertCallPayload` compares members with `Object.is`, so every value it can
 * check is a scalar, and `evse` is an object whose SHAPE is the subject.
 * Widening that helper to walk nested structures would hand every OCPP 1.6
 * scenario a matcher none of them asked for, and "a ChangeAvailability request
 * addresses a scope by which members of `evse` are present" is message
 * knowledge, which assert.ts is built not to hold.
 *
 * NULL MEANS "MUST BE ABSENT" rather than "do not care", which is the half
 * that makes the helper worth having. `evseId: null` fails a request that
 * carries an `evse`, and `connectorId: null` fails one that narrowed to a
 * connector the scenario did not ask about. A "do not care" spelling was
 * considered and rejected: every call below knows exactly which scope it wants,
 * and the one thing a CSMS can do wrong here is send a different one.
 *
 * `occurrence` because two of the six scenarios put a second request on the
 * wire before the one under test -- a fixture in one case, an inline setup in
 * the other -- and matching ANY request would let the setup satisfy the check
 * the case is about.
 */
function assertChangeAvailabilityScope(
  rec: AssertRecorder,
  frames: readonly Frame[],
  occurrence: number,
  operationalStatus: string,
  /** The `evse.id` the request must carry, or null for one that must omit
   *  `evse` altogether and so address the whole charging station. */
  evseId: number | null,
  /** The `evse.connectorId` it must carry, or null for one that must omit it. */
  connectorId: number | null,
  description: string,
): void {
  const calls = findAllCalls(frames, "received", "ChangeAvailability");
  const call = calls[occurrence];
  if (!call) {
    rec.fail(
      description,
      `no Received CALL number ${occurrence} for action=ChangeAvailability (found ${calls.length})`,
    );
    return;
  }
  const payload = call.payload as Record<string, unknown> | null;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    rec.fail(description, `payload is ${JSON.stringify(call.payload)}`);
    return;
  }
  const evse = payload.evse;
  // Present-but-not-an-object is refused by name rather than falling into the
  // reads below, where `("" as never).id` is undefined and would render as the
  // absent scope -- i.e. a malformed request reported as a correct one.
  if (evse !== undefined && (typeof evse !== "object" || evse === null || Array.isArray(evse))) {
    rec.fail(description, `evse is ${JSON.stringify(evse)}, which is not an EVSEType object`);
    return;
  }
  const members = (evse ?? {}) as Record<string, unknown>;
  const sentEvseId = evse === undefined ? null : (members.id ?? null);
  const sentConnectorId = evse === undefined ? null : (members.connectorId ?? null);
  const wrong: string[] = [];
  if (payload.operationalStatus !== operationalStatus) {
    wrong.push(`operationalStatus=${JSON.stringify(payload.operationalStatus)}`);
  }
  if (sentEvseId !== evseId) wrong.push(`evse.id=${JSON.stringify(sentEvseId)}`);
  if (sentConnectorId !== connectorId) {
    wrong.push(`evse.connectorId=${JSON.stringify(sentConnectorId)}`);
  }
  if (wrong.length === 0) {
    rec.pass(description);
    return;
  }
  rec.fail(
    description,
    `expected operationalStatus=${operationalStatus}, evse.id=${JSON.stringify(evseId)}, ` +
      `evse.connectorId=${JSON.stringify(connectorId)}; got ${wrong.join(", ")}`,
  );
}

/**
 * The pair TC_B_06 and TC_B_09 operate on.
 *
 * NOT AN ARBITRARY CHOICE, and the constraint is the STATION's rather than the
 * CSMS's. The pinned simulator answers 2.0.1 variable traffic out of a 12-entry
 * map from `<Component>/<Variable>` onto an OCPP 1.6 configuration key
 * (`deviceModelMap.ts` in its own sources); anything outside that map is
 * answered `UnknownComponent` or `UnknownVariable`, which would make both
 * scenarios red for a reason that is not about the CSMS at all.
 *
 * `HeartbeatInterval` specifically because it is the one entry that is both
 * readable and writable with no side effect worth having: it is `readonly:
 * false` and absent from the simulator's reboot-required set, so a write is
 * answered `Accepted` rather than `RebootRequired`, and the value below is
 * raised rather than lowered so that a station left running after the write
 * emits LESS traffic, not more.
 *
 * WHEN THE SIMULATOR DIGEST MOVES, this is the assumption to re-check. Both
 * scenarios go red together if it stops holding, which is the loudest way for
 * it to fail.
 *
 * WHICH COMMITTED ARTIFACT PINS THESE, because it is not the obvious one.
 * Passing them as identifiers rather than literals means ASSERT-INVENTORY.txt
 * renders them `·` -- the same blindness a callback argument has there -- so
 * the assertion side records only that SOMETHING was asked about. DRIVE-TRACE
 * .txt is what holds them: `OP 201:GetVariables [heartbeatinterval,
 * ocppcommctrlr]`. Editing either constant therefore still moves a guarded
 * artifact, just the other one. Inlining the strings at all four call sites
 * would put them in both, and duplicate the pair the drive and the assert must
 * agree on -- which is the coupling these constants exist to make impossible.
 */
const VARIABLE_COMPONENT = "OCPPCommCtrlr";
const VARIABLE_NAME = "HeartbeatInterval";
const WRITTEN_INTERVAL = "600";

const TC_B_06: ScenarioSpec = {
  templateId: "cert201-tcb06-get-variables",
  description:
    "TC_B_06 Get Variables: the CSMS reads one variable and the station answers it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12 BECAUSE IT WAS MEASURED, not because it was reasoned to. What this
  // waits for is one CSMS-initiated command and one station answer -- the
  // shape TC_B_22 below holds at 10 -- so 12 has two seconds of margin over
  // the closest precedent and no argument of its own. Both values are
  // guesses about contention; this one is a guess that has since run green
  // in CI, and TC_B_20's history is a number that passed isolated and failed
  // under three lanes. Lowering it is a sweep, not an edit.
  holdSecs: 12,
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, {
      action: "GetVariables",
      variables: [
        {
          component: { name: VARIABLE_COMPONENT },
          variable: { name: VARIABLE_NAME },
        },
      ],
    });
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "GetVariables", "GetVariables.req received");
    assertVariableRequested(
      rec,
      frames,
      "GetVariables",
      "getVariableData",
      VARIABLE_COMPONENT,
      VARIABLE_NAME,
      `GetVariables.req asks about ${VARIABLE_COMPONENT}/${VARIABLE_NAME}`,
    );
    assertVariableResultStatus(
      rec,
      frames,
      "GetVariables",
      "getVariableResult",
      "Accepted",
      "the variable was read",
    );
  },
};

const TC_B_09: ScenarioSpec = {
  templateId: "cert201-tcb09-set-variables",
  description:
    "TC_B_09 Set Variables: the CSMS writes one variable and the station accepts it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, {
      action: "SetVariables",
      variables: [
        {
          component: { name: VARIABLE_COMPONENT },
          variable: { name: VARIABLE_NAME },
          attributeValue: WRITTEN_INTERVAL,
        },
      ],
    });
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "SetVariables", "SetVariables.req received");
    assertVariableRequested(
      rec,
      frames,
      "SetVariables",
      "setVariableData",
      VARIABLE_COMPONENT,
      VARIABLE_NAME,
      `SetVariables.req asks about ${VARIABLE_COMPONENT}/${VARIABLE_NAME}`,
    );
    // THE VALUE IS THE HALF THAT ONLY THIS CASE CAN CHECK. Reading measures
    // that the CSMS relayed a subject; writing measures that it relayed a
    // PAYLOAD, and `attributeValue` is the one member a CSMS could plausibly
    // reshape on the way out -- 2.0.1 carries every value as text whatever the
    // variable's declared type, so a CSMS that helpfully sent 600 rather than
    // "600" would be spelling a schema violation the station may still accept.
    assertVariableValueSent(
      rec,
      frames,
      "SetVariables",
      "setVariableData",
      WRITTEN_INTERVAL,
      `SetVariables.req carries attributeValue="${WRITTEN_INTERVAL}" as a string`,
    );
    assertVariableResultStatus(
      rec,
      frames,
      "SetVariables",
      "setVariableResult",
      "Accepted",
      "the variable was written",
    );
  },
};

const TC_B_01: ScenarioSpec = {
  templateId: "cert201-tcb01-cold-boot",
  description:
    "TC_B_01 Cold Boot: the charge point boots on OCPP 2.0.1 and the CSMS accepts it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 10,
  async assert({ cpId, frames, rec, records }) {
    assertSent(rec, frames, "BootNotification", "BootNotification.req sent");
    // THE PROTOCOL, ASSERTED RATHER THAN ASSUMED, and it is this scenario's
    // job because it is the one that boots. `reason` is a 2.0.1 member: the
    // 1.6 request carries chargePointVendor/chargePointModel and nothing
    // resembling it, so a run that reached a 1.6 wire cannot satisfy this. The
    // scenario declares its version and the runner passes it to the container,
    // which leaves exactly one way to be wrong -- the flag not arriving -- and
    // this is what notices. Six of seven checks stayed green when a 1.6
    // scenario was forced onto 2.0.1 (issue #57 §C); the reverse would be
    // quieter still.
    assertCallPayload(
      rec,
      frames,
      "sent",
      "BootNotification",
      { reason: "PowerUp" },
      "BootNotification.req is the OCPP 2.0.1 request (reason=PowerUp)",
    );
    assertResponseStatus(
      rec,
      frames,
      "BootNotification",
      "Accepted",
      "BootNotification accepted",
      { direction: "sent" },
    );
    // What the station reports once the boot is accepted, and the CSMS owes a
    // response to each.
    assertAllAnswered(rec, frames, "StatusNotification");
    // AND WHETHER ANSWERING MEANT ANYTHING, which is the question the line
    // above cannot reach and used to be parked on issue #58 as unanswerable.
    // It is answerable, just not from the charge point's side: the helper reads
    // the CSMS back. This is the one scenario that boots, so it is the one that
    // reports connector statuses, so it is where the check belongs.
    await assertStatusesRecorded(rec, records, cpId, frames);
  },
};

const TC_B_20: ScenarioSpec = {
  templateId: "cert201-tcb20-reset-accepted",
  description:
    "TC_B_20 Reset: the CSMS sends Reset(Immediate) to an idle station, which accepts it and reboots.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 25s left the reboot's answer outstanding under three-lane contention on
  // the first CI sweep, where the same window passed isolated. This is the
  // only scenario here that waits on a round trip the station makes AFTER
  // rebooting, so it is the only one that pays for contention twice.
  holdSecs: 32,
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, { action: "Reset", type: "Immediate" });
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "Reset", "Reset.req received");
    // The CSMS is the system under test, so what it sent is the measurement:
    // an operation the driver asked for and the CSMS reshaped on the way to
    // the wire is a finding, and the type is the only member this request has.
    assertCallPayload(
      rec,
      frames,
      "received",
      "Reset",
      { type: "Immediate" },
      "Reset.req asks for type=Immediate",
    );
    assertResponseStatus(
      rec,
      frames,
      "Reset",
      "Accepted",
      "Reset accepted",
      { direction: "received" },
    );
    // The station reboots and boots again, and the CSMS owes that second
    // BootNotification an answer exactly as it owed the first.
    //
    // BOTH BOOTS, AND THE ORDER MATTERS FOR A REASON THAT IS NOT TIDINESS.
    // `occurrence: 1` is an index, so it means "the reboot" only while the
    // first boot is the first boot: a CSMS that Rejected the cold boot would
    // have the station retry, and occurrence 1 would silently become that
    // RETRY -- green while no reset-triggered reboot ever happened. Pinning
    // occurrence 0 as Accepted is what keeps the index meaning what it says.
    assertResponseStatus(
      rec,
      frames,
      "BootNotification",
      "Accepted",
      "the cold boot is accepted, so the next boot is the reset's",
      { direction: "sent", occurrence: 0 },
    );
    // THE REBOOT IS REQUIRED HERE, AND ITS ANSWER IS NOT PINNED BY INDEX --
    // measured, not chosen. A status check on occurrence 1 was written first
    // and the first CI sweep failed it with "no response frame found": the
    // reboot's BootNotification had reached the wire and its CALLRESULT had
    // not, at the moment the window closed. The isolated retry passed. So the
    // CSMS was conformant and the harness reported a non-conformance, which is
    // the one mistake this suite may not make.
    //
    // `assertAllAnswered`'s third rule is built for exactly that: a call still
    // outstanding when the log ends is not an unanswered one. `minimum: 2` is
    // what keeps the reboot a stated requirement -- one boot is the cold boot,
    // so fewer than two means the reset produced none -- and it reads the
    // CSMS's side of both, which is what the case obliges.
    assertAllAnswered(rec, frames, "BootNotification", undefined, {
      minimum: 2,
    });
  },
};

const TC_B_21: ScenarioSpec = {
  templateId: "cert201-tcb21-reset-scheduled",
  description:
    "TC_B_21 Reset: the CSMS sends Reset(OnIdle) while a transaction is running, and the station schedules it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  // THE ONE SCENARIO HERE THAT NEEDS THE STATION IN A STATE, and Part 6 names
  // that state: `OnIdle` is only distinguishable from `Immediate` when there is
  // a transaction to wait for. `Authorized` is not written here even though the
  // fixture executes it -- the edge is a fact about the reference and
  // tck/states-201.ts derives it, where a second copy on every scenario is a
  // fact that drifts.
  //
  // LITERALS AND NOT A SHARED CONSTANT, for the reason TC_B_22 gives eight
  // lines further down about its own two: an identifier renders as `·`, which
  // for a top-level field means the whole declaration is OMITTED from
  // ASSERT-INVENTORY.txt rather than marked, and the fixture could then be
  // re-pointed at another connector or another tag with no committed artifact
  // moving. The tag's shape is part of the setup and `tck/states-201.ts`'s
  // `AUTHORIZED` carries the argument for why it is not `CERT-TAG-1`.
  states: [{ state: "EnergyTransferStarted", connectorId: 1, idToken: "CE712001" }],
  async drive({ cpId, csms201 }) {
    await sleep(2000);
    await csms201.execute(cpId, { action: "Reset", type: "OnIdle" });
  },
  assert({ frames, rec, fixtures }) {
    // FIRST, so a reader of results/ meets the cause before the consequence --
    // and SKIPPED rather than FAIL when it did not hold. `OnIdle` against an
    // idle station is answered `Accepted`, which is correct of the station and
    // correct of a CSMS that dispatched faithfully: red would be this harness
    // filing a non-conformance against a CSMS that did nothing wrong, which is
    // the one mistake a conformance tool may not make. Orange says the suite
    // did not ask, which is what actually happened. The rule now lives in
    // `assertStateEstablished` rather than in this scenario, which is what it
    // means for the mechanism to have taken the setup over.
    assertStateEstablished(
      rec,
      fixtures,
      "EnergyTransferStarted",
      "a transaction was running when the reset was asked for",
    );
    assertReceived(rec, frames, "Reset", "Reset.req received");
    assertCallPayload(
      rec,
      frames,
      "received",
      "Reset",
      { type: "OnIdle" },
      "Reset.req asks for type=OnIdle",
    );
    if (fixtures.established("EnergyTransferStarted")) {
      assertResponseStatus(
        rec,
        frames,
        "Reset",
        "Scheduled",
        "Reset scheduled until the transaction ends",
        { direction: "received" },
      );
    } else {
      rec.skip(
        "Reset scheduled until the transaction ends",
        `${UNEXERCISED_PREFIX} the station was idle, so this case's distinguishing outcome was never reachable`,
      );
    }
    // The transaction that makes the status above meaningful. It is a check
    // about the CSMS in its own right -- a TransactionEvent it never answered
    // is the failure the whole `assertAllAnswered` family exists for -- and it
    // is also how a reader tells "Scheduled because a transaction was running"
    // from "Scheduled for a reason nobody established".
    assertAllAnswered(rec, frames, "TransactionEvent");
  },
};

const TC_B_22: ScenarioSpec = {
  templateId: "cert201-tcb22-reset-rejected",
  description:
    "TC_B_22 Reset: the CSMS sends Reset for an EVSE the station does not have, and the station rejects it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 10,
  async drive({ cpId, csms201 }) {
    // EVSE 9 IS THE POINT, AND IT IS A LITERAL ON PURPOSE. The simulator runs
    // with its default single connector, so any id past the first is unknown
    // to it and the request is refused for the reason this case is about
    // rather than by accident; a comfortable distance from 1 keeps that true
    // if a station is ever widened. It is not 0, which 2.0.1 reads as the
    // station's own component -- a request that means something else.
    //
    // Named constants for the two spellings below were tried and reverted: an
    // identifier renders as `·` in ASSERT-INVENTORY.txt, so the assertion's
    // expected payload stops being pinned and the value could be changed with
    // no committed artifact moving. Two literals eight lines apart is the
    // price of that artifact meaning what it says.
    await csms201.execute(cpId, { action: "Reset", type: "Immediate", evseId: 9 });
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "Reset", "Reset.req received");
    // evseId is the member under test, so it is the one that has to survive
    // the CSMS: a Reset dispatched without it is a station-wide reset, which
    // the station would accept, and the scenario would then be measuring the
    // previous one.
    assertCallPayload(
      rec,
      frames,
      "received",
      "Reset",
      { type: "Immediate", evseId: 9 },
      "Reset.req names the EVSE it was asked to name",
    );
    assertResponseStatus(
      rec,
      frames,
      "Reset",
      "Rejected",
      "Reset rejected for an EVSE the station does not have",
      { direction: "received" },
    );
  },
};

// WHAT THIS SCENARIO USED TO MEASURE, and why the change is a correction
// rather than a widening. It drove `sim.send({ command: "heartbeat" })` and
// asserted the CSMS answered -- the station's half of TC_F_20, and the half
// the case does not validate. TC_F_20_CSMS is "Trigger message - Heartbeat":
// the CSMS is the system under test, its step 1 is a TriggerMessageRequest,
// and that step carries the case's ONLY tool validation. So the row claimed a
// case whose measurement was absent, in the direction that reads as coverage.
//
// The mistake was reading the case off its title. A title names the message
// the station is made to send; the reference organises a case by which side is
// under test. OCA-201-SELECTION.md records the same correction against the six
// candidate messages the milestone was scoped from -- Reset turning out to be
// three cases, StatusNotification none -- and this is that correction arriving
// a second time, from the other end.
const TC_F_20: ScenarioSpec = {
  templateId: "cert201-tcf20-heartbeat",
  description:
    "TC_F_20 Trigger Message: the CSMS sends TriggerMessage(Heartbeat), and the station's Heartbeat is answered with a current time.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, and the 8 it replaces was measured against a drive() that no longer
  // exists: one local sim.send. What is waited on now is a chain -- the CSMS's
  // TriggerMessage, the station's answer, the Heartbeat it then sends, and the
  // CSMS's answer to that -- and 8 was the shortest hold in this file while
  // being one of its longest chains. 12 is the modal hold among this file's
  // CSMS-driven scenarios -- TC_B_06, TC_B_09 and TC_B_21 -- and what the 1.6
  // twin uses for this
  // exact exchange (plus a sleep(2000) this does not need: bootWaitSecs gates
  // the same thing). TC_B_20's note records what a window tuned in isolation
  // costs under three-lane CI contention.
  holdSecs: 12,
  async drive({ cpId, csms201 }) {
    // THE TRIGGER IS THE MEASUREMENT, and the Heartbeat is its consequence. The
    // charge point also starts a periodic timer at whatever interval the
    // BootNotification response returned -- 60s on the CSMS this was measured
    // against (issue #57) -- which is why the assertions below pin the
    // Heartbeat to this trigger rather than to its own existence.
    await csms201.execute(cpId, {
      action: "TriggerMessage",
      requestedMessage: "Heartbeat",
    });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "TriggerMessage", "TriggerMessage.req received");
    // The CSMS is the system under test, so what it put on the wire is the
    // measurement -- and `requestedMessage` is the one member this request
    // carries, so a CSMS that reshaped the operation on the way out has
    // nowhere to hide it.
    assertCallPayload(
      rec,
      frames,
      "received",
      "TriggerMessage",
      { requestedMessage: "Heartbeat" },
      "TriggerMessage.req asks for a Heartbeat",
    );
    assertResponseStatus(
      rec,
      frames,
      "TriggerMessage",
      "Accepted",
      "TriggerMessage accepted",
      { direction: "received" },
    );
    // assertLineAfter, not a first-match order check, for TC_054's reason one
    // protocol over: the periodic Heartbeat is unrelated to this trigger and
    // can land anywhere in the log, so a first-match check is satisfied by a
    // Heartbeat that owes nothing to the request under test.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"TriggerMessage"/,
      /Sent: \[2,.*"Heartbeat"/,
      "requested Heartbeat sent after TriggerMessage",
    );
    assertSent(rec, frames, "Heartbeat", "Heartbeat.req sent");
    // Heartbeat only. `assertAllAnswered` counts CALLs the charge point
    // SENT, which is the direction every OCA `_CSMS` obligation is in, and
    // TriggerMessage travels the other way -- pointed at it, the check finds
    // nothing to count and reports UNEXERCISED forever. That the trigger was
    // answered is `assertResponseStatus`'s job above, on `received`.
    assertAllAnswered(rec, frames, "Heartbeat");
    assertResponseTimestamp(
      rec,
      frames,
      "Heartbeat",
      "currentTime",
      "Heartbeat.conf carries a currentTime the charge point can parse",
    );
  },
};

const TC_C_02: ScenarioSpec = {
  templateId: "cert201-tcc02-authorize-invalid",
  description:
    "TC_C_02 Local start transaction: the station presents an idToken the CSMS does not know, and the CSMS reports it as not valid.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 10, the shortest hold in this file, and the chain is why: one local
  // sim.send, one Authorize.req, one answer. That is TC_B_22's shape -- a
  // single round trip with nothing after it -- and 10 is what TC_B_22 has run
  // at. Nothing here waits on a reboot, on a second boot, or on a station
  // timer, which is what the longer holds above are paying for.
  holdSecs: 10,
  async drive({ sim }) {
    // EIGHT HEXADECIMAL CHARACTERS, AND THAT IS THE HALF THAT IS NOT
    // ARBITRARY. The station types every 2.0.1 idToken `ISO14443` -- a literal
    // in the pinned image, not a setting -- and a CSMS is entitled to validate
    // that type's format (a card UID: 4 or 7 bytes, so 8 or 14 hex characters)
    // BEFORE looking anything up. A `CERT…` spelling is answered with a
    // CALLERROR about the shape, which is not the verdict this case is about,
    // and the scenario would be measuring a format check.
    //
    // AND IT MUST BE A TOKEN NOTHING SEEDS, which is the other half: the case
    // asks the CSMS about a token it does not know, so a collision with any
    // driver's fixture turns the expected answer into `Accepted`. It is not a
    // named constant for TC_B_22's reason -- an identifier renders as `·` in
    // ASSERT-INVENTORY.txt and DRIVE-TRACE.txt, so the token the run puts on
    // the wire would stop being pinned by either artifact. Two literals thirty
    // lines apart is the price of them meaning what they say.
    await sim.send({ command: "authorize", params: { tagId: "CE71FFFF" } });
  },
  assert({ frames, rec }) {
    assertSent(rec, frames, "Authorize", "Authorize.req sent");
    // WHICH TOKEN WAS PUT TO THE CSMS, before what it answered. Without this
    // the check below is satisfied by an `Unknown` about a token this run
    // never sent, which is what a mistyped tagId produces -- green, and a
    // conformance claim about an exchange that did not happen.
    assertIdTokenSent(
      rec,
      frames,
      "Authorize",
      "CE71FFFF",
      "Authorize.req presents the unknown idToken this scenario asked about",
    );
    // The CSMS owes an AuthorizeResponse, and a CALLERROR is not one. This is
    // also the check that catches the format rejection the comment above
    // guards against: were the token misshapen, the answer would be a
    // CALLERROR and the status check below would report it as a missing
    // verdict rather than as the shape problem it is.
    assertAllAnswered(rec, frames, "Authorize");
    // THE CASE'S ONE TOOL VALIDATION, and both values are the case's. Which of
    // the two a CSMS picks for a token it has never seen is its own business,
    // so pinning either one alone would file against a conformant CSMS for
    // choosing the other.
    assertIdTokenInfoStatus(
      rec,
      frames,
      "Authorize",
      ["Invalid", "Unknown"],
      "the CSMS reports the idToken as not valid",
    );
  },
};

/** What TC_E_10 established before it read the CSMS's answer to the start. */
interface AuthorizedStartPrecondition {
  started: boolean;
}

const TC_E_10: ScenarioSpec<AuthorizedStartPrecondition> = {
  templateId: "cert201-tce10-start-authorized",
  description:
    "TC_E_10 Start transaction options: the station authorizes an idToken and then starts a transaction on it, and the CSMS accepts both.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, and the reasoning is about what is left OUTSTANDING when drive()
  // returns rather than about the whole exchange. drive() blocks on the
  // Started TransactionEvent reaching the wire and then sleeps, so the
  // Authorize round trip and the Started one are already paid for by the time
  // this window opens; what it has to cover is the Ended event drive() sends
  // last and the answer to it -- one round trip, plus the answer to the
  // Started event if the CSMS was still working on it. That is the same shape
  // TC_B_06 and TC_B_09 hold at 12, and this file's note there records that 12
  // is the value that has run green under three-lane CI contention where
  // shorter windows tuned in isolation have not.
  holdSecs: 12,
  async drive({ connector, sim }) {
    // ONE COMMAND FOR THE CASE'S FIRST FOUR STEPS, which is a fact about the
    // pinned image rather than a shortcut. `AuthorizeBeforeLocalStart` is true
    // by default there, so `start_transaction` sends the Authorize.req itself,
    // WAITS for the answer, and only then emits the Started TransactionEvent
    // -- triggerReason `Authorized`, which is the value this case's Started
    // event is defined by. Sending a separate `authorize` first would put a
    // second, unrelated Authorize on the wire and leave the assertions below
    // reading whichever came first.
    //
    // THE TAG IS THE ONE A DRIVER PROVISIONS, and it is spelled here rather
    // than shared with TC_B_21 for the artifact reason TC_C_02's note above
    // gives. TC_B_21's comment carries the argument for its shape.
    await sim.send({
      command: "start_transaction",
      params: { connector, tagId: "CE712001" },
    });
    // THE PRECONDITION IS REPORTED, NOT ASSUMED, exactly as TC_B_21 does it
    // and for a sharper reason: the station will not start a local
    // transaction at all when the CSMS answers the Authorize with anything
    // other than `Accepted`. That refusal is the station behaving correctly,
    // so the absence of a Started event is not a finding about it -- the
    // finding is the Authorize status, which is checked unconditionally below.
    // 15s rather than TC_B_21's 10 because this wait sits BEHIND the station's
    // own 10s Authorize gate, not in front of it.
    let started = true;
    try {
      await sim.waitForLine(/Sent: \[2,.*"TransactionEvent"/, 15_000);
    } catch (err) {
      started = false;
      process.stderr.write(
        `[runner] WARN: no TransactionEvent within 15s -- the CSMS did not accept the idToken, so this case's start never happened (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }
    // Long enough for the Started event's answer to land before the Ended one
    // is queued behind it, so the two verdicts below are about two exchanges
    // rather than about one queue.
    await sleep(2000);
    // TEARDOWN, AND NOT PART OF THE CASE. `runsSimTemplate: false` moves the
    // wind-down onto drive() (see ScenarioSpec), and a transaction left open
    // is a row the next scenario on this station trips over. The Ended event
    // it produces is asserted on only by `assertAllAnswered` below, which is
    // an obligation the CSMS owes every TransactionEvent whatever caused it.
    await sim.send({ command: "stop_transaction", params: { connector } });
    return { started };
  },
  assert({ frames, rec, driveState }) {
    // FIRST, so a reader of results/ meets the cause before the consequence.
    const description = "the CSMS accepted the idToken, so the station started";
    if (driveState.started) {
      rec.pass(description);
    } else {
      rec.skip(
        description,
        `${UNEXERCISED_PREFIX} no TransactionEvent reached the wire within 15s, so the station refused the local start and this case's second half never happened`,
      );
    }
    assertSent(rec, frames, "Authorize", "Authorize.req sent");
    assertIdTokenSent(
      rec,
      frames,
      "Authorize",
      "CE712001",
      "Authorize.req presents the provisioned idToken",
    );
    assertAllAnswered(rec, frames, "Authorize");
    // THE CASE'S FIRST TOOL VALIDATION, and it stays unconditional on purpose:
    // it is the check the precondition above depends on, so degrading it with
    // the precondition would leave a CSMS that refused a provisioned token
    // reported as orange everywhere and red nowhere.
    assertIdTokenInfoStatus(
      rec,
      frames,
      "Authorize",
      ["Accepted"],
      "the CSMS accepted the idToken",
    );
    if (driveState.started) {
      assertSent(rec, frames, "TransactionEvent", "TransactionEvent.req sent");
      // WHAT MAKES THIS CASE THIS CASE. `eventType` and `triggerReason`
      // together are how the wire says "the transaction started because the
      // driver was authorized" rather than because a cable went in or energy
      // began to flow -- the neighbouring E01 cases differ from this one in
      // exactly that member. `assertCallPayload` matches ANY sent
      // TransactionEvent carrying both, which is what keeps the Ended event
      // drive() sends afterwards from being read as this one: it spells
      // `eventType` differently.
      assertCallPayload(
        rec,
        frames,
        "sent",
        "TransactionEvent",
        { eventType: "Started", triggerReason: "Authorized" },
        "the Started TransactionEvent says the transaction started on an authorization",
      );
      assertIdTokenSent(
        rec,
        frames,
        "TransactionEvent",
        "CE712001",
        "the Started TransactionEvent carries the idToken that was authorized",
      );
      // The case's second tool validation. The CSMS answers a Started event
      // carrying an idToken with its verdict on that token AGAIN, and the case
      // requires it to say the same thing it said to the Authorize -- a CSMS
      // that accepted the token and then declined the transaction on it is the
      // finding this reaches and nothing above can.
      assertIdTokenInfoStatus(
        rec,
        frames,
        "TransactionEvent",
        ["Accepted"],
        "the CSMS accepted the transaction the idToken started",
      );
    } else {
      rec.skip(
        "the CSMS accepted the transaction the idToken started",
        `${UNEXERCISED_PREFIX} the station never sent a Started TransactionEvent, so there is no second verdict to read`,
      );
    }
    // Unconditional, and it degrades itself: with no TransactionEvent on the
    // wire this reports UNEXERCISED rather than accusing the CSMS of not
    // answering something nobody sent (assertAllAnswered's rule 1).
    assertAllAnswered(rec, frames, "TransactionEvent");
  },
};

// WHAT THIS CASE ASKS FOR THAT THE PINNED IMAGE CANNOT SPELL, written down
// because the gap is invisible from the assertions and a reader will otherwise
// re-derive it. TC_F_27's scenario column is one exchange and its tool
// validations are `N/a`, so what a conformance tool checks here is not a
// payload member: it is that the CSMS survives being told the station does not
// implement what it asked for. There is no wire assertion for "survives", so
// this scenario manufactures one -- a Heartbeat afterwards, and the CSMS's
// answer to it. That exchange is deliberately absent from OCA-OBLIGATIONS.txt:
// the case obliges no HeartbeatResponse, and the check is our evidence that
// the session outlived the refusal rather than something the reference asks
// for.
const TC_F_27: ScenarioSpec = {
  templateId: "cert201-tcf27-trigger-not-implemented",
  description:
    "TC_F_27 Trigger Message: the CSMS asks for a message this station does not implement, is answered NotImplemented, and goes on serving the station.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, by comparison with TC_F_20 above, which is the same chain one leg
  // shorter here: there the CSMS's trigger, the station's answer, the
  // Heartbeat the trigger PRODUCED and the answer to that; here the trigger,
  // the refusal, and then a Heartbeat this scenario sends locally rather than
  // waits for the station to be driven into. So 12 is TC_F_20's measured value
  // covering one round trip less, and the margin is deliberate rather than
  // spare -- TC_B_20's note records what a window tuned to its own chain costs
  // under three-lane CI contention.
  holdSecs: 12,
  async drive({ cpId, sim, csms201 }) {
    // FirmwareStatusNotification IS A LITERAL AND THE CHOICE IS THE CASE. It
    // has to be a value the 2.0.1 MessageTriggerEnumType has -- or the CSMS
    // rejects the request locally and nothing reaches the wire -- AND one the
    // pinned image does not implement, which is every value outside the four
    // its handler answers `Accepted` for (BootNotification, Heartbeat,
    // StatusNotification, MeterValues). Firmware status is the furthest of
    // those from anything this station does: it has no firmware update to
    // report on, so the negative check below cannot be satisfied by traffic
    // that would have happened anyway.
    await csms201.execute(cpId, {
      action: "TriggerMessage",
      requestedMessage: "FirmwareStatusNotification",
    });
    // Long enough for the refusal to be answered before the Heartbeat is
    // queued behind it, so `assertLineAfter` below is reading an ordering the
    // CSMS produced rather than one this scenario forced.
    await sleep(2000);
    await sim.send({ command: "heartbeat" });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "TriggerMessage", "TriggerMessage.req received");
    // The CSMS is the system under test, so what it put on the wire is the
    // measurement -- and here it is the whole of it. A CSMS that quietly
    // substituted a message it knows the station handles would be answered
    // `Accepted`, and this scenario would become TC_F_20 with a different name
    // on it: every other check below would still pass.
    assertCallPayload(
      rec,
      frames,
      "received",
      "TriggerMessage",
      { requestedMessage: "FirmwareStatusNotification" },
      "TriggerMessage.req asks for the message the station does not implement",
    );
    assertResponseStatus(
      rec,
      frames,
      "TriggerMessage",
      "NotImplemented",
      "TriggerMessage refused as not implemented",
      { direction: "received" },
    );
    // THE REFUSAL WAS REAL, not a status the station sent while doing the
    // thing anyway. Cheap, and it is the only check that distinguishes a
    // station answering NotImplemented from one answering it wrongly.
    assertNotSent(
      rec,
      frames,
      "FirmwareStatusNotification",
      "sent",
      "no FirmwareStatusNotification followed the refusal",
    );
    // assertLineAfter rather than a first-match order check, for TC_F_20's
    // reason: the charge point also runs a periodic Heartbeat timer at
    // whatever interval the BootNotification response returned, so a
    // first-match check can be satisfied by a Heartbeat that owes nothing to
    // anything this scenario did.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"TriggerMessage"/,
      /Sent: \[2,.*"Heartbeat"/,
      "the station still reaches the CSMS after the refusal",
    );
    // AND THE CSMS STILL ANSWERS IT, which is the case's Purpose in the only
    // form the wire has. A CSMS that treated an unimplemented trigger as a
    // fault -- dropped the session, stopped answering, wedged the station's
    // queue -- passes every check above and fails this one.
    assertResponseTimestamp(
      rec,
      frames,
      "Heartbeat",
      "currentTime",
      "the CSMS answered the station's next request with a current time",
    );
  },
};

// WHAT THIS CASE ASKS FOR THAT THE PINNED IMAGE CANNOT SPELL, and it is two
// members rather than TC_F_27's zero. The case's station-side message carries
// `sampledValue.context` as the clock-aligned reading context, and its note
// says the readings arrive one configured interval apart. The pinned image
// drops `context` from every 2.0.1 sampled value (issue #114) and has no
// clock-aligned scheduler on the 2.0.1 path at all, so this scenario sends
// three readings on its own clock instead. NEITHER MEMBER CARRIES A TOOL
// VALIDATION -- the case's are `N/a`, and both belong to the test tool's own
// behaviour rather than to the CSMS's -- so what is measured here is the whole
// of what the case measures of a CSMS: that it answered.
//
// AND WHY THE CASE IS STILL THIS ONE. Of the mandatory J cases, this is the
// only one whose station-side message is a bare MeterValuesRequest with no
// transaction behind it; every "Sampled Meter Values" case carries its
// readings inside a TransactionEvent, and the other clock-aligned ones all
// require a transaction. So an idle station sending MeterValues is
// unambiguously this case's stimulus, which is the test the E-block cases
// declined in OCA-201-SLICE.txt fail.
const TC_J_01: ScenarioSpec = {
  templateId: "cert201-tcj01-clock-aligned-meter-values",
  description:
    "TC_J_01 Clock-aligned Meter Values: an idle station reports its meter three times and the CSMS answers every one.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 10, and what it covers is one round trip rather than three: drive() sends
  // the three readings itself and spaces them, so the first two are answered
  // while it is still running and only the last is outstanding when this
  // window opens. That is TC_B_22's and TC_C_02's shape, and their value.
  // Raising it would buy nothing here -- assertAllAnswered's rule 3 already
  // forgives a CALL the log ended on, which is exactly what a third reading
  // answered a moment too late would be.
  holdSecs: 10,
  async drive({ connector, sim }) {
    // THREE, BECAUSE THE CASE SAYS THREE -- its note ends the test after the
    // third reading, and `minimum: 3` below is what makes that a requirement
    // rather than a habit. Spaced rather than burst: three readings inside one
    // tick would reach the CSMS as one queue and say nothing about whether it
    // can answer a repeated request, which is the only thing this case asks
    // of it.
    await sim.send({ command: "send_meter_value", params: { connector } });
    await sleep(2000);
    await sim.send({ command: "send_meter_value", params: { connector } });
    await sleep(2000);
    await sim.send({ command: "send_meter_value", params: { connector } });
  },
  assert({ frames, rec }) {
    // FIRST, because it is what separates this case from its neighbour. A
    // TransactionEvent on the wire would mean the readings arrived with a
    // transaction running, which is TC_J_02 -- a different mandatory case, and
    // one this row does not claim. SKIPPED rather than FAIL for TC_B_21's
    // reason: a station that had a transaction open is not a CSMS that did
    // anything wrong, and orange says the suite did not ask what it meant to.
    const idle = "no transaction was running when the meter reported";
    if (findCall(frames, "sent", "TransactionEvent") === undefined) {
      rec.pass(idle);
    } else {
      rec.skip(
        idle,
        `${UNEXERCISED_PREFIX} a TransactionEvent reached the wire, so these readings were taken during a transaction and this case's distinguishing condition did not hold`,
      );
    }
    assertSent(rec, frames, "MeterValues", "MeterValues.req sent");
    assertMeterValueSampled(
      rec,
      frames,
      "MeterValues",
      "MeterValues.req is the OCPP 2.0.1 request (an evseId and a sampled reading)",
    );
    // THE CASE'S ONE CSMS OBLIGATION, three times over. `minimum: 3` is what
    // keeps the count a requirement: fewer readings on the wire is the
    // scenario not having asked, which reports UNEXERCISED rather than
    // accusing the CSMS of not answering messages nobody sent.
    assertAllAnswered(rec, frames, "MeterValues", undefined, { minimum: 3 });
  },
};

// ---------------------------------------------------------------------------
// ChangeAvailability -- six cases, three addressing scopes, two availabilities.
//
// WHAT SEPARATES THEM IS THE CSMS'S REQUEST AND ALMOST NOTHING ELSE, which is
// why `assertChangeAvailabilityScope` above exists and why every scenario here
// calls it. Three of the six ask for `Inoperative` and three for `Operative`;
// within each three, one addresses the whole charging station, one an EVSE and
// one a connector. On the wire that is `operationalStatus` plus which members
// of the optional `evse` object are present -- and the CSMS is the system under
// test, so a CSMS that reshaped the scope on the way out is precisely the
// finding these six are for.
//
// THREE THINGS THE PINNED SIMULATOR DOES THAT ARE NOT BLOCKERS, measured in its
// own sources and written here so no reader re-derives them from a red run:
//
//   1. IT IGNORES `evse.connectorId`. Its 2.0.1 handler reads `req.evse?.id`
//      and nothing else, and its topology is flat -- domain connector N is
//      wire address `(evseId N, connectorId 1)`. So the connector-scoped cases
//      cannot be told from the EVSE-scoped ones by what the STATION does. They
//      are told apart by what the CSMS SENDS, which is the right subject
//      anyway: the case is about the request, and the station's reaction to a
//      member it does not read says nothing about either.
//   2. STATION-WIDE SCOPE EMITS AN EXTRA STATUS REPORT, addressed
//      `(evseId 0, connectorId 0)`, before it loops the connectors. It is
//      schema-valid and semantically odd, and nothing below asserts on it in
//      either direction -- neither that it arrives nor that it does not.
//      `assertAllAnswered` counts it like any other, which is correct: a CSMS
//      owes an answer to every request the station sends it.
//   3. IT REPORTS UNCONDITIONALLY. A connector told to become Operative when
//      it already is still sends a status report, so the two cases that ask
//      for `Operative` would pass with no precondition at all. That is why
//      each of them establishes one first -- and why the precondition is a
//      real part of the scenario rather than decoration.
// ---------------------------------------------------------------------------

const TC_G_03: ScenarioSpec = {
  templateId: "cert201-tcg03-evse-inoperative",
  description:
    "TC_G_03 Change Availability EVSE: the CSMS makes one EVSE inoperative and answers the status the station then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 10, the shortest hold in this file, and the reason is that this scenario
  // has no drive(): the fixture has already sent the request AND waited for
  // the station's status report to reach the wire by the time this window
  // opens. What is left outstanding is one CALLRESULT -- the CSMS's answer to
  // that report. That is TC_B_22's and TC_C_02's shape, a single round trip
  // with nothing after it, and 10 is what both run at. The five scenarios
  // below hold longer because each of them still has a whole chain to pay for
  // when their drive() returns.
  holdSecs: 10,
  // THE FIXTURE IS THE CASE, which is the one thing about this scenario worth
  // reading twice. Part 6 gives this case no tool validation of its own: its
  // whole scenario is the execution of the `Unavailable` Reusable State, and
  // ChangeAvailability is named only inside that state. So there is nothing
  // for a drive() to do that the fixture does not already do, and writing one
  // would put a SECOND request on the wire and make the assertions below
  // ambiguous about which one they are describing. What is measured is the
  // request the fixture caused and the answers the CSMS gave it -- read off
  // the same frames every other scenario reads, because the runner captures
  // the container's whole stdout from `connect` onwards.
  //
  // LITERALS AND NOT A SHARED CONSTANT, for TC_B_21's reason: an identifier
  // renders as `·` in ASSERT-INVENTORY.txt, which for a top-level field means
  // the whole declaration is omitted rather than marked, and the fixture could
  // be re-pointed at another EVSE with no committed artifact moving.
  states: [{ state: "Unavailable", evseId: 1 }],
  assert({ frames, lines, rec, fixtures }) {
    // FIRST, so a reader of results/ meets the cause before the consequence,
    // and SKIPPED rather than FAIL when it did not hold -- TC_B_21's rule,
    // which now lives in `assertStateEstablished`.
    assertStateEstablished(
      rec,
      fixtures,
      "Unavailable",
      "the EVSE was taken out of service",
    );
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    // THE MEASUREMENT. `evse.id` present and `evse.connectorId` absent is what
    // makes this the EVSE-scoped case rather than the station-wide one two
    // scenarios down, and a CSMS that dropped `evse` would have sent that
    // other request instead.
    assertChangeAvailabilityScope(
      rec,
      frames,
      0,
      "Inoperative",
      1,
      null,
      "ChangeAvailability.req takes EVSE 1 out of service and names no connector",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeAvailability",
      "Accepted",
      "ChangeAvailability accepted",
      { direction: "received" },
    );
    // The station's own report, pinned to this request rather than to its own
    // existence: assertLineAfter anchors on the LAST ChangeAvailability on the
    // wire, so a status the station happened to send at boot cannot satisfy
    // it. TC_F_20's note carries the argument against a first-match order
    // check.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Unavailable")/,
      "the station reported the EVSE unavailable after the request",
    );
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

const TC_G_04: ScenarioSpec = {
  templateId: "cert201-tcg04-evse-operative",
  description:
    "TC_G_04 Change Availability EVSE: the CSMS returns an out-of-service EVSE to service and answers the status the station then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, the modal hold among this file's CSMS-driven scenarios, and the chain
  // is why: drive() returns once the CSMS has accepted the operation, and what
  // is still outstanding is the station's answer to the request, the status
  // report it then sends, and the CSMS's answer to that. Two round trips,
  // which is TC_F_20's shape at the same value. TC_B_20's note records what a
  // window tuned in isolation costs under three-lane CI contention.
  holdSecs: 12,
  // THE PRECONDITION IS A NAMED STATE, and it is the state this case declares
  // rather than one chosen for convenience: returning an EVSE to service is
  // only distinguishable from leaving it alone when it was out of service to
  // begin with. The fixture sends the inoperative request; drive() sends the
  // operative one. See TC_G_03 for why the literals are literals.
  states: [{ state: "Unavailable", evseId: 1 }],
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Operative",
      evse: { id: 1 },
    });
  },
  assert({ frames, lines, rec, fixtures }) {
    assertStateEstablished(
      rec,
      fixtures,
      "Unavailable",
      "the EVSE was out of service before it was returned to service",
    );
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    // OCCURRENCE 1 IS THE CASE, AND OCCURRENCE 0 IS WHAT KEEPS THE INDEX
    // MEANING THAT. Two requests reach the wire here -- the fixture's, then
    // this case's -- so the checks below are guarded on the fixture having
    // run: without that guard, a fixture whose dispatch failed would leave one
    // request on the wire at index 0 and every check here would file a
    // non-conformance against a CSMS that answered exactly what it was asked.
    // TC_B_20's note is the same argument about a different index.
    if (fixtures.established("Unavailable")) {
      assertChangeAvailabilityScope(
        rec,
        frames,
        0,
        "Inoperative",
        1,
        null,
        "the precondition request took EVSE 1 out of service",
      );
      assertChangeAvailabilityScope(
        rec,
        frames,
        1,
        "Operative",
        1,
        null,
        "ChangeAvailability.req returns EVSE 1 to service and names no connector",
      );
      assertResponseStatus(
        rec,
        frames,
        "ChangeAvailability",
        "Accepted",
        "ChangeAvailability accepted",
        { direction: "received", occurrence: 1 },
      );
    } else {
      rec.skip(
        "ChangeAvailability.req returns EVSE 1 to service and names no connector",
        `${UNEXERCISED_PREFIX} the EVSE was never taken out of service, so the request this case is about is not the one on the wire`,
      );
    }
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Available")/,
      "the station reported the EVSE available after the request",
    );
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

const TC_G_05: ScenarioSpec = {
  templateId: "cert201-tcg05-station-inoperative",
  description:
    "TC_G_05 Change Availability station: the CSMS takes the whole charging station out of service and answers the statuses it then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, for TC_G_04's chain and one addition: a station-wide request makes the
  // station report every connector plus its own address, so the window covers
  // several answers rather than one. They are answered in parallel by any CSMS
  // that answers at all, so the chain is no longer -- and `assertAllAnswered`
  // already forgives a CALL the log ended on.
  holdSecs: 12,
  // NO PRECONDITION AND NONE NEEDED: a station that has just booted is in
  // service, so taking it out of service is a real transition from where the
  // runner leaves it. The two cases below that ask for `Operative` are the
  // ones that have to arrange something first.
  async drive({ cpId, csms201 }) {
    // `evse` OMITTED, WHICH IS THE CASE. 2.0.1 addresses the whole charging
    // station by leaving the member out -- not by sending id 0, which names
    // the station's own EVSE-shaped component and is a different request. The
    // contract's arm has no member to omit incorrectly; what this measures is
    // whether the CSMS puts one there on the way out.
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Inoperative",
    });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    assertChangeAvailabilityScope(
      rec,
      frames,
      0,
      "Inoperative",
      null,
      null,
      "ChangeAvailability.req omits evse, so it addresses the whole charging station",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeAvailability",
      "Accepted",
      "ChangeAvailability accepted",
      { direction: "received" },
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Unavailable")/,
      "the station reported a connector unavailable after the request",
    );
    // EVERY REPORT, WHATEVER THE STATION SENT, and deliberately no `minimum`.
    // A station-wide request makes the pinned image report its own address as
    // well as each connector's; that extra frame is this image's behaviour
    // rather than the case's requirement, so pinning a count here would assert
    // a simulator quirk as an obligation. What the case obliges is that the
    // CSMS answers what it receives, which is what this counts.
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

const TC_G_06: ScenarioSpec = {
  templateId: "cert201-tcg06-station-operative",
  description:
    "TC_G_06 Change Availability station: the CSMS returns an out-of-service charging station to service and answers the statuses it then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, TC_G_05's chain. The setup exchange is paid for inside drive() before
  // this window opens, so what it covers is the same single chain the four
  // scenarios above cover.
  holdSecs: 12,
  // SETUP INLINE RATHER THAN AS A REUSABLE STATE, and that is a refusal rather
  // than an omission. This case's precondition is prose in Part 6, not a named
  // state; the state next door, `Unavailable`, is parameterised by an EVSE,
  // which is the reference's own shape. Widening that invocation to carry a
  // station-wide scope so this scenario could declare it would make
  // tck/states-201.ts's declaration say something about the reference that the
  // reference does not -- and the whole value of that file is that its
  // parameters are facts. Two lines here cost less than one wrong fact there.
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Inoperative",
    });
    // Long enough for the setup's reports and their answers to land before the
    // request under test is sent, so the two exchanges are two exchanges
    // rather than one queue -- TC_E_10's reason for its own sleep.
    await sleep(2000);
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Operative",
    });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    // OCCURRENCE 0 IS THE SETUP AND 1 IS THE CASE, and no fixture guard is
    // needed for the pair to mean that: both requests are drive()'s own, and a
    // dispatch that failed would have thrown out of drive() rather than
    // leaving this assert reading a shifted index. That is the difference
    // between an inline setup and a fixture, and it is why TC_G_04 needs the
    // guard this scenario does not.
    assertChangeAvailabilityScope(
      rec,
      frames,
      0,
      "Inoperative",
      null,
      null,
      "the precondition request took the whole charging station out of service",
    );
    assertChangeAvailabilityScope(
      rec,
      frames,
      1,
      "Operative",
      null,
      null,
      "ChangeAvailability.req omits evse, so it returns the whole charging station to service",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeAvailability",
      "Accepted",
      "ChangeAvailability accepted",
      { direction: "received", occurrence: 1 },
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Available")/,
      "the station reported a connector available after the request",
    );
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

const TC_G_07: ScenarioSpec = {
  templateId: "cert201-tcg07-connector-inoperative",
  description:
    "TC_G_07 Change Availability connector: the CSMS makes one connector of an EVSE inoperative and answers the status the station then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, TC_G_04's chain exactly: one request, the station's answer, one status
  // report, the CSMS's answer to it.
  holdSecs: 12,
  async drive({ cpId, csms201 }) {
    // BOTH MEMBERS, AND THAT IS THE WHOLE DIFFERENCE FROM TC_G_03. `evse.id`
    // names the EVSE and `evse.connectorId` narrows it to one connector; drop
    // the second and this is the EVSE-scoped request four scenarios up. The
    // pinned station will not act differently on it -- its handler never reads
    // `connectorId` -- so what this scenario measures is that the member
    // survives the CSMS, which is what the case asks of the system under test.
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Inoperative",
      evse: { id: 1, connectorId: 1 },
    });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    assertChangeAvailabilityScope(
      rec,
      frames,
      0,
      "Inoperative",
      1,
      1,
      "ChangeAvailability.req names EVSE 1 AND connector 1, so it addresses one connector",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeAvailability",
      "Accepted",
      "ChangeAvailability accepted",
      { direction: "received" },
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Unavailable")/,
      "the station reported the connector unavailable after the request",
    );
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

const TC_G_08: ScenarioSpec = {
  templateId: "cert201-tcg08-connector-operative",
  description:
    "TC_G_08 Change Availability connector: the CSMS returns an out-of-service connector to service and answers the status the station then reports.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // 12, TC_G_06's shape: the setup exchange is paid for inside drive(), and
  // this window covers the chain the request under test starts.
  holdSecs: 12,
  // SETUP INLINE, for TC_G_06's reason one scope further in: the `Unavailable`
  // state takes an EVSE, and narrowing it to a connector would be a parameter
  // the reference does not give it.
  async drive({ cpId, csms201 }) {
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Inoperative",
      evse: { id: 1, connectorId: 1 },
    });
    await sleep(2000);
    await csms201.execute(cpId, {
      action: "ChangeAvailability",
      operationalStatus: "Operative",
      evse: { id: 1, connectorId: 1 },
    });
  },
  assert({ frames, lines, rec }) {
    assertReceived(rec, frames, "ChangeAvailability", "ChangeAvailability.req received");
    assertChangeAvailabilityScope(
      rec,
      frames,
      0,
      "Inoperative",
      1,
      1,
      "the precondition request took connector 1 of EVSE 1 out of service",
    );
    assertChangeAvailabilityScope(
      rec,
      frames,
      1,
      "Operative",
      1,
      1,
      "ChangeAvailability.req names EVSE 1 AND connector 1, so it returns one connector to service",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeAvailability",
      "Accepted",
      "ChangeAvailability accepted",
      { direction: "received", occurrence: 1 },
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ChangeAvailability"/,
      /Sent: \[2,.*"StatusNotification",(?=[^\]]*"connectorStatus":"Available")/,
      "the station reported the connector available after the request",
    );
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

/**
 * The scenarios, in case order -- the seventeen of `OCA-201-SLICE.txt`'s 147
 * that are implemented. The other 130 are declined there rather than here,
 * with the reason in the row: one place per fact, and the guard reads that one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CORE_201_SPECS: ScenarioSpec<any>[] = [
  TC_B_01,
  TC_B_06,
  TC_B_09,
  TC_B_20,
  TC_B_21,
  TC_B_22,
  TC_C_02,
  TC_E_10,
  TC_F_20,
  TC_F_27,
  TC_G_03,
  TC_G_04,
  TC_G_05,
  TC_G_06,
  TC_G_07,
  TC_G_08,
  TC_J_01,
];
