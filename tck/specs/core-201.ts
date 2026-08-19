/**
 * specs/core-201.ts -- the OCPP 2.0.1 slice, and the first scenarios in this
 * suite that were not ported from anything.
 *
 * WHICH CASES MAY BE HERE IS NOT THIS FILE'S DECISION. `OCA-201-SELECTION.md`
 * states the rule -- profile Core, role CSMS, status `M` -- and
 * `OCA-201-SLICE.txt` is the resulting list, one row per case, guarded by
 * tests/oca-201-slice.sh in both directions. Adding a scenario here for a case
 * that is not in that file fails the build, which is the point: "a small
 * representative set" was a judgement each reviewer made differently.
 *
 * WRITTEN, NOT COPIED. OCPP 2.0.1 Parts 5 and 6 are CC BY-ND 4.0 and this
 * repository is Apache-2.0, so their prose, tables and step text are not here
 * and cannot be. Case identifiers are citations and are all that is quoted.
 * Every assertion below says what we decided to measure, in our words, exactly
 * as the OCPP 1.6 scenarios do.
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
 * scenario below. The simulator image ships a scenario template per ported
 * 1.6 scenario and none for anything else, and none of these needs one: two
 * are what a charge point does on `connect`, and three are driven entirely
 * from the CSMS side. A template would be a thing to maintain upstream before
 * a single case could be measured here.
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
 * THE SETUP IS INLINE, AND IT DUPLICATES. `ocppVersion` plus
 * `runsSimTemplate: false` is five copies of the same two lines, and the three
 * Reset scenarios repeat the same drive-then-check shape with one member
 * changed. That is deliberate: OCPP 2.0.1 Part 6 defines 13 `Reusable State`
 * fixtures and this suite has timers and one-shot provisioning, which are not
 * the same thing -- issue #63 says to write the setup inline and note where it
 * duplicates rather than build the mechanism from one slice's evidence. This
 * paragraph is that note.
 */

import {
  assertAllAnswered,
  assertCallPayload,
  assertReceived,
  assertResponseStatus,
  assertSent,
  type AssertRecorder,
} from "../assert";
import { findCall, findResponseFor, type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
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

const TC_B_01: ScenarioSpec = {
  templateId: "cert201-tcb01-cold-boot",
  description:
    "TC_B_01 Cold Boot: the charge point boots on OCPP 2.0.1 and the CSMS accepts it.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 10,
  assert({ frames, rec }) {
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
    // response to each. Answered is all this asserts: whether the status
    // reached the CSMS's device model is a different question, it is
    // unanswerable from the charge point's side, and issue #58 owns it.
    assertAllAnswered(rec, frames, "StatusNotification");
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
  holdSecs: 25,
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
    // BootNotification an answer exactly as it owed the first. Asserting the
    // response rather than counting the requests is what makes this a check
    // about the CSMS: with no second boot it fails naming the occurrence it
    // could not find, which is the reboot half.
    assertResponseStatus(
      rec,
      frames,
      "BootNotification",
      "Accepted",
      "the post-reset BootNotification is accepted",
      { direction: "sent", occurrence: 1 },
    );
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
  async drive({ cpId, connector, sim, csms201 }) {
    // THE ONE SCENARIO HERE THAT NEEDS THE STATION IN A STATE, and the state
    // is set from the charge point rather than from the CSMS: `OnIdle` is only
    // distinguishable from `Immediate` when there is a transaction to wait
    // for. This is the setup Part 6 would take from a `Reusable State`, and
    // the file header says why it is written out here instead.
    await sim.send({
      command: "start_transaction",
      params: { connector, tagId: "CERT-TAG-1" },
    });
    try {
      await sim.waitForLine(/Sent: \[2,.*"TransactionEvent"/, 10_000);
    } catch (err) {
      // Warn and proceed, the shape every soft wait in this suite takes: if
      // the transaction never started, the status this scenario is about will
      // not be the one that comes back, and the assertions say so. The warning
      // is what tells a reader of results/ which of the two happened.
      process.stderr.write(
        `[runner] WARN: no TransactionEvent within 10s -- proceeding anyway, the Reset will be answered as if the station were idle (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }
    await sleep(2000);
    await csms201.execute(cpId, { action: "Reset", type: "OnIdle" });
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "Reset", "Reset.req received");
    assertCallPayload(
      rec,
      frames,
      "received",
      "Reset",
      { type: "OnIdle" },
      "Reset.req asks for type=OnIdle",
    );
    assertResponseStatus(
      rec,
      frames,
      "Reset",
      "Scheduled",
      "Reset scheduled until the transaction ends",
      { direction: "received" },
    );
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

const TC_F_20: ScenarioSpec = {
  templateId: "cert201-tcf20-heartbeat",
  description:
    "TC_F_20 Heartbeat: the CSMS answers a Heartbeat with its current time.",
  ocppVersion: "OCPP-2.0.1",
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 6,
  async drive({ sim }) {
    // ONE HEARTBEAT ON DEMAND, not the periodic one. The charge point starts a
    // timer at whatever interval the BootNotification response returned, and
    // the CSMS this was measured against returns 60s (issue #57) -- so waiting
    // for the timer would mean holding every run of this scenario open for a
    // minute to observe a message the simulator will send on request.
    await sim.send({ command: "heartbeat" });
    await sleep(2000);
  },
  assert({ frames, rec }) {
    assertSent(rec, frames, "Heartbeat", "Heartbeat.req sent");
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

/**
 * The slice, in case order. Two of the seven cases `OCA-201-SLICE.txt` lists
 * are absent, with the reason in that file rather than here -- one place per
 * fact, and the guard reads that one.
 */
export const CORE_201_SPECS: ScenarioSpec[] = [
  TC_B_01,
  TC_B_20,
  TC_B_21,
  TC_B_22,
  TC_F_20,
];
