/**
 * specs/core.ts -- typed port of the "Core" group's bash specs
 * (scripts/steve-verify/specs/cert16-{tc001,tc003,tc004,tc005,tc013,tc014,
 * tc017,tc018,tc019(x2),tc021,tc024,tc031,tc061,tc064}-*.spec.sh), mirroring
 * run-all.sh's CORE array exactly (15 scenarios). Each spec asserts AT
 * LEAST what its bash predecessor asserted; CALLRESULT status checks are
 * upgraded to uniqueId-paired correlation (assertResponseStatus /
 * assertIdTagInfoStatus) instead of the bash version's log-window grep.
 */

import {
  assertAllAnswered,
  assertCallPayload,
  assertEq,
  assertIdTagInfoStatus,
  assertLineAfter,
  assertLineMatches,
  assertLineOrder,
  assertNoLineMatches,
  assertNonEmpty,
  assertReceived,
  assertResponseStatus,
  assertSent,
  type AssertRecorder,
} from "../assert";
import { findAllCalls, findCall, findResponseFor, type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
import { sleep } from "../util";

/**
 * TC_019_1's actual obligation: a GetConfiguration reached the charge point
 * asking for NO filter. OCPP 1.6 makes `key` 0..N optional and defines its
 * ABSENCE as "return every key", so `{}` and `{"key":[]}` are the same request
 * and a CSMS may send either. Checking the wire text for one of them failed a
 * conformant CSMS on its serialisation while the rest of the scenario passed
 * (issue #31) -- so this reads the parsed frame, which is also what keeps
 * TC_019_1 distinguishable from TC_019_2's `{"key":["HeartbeatInterval"]}`.
 *
 * Any received GetConfiguration satisfying it is enough, matching the any-line
 * semantics of the assertLineMatches this replaced: a CSMS that also makes
 * filtered requests is not failed for them.
 *
 * A malformed payload is not one of those witnesses. An OCPP-J CALL carries a
 * JSON OBJECT, and reading `key` off anything else -- `null`, an array, a
 * scalar -- yields undefined, which is the same shape an omitted member has.
 * Without the check below, `[2,"id","GetConfiguration",null]` would report a
 * conformance PASS: a green check for a request that is not a GetConfiguration
 * at all, which is the failure this whole helper exists to stop happening in
 * the other direction.
 *
 * Exported ONLY so tests/get-configuration-filter.ts can reach it -- neither
 * spelling is reproducible from a bundled driver, so the guard has to hand the
 * helper its frames. Not part of the driver-author surface: tck/index.ts
 * deliberately re-exports no specs.
 *
 * NOT GENERALISED into an assert.ts primitive, and here is the survey so the
 * question is not re-opened blind. Every `Sent:` regex in specs/ matches our
 * own simulator's JSON.stringify output and cannot vary. Of the `Received:`
 * ones -- the only CSMS-serialised half -- most pin nothing past the action
 * name, and exactly one other was at genuine risk: TC_021, which pinned member
 * ORDER. It is fixed below, by composing assertReceived with assertEq rather
 * than by a second helper, because what it needs is a value comparison the DSL
 * already has. Two instances, two shapes, no third caller: a generic
 * "assert a received payload satisfies a predicate" would be speculative here,
 * and it would put message-specific knowledge in a DSL that is message-agnostic
 * by construction. This helper stays in specs/ for the same reason -- "`key`
 * absent means return everything" is GetConfiguration semantics, not assertion
 * machinery.
 *
 * THAT SURVEY'S PREMISE MOVED, and the conclusion only half survived -- issue
 * #44. "Every `Sent:` regex matches our own simulator and cannot vary" is
 * false: it matches a PINNED DIGEST, and six of those regexes pinned member
 * order, so bumping the digest could turn them red for a reason no CSMS
 * caused. Two of the six even carried a comment saying they matched their
 * members "independently rather than assuming an order", which `.*` between
 * two members is not. All six are converted, so the caller count is no longer
 * two.
 *
 * What survives is WHERE the knowledge lives, and it survives whole. assert.ts
 * gained exactly one shape that carries no message knowledge --
 * `assertCallPayload`, a flat scalar subset of a CALL payload, which serves
 * three of the six. The other three are about what a `configurationKey` list
 * or a `chargingSchedule` looks like, so they stayed in this directory:
 * `assertConfigurationKeyListed` below, and
 * `assertCompositeSchedulePeriodLimit` in specs/remotetrigger-smartcharging.ts.
 * A primitive that knew what a `configurationKey` list is would still be the
 * wrong thing to build -- and the version of it that knew nothing, taking a
 * predicate, was written and reverted for a second reason recorded beside
 * `assertIdTagInfoStatus` in assert.ts.
 */
export function assertGetConfigurationUnfiltered(
  rec: AssertRecorder,
  frames: readonly Frame[],
  description: string,
): void {
  const calls = findAllCalls(frames, "received", "GetConfiguration");
  if (calls.length === 0) {
    rec.fail(description, "no Received CALL found for action=GetConfiguration");
    return;
  }
  const seen: string[] = [];
  for (const call of calls) {
    const payload = call.payload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      seen.push(`malformed payload ${JSON.stringify(payload)}`);
      continue;
    }
    const key = (payload as { key?: unknown }).key;
    if (key == null || (Array.isArray(key) && key.length === 0)) {
      rec.pass(description);
      return;
    }
    seen.push(`key=${JSON.stringify(key)}`);
  }
  rec.fail(
    description,
    `no received GetConfiguration asked for every key: ${seen.join("; ")}`,
  );
}

