/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/specs/remotetrigger-smartcharging.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: CSMS operations are expressed as typed OCPP through the driver contract.
 *
 * specs/remotetrigger-smartcharging.ts -- typed port of the "RemoteTrigger +
 * SmartCharging" bash specs (scripts/steve-verify/specs/cert16-{tc010,tc011,
 * tc012,tc026,tc028,tc054,tc055,tc056,tc057,tc059,tc066,tc067}-*.spec.sh),
 * mirroring run-all.sh's REMOTETRIGGER_SMARTCHARGING array exactly (12
 * scenarios). Each spec asserts AT LEAST what its bash predecessor asserted;
 * CALLRESULT status checks are upgraded to uniqueId-paired correlation
 * (assertResponseStatus) instead of the bash version's log-window grep.
 *
 * cert16-tc026-remote-start-rejected moves here from main.ts (Task 1's proof
 * scenario, kept there unported until this group existed).
 */

import {
  assertAllAnswered,
  assertEq,
  assertLineMatches,
  assertNoLineMatches,
  assertNonEmpty,
  assertNotSent,
  assertReceived,
  assertResponseStatus,
  assertSent,
  findCallByPayloadField,
  type AssertRecorder,
} from "../assert";
import { findAllCalls, findResponseFor, type Frame } from "../ocpp";
import { warnOpFailed } from "../op-warn";
import type { ScenarioSpec } from "../spec-types";
import { sleep } from "../util";
import { GHERKIN_PILOT_SPECS } from "../gherkin/compiler";

/**
 * The CALLRESULT answering the received GetCompositeSchedule returns a
 * chargingSchedule with a period at `limit`.
 *
 * Replaces `/Sent: \[3,.*"chargingSchedule".*"limit":11000/`, which asserted
 * that the two strings appeared in that order in one line of the run's log --
 * a member order nothing declares, over a CALLRESULT identified only by
 * "some sent CALLRESULT mentioning chargingSchedule" (issue #44). What the
 * check means is a property of the schedule the charge point returned for the
 * request that asked for it, so it reads the correlated response's periods.
 *
 * ANY received GetCompositeSchedule whose answer carries the limit satisfies
 * it, which is what the regex did -- it matched any line. Correlating from
 * only the FIRST request would narrow what the scenario measures, in the
 * failing direction and silently, which a conversion must not do.
 *
 * The limit is the caller's literal so ASSERT-INVENTORY.txt renders it: it is
 * the value the applied profile is supposed to have produced, which is the
 * whole point of the check. The rest is spelled out here for the same reason,
 * rather than passed as a predicate to a helper in assert.ts -- see the
 * rejected-refactor note beside `assertIdTagInfoStatus` there.
 */
function assertCompositeSchedulePeriodLimit(
  rec: AssertRecorder,
  frames: readonly Frame[],
  limit: number,
  description: string,
): void {
  const calls = findAllCalls(frames, "received", "GetCompositeSchedule");
  if (calls.length === 0) {
    rec.fail(
      description,
      "no Received CALL found for action=GetCompositeSchedule",
    );
    return;
  }
  const seen: string[] = [];
  for (const call of calls) {
    const response = findResponseFor(frames, call);
    if (!response) {
      seen.push(`uniqueId=${call.uniqueId} unanswered`);
      continue;
    }
    if (response.kind === "callerror") {
      seen.push(`CALLERROR ${response.errorCode}: ${response.errorDescription}`);
      continue;
    }
    const schedule = (response.payload as { chargingSchedule?: unknown } | null)
      ?.chargingSchedule;
    const periods = (schedule as { chargingSchedulePeriod?: unknown } | null)
      ?.chargingSchedulePeriod;
    if (!Array.isArray(periods)) {
      seen.push(
        `no chargingSchedulePeriod list: ${JSON.stringify(response.payload)}`,
      );
      continue;
    }
    const limits = periods.map(
      (period) => (period as { limit?: unknown } | null)?.limit,
    );
    if (limits.includes(limit)) {
      rec.pass(description);
      return;
    }
    seen.push(`limits=${JSON.stringify(limits)}`);
  }
  rec.fail(
    description,
    `no GetCompositeSchedule.conf carried limit ${limit}: ${seen.join("; ")}`,
  );
}

// ---------------------------------------------------------------------------
// TC_010 Remote Start Transaction -- parks waiting for RemoteStartTransaction;
// on Accepted, StatusNotification(Preparing) -> StartTransaction ->
// StatusNotification(Charging), then bounded MeterValue while charging. No
// tx-stop node in the scenario itself -- drive() cleans up the still-open
// transaction afterward.
// ---------------------------------------------------------------------------

