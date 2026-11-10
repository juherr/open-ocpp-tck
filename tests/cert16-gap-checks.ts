/**
 * tests/cert16-gap-checks.ts -- guard over the hand-rolled checks the 1.6
 * coverage-gap scenarios (cert16-tc053, cert16-tc054, spec48) decide on.
 *
 * PROPERTY, one claim per helper:
 *
 * - assertTriggered (TC_054): a trigger passes only when the CSMS sent a
 *   TriggerMessage for that message, scoped to the case's connector, the CP
 *   answered Accepted, and the requested message left the CP AFTER that
 *   answer -- on the same connector. NotImplemented is accepted only where
 *   the call site allows it, which TC_054 does for its LAST trigger alone;
 *   the call-site `true`/`false` literals are pinned by ASSERT-INVENTORY.txt,
 *   so what this guard holds is the helper honouring the flag both ways.
 * - assertIdTagInfoParent (TC_053): the Authorize.conf answering the given
 *   tag's Authorize carries the expected parentIdTag -- read off THAT tag's
 *   exchange, not the first Authorize on the wire.
 * - assertStartUsesReservation (TC_053): the given tag's StartTransaction
 *   carries the reservationId of the ReserveNow the CSMS sent.
 * - assertStartConfirmed (spec48): the given tag's StartTransaction was
 *   answered with a CALLRESULT; a CALLERROR or no answer is red.
 * - assertDistinctTransactionIds (spec48): both starts got integer
 *   transactionIds, and different ones.
 * - assertStartStatus (spec48): the given tag's start was answered with the
 *   expected idTagInfo.status, the tag selected by idTag -- a resent FIRST
 *   start is a second StartTransaction on the wire and must not be read as
 *   the busy-connector one.
 *
 * Why this is TypeScript. Every red row needs a CSMS (or a station) that
 * answers a chosen way -- a CALLERROR to the second start, a reused
 * transactionId, an Authorize.conf without the parent, a trigger accepted
 * and never honoured -- and none of the bundled ones can be asked for that.
 * The only way in is handing the helper the frames, as
 * tests/assert-answered.ts does. Every row is a one-field change of its
 * helper's green control, and every red row names the reason it must go red
 * for, so a synthetic line that stopped parsing cannot pass as a working
 * check.
 */

import { AssertRecorder, type CheckStatus } from "../tck/assert";
import { parseLog, type Frame } from "../tck/ocpp";
import {
  assertIdTagInfoParent,
  assertStartUsesReservation,
} from "../tck/specs/authlist-reservation";
import {
  assertDistinctTransactionIds,
  assertStartConfirmed,
  assertStartStatus,
} from "../tck/specs/core";
import { assertTriggered } from "../tck/specs/remotetrigger-smartcharging";

/** A Logger frame line in the shape ocpp.ts parses (see its LOG_LINE_RE). */
function line(direction: "Sent" | "Received", frame: unknown): string {
  return `[2026-08-14T00:00:00Z] [INFO] [ws] ${direction}: ${JSON.stringify(frame)}`;
}
const sentCall = (id: string, action: string, payload: unknown) =>
  line("Sent", [2, id, action, payload]);
const receivedCall = (id: string, action: string, payload: unknown) =>
  line("Received", [2, id, action, payload]);
const sentResult = (id: string, payload: unknown) => line("Sent", [3, id, payload]);
const receivedResult = (id: string, payload: unknown) =>
  line("Received", [3, id, payload]);
const receivedError = (id: string) =>
  line("Received", [4, id, "InternalError", "connector busy", {}]);

// --- assertTriggered ---------------------------------------------------------

const trigger = (message: string, connectorId?: number, id = "t") =>
  receivedCall(id, "TriggerMessage", {
    requestedMessage: message,
    ...(connectorId === undefined ? {} : { connectorId }),
  });
const triggerConf = (status: string, id = "t") => sentResult(id, { status });
const statusNotification = (connectorId: number) =>
  sentCall("s", "StatusNotification", {
    connectorId,
    errorCode: "NoError",
    status: "Available",
  });