/**
 * The CALLRESULT answering the received GetConfiguration returns a
 * `configurationKey` list -- and, when `key` is a string rather than null,
 * one carrying that key.
 *
 * Replaces `/Sent: \[3,.*"configurationKey":\[{"key"/` and its
 * `:"HeartbeatInterval"` variant. Both were wrong twice over, and only the
 * first way is issue #44's: `\[{"key"` requires `key` to be the FIRST member
 * the charge point serialised in the FIRST entry, which no part of OCPP 1.6
 * says and nothing here declares. The second is that a text match over the
 * run's lines identifies the response as "some sent CALLRESULT mentioning
 * configurationKey" -- any CALLRESULT, to any request. Correlating from the
 * GetConfiguration that provoked it is what the check always meant.
 *
 * `key: null` is "a non-empty list", which is TC_019_1's obligation: it asked
 * for every key, so what matters is that a list came back at all. A literal
 * rather than an omitted argument so that ASSERT-INVENTORY.txt renders it --
 * a non-literal argument renders as `·`, and the difference between the two
 * scenarios' checks would then be invisible in the artifact that exists to
 * show it.
 *
 * An entry without a string `key` is not a configurationKey entry: OCPP 1.6
 * makes `key` required in `KeyValue`, and accepting anything else would let a
 * malformed response satisfy a conformance check.
 *
 * ANY received GetConfiguration whose answer satisfies it is enough, and that
 * is not a detail. The regexes this replaced matched any LINE, and the check
 * standing beside it in TC_019_1 -- assertGetConfigurationUnfiltered above --
 * accepts any request. Correlating from only the FIRST GetConfiguration would
 * make the two neighbours talk about different requests the moment a CSMS
 * sends one of its own, and would narrow what the scenario measures in the
 * failing direction, silently. Converting a regex must not do that.
 *
 * SPELLED OUT rather than handed to a predicate-taking helper in assert.ts --
 * see the rejected-refactor note beside `assertIdTagInfoStatus` there. In
 * short: an argument the extractor cannot render is an argument
 * ASSERT-INVENTORY.txt cannot pin, and what this helper accepts is exactly
 * what that artifact exists to show.
 */