export const tc010RemoteStartSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc010-remote-start",
  ocppVersion: "OCPP-1.6J",
  tags: ["remote-control", "transaction"],
  description:
    "TC_010 Remote Start Transaction: CSMS RemoteStartTransaction accepted, drives a session; drive() stops it afterward.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 25,
  async drive({ cpId, records, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "RemoteStartTransaction",
        connectorId: 1,
        idTag: "CERT-TAG-1",
      });
    } catch (err) {
      warnOpFailed("RemoteStartTransaction", err);
    }

    // meter-auto's autoIncrement fires every 5s -- wait long enough for at
    // least one MeterValues to land before cleaning up the still-open
    // transaction (confirmed live: a 3s wait here stopped it before the
    // first increment, producing a false FAIL on "MeterValues sent while
    // charging").
    await sleep(8000);
    const txPk = await records.latestTransaction(cpId);
    if (txPk) {
      try {
        await csms16.execute(cpId, { action: "RemoteStopTransaction", transaction: txPk });
      } catch (err) {
        warnOpFailed("RemoteStopTransaction", err);
      }
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertReceived(
      rec,
      frames,
      "RemoteStartTransaction",
      "RemoteStartTransaction.req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "RemoteStartTransaction",
      "Accepted",
      "RemoteStartTransaction accepted",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Preparing"/,
      "Preparing precedes StartTransaction",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT-TAG-1"/,
      "StartTransaction sent with CSMS-supplied idTag (overrides scenario's hardcoded CERT010 fallback)",
    );
    assertSent(rec, frames, "MeterValues", "MeterValues sent while charging");
    // TC_010 steps 6, 8, 10, 12. Before the DB block: the early return below
    // would otherwise skip these whenever no transaction row is findable.
    //
    // Authorize reports SKIPPED, for a reason that holds for every
    // remote-start scenario here, and it is the SIMULATOR's, not remote
    // start's. OCPP 1.6 §5.11: with AuthorizeRemoteTxRequests=true the CP
    // treats a remote start as a local one and authorizes the idTag first,
    // which is the flow TC_010 is written for (Authorize.req after
    // RemoteStartTransaction.conf). The pinned simulator has the key
    // read-only and false -- conformant, since §9.1.3 lets the CP choose --
    // so it goes straight to StartTransaction and no scenario can switch it
    // on (shiv3/ocpp-cp-simulator#921). Measured, not assumed -- a sweep
    // shows no Authorize on the wire for this scenario at all. Orange rather
    // than red because that is a gap in what the scenario can drive, not a
    // CSMS defect; TC_003/TC_004 are locally driven and check the same
    // obligation for real.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "StartTransaction");
    assertAllAnswered(rec, frames, "Authorize");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId} with id_tag CERT-TAG-1`,
        "no transaction found",
      );
      return;
    }
    // Was a raw `... WHERE transaction_pk=X AND id_tag='CERT-TAG-1'`
    // existence check (non-empty iff both match) -- txPk already narrows to
    // one row, so comparing ITS id_tag for equality checks the exact same
    // thing (and reports a more useful mismatch on failure).
    assertEq(
      rec,
      await records.transactionIdTag(txPk),
      "CERT-TAG-1",
      `DB: transaction row exists for ${cpId} with id_tag CERT-TAG-1`,
    );
  },
};

// ---------------------------------------------------------------------------
// TC_011 Remote Start + Remote Stop Transaction -- RemoteStartTransaction ->
// Preparing -> StartTransaction -> Charging with running MeterValue; on
// RemoteStopTransaction, StopTransaction -> Finishing -> Available.
// ---------------------------------------------------------------------------

export const tc011RemoteStartStopSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc011-remote-start-stop",
  ocppVersion: "OCPP-1.6J",
  tags: ["remote-control", "transaction"],
  description:
    "TC_011 Remote Start + Remote Stop Transaction: both CSMS ops accepted, session completes.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 20,
  async drive({ cpId, records, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "RemoteStartTransaction",
        connectorId: 1,
        idTag: "CERT-TAG-2",
      });
    } catch (err) {
      warnOpFailed("RemoteStartTransaction", err);
    }

    await sleep(3000);
    const txPk = await records.latestTransaction(cpId);

    await sleep(2000);
    if (txPk) {
      try {
        await csms16.execute(cpId, { action: "RemoteStopTransaction", transaction: txPk });
      } catch (err) {
        warnOpFailed("RemoteStopTransaction", err);
      }
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertResponseStatus(
      rec,
      frames,
      "RemoteStartTransaction",
      "Accepted",
      "RemoteStartTransaction accepted",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT-TAG-2"/,
      "StartTransaction sent with CSMS-supplied idTag",
    );
    assertResponseStatus(
      rec,
      frames,
      "RemoteStopTransaction",
      "Accepted",
      "RemoteStopTransaction accepted",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StopTransaction".*"reason":"Remote"/,
      "StopTransaction sent with reason Remote",
    );
    // TC_011.1 steps 4, 6, 8, 10, 14. Authorize is SKIPPED for the same
    // measured reason as TC_010 above: the simulator's
    // AuthorizeRemoteTxRequests is read-only false, so it never authorizes
    // a remote start (shiv3/ocpp-cp-simulator#921).
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "StartTransaction");
    assertAllAnswered(rec, frames, "Authorize");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        "DB: transaction is closed (stop_timestamp set)",
        "no transaction found",
      );
      return;
    }
    assertNonEmpty(
      rec,
      await records.transactionStopTimestamp(txPk),
      "DB: transaction is closed (stop_timestamp set)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_012 Remote Stop Transaction -- locally-started session (StartTransaction
// + running MeterValue) already Charging when RemoteStopTransaction arrives.
// ---------------------------------------------------------------------------

export const tc012RemoteStopSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc012-remote-stop",
  ocppVersion: "OCPP-1.6J",
  tags: ["remote-control", "transaction"],
  description:
    "TC_012 Remote Stop Transaction: self-driven session, CSMS RemoteStopTransaction accepted.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 18,
  async drive({ cpId, records, csms16 }) {
    await sleep(4000);
    const txPk = await records.latestTransaction(cpId);
    if (txPk) {
      try {
        await csms16.execute(cpId, { action: "RemoteStopTransaction", transaction: txPk });
      } catch (err) {
        warnOpFailed("RemoteStopTransaction", err);
      }
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT012"/,
      "StartTransaction sent with idTag CERT012 (self-driven, not remote-started)",
    );
    assertResponseStatus(
      rec,
      frames,
      "RemoteStopTransaction",
      "Accepted",
      "RemoteStopTransaction accepted",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StopTransaction".*"reason":"Remote"/,
      "StopTransaction sent with reason Remote",
    );
    // TC_012 steps 6 and 8.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "StopTransaction");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail("DB: id_tag is CERT012", "no transaction found");
      rec.fail(
        "DB: transaction is closed (stop_timestamp set)",
        "no transaction found",
      );
      return;
    }
    assertEq(rec, await records.transactionIdTag(txPk), "CERT012", "DB: id_tag is CERT012");
    assertNonEmpty(
      rec,
      await records.transactionStopTimestamp(txPk),
      "DB: transaction is closed (stop_timestamp set)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_026 Remote Start -- Rejected. Scenario arms a responseOverride
// (RemoteStartTransaction -> Rejected) before parking on the trigger; the
// CSMS sends RemoteStartTransaction on an Available connector and must see
// Rejected with no StartTransaction/transaction row created.
//
// Ported from main.ts (Task 1's proof scenario, held there until this group
// existed) -- logic unchanged.
// ---------------------------------------------------------------------------

interface RemoteStartRejectedDriveState {
  baselineTxPk: string;
}

export const tc026RemoteStartRejectedSpec: ScenarioSpec<RemoteStartRejectedDriveState> =
  {
    templateId: "cert16-tc026-remote-start-rejected",
    ocppVersion: "OCPP-1.6J",
    tags: ["remote-control", "transaction"],
    description:
      "TC_026 Remote Start — Rejected: CSMS RemoteStartTransaction must be Rejected, no transaction created.",
    connector: 1,
    bootWaitSecs: 4,
    holdSecs: 15,
    async drive({ cpId, records, csms16 }): Promise<RemoteStartRejectedDriveState> {
      const baselineTxPk = await records.latestTransaction(cpId);
      // Give the scenario time to arm its responseOverride and park on the
      // csmsCallTrigger node before we fire the operation -- mirrors the
      // bash spec's `sleep 2`.
      await sleep(2000);
      try {
        await csms16.execute(cpId, {
        action: "RemoteStartTransaction",
        connectorId: 1,
        idTag: "CERT-TAG-1",
      });
      } catch (err) {
        // Mirror the bash spec's `|| true`: a failed queue POST doesn't
        // abort drive() -- assert() below fails loudly on its own if the
        // request never reached the CP.
        warnOpFailed("RemoteStartTransaction", err);
      }
      return { baselineTxPk };
    },
    async assert({ cpId, frames, rec, records, driveState }) {
      assertReceived(
        rec,
        frames,
        "RemoteStartTransaction",
        "RemoteStartTransaction.req received",
      );
      // uniqueId-correlated: pairs THIS RemoteStartTransaction CALL to ITS
      // OWN CALLRESULT by OCPP-J uniqueId, not the next "Sent: [3,...]"
      // line in the log -- see ocpp.ts's findResponseFor.
      assertResponseStatus(
        rec,
        frames,
        "RemoteStartTransaction",
        "Rejected",
        "RemoteStartTransaction rejected",
        { direction: "received" },
      );
      assertNotSent(
        rec,
        frames,
        "StartTransaction",
        "sent",
        "no StartTransaction sent",
      );

      const after = await records.latestTransaction(cpId);
      assertEq(
        rec,
        after,
        driveState.baselineTxPk,
        `DB: no new transaction row created for ${cpId}`,
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_028 Remote Stop -- Rejected. Session charging when RemoteStopTransaction
// arrives; scenario's pre-armed override rejects it; charging continues for a
// few seconds, then the CP stops the session locally.
// ---------------------------------------------------------------------------

interface RemoteStopRejectedDriveState {
  txPk: string;
}

export const tc028RemoteStopRejectedSpec: ScenarioSpec<RemoteStopRejectedDriveState> =
  {
    templateId: "cert16-tc028-remote-stop-rejected",
    ocppVersion: "OCPP-1.6J",
    tags: ["remote-control", "transaction"],
    description:
      "TC_028 Remote Stop — Rejected: CSMS RemoteStopTransaction rejected mid-charge; CP stops locally afterward.",
    connector: 1,
    bootWaitSecs: 4,
    holdSecs: 20,
    async drive({ cpId, records, csms16 }): Promise<RemoteStopRejectedDriveState> {
      // Bind to the ACTIVE transaction CERT028's own StartTransaction
      // created, not records.latestTransaction's "newest row regardless of tag/state"
      // -- on a reused charge point that could silently pick up a stale
      // closed transaction from an earlier run instead. Mirrors the bash
      // spec's `db_wait_active_tx_pk ... || true`: waitActiveTxPk rejects
      // (fail-hard) on timeout, so catch it here and continue with an
      // empty txPk, same as the bash `|| true` swallowing a timeout.
      let txPk = "";
      try {
        txPk = await records.waitForActiveTransaction(cpId, "CERT028", 15);
      } catch (err) {
        warnOpFailed("db_wait_active_tx_pk(CERT028)", err);
      }
      if (txPk) {
        try {
          await csms16.execute(cpId, { action: "RemoteStopTransaction", transaction: txPk });
        } catch (err) {
          warnOpFailed("RemoteStopTransaction", err);
        }
      }
      return { txPk };
    },
    async assert({ frames, lines, rec, records, driveState }) {
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StartTransaction".*"idTag":"CERT028"/,
        "StartTransaction sent with idTag CERT028",
      );
      assertResponseStatus(
        rec,
        frames,
        "RemoteStopTransaction",
        "Rejected",
        "RemoteStopTransaction rejected",
      );
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StopTransaction"/,
        "StopTransaction eventually sent (local stop after rejection, charging continued in between)",
      );

      if (!driveState.txPk) {
        rec.fail(
          "DB: transaction is closed (stop_timestamp set)",
          "no active transaction found for CERT028",
        );
        return;
      }
      assertNonEmpty(
        rec,
        await records.transactionStopTimestamp(driveState.txPk),
        "DB: transaction is closed (stop_timestamp set)",
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_054 Trigger Message -- the CSMS triggers, one after the other, the five
// charge-point messages the case lists; the CP answers each TriggerMessage
// and sends the requested message, which the CSMS has to answer.
// ---------------------------------------------------------------------------

/**
 * One TriggerMessage of TC_054, judged on its own: the CSMS sent a
 * TriggerMessage.req asking for `requestedMessage` (scoped to `connectorId`
 * when the case scopes it, i.e. for MeterValues and StatusNotification), the
 * CP answered it, and -- when the answer is Accepted -- the requested message
 * left the CP AFTER that answer.
 *
 * Why per trigger rather than the generic helpers: `assertResponseStatus`
 * reads the FIRST TriggerMessage only, and `assertLineAfter` anchors on the
 * LAST one, so with five triggers in a row the first would stop covering
 * triggers two to five and the second would read the Heartbeat sent at step 7
 * as missing because the FirmwareStatusNotification trigger comes later. And
 * "sent after" is the check that FAILS: `assertAllAnswered` reports SKIPPED
 * when nothing was sent, so without this a trigger the CSMS never dispatched
 * would leave the scenario PARTIAL rather than red.
 *
 * `notImplementedAllowed` is the case's own exception for its last trigger:
 * the CP sends FirmwareStatusNotification only "if implemented", and answers
 * NotImplemented otherwise, after which nothing is owed on the wire.
 *
 * The arguments are literals at the call sites so ASSERT-INVENTORY.txt
 * renders which trigger each check is about -- see the rejected-refactor note
 * beside `assertIdTagInfoStatus` in assert.ts for why a predicate would not.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames. Not part of
 * the driver-author surface: tck/index.ts deliberately re-exports no specs.
 */
export function assertTriggered(
  rec: AssertRecorder,
  frames: readonly Frame[],
  requestedMessage: string,
  connectorId: number | null,
  notImplementedAllowed: boolean,
  description: string,
): void {
  const answeredDescription = `TriggerMessage(${requestedMessage}) sent and accepted`;
  const trigger = findCallByPayloadField(
    frames,
    "received",
    "TriggerMessage",
    "requestedMessage",
    requestedMessage,
  );
  if (!trigger) {
    rec.fail(
      answeredDescription,
      `no Received TriggerMessage with requestedMessage=${requestedMessage}`,
    );
    rec.fail(description, "nothing was triggered");
    return;
  }
  const sentConnector = (trigger.payload as { connectorId?: unknown })
    .connectorId;
  if (connectorId !== null && sentConnector !== connectorId) {
    rec.fail(
      answeredDescription,
      `expected connectorId ${connectorId}, got ${JSON.stringify(sentConnector)}`,
    );
    rec.fail(description, "the trigger was scoped to another connector");
    return;
  }
  const response = findResponseFor(frames, trigger);
  if (!response || response.kind === "callerror") {
    const detail = !response
      ? `no response frame found for uniqueId=${trigger.uniqueId}`
      : `CALLERROR ${response.errorCode}: ${response.errorDescription}`;
    rec.fail(answeredDescription, detail);
    rec.fail(description, "the trigger was not accepted");
    return;
  }
  const status = (response.payload as { status?: unknown } | null)?.status;
  if (notImplementedAllowed && status === "NotImplemented") {
    rec.pass(`${answeredDescription} (NotImplemented, which the case allows)`);
    rec.pass(`${description} (not owed: the CP answered NotImplemented)`);
    return;
  }
  if (status !== "Accepted") {
    rec.fail(answeredDescription, `expected status Accepted, got ${String(status)}`);
    rec.fail(description, "the trigger was not accepted");
    return;
  }
  rec.pass(answeredDescription);

  const after = frames.slice(frames.indexOf(response) + 1);
  const sent = after.some(
    (frame) =>
      frame.kind === "call" &&
      frame.direction === "sent" &&
      frame.action === requestedMessage &&
      (connectorId === null ||
        (frame.payload as { connectorId?: unknown } | null)?.connectorId ===
          connectorId),
  );
  if (sent) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `no Sent ${requestedMessage}${connectorId === null ? "" : ` for connector ${connectorId}`} after the TriggerMessage.conf (uniqueId=${trigger.uniqueId})`,
    );
  }
}

export const tc054TriggerMessageSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc054-trigger-message",
  ocppVersion: "OCPP-1.6J",
  tags: ["remote-trigger"],
  description:
    "TC_054 Trigger Message: the CSMS triggers MeterValues, Heartbeat, StatusNotification, DiagnosticsStatusNotification and FirmwareStatusNotification in turn; the CP sends each.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    // The case's order, one trigger at a time. The pause after each lets the
    // triggered CALL go out and be answered before the next TriggerMessage:
    // the case is a sequence, not a burst, and a CSMS may refuse a
    // CSMS-initiated Call while one of the station's is still in progress.
    // MeterValues and StatusNotification are scoped to the configured
    // connector, as the case requires; the other three are station-wide.
    const triggers = [
      { action: "TriggerMessage", requestedMessage: "MeterValues", connectorId: 1 },
      { action: "TriggerMessage", requestedMessage: "Heartbeat" },
      { action: "TriggerMessage", requestedMessage: "StatusNotification", connectorId: 1 },
      { action: "TriggerMessage", requestedMessage: "DiagnosticsStatusNotification" },
      { action: "TriggerMessage", requestedMessage: "FirmwareStatusNotification" },
    ] as const;
    await sleep(2000);
    for (const trigger of triggers) {
      try {
        await csms16.execute(cpId, trigger);
      } catch (err) {
        warnOpFailed("TriggerMessage", err);
      }
      await sleep(3000);
    }
  },
  assert({ frames, rec }) {
    // TC_054 steps 1-19, one trigger at a time -- see assertTriggered.
    assertTriggered(rec, frames, "MeterValues", 1, false, "requested MeterValues sent for connector 1");
    assertTriggered(rec, frames, "Heartbeat", null, false, "requested Heartbeat sent");
    assertTriggered(rec, frames, "StatusNotification", 1, false, "requested StatusNotification sent for connector 1");
    assertTriggered(rec, frames, "DiagnosticsStatusNotification", null, false, "requested DiagnosticsStatusNotification sent");
    assertTriggered(rec, frames, "FirmwareStatusNotification", null, true, "requested FirmwareStatusNotification sent (if implemented)");
    // TC_054 steps 4, 8, 12, 16, 20: a .conf on the Central System for each of
    // the five messages it triggered. The checks above make sure each was
    // sent, so none of these can report SKIPPED on a run where the CSMS
    // dispatched every trigger.
    assertAllAnswered(rec, frames, "Heartbeat");
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "MeterValues");
    assertAllAnswered(rec, frames, "DiagnosticsStatusNotification");
    assertAllAnswered(rec, frames, "FirmwareStatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_055 Trigger Message -- Rejected. Scenario pre-arms a Rejected response
// override; CP answers Rejected and sends nothing.
// ---------------------------------------------------------------------------

export const tc055TriggerMessageRejectedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc055-trigger-message-rejected",
  ocppVersion: "OCPP-1.6J",
  tags: ["remote-trigger"],
  description:
    "TC_055 Trigger Message — Rejected: pre-armed override, CP sends nothing.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "TriggerMessage", requestedMessage: "Heartbeat" });
    } catch (err) {
      warnOpFailed("TriggerMessage", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertReceived(
      rec,
      frames,
      "TriggerMessage",
      "TriggerMessage.req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "TriggerMessage",
      "Rejected",
      "TriggerMessage rejected",
    );
    assertNoLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"Heartbeat"/,
      "no Heartbeat sent (rejected, nothing triggered)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_056 Central Smart Charging -- TxDefaultProfile. Charging session runs;
// CSMS sends SetChargingProfile (TxDefaultProfile, connector 1); CP stores
// and applies it, then the scenario stops the transaction.
// ---------------------------------------------------------------------------

interface TxDefaultProfileDriveState {
  txPk: string;
  /** Looked up by description (see steve.ts's `SteveTx.chargingProfilePkByDescription`
   *  doc comment) rather than hardcoded -- a hardcoded pk drifts on a
   *  long-lived SteVe DB (auto_increment gaps from unrelated provisioning
   *  history), which is exactly what broke this spec (issue #184 Task 4). */
  profilePk: string;
}

export const tc056SmartChargingTxDefaultSpec: ScenarioSpec<TxDefaultProfileDriveState> =
  {
    templateId: "cert16-tc056-central-smart-charging-txdefault",
    ocppVersion: "OCPP-1.6J",
    tags: ["smart-charging", "transaction"],
    description:
      "TC_056 Central Smart Charging (TxDefaultProfile): applied by the CP; session completes.",
    connector: 1,
    bootWaitSecs: 4,
    // tx-start settle(3s) + csmsCallTrigger + 10s delay-before-stop + tail.
    holdSecs: 25,
    async drive({ cpId, records, csms16 }): Promise<TxDefaultProfileDriveState> {
      await sleep(3000);
      const txPk = await records.latestTransaction(cpId);
      const profilePk = await records.chargingProfiles.refByDescription(
        "TC056 TxDefaultProfile",
      );
      try {
        await csms16.execute(cpId, {
        action: "SetChargingProfile",
        connectorId: 1,
        chargingProfile: profilePk,
      });
      } catch (err) {
        warnOpFailed("SetChargingProfile", err);
      }
      return { txPk, profilePk };
    },
    async assert({ cpId, frames, lines, rec, records, driveState }) {
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StartTransaction".*"idTag":"CERT056"/,
        "StartTransaction sent with idTag CERT056",
      );
      assertResponseStatus(
        rec,
        frames,
        "SetChargingProfile",
        "Accepted",
        "SetChargingProfile (TxDefaultProfile) accepted",
      );
      assertLineMatches(
        rec,
        lines,
        new RegExp(`Applied charging profile #${driveState.profilePk}(?!\\d)`),
        "CP applied the TxDefaultProfile",
      );
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StopTransaction"/,
        "StopTransaction eventually sent",
      );

      // Bash: `local tx_pk="${TX_PK:-$(db_latest_tx_pk "$CP_ID")}"` -- use
      // drive()'s captured pk if non-empty, else fall back to a fresh
      // lookup (defensive: TX_PK could be empty if drive() raced the DB
      // write before the profile-set op).
      const txPk = driveState.txPk || (await records.latestTransaction(cpId));
      if (!txPk) {
        rec.fail(
          "DB: transaction is closed (stop_timestamp set)",
          "no transaction found",
        );
        return;
      }
      assertNonEmpty(
        rec,
        await records.transactionStopTimestamp(txPk),
        "DB: transaction is closed (stop_timestamp set)",
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_057 Central Smart Charging -- TxProfile. Charging session runs; CSMS
// sends SetChargingProfile (TxProfile, for the running transaction); CP
// stores and applies it, then the scenario stops the transaction.
// ---------------------------------------------------------------------------

interface TxProfileDriveState {
  txPk: string;
  /** See TxDefaultProfileDriveState.profilePk's comment above -- same
   *  hardcoded-pk drift issue, fixed the same way. */
  profilePk: string;
}

export const tc057SmartChargingTxProfileSpec: ScenarioSpec<TxProfileDriveState> =
  {
    templateId: "cert16-tc057-central-smart-charging-txprofile",
    ocppVersion: "OCPP-1.6J",
    tags: ["smart-charging", "transaction"],
    description:
      "TC_057 Central Smart Charging (TxProfile): applied by the CP to the running transaction; session completes.",
    connector: 1,
    bootWaitSecs: 4,
    holdSecs: 25,
    async drive({ cpId, records, csms16 }): Promise<TxProfileDriveState> {
      // Bind to the ACTIVE transaction CERT057's own StartTransaction
      // created, not records.latestTransaction's "newest row regardless of tag/state"
      // -- on a reused charge point that could silently pick up a stale
      // closed transaction from an earlier run instead (and the TxProfile
      // is only meaningful attached to the actual running transaction).
      let txPk = "";
      try {
        txPk = await records.waitForActiveTransaction(cpId, "CERT057", 15);
      } catch (err) {
        warnOpFailed("db_wait_active_tx_pk(CERT057)", err);
      }
      const profilePk =
        await records.chargingProfiles.refByDescription("TC057 TxProfile");
      try {
        await csms16.execute(cpId, {
        action: "SetChargingProfile",
        connectorId: 1,
        chargingProfile: profilePk,
        transaction: txPk,
      });
      } catch (err) {
        warnOpFailed("SetChargingProfile", err);
      }
      return { txPk, profilePk };
    },
    async assert({ frames, lines, rec, records, driveState }) {
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StartTransaction".*"idTag":"CERT057"/,
        "StartTransaction sent with idTag CERT057",
      );
      assertResponseStatus(
        rec,
        frames,
        "SetChargingProfile",
        "Accepted",
        "SetChargingProfile (TxProfile) accepted",
      );
      assertLineMatches(
        rec,
        lines,
        new RegExp(`Applied charging profile #${driveState.profilePk}(?!\\d)`),
        "CP applied the TxProfile",
      );
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StopTransaction"/,
        "StopTransaction eventually sent",
      );

      if (!driveState.txPk) {
        rec.fail(
          "DB: transaction is closed (stop_timestamp set)",
          "no active transaction found for CERT057",
        );
        return;
      }
      assertNonEmpty(
        rec,
        await records.transactionStopTimestamp(driveState.txPk),
        "DB: transaction is closed (stop_timestamp set)",
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_059 Remote Start with Charging Profile -- CSMS sends
// RemoteStartTransaction with an attached TxProfile entity ("TC057
// TxProfile", the only purpose SteVe will attach to this op). Per OCPP 5.11
// a Core-only CP may accept the start but not store/apply the profile --
// that's the load-bearing assertion here.
// ---------------------------------------------------------------------------

interface RemoteStartWithProfileDriveState {
  /** See TxDefaultProfileDriveState.profilePk's comment above -- same
   *  hardcoded-pk drift issue, fixed the same way. */
  profilePk: string;
}

export const tc059RemoteStartWithProfileSpec: ScenarioSpec<RemoteStartWithProfileDriveState> =
  {
    templateId: "cert16-tc059-remote-start-with-profile",
    ocppVersion: "OCPP-1.6J",
    tags: ["remote-control", "smart-charging", "transaction"],
    description:
      "TC_059 Remote Start with Charging Profile: accepted, but the attached TxProfile is NOT applied (Core CP).",
    connector: 1,
    bootWaitSecs: 4,
    // meter-auto blocks 30s before tx-stop + tail.
    holdSecs: 40,
    async drive({
      cpId,
      records,
      csms16,
    }): Promise<RemoteStartWithProfileDriveState> {
      await sleep(2000);
      const profilePk =
        await records.chargingProfiles.refByDescription("TC057 TxProfile");
      try {
        await csms16.execute(cpId, {
        action: "RemoteStartTransaction",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        chargingProfile: profilePk,
      });
      } catch (err) {
        warnOpFailed("RemoteStartTransaction", err);
      }
      return { profilePk };
    },
    async assert({ cpId, frames, lines, rec, records, driveState }) {
      assertResponseStatus(
        rec,
        frames,
        "RemoteStartTransaction",
        "Accepted",
        "RemoteStartTransaction (with attached TxProfile) accepted",
      );
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StartTransaction"/,
        "StartTransaction sent",
      );
      // Narrowed to the attached profile's own pk specifically (the log's
      // actual format is "Applied charging profile #<id> to connector <n>",
      // confirmed against SmartChargingHandlers.ts) -- a bare 'Applied
      // charging profile' would also fail this scenario on an unrelated
      // profile (e.g. TC056's, from another spec's leftover state) being
      // applied, which isn't what this assertion is about.
      assertNoLineMatches(
        rec,
        lines,
        new RegExp(
          `Applied charging profile #${driveState.profilePk}(?!\\d) to connector`,
        ),
        "attached profile is accepted but NOT stored/applied (Core CP may ignore SmartCharging profiles per OCPP 5.11)",
      );
      assertLineMatches(
        rec,
        lines,
        /Sent: \[2,.*"StopTransaction"/,
        "StopTransaction eventually sent",
      );
      // TC_059 steps 4, 6, 8, 10. Authorize is SKIPPED for the same measured
      // reason as TC_010 and TC_011: the simulator's AuthorizeRemoteTxRequests
      // is read-only false, so it never authorizes a remote start
      // (shiv3/ocpp-cp-simulator#921).
      assertAllAnswered(rec, frames, "StatusNotification");
      assertAllAnswered(rec, frames, "StartTransaction");
      assertAllAnswered(rec, frames, "Authorize");

      const txPk = await records.latestTransaction(cpId);
      if (!txPk) {
        rec.fail(
          "DB: transaction is closed (stop_timestamp set)",
          "no transaction found",
        );
        return;
      }
      assertNonEmpty(
        rec,
        await records.transactionStopTimestamp(txPk),
        "DB: transaction is closed (stop_timestamp set)",
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_066 Get Composite Schedule -- SetChargingProfile then
// GetCompositeSchedule in sequence (tests dual-park re-entry in the scenario
// engine). Both must be accepted; the returned schedule should reflect the
// applied profile.
// ---------------------------------------------------------------------------

export const tc066GetCompositeScheduleSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc066-get-composite-schedule",
  ocppVersion: "OCPP-1.6J",
  tags: ["smart-charging"],
  description:
    "TC_066 Get Composite Schedule: SetChargingProfile then GetCompositeSchedule, both accepted, schedule reflects the profile.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 15,
  async drive({ cpId, records, sim, csms16 }) {
    await sleep(2000);
    // Looked up by description (see TxDefaultProfileDriveState's comment
    // above -- same hardcoded-pk drift issue, fixed the same way) rather
    // than assuming this profile always has pk 1.
    const profilePk = await records.chargingProfiles.refByDescription(
      "TC056 TxDefaultProfile",
    );
    try {
      await csms16.execute(cpId, {
        action: "SetChargingProfile",
        connectorId: 1,
        chargingProfile: profilePk,
      });
    } catch (err) {
      warnOpFailed("SetChargingProfile", err);
    }

    // CSMS operation only confirms SetChargingProfile was QUEUED -- a fixed sleep
    // here isn't a completion barrier. Wait for the CP's own confirmation
    // that it actually applied the profile (the log literal is
    // SmartChargingHandlers.ts's "Applied charging profile #<id> to
    // connector <n>") before requesting the composite schedule, so a
    // slower host can't race GetCompositeSchedule ahead of the profile
    // actually landing -- ported from the bash spec's sim_wait_log barrier.
    const appliedRe = new RegExp(
      `Applied charging profile #${profilePk}(?!\\d)`,
    );
    try {
      await sim.waitForLine(appliedRe, 10_000);
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: did not see 'Applied charging profile #${profilePk}' within 10s -- proceeding anyway, assert() will likely fail (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }

    try {
      await csms16.execute(cpId, {
        action: "GetCompositeSchedule",
        connectorId: 1,
        duration: 600,
        chargingRateUnit: "W",
      });
    } catch (err) {
      warnOpFailed("GetCompositeSchedule", err);
    }
  },
  assert({ frames, rec }) {
    assertResponseStatus(
      rec,
      frames,
      "SetChargingProfile",
      "Accepted",
      "SetChargingProfile accepted",
    );
    assertResponseStatus(
      rec,
      frames,
      "GetCompositeSchedule",
      "Accepted",
      "GetCompositeSchedule accepted",
    );
    assertCompositeSchedulePeriodLimit(
      rec,
      frames,
      11000,
      "returned schedule reflects the applied profile's period (limit 11000)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_067 Clear Charging Profile -- CSMS sends SetChargingProfile (stored),
// then ClearChargingProfile; CP clears the profile and confirms Accepted.
// ---------------------------------------------------------------------------

export const tc067ClearChargingProfileSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc067-clear-charging-profile",
  ocppVersion: "OCPP-1.6J",
  tags: ["smart-charging"],
  description:
    "TC_067 Clear Charging Profile: SetChargingProfile then ClearChargingProfile, both accepted.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 15,
  async drive({ cpId, records, sim, csms16 }) {
    await sleep(2000);
    // Looked up by description (see TxDefaultProfileDriveState's comment
    // in the TC_056 spec above -- same hardcoded-pk drift issue, fixed the
    // same way) rather than assuming this profile always has pk 1.
    const profilePk = await records.chargingProfiles.refByDescription(
      "TC056 TxDefaultProfile",
    );
    try {
      await csms16.execute(cpId, {
        action: "SetChargingProfile",
        connectorId: 1,
        chargingProfile: profilePk,
      });
    } catch (err) {
      warnOpFailed("SetChargingProfile", err);
    }

    // Same completion-barrier rationale as TC_066 -- wait for the CP's own
    // "applied" confirmation before clearing it, so ClearChargingProfile
    // can't race ahead of the profile actually being stored.
    const appliedRe = new RegExp(
      `Applied charging profile #${profilePk}(?!\\d)`,
    );
    try {
      await sim.waitForLine(appliedRe, 10_000);
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: did not see 'Applied charging profile #${profilePk}' within 10s -- proceeding anyway, assert() will likely fail (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }

    try {
      await csms16.execute(cpId, { action: "ClearChargingProfile", chargingProfile: profilePk });
    } catch (err) {
      warnOpFailed("ClearChargingProfile", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertResponseStatus(
      rec,
      frames,
      "SetChargingProfile",
      "Accepted",
      "SetChargingProfile accepted",
    );
    assertResponseStatus(
      rec,
      frames,
      "ClearChargingProfile",
      "Accepted",
      "ClearChargingProfile accepted",
    );
    assertLineMatches(
      rec,
      lines,
      /Cleared.*profile/,
      "CP logged clearing the stored profile",
    );
  },
};

// See specs/core.ts's CORE_SPECS comment: ScenarioSpec<D> is effectively
// invariant in D, so a single array holding specs with different
// driveState types needs `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REMOTETRIGGER_SMARTCHARGING_SPECS: ScenarioSpec<any>[] = [
  tc010RemoteStartSpec,
  GHERKIN_PILOT_SPECS[2]!,
  tc012RemoteStopSpec,
  tc026RemoteStartRejectedSpec,
  tc028RemoteStopRejectedSpec,
  tc054TriggerMessageSpec,
  tc055TriggerMessageRejectedSpec,
  tc056SmartChargingTxDefaultSpec,
  tc057SmartChargingTxProfileSpec,
  tc059RemoteStartWithProfileSpec,
  tc066GetCompositeScheduleSpec,
  tc067ClearChargingProfileSpec,
];