const triggered =
  (message: string, connectorId: number | null, notImplementedAllowed: boolean) =>
  (rec: AssertRecorder, frames: readonly Frame[]) =>
    assertTriggered(rec, frames, message, connectorId, notImplementedAllowed, "sent");

// --- TC_053 ------------------------------------------------------------------

const authorize = (id: string, idTag: string) =>
  sentCall(id, "Authorize", { idTag });
const authorizeConf = (id: string, parentIdTag?: string) =>
  receivedResult(id, {
    idTagInfo: {
      status: "Accepted",
      ...(parentIdTag === undefined ? {} : { parentIdTag }),
    },
  });
const parentOf = (rec: AssertRecorder, frames: readonly Frame[]) =>
  assertIdTagInfoParent(rec, frames, "Authorize", "CHILD", "GRP", "parent");

const reserveNow = (reservationId: number) =>
  receivedCall("r", "ReserveNow", {
    connectorId: 1,
    expiryDate: "2026-08-14T01:00:00Z",
    idTag: "OWNER",
    parentIdTag: "GRP",
    reservationId,
  });
const startWith = (id: string, idTag: string, reservationId?: number) =>
  sentCall(id, "StartTransaction", {
    connectorId: 1,
    idTag,
    meterStart: 0,
    timestamp: "2026-08-14T00:00:00Z",
    ...(reservationId === undefined ? {} : { reservationId }),
  });
const usesReservation = (rec: AssertRecorder, frames: readonly Frame[]) =>
  assertStartUsesReservation(rec, frames, "CHILD", "reservation");

// --- spec48 ------------------------------------------------------------------

const start = (id: string, idTag: string) => startWith(id, idTag);
const startConf = (id: string, transactionId: unknown, status = "Accepted") =>
  receivedResult(id, { transactionId, idTagInfo: { status } });
const confirmed = (rec: AssertRecorder, frames: readonly Frame[]) =>
  assertStartConfirmed(rec, frames, "TAG-2", "confirmed");
const distinct = (rec: AssertRecorder, frames: readonly Frame[]) =>
  assertDistinctTransactionIds(rec, frames, "TAG-1", "TAG-2", "distinct");
const statusOf = (rec: AssertRecorder, frames: readonly Frame[]) =>
  assertStartStatus(rec, frames, "TAG-2", "Accepted", "status");

/** The conformant spec48 exchange: two starts, two confs, two ids. */
const SPEC48_OK = [
  start("a", "TAG-1"),
  startConf("a", 10),
  start("b", "TAG-2"),
  startConf("b", 11),
];