export function assertConfigurationKeyListed(
  rec: AssertRecorder,
  frames: readonly Frame[],
  key: string | null,
  description: string,
): void {
  const calls = findAllCalls(frames, "received", "GetConfiguration");
  if (calls.length === 0) {
    rec.fail(description, "no Received CALL found for action=GetConfiguration");
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
    const list = (response.payload as { configurationKey?: unknown } | null)
      ?.configurationKey;
    if (!Array.isArray(list) || list.length === 0) {
      seen.push(`no configurationKey list: ${JSON.stringify(response.payload)}`);
      continue;
    }
    const keys = list.flatMap((entry) => {
      const name = (entry as { key?: unknown } | null)?.key;
      return typeof name === "string" ? [name] : [];
    });
    if (keys.length !== list.length) {
      seen.push(`configurationKey entry without a string key: ${JSON.stringify(list)}`);
      continue;
    }
    if (key === null || keys.includes(key)) {
      rec.pass(description);
      return;
    }
    seen.push(`keys=${keys.join(",")}`);
  }
  rec.fail(
    description,
    `no GetConfiguration.conf carried ${key === null ? "a configurationKey list" : key}: ${seen.join("; ")}`,
  );
}

// ---------------------------------------------------------------------------
// TC_001 Cold Boot -- CP-only, no CSMS-side operator action.
// ---------------------------------------------------------------------------

export const tc001ColdBootSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc001-cold-boot",
  description:
    "TC_001 Cold Boot: CP core drives StatusNotification(Available) on boot (no scripted node), then idles.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 20,
  assert({ frames, lines, rec }) {
    assertSent(rec, frames, "BootNotification", "BootNotification.req sent");
    assertResponseStatus(
      rec,
      frames,
      "BootNotification",
      "Accepted",
      "BootNotification accepted",
      { direction: "sent" },
    );
    // TC_001 steps 4 and 6. Heartbeat reports SKIPPED here rather than PASS or
    // FAIL, and that is the intended reading: this scenario holds for 20s and
    // the CP sends no Heartbeat in that window (measured -- a sweep's log
    // carries BootNotification and StatusNotification only). The obligation is
    // real and unexercised, which is orange; TC_054 triggers a Heartbeat
    // explicitly and checks it for real.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "Heartbeat");

    const sentAvailableOnConnector1 = frames.some(
      (f) =>
        f.kind === "call" &&
        f.direction === "sent" &&
        f.action === "StatusNotification" &&
        (f.payload as { connectorId?: number; status?: string } | null)
          ?.connectorId === 1 &&
        (f.payload as { connectorId?: number; status?: string } | null)
          ?.status === "Available",
    );
    if (sentAvailableOnConnector1) {
      rec.pass("StatusNotification(Available) sent for connector 1");
    } else {
      rec.fail(
        "StatusNotification(Available) sent for connector 1",
        "no Sent StatusNotification frame with connectorId=1, status=Available",
      );
    }

    // Prefer the structured JSON event over the bash version's free-text
    // "Scenario execution completed" grep -- see the Task 1 investigation
    // notes (.superpowers/sdd/tsr-task-1-report.md) for why it's the more
    // robust signal for scenario lifecycle specifically.
    assertLineMatches(
      rec,
      lines,
      /"event":"scenario_completed"/,
      "scenario ran to completion",
    );
    assertNoLineMatches(
      rec,
      lines,
      /blocked by the boot gate/,
      "no messages were dropped by the boot gate",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_003 Charging Session (Plug-In First) -- fully CP-driven.
// ---------------------------------------------------------------------------

export const tc003ChargingPluginFirstSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc003-charging-plugin-first",
  description:
    "TC_003 Charging Session (Plug-In First): plug in, idTag CERT003, charge, stop, plug out.",
  connector: 1,
  bootWaitSecs: 4,
  // delay-connect(2s) + delay-idtag(2s) + bounded meter block(30s) + tail.
  holdSecs: 45,
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Preparing"/,
      /Sent: \[2,.*"StartTransaction"/,
      "Preparing precedes StartTransaction",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT003"/,
      "StartTransaction sent with idTag CERT003",
    );
    assertIdTagInfoStatus(
      rec,
      frames,
      "StartTransaction",
      "Accepted",
      "StartTransaction accepted by the CSMS",
    );
    assertSent(rec, frames, "MeterValues", "MeterValues sent while charging");
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"MeterValues"/,
      /Sent: \[2,.*"StopTransaction"/,
      "MeterValues precede StopTransaction",
    );
    assertSent(rec, frames, "StopTransaction", "StopTransaction sent");
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "final StatusNotification(Available) sent",
    );
    // TC_003 steps 2, 4, 6, 8. Before the DB block on purpose: whether the
    // CSMS answered the wire is not contingent on a transaction row being
    // findable, and the early return below would skip these if they came after.
    assertAllAnswered(rec, frames, "Authorize");
    assertAllAnswered(rec, frames, "StatusNotification");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    rec.pass(`DB: transaction row exists for ${cpId} (pk=${txPk})`);
    assertEq(rec, await records.transactionIdTag(txPk), "CERT003", "DB: id_tag is CERT003");
    assertNonEmpty(
      rec,
      await records.transactionStopTimestamp(txPk),
      "DB: transaction is closed (stop_timestamp set)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_004 Charging Session (Identification First) -- fully CP-driven.
// ---------------------------------------------------------------------------

export const tc004ChargingIdFirstSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc004-charging-id-first",
  description:
    "TC_004 Charging Session (Identification First): idTag CERT004 before plug-in, charge, stop.",
  connector: 1,
  bootWaitSecs: 4,
  // delay-idtag(2s) + bounded meter block(30s) + tail.
  holdSecs: 40,
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT004"/,
      "StartTransaction sent with idTag CERT004",
    );
    assertIdTagInfoStatus(
      rec,
      frames,
      "StartTransaction",
      "Accepted",
      "StartTransaction accepted by the CSMS",
    );
    assertSent(rec, frames, "MeterValues", "MeterValues sent while charging");
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"MeterValues"/,
      /Sent: \[2,.*"StopTransaction"/,
      "MeterValues precede StopTransaction",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "final StatusNotification(Available) sent",
    );
    // TC_004.1 -- the case gives its whole scenario as the reusable state
    // "Charging", which is Authorized + StatusNotification.conf x2 +
    // StartTransaction.conf (reference section 3.22).
    assertAllAnswered(rec, frames, "Authorize");
    assertAllAnswered(rec, frames, "StatusNotification");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    rec.pass(`DB: transaction row exists for ${cpId} (pk=${txPk})`);
    assertEq(rec, await records.transactionIdTag(txPk), "CERT004", "DB: id_tag is CERT004");
    assertNonEmpty(
      rec,
      await records.transactionStopTimestamp(txPk),
      "DB: transaction is closed (stop_timestamp set)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_005 EV Side Disconnected -- fully CP-driven.
// ---------------------------------------------------------------------------

export const tc005EvSideDisconnectSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc005-ev-side-disconnect",
  description:
    "TC_005 EV Side Disconnected: mid-charge EV-side plugout, StopTransaction reason EVDisconnected.",
  connector: 1,
  bootWaitSecs: 4,
  // bounded meter block(15s) + tail.
  holdSecs: 25,
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT005"/,
      "StartTransaction sent with idTag CERT005",
    );
    assertSent(rec, frames, "MeterValues", "MeterValues sent while charging");
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StopTransaction".*"reason":"EVDisconnected"/,
      "StopTransaction sent with reason EVDisconnected",
    );
    // TC_005.1 steps 2, 4, 6.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "StopTransaction");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    rec.pass(`DB: transaction row exists for ${cpId} (pk=${txPk})`);
    assertEq(rec, await records.transactionIdTag(txPk), "CERT005", "DB: id_tag is CERT005");
    assertEq(
      rec,
      await records.transactionStopReason(txPk),
      "EVDisconnected",
      "DB: stop_reason is EVDisconnected",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_013 Hard Reset -- CSMS Reset(Hard) during charging.
// ---------------------------------------------------------------------------

export const tc013HardResetSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc013-hard-reset",
  description:
    "TC_013 Hard Reset: CSMS Reset(Hard) mid-charge; CP stops the tx (HardReset) and reboots (WS disconnect+reconnect).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 25,
  async drive({ cpId, csms16 }) {
    await sleep(3000);
    try {
      await csms16.execute(cpId, { action: "Reset", type: "Hard" });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation Reset(Hard) failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"Reset".*"type":"Hard"/,
      "Reset(Hard).req received",
    );
    // NOTE (ported from the bash spec, confirmed live): unlike Soft Reset,
    // the CP does NOT send an explicit Reset.conf CALLRESULT before
    // disconnecting on a Hard Reset -- it goes straight from "Reset request
    // received: Hard" to StopTransaction to WebSocket close. That's real
    // observed behavior, not a gap in this spec, so the disconnect/
    // reconnect/reboot sequence is asserted instead of a never-sent
    // CALLRESULT.
    assertSent(rec, frames, "StopTransaction", "StopTransaction sent");
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"StopTransaction"/,
      /WebSocket closed/,
      "StopTransaction precedes the WebSocket disconnect (reboot)",
    );

    const bootCount = frames.filter(
      (f) =>
        f.kind === "call" &&
        f.direction === "sent" &&
        f.action === "BootNotification",
    ).length;
    if (bootCount >= 2) {
      rec.pass(
        `CP reconnects and sends a fresh BootNotification after the reboot (${bootCount} total)`,
      );
    } else {
      rec.fail(
        "CP reconnects and sends a fresh BootNotification after the reboot",
        `expected >=2 BootNotification.req sends (initial + post-reboot), got ${bootCount}`,
      );
    }
    // TC_013 steps 6 and 8. Both boots, not just the first: the check above
    // establishes that the CP re-registered, this one that the CSMS answered
    // when it did. StopTransaction is deliberately absent -- TC_013_CSMS does
    // not put a StopTransaction.conf on the Central System, and the CP tears
    // the socket down straight after sending it.
    assertAllAnswered(rec, frames, "BootNotification", undefined, { minimum: 2 });
    assertAllAnswered(rec, frames, "StatusNotification");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    assertEq(
      rec,
      await records.transactionStopReason(txPk),
      "HardReset",
      "DB: stop_reason is HardReset",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_014 Soft Reset -- CSMS Reset(Soft) during charging.
//
// templateId/naming NOTE: a prior review suggested renaming this to
// "tc016" to follow the OCTT CSMS-side test-case document's numbering
// (README's numbering note); that suggestion was explicitly DECLINED (see
// .superpowers/sdd/progress.md's "declined w/ rationale: tc014 rename
// (CSMS-doc numbering)") -- the id/filename intentionally stays
// cert16-tc014-soft-reset. Carried forward unchanged here.
// ---------------------------------------------------------------------------

export const tc014SoftResetSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc014-soft-reset",
  description:
    "TC_014 Soft Reset: CSMS Reset(Soft) mid-charge; CP stops the tx (SoftReset) and reboots on the SAME socket.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 25,
  async drive({ cpId, csms16 }) {
    await sleep(3000);
    try {
      await csms16.execute(cpId, { action: "Reset", type: "Soft" });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation Reset(Soft) failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"Reset".*"type":"Soft"/,
      "Reset(Soft).req received",
    );
    assertResponseStatus(rec, frames, "Reset", "Accepted", "Reset accepted", {
      direction: "received",
    });
    assertSent(rec, frames, "StopTransaction", "StopTransaction sent");
    // ChargePoint.applyRemoteReset() takes the Soft path via boot() (no
    // disconnect/reconnect -- see src/cp/domain/charge-point/ChargePoint.ts),
    // which re-sends BootNotification.req on the SAME socket -- a CP CALL,
    // so it shows up as "Sent:" here, not "Received:". Anchored strictly
    // after the Reset.req line (assertLineAfter, not assertLineOrder) so
    // the unrelated INITIAL BootNotification can't trivially satisfy this.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"Reset"/,
      /Sent: \[2,.*"BootNotification"/,
      "CP sends a fresh BootNotification after Soft Reset (reboot on the same socket)",
    );
    // TC_014 steps 6 and 8. Two boots here as well -- the initial one and the
    // post-reset one the check above anchors, on the same socket.
    assertAllAnswered(rec, frames, "BootNotification", undefined, { minimum: 2 });
    assertAllAnswered(rec, frames, "StatusNotification");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    assertEq(
      rec,
      await records.transactionStopReason(txPk),
      "SoftReset",
      "DB: stop_reason is SoftReset",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_017 Unlock Connector (Occupied, Succeeds).
// ---------------------------------------------------------------------------

export const tc017UnlockOccupiedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc017-unlock-occupied",
  description:
    "TC_017 Unlock Connector (Occupied, Succeeds): CSMS UnlockConnector while charging -> Unlocked; session completes normally.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 35,
  async drive({ cpId, csms16 }) {
    // Timing: delay(2s) -> plug-in -> preparing -> tx-start -> charging ->
    // meter-auto(maxTime 15s, BLOCKS) -> unlock pre-arm (instant) ->
    // delay(10s window) -> tx-stop. The pre-arm window for
    // UnlockConnector.req is roughly [17s, 27s] after scenario start -- land
    // the op with a single combined sleep+op (mirrors the bash spec's
    // rationale, see .superpowers/sdd/steve-verify-results-g1.md).
    await sleep(20_000);
    try {
      await csms16.execute(cpId, { action: "UnlockConnector", connectorId: 1 });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation UnlockConnector failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  async assert({ cpId, records, frames, rec }) {
    assertReceived(
      rec,
      frames,
      "UnlockConnector",
      "UnlockConnector.req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "UnlockConnector",
      "Unlocked",
      "UnlockConnector -> Unlocked",
    );
    assertSent(
      rec,
      frames,
      "StopTransaction",
      "StopTransaction sent (session completes normally)",
    );

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
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
// TC_018 Unlock Connector (Failure).
// ---------------------------------------------------------------------------

export const tc018UnlockFailureSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc018-unlock-failure",
  description:
    "TC_018 Unlock Connector (Failure): CSMS UnlockConnector while charging -> UnlockFailed; session STILL completes normally.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 35,
  async drive({ cpId, csms16 }) {
    // Same timing window as TC_017 -- see that spec for the derivation.
    await sleep(20_000);
    try {
      await csms16.execute(cpId, { action: "UnlockConnector", connectorId: 1 });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation UnlockConnector failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  async assert({ cpId, records, frames, rec }) {
    assertReceived(
      rec,
      frames,
      "UnlockConnector",
      "UnlockConnector.req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "UnlockConnector",
      "UnlockFailed",
      "UnlockConnector -> UnlockFailed",
    );
    assertSent(
      rec,
      frames,
      "StopTransaction",
      "StopTransaction sent (session completes normally despite unlock failure)",
    );
    // TC_018.1 steps 6 and 8.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "StopTransaction");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
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
// TC_019_1 Retrieve All Configuration Keys.
// ---------------------------------------------------------------------------

export const tc019GetConfigurationAllSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc019-get-configuration-all",
  description:
    "TC_019_1 GetConfiguration(no filter) returns every supported key.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "GetConfiguration" });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation GetConfiguration failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  assert({ frames, lines, rec }) {
    assertGetConfigurationUnfiltered(
      rec,
      frames,
      "GetConfiguration(no filter).req received",
    );
    assertConfigurationKeyListed(
      rec,
      frames,
      null,
      "CALLRESULT returns a configurationKey list",
    );
    assertLineMatches(
      rec,
      lines,
      /"HeartbeatInterval"/,
      "response includes HeartbeatInterval",
    );
    assertLineMatches(
      rec,
      lines,
      /"SupportedFeatureProfiles"/,
      "response includes SupportedFeatureProfiles",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_019_2 Retrieve Specific Configuration Key.
// ---------------------------------------------------------------------------

export const tc019GetConfigurationKeySpec: ScenarioSpec<void> = {
  templateId: "cert16-tc019-get-configuration-key",
  description:
    "TC_019_2 GetConfiguration(HeartbeatInterval) returns just that key.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "GetConfiguration", keys: ["HeartbeatInterval"] });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation GetConfiguration failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  assert({ frames, lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"GetConfiguration".*"key":\["HeartbeatInterval"\]/,
      "GetConfiguration(HeartbeatInterval).req received",
    );
    assertConfigurationKeyListed(
      rec,
      frames,
      "HeartbeatInterval",
      "CALLRESULT returns the HeartbeatInterval key",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_021 Change Configuration.
// ---------------------------------------------------------------------------

export const tc021ChangeConfigurationSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc021-change-configuration",
  description:
    "TC_021 ChangeConfiguration(MeterValueSampleInterval=10) accepted and applied.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "ChangeConfiguration",
        key: "MeterValueSampleInterval",
        value: "10",
      });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation ChangeConfiguration failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  assert({ frames, rec }) {
    // The second instance of issue #31, and the one its report could not find:
    // its grep looked for an empty optional member, where this was a regex
    // matching `"key":...` BEFORE `"value":...`. That pins JSON member order,
    // which JSON does not define -- a CSMS serialising {value, key} is
    // conformant and was reported as failing. main.ts hit the same bug once
    // on BootNotification.conf and fixed it with order-free lookaheads; going
    // one better here and comparing the members as VALUES also drops the
    // assumption that the CSMS puts no whitespace around its colons.
    //
    // Composed from the existing DSL rather than given a helper of its own:
    // assertReceived already hands back the frame it found, and assertEq
    // already renders a value mismatch. Three checks where there was one, and
    // the extra two are the point -- a CSMS that applies the right key with
    // the wrong value now reports which, instead of "the regex did not match".
    const req = assertReceived(
      rec,
      frames,
      "ChangeConfiguration",
      "ChangeConfiguration.req received",
    );
    const payload = req?.payload as
      | { key?: unknown; value?: unknown }
      | undefined;
    assertEq(
      rec,
      payload?.key,
      "MeterValueSampleInterval",
      "ChangeConfiguration.req asks for MeterValueSampleInterval",
    );
    assertEq(
      rec,
      payload?.value,
      "10",
      "ChangeConfiguration.req carries value 10",
    );
    assertResponseStatus(
      rec,
      frames,
      "ChangeConfiguration",
      "Accepted",
      "ChangeConfiguration accepted",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_024 Start Charging Session -- Lock Failure.
// ---------------------------------------------------------------------------

export const tc024LockFailureSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc024-lock-failure",
  description:
    "TC_024 Lock Failure: plug in -> Faulted/ConnectorLockFailure, no transaction started, then plug out.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  assert({ frames, lines, rec }) {
    // The comment that stood here said the two members were matched
    // "independently rather than assuming an order", and named the order it
    // had confirmed live -- errorCode before status. The regex under it did
    // assume that order: `.*` between two members IS an order, and "confirmed
    // live" confirmed one run of one pinned digest (issue #44). Compared as
    // values, there is no order to confirm.
    assertCallPayload(
      rec,
      frames,
      "sent",
      "StatusNotification",
      { errorCode: "ConnectorLockFailure", status: "Faulted" },
      "StatusNotification(Faulted, ConnectorLockFailure) sent",
    );
    assertNoLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction"/,
      "no StartTransaction sent (lock failure prevents charging)",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "final StatusNotification(Available) sent after plug-out",
    );
    // TC_024 steps 2, 4, 6 -- the whole case is status reports, so every one
    // of them carries the obligation.
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_031 Unlock Connector -- Unknown Connector.
// ---------------------------------------------------------------------------

export const tc031UnlockUnknownConnectorSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc031-unlock-unknown-connector",
  description:
    "TC_031 UnlockConnector(connectorId=99) -> NotSupported (unknown connector).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 10,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "UnlockConnector", connectorId: 99 });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation UnlockConnector failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  assert({ frames, lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"UnlockConnector".*"connectorId":99/,
      "UnlockConnector(connectorId=99).req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "UnlockConnector",
      "NotSupported",
      "UnlockConnector -> NotSupported",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_061 Clear Authorization Cache.
// ---------------------------------------------------------------------------

export const tc061ClearCacheSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc061-clear-cache",
  description: "TC_061 ClearCache accepted.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 15,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "ClearCache" });
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: CSMS operation ClearCache failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "ClearCache", "ClearCache.req received");
    assertResponseStatus(
      rec,
      frames,
      "ClearCache",
      "Accepted",
      "ClearCache accepted",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_064 Data Transfer to Central System -- CP-initiated, unprompted.
// ---------------------------------------------------------------------------

export const tc064DataTransferSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc064-data-transfer",
  description:
    "TC_064 DataTransfer: CP sends DataTransfer.req unprompted; the CSMS response status is its own policy (not asserted exactly).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 10,
  assert({ frames, rec }) {
    // Three members chained with `.*` -- the widest member-order assumption in
    // the suite, and the one with the most ways to break silently. See #44.
    assertCallPayload(
      rec,
      frames,
      "sent",
      "DataTransfer",
      {
        vendorId: "com.example.cert16",
        messageId: "certTest",
        data: "hello-csms",
      },
      "DataTransfer.req sent with expected vendorId/messageId/data",
    );

    // TC_064 step 2, and the one obligation in the suite that assertAllAnswered
    // would UNDER-check rather than cover: it would establish that a CALLRESULT
    // came back, but not that its status is one the protocol defines. The
    // hand-rolled block below does both, so it stays -- it is a superset, not a
    // survivor of the refactor.
    //
    // REJECTED REFACTOR, and it will be proposed again because it is the
    // obvious one: fold the block into a new `assertResponseStatusOneOf` in
    // assert.ts, next to assertResponseStatus, which it duplicates down to the
    // wording of its two failure details. Not taken here for a reason outside
    // the code -- doing it moves this scenario's entry in ASSERT-INVENTORY.txt,
    // and that artifact is the review signal for "what does this scenario
    // measure". Spending it on a refactor that measures exactly the same thing
    // makes the next genuine change harder to read. Worth doing in a commit
    // whose only job is that refactor, never bundled with one that changes a
    // check.
    const description =
      "DataTransfer.conf received (status is the CSMS's own policy, not asserted)";
    const call = findCall(frames, "sent", "DataTransfer");
    if (!call) {
      rec.fail(description, "no Sent CALL found for action=DataTransfer");
      return;
    }
    const response = findResponseFor(frames, call);
    if (!response) {
      rec.fail(
        description,
        `no response frame found for uniqueId=${call.uniqueId} (DataTransfer)`,
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
    if (
      status === "Accepted" ||
      status === "Rejected" ||
      status === "UnknownVendorId"
    ) {
      rec.pass(description);
    } else {
      rec.fail(
        description,
        `expected status in (Accepted|Rejected|UnknownVendorId), got ${String(status)}`,
      );
    }
  },
};

// ScenarioSpec<D> is effectively invariant in D (D appears in drive()'s
// return position AND assert()'s parameter position), so a single array
// holding specs with different driveState types needs `any` here, same as
// main.ts's SPECS_BY_TEMPLATE_ID registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CORE_SPECS: ScenarioSpec<any>[] = [
  tc001ColdBootSpec,
  tc003ChargingPluginFirstSpec,
  tc004ChargingIdFirstSpec,
  tc005EvSideDisconnectSpec,
  tc013HardResetSpec,
  tc014SoftResetSpec,
  tc017UnlockOccupiedSpec,
  tc018UnlockFailureSpec,
  tc019GetConfigurationAllSpec,
  tc019GetConfigurationKeySpec,
  tc021ChangeConfigurationSpec,
  tc024LockFailureSpec,
  tc031UnlockUnknownConnectorSpec,
  tc061ClearCacheSpec,
  tc064DataTransferSpec,
];