const cases: Array<{
  name: string;
  check: (rec: AssertRecorder, frames: readonly Frame[]) => void;
  lines: string[];
  expect: CheckStatus[];
  /** Substring the first failing check's detail must contain: the reason the
   *  row is red, so a parse failure cannot stand in for it. */
  because?: string;
}> = [
  // assertTriggered
  {
    name: "trigger: Accepted, then the message on the right connector",
    check: triggered("StatusNotification", 1, false),
    lines: [trigger("StatusNotification", 1), triggerConf("Accepted"), statusNotification(1)],
    expect: ["PASS", "PASS"],
  },
  {
    name: "trigger: accepted but the message is never sent",
    check: triggered("StatusNotification", 1, false),
    lines: [trigger("StatusNotification", 1), triggerConf("Accepted")],
    expect: ["PASS", "FAIL"],
    because: "no Sent StatusNotification for connector 1 after",
  },
  {
    name: "trigger: the message went out only BEFORE the TriggerMessage.conf",
    check: triggered("StatusNotification", 1, false),
    lines: [trigger("StatusNotification", 1), statusNotification(1), triggerConf("Accepted")],
    expect: ["PASS", "FAIL"],
    because: "after the TriggerMessage.conf",
  },
  {
    name: "trigger: the TriggerMessage names another connector",
    check: triggered("StatusNotification", 1, false),
    lines: [trigger("StatusNotification", 2), triggerConf("Accepted"), statusNotification(2)],
    expect: ["FAIL", "FAIL"],
    because: "expected connectorId 1, got 2",
  },
  {
    name: "trigger: right trigger, the message sent for another connector",
    check: triggered("StatusNotification", 1, false),
    lines: [trigger("StatusNotification", 1), triggerConf("Accepted"), statusNotification(2)],
    expect: ["PASS", "FAIL"],
    because: "for connector 1 after",
  },
  {
    // Five triggers in a row: each check reads ITS TriggerMessage, not the
    // first one on the wire, which here is another message's and Rejected.
    name: "trigger: read off its own TriggerMessage, not the first one",
    check: triggered("Heartbeat", null, false),
    lines: [
      trigger("DiagnosticsStatusNotification", undefined, "t1"),
      triggerConf("Rejected", "t1"),
      trigger("Heartbeat", undefined, "t2"),
      triggerConf("Accepted", "t2"),
      sentCall("h", "Heartbeat", {}),
    ],
    expect: ["PASS", "PASS"],
  },
  {
    name: "trigger: the CSMS never sent the TriggerMessage",
    check: triggered("Heartbeat", null, false),
    lines: [sentCall("h", "Heartbeat", {})],
    expect: ["FAIL", "FAIL"],
    because: "no Received TriggerMessage with requestedMessage=Heartbeat",
  },
  {
    name: "trigger: NotImplemented where the case allows it (last trigger)",
    check: triggered("FirmwareStatusNotification", null, true),
    lines: [trigger("FirmwareStatusNotification"), triggerConf("NotImplemented")],
    expect: ["PASS", "PASS"],
  },
  {
    name: "trigger: NotImplemented on a trigger that is not the last",
    check: triggered("DiagnosticsStatusNotification", null, false),
    lines: [trigger("DiagnosticsStatusNotification"), triggerConf("NotImplemented")],
    expect: ["FAIL", "FAIL"],
    because: "expected status Accepted, got NotImplemented",
  },
  {
    name: "trigger: Rejected is red even where NotImplemented is allowed",
    check: triggered("FirmwareStatusNotification", null, true),
    lines: [trigger("FirmwareStatusNotification"), triggerConf("Rejected")],
    expect: ["FAIL", "FAIL"],
    because: "expected status Accepted, got Rejected",
  },

  // assertIdTagInfoParent
  {
    name: "parent: Authorize.conf carries the group",
    check: parentOf,
    lines: [authorize("a", "CHILD"), authorizeConf("a", "GRP")],
    expect: ["PASS"],
  },
  {
    name: "parent: Authorize.conf without parentIdTag",
    check: parentOf,
    lines: [authorize("a", "CHILD"), authorizeConf("a")],
    expect: ["FAIL"],
    because: "idTagInfo.parentIdTag is absent",
  },
  {
    name: "parent: Authorize.conf with another parentIdTag",
    check: parentOf,
    lines: [authorize("a", "CHILD"), authorizeConf("a", "OTHER")],
    expect: ["FAIL"],
    because: 'idTagInfo.parentIdTag is "OTHER"',
  },
  {
    name: "parent: read off the tag's own Authorize, not the first one",
    check: parentOf,
    lines: [
      authorize("a", "OWNER"),
      authorizeConf("a", "GRP"),
      authorize("b", "CHILD"),
      authorizeConf("b"),
    ],
    expect: ["FAIL"],
    because: "idTagInfo.parentIdTag is absent",
  },

  // assertStartUsesReservation
  {
    name: "reservation: StartTransaction carries the ReserveNow's id",
    check: usesReservation,
    lines: [reserveNow(7), startWith("s", "CHILD", 7)],
    expect: ["PASS"],
  },
  {
    name: "reservation: StartTransaction without a reservationId",
    check: usesReservation,
    lines: [reserveNow(7), startWith("s", "CHILD")],
    expect: ["FAIL"],
    because: "StartTransaction.reservationId is undefined",
  },
  {
    name: "reservation: StartTransaction with another reservationId",
    check: usesReservation,
    lines: [reserveNow(7), startWith("s", "CHILD", 8)],
    expect: ["FAIL"],
    because: "StartTransaction.reservationId is 8",
  },
  {
    name: "reservation: the station never started for the tag",
    check: usesReservation,
    lines: [reserveNow(7), startWith("s", "OWNER", 7)],
    expect: ["FAIL"],
    because: "no sent StartTransaction for idTag CHILD",
  },

  // assertStartConfirmed
  {
    name: "confirmed: second start answered with a CALLRESULT",
    check: confirmed,
    lines: SPEC48_OK,
    expect: ["PASS"],
  },
  {
    name: "confirmed: second start answered with a CALLERROR",
    check: confirmed,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), receivedError("b")],
    expect: ["FAIL"],
    because: "got CALLERROR InternalError",
  },
  {
    name: "confirmed: second start never answered",
    check: confirmed,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2")],
    expect: ["FAIL"],
    because: "no response frame found for uniqueId=b",
  },

  // assertDistinctTransactionIds
  {
    name: "distinct: two integer ids that differ",
    check: distinct,
    lines: SPEC48_OK,
    expect: ["PASS"],
  },
  {
    name: "distinct: the second start reuses the open transaction's id",
    check: distinct,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), startConf("b", 10)],
    expect: ["FAIL"],
    because: "both starts got transactionId 10",
  },
  {
    name: "distinct: the second start got a CALLERROR, so no id",
    check: distinct,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), receivedError("b")],
    expect: ["FAIL"],
    because: "are not both integers",
  },
  {
    name: "distinct: a non-integer id",
    check: distinct,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), startConf("b", "11")],
    expect: ["FAIL"],
    because: "are not both integers",
  },

  // assertStartStatus
  {
    name: "status: second start Accepted",
    check: statusOf,
    lines: SPEC48_OK,
    expect: ["PASS"],
  },
  {
    name: "status: second start answered ConcurrentTx",
    check: statusOf,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), startConf("b", 11, "ConcurrentTx")],
    expect: ["FAIL"],
    because: 'expected idTagInfo.status=Accepted, got "ConcurrentTx"',
  },
  {
    name: "status: second start answered with a CALLERROR",
    check: statusOf,
    lines: [start("a", "TAG-1"), startConf("a", 10), start("b", "TAG-2"), receivedError("b")],
    expect: ["FAIL"],
    because: "expected CALLRESULT, got CALLERROR",
  },
  {
    // The resend: the first start's CALLERROR makes the station send it
    // again, so the wire's SECOND StartTransaction is TAG-1's and Accepted.
    // A positional read reports that as TAG-2's status.
    name: "status: a resent first start is not read as the second",
    check: statusOf,
    lines: [
      start("a", "TAG-1"),
      receivedError("a"),
      start("a2", "TAG-1"),
      startConf("a2", 10),
      start("b", "TAG-2"),
      startConf("b", 11, "ConcurrentTx"),
    ],
    expect: ["FAIL"],
    because: 'got "ConcurrentTx"',
  },
];

let failures = 0;
for (const { name, check, lines, expect, because } of cases) {
  const rec = new AssertRecorder();
  check(rec, parseLog(lines.join("\n")));
  const statuses = rec.results.map((r) => r.status);
  const firstFailure = rec.results.find((r) => r.status === "FAIL");
  const wrongStatus = statuses.join(",") !== expect.join(",");
  const wrongReason =
    because !== undefined && !firstFailure?.detail?.includes(because);
  if (!wrongStatus && !wrongReason) continue;
  failures++;
  process.stderr.write(
    `FAIL: ${name}\n  expected [${expect.join(",")}]` +
      `${because ? ` failing because "${because}"` : ""}` +
      `, got [${statuses.join(",")}]` +
      `${firstFailure?.detail ? ` (${firstFailure.detail})` : ""}\n`,
  );
}

if (failures > 0) {
  process.stderr.write(
    `\nThe cert16 gap checks no longer decide what their scenarios claim ` +
      `(${failures}/${cases.length} cases wrong). See the header of this file ` +
      `for what each helper must hold.\n`,
  );
  process.exit(1);
}

process.stdout.write(`cert16 gap checks: ${cases.length} cases OK\n`);
