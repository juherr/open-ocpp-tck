/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/specs/authlist-reservation.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: CSMS operations are expressed as typed OCPP through the driver contract.
 *
 * specs/authlist-reservation.ts -- typed port of the "LocalAuthList +
 * Reservation" bash specs (scripts/steve-verify/specs/cert16-{tc042(x2),
 * tc043(x4),reservation-basic,tc048(x4),tc051,tc052}-*.spec.sh), mirroring
 * run-all.sh's AUTHLIST_RESERVATION array exactly (13 scenarios). Each spec
 * asserts AT LEAST what its bash predecessor asserted; CALLRESULT status
 * checks are upgraded to uniqueId-paired correlation (assertResponseStatus)
 * instead of the bash version's log-window grep. TC_053 came later and has no
 * bash predecessor, nor a simulator template: its drive() sends the station's
 * two commands itself.
 */

import {
  assertAllAnswered,
  assertCallPayload,
  assertEq,
  assertIdTagInfoStatus,
  assertLineAfter,
  assertLineMatches,
  assertLineOrder,
  assertNonEmpty,
  assertReceived,
  assertResponseStatus,
  assertSent,
  type AssertRecorder,
} from "../assert";
import { UnsupportedOperationError } from "../driver";
import { findAllCalls, findResponseFor, type Frame } from "../ocpp";
import { warnOpFailed } from "../op-warn";
import type { ScenarioSpec } from "../spec-types";
import { inMinutes } from "../time";
import { sleep } from "../util";
import { waitForCondition } from "../wait";

// ---------------------------------------------------------------------------
// TC_042.1 Get Local List Version -- Not Supported. Local list disabled via
// the scenario template's configSet; CP must answer listVersion -1.
// ---------------------------------------------------------------------------

export const tc0421GetLocalListVersionNotSupportedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc042-1-get-local-list-version-not-supported",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description:
    "TC_042.1 GetLocalListVersion -> listVersion -1 (local list disabled).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "GetLocalListVersion" });
    } catch (err) {
      warnOpFailed("GetLocalListVersion", err);
    }
  },
  assert({ lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"GetLocalListVersion"/,
      "GetLocalListVersion.req received",
    );
    // No "status" field on this CALLRESULT (just {"listVersion":-1}), so
    // assertResponseStatus doesn't apply -- this run has exactly one
    // call/response pair, so a direct line match is simple and honest
    // (matches the bash spec's own reasoning).
    assertLineMatches(
      rec,
      lines,
      /"listVersion":-1/,
      "listVersion -1 returned (local list disabled)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_042.2 Get Local List Version -- Empty. Local list enabled via configSet
// on a fresh CP; CP must answer listVersion 0.
// ---------------------------------------------------------------------------

export const tc0422GetLocalListVersionEmptySpec: ScenarioSpec<void> = {
  templateId: "cert16-tc042-2-get-local-list-version-empty",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description:
    "TC_042.2 GetLocalListVersion -> listVersion 0 (local list enabled, empty).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  // NOTE (ported from the bash spec, a reviewed/declined-restructure
  // decision -- see .superpowers/sdd/progress.md's "tc042-2 restructure
  // (fresh-process in-memory list)"): version 0 holds regardless of run
  // order. sim.ts's startSim() launches a FRESH simulator container per
  // scenario, and LocalAuthListManager's list/version live only in that
  // process's memory (src/cp/domain/auth/LocalAuthList.ts), so a prior
  // SendLocalList run against the same cpId (even earlier in the same
  // group sweep) leaves nothing behind here. Do not "fix" this by
  // resetting/isolating state -- there's no cross-run state to reset.
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, { action: "GetLocalListVersion" });
    } catch (err) {
      warnOpFailed("GetLocalListVersion", err);
    }
  },
  assert({ lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"GetLocalListVersion"/,
      "GetLocalListVersion.req received",
    );
    assertLineMatches(
      rec,
      lines,
      /"listVersion":0/,
      "listVersion 0 returned (local list enabled, empty)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_043.1 Send Local List -- Not Supported.
// ---------------------------------------------------------------------------

export const tc0431SendLocalListNotSupportedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc043-1-send-local-list-not-supported",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description: "TC_043.1 SendLocalList -> NotSupported (local list disabled).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "SendLocalList",
        listVersion: 1,
        updateType: "Full",
        localAuthorizationList: [{ idTag: "CERT-TAG-1" }],
      });
    } catch (err) {
      warnOpFailed("SendLocalList", err);
    }
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "SendLocalList", "SendLocalList.req received");
    assertResponseStatus(
      rec,
      frames,
      "SendLocalList",
      "NotSupported",
      "SendLocalList rejected as NotSupported (local list disabled)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_043.3 Send Local List -- Failed (pre-armed responseOverride).
// ---------------------------------------------------------------------------

export const tc0433SendLocalListFailedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc043-3-send-local-list-failed",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description: "TC_043.3 SendLocalList -> Failed (pre-armed override).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "SendLocalList",
        listVersion: 1,
        updateType: "Full",
        localAuthorizationList: [{ idTag: "CERT-TAG-1" }],
      });
    } catch (err) {
      warnOpFailed("SendLocalList", err);
    }
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "SendLocalList", "SendLocalList.req received");
    assertResponseStatus(
      rec,
      frames,
      "SendLocalList",
      "Failed",
      "SendLocalList rejected as Failed (pre-armed override)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_043.4 Send Local List -- Full Update.
// ---------------------------------------------------------------------------

export const tc0434SendLocalListFullSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc043-4-send-local-list-full",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description: "TC_043.4 SendLocalList(Full) -> Accepted.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "SendLocalList",
        listVersion: 1,
        updateType: "Full",
        localAuthorizationList: [{ idTag: "CERT-TAG-1" }],
      });
    } catch (err) {
      warnOpFailed("SendLocalList", err);
    }
  },
  assert({ frames, lines, rec }) {
    // Known SteVe quirk (confirmed live, ported from the bash spec's note):
    // a Full update sends the CP its *entire* known ocpp_tag table
    // regardless of which single tag is passed in addUpdateList -- only
    // Differential respects the single selection. Not asserting an exact
    // entry count here for that reason.
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"SendLocalList".*"updateType":"Full"/,
      "SendLocalList.req received with updateType Full",
    );
    assertResponseStatus(
      rec,
      frames,
      "SendLocalList",
      "Accepted",
      "SendLocalList (Full) accepted",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_043.5 Send Local List -- Differential Update (Full then Differential).
// ---------------------------------------------------------------------------

export const tc0435SendLocalListDifferentialSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc043-5-send-local-list-differential",
  ocppVersion: "OCPP-1.6J",
  tags: ["local-auth-list"],
  description: "TC_043.5 SendLocalList Full then Differential, both Accepted.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 18,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "SendLocalList",
        listVersion: 1,
        updateType: "Full",
        localAuthorizationList: [{ idTag: "CERT-TAG-1" }],
      });
    } catch (err) {
      warnOpFailed("SendLocalList (Full)", err);
    }
    await sleep(3000);
    try {
      await csms16.execute(cpId, {
        action: "SendLocalList",
        listVersion: 2,
        updateType: "Differential",
        localAuthorizationList: [{ idTag: "CERT-TAG-2" }],
      });
    } catch (err) {
      warnOpFailed("SendLocalList (Differential)", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineOrder(
      rec,
      lines,
      /Received: \[2,.*"SendLocalList".*"updateType":"Full"/,
      /Received: \[2,.*"SendLocalList".*"updateType":"Differential"/,
      "Full update precedes Differential update",
    );
    assertResponseStatus(
      rec,
      frames,
      "SendLocalList",
      "Accepted",
      "SendLocalList (Full) accepted",
      { occurrence: 0 },
    );
    // assertResponseStatus's occurrence index picks out the SECOND
    // (Differential) Received CALL for SendLocalList by position, then
    // pairs it to ITS OWN CALLRESULT by uniqueId -- upgrading the bash
    // predecessor's check_response_status_after (anchored-then-windowed
    // grep) to real per-exchange correlation.
    assertResponseStatus(
      rec,
      frames,
      "SendLocalList",
      "Accepted",
      "SendLocalList (Differential) accepted",
      { occurrence: 1 },
    );
    assertLineMatches(
      rec,
      lines,
      /"listVersion":2,"localAuthorizationList":\[\{"idTag":"CERT-TAG-2"/,
      "Differential update carries only the selected entry",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_046 Reservation (Basic).
// ---------------------------------------------------------------------------

export const reservationBasicSpec: ScenarioSpec<void> = {
  templateId: "cert16-reservation-basic",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation", "transaction"],
  description:
    "TC_046 Reservation (Basic): ReserveNow for CERT-RES01 accepted; that idTag arrives and starts a tx, charges, stops.",
  connector: 1,
  bootWaitSecs: 4,
  // settle(2) + delay-arrival(2) + bounded meter block(30) + tail.
  holdSecs: 45,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      // THE TAG THE TEMPLATE PRESENTS, because TC_046 is the RESERVED idTag
      // arriving. The template hard-codes CERT-RES01 for its start; until the
      // 0.10.1 simulator pin this reserved CERT-TAG-1, and the station started
      // the transaction anyway on a connector reserved for another tag. From
      // 0.10.0 it refuses to, as OCPP 1.6 section 5.13 has it, and the
      // scenario had been measuring that defect.
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-RES01",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      warnOpFailed("ReserveNow", err);
    }
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertReceived(rec, frames, "ReserveNow", "ReserveNow.req received");
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Accepted",
      "ReserveNow accepted",
    );
    // #186: the CP core now drives the connector Reserved through
    // updateConnectorStatus, so a StatusNotification(Reserved) reaches the
    // wire on Accepted (previously a bare `connector.status =` write left the
    // CSMS blind to the transition). assertLineAfter (not assertLineOrder):
    // the connector's post-boot Available always precedes ReserveNow, so anchor
    // on the ReserveNow exchange to confirm Reserved is the response to it.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ReserveNow"/,
      /Sent: \[2,.*"StatusNotification".*"status":"Reserved"/,
      "StatusNotification(Reserved) sent after ReserveNow accepted (#186)",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"StartTransaction".*"idTag":"CERT-RES01"/,
      "StartTransaction sent with the reserved idTag CERT-RES01",
    );
    assertSent(rec, frames, "StopTransaction", "StopTransaction sent");
    // TC_046 step 4, plus the reusable state "Charging" it executes at step 5
    // (reference section 3.22): Authorized + StatusNotification.conf x2 +
    // StartTransaction.conf. StartTransaction is covered as part of the
    // StatusNotification/Authorize pair below only if the CSMS answered it,
    // so it gets its own check.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "Authorize");
    assertAllAnswered(rec, frames, "StartTransaction");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    rec.pass(`DB: transaction row exists for ${cpId} (pk=${txPk})`);
    assertEq(
      rec,
      await records.transactionIdTag(txPk),
      "CERT-RES01",
      "DB: id_tag is CERT-RES01",
    );
    assertNonEmpty(
      rec,
      await records.transactionStopTimestamp(txPk),
      "DB: transaction is closed (stop_timestamp set)",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_048.1 ReserveNow -- Faulted.
// ---------------------------------------------------------------------------

export const tc0481ReserveNowFaultedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc048-1-reserve-now-faulted",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation"],
  description:
    "TC_048.1 ReserveNow -> Faulted (connector forced Faulted); resets to Available afterward.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      warnOpFailed("ReserveNow", err);
    }
  },
  assert({ frames, lines, rec }) {
    // Same correction as TC_024's identical StatusNotification node type: the
    // comment here claimed the two members were matched independently, and the
    // regex chained them with `.*`, which is an order (issue #44).
    assertCallPayload(
      rec,
      frames,
      "sent",
      "StatusNotification",
      { errorCode: "InternalError", status: "Faulted" },
      "connector forced Faulted before ReserveNow",
    );
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Faulted",
      "ReserveNow rejected as Faulted",
    );
    // assertLineAfter (not assertLineOrder): the connector's automatic
    // post-boot StatusNotification(Available) always precedes ReserveNow
    // trivially, so a first-occurrence order check would pass even without
    // a real post-ReserveNow reset. Confirm Available appears strictly
    // after the (last) ReserveNow exchange instead.
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ReserveNow"/,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "reset to Available follows the ReserveNow exchange",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_048.2 ReserveNow -- Occupied.
// ---------------------------------------------------------------------------

export const tc0482ReserveNowOccupiedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc048-2-reserve-now-occupied",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation"],
  description:
    "TC_048.2 ReserveNow -> Occupied (connector plugged in); plugs out and resets to Available afterward.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      warnOpFailed("ReserveNow", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Preparing"/,
      /Received: \[2,.*"ReserveNow"/,
      "connector Preparing before ReserveNow",
    );
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Occupied",
      "ReserveNow rejected as Occupied",
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ReserveNow"/,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "plug-out and reset to Available follow the ReserveNow exchange",
    );
    // TC_048.2 steps 2 and 6.
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_048.3 ReserveNow -- Unavailable.
// ---------------------------------------------------------------------------

export const tc0483ReserveNowUnavailableSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc048-3-reserve-now-unavailable",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation"],
  description:
    "TC_048.3 ReserveNow -> Unavailable (connector forced Unavailable); resets to Available afterward.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      warnOpFailed("ReserveNow", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineOrder(
      rec,
      lines,
      /Sent: \[2,.*"StatusNotification".*"status":"Unavailable"/,
      /Received: \[2,.*"ReserveNow"/,
      "connector Unavailable before ReserveNow",
    );
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Unavailable",
      "ReserveNow rejected as Unavailable",
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ReserveNow"/,
      /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
      "reset to Available follows the ReserveNow exchange",
    );
    // TC_048.3 steps 2 and 6.
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_048.4 ReserveNow -- Rejected.
// ---------------------------------------------------------------------------

export const tc0484ReserveNowRejectedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc048-4-reserve-now-rejected",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation"],
  description:
    "TC_048.4 ReserveNow -> Rejected (CP configured to not accept reservations).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    try {
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      warnOpFailed("ReserveNow", err);
    }
  },
  assert({ frames, rec }) {
    assertReceived(rec, frames, "ReserveNow", "ReserveNow.req received");
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Rejected",
      "ReserveNow rejected",
    );
  },
};

// ---------------------------------------------------------------------------
// TC_051 Cancel Reservation (Accepted).
// ---------------------------------------------------------------------------

interface CancelReservationDriveState {
  reservationPk: string;
}

export const tc051CancelReservationSpec: ScenarioSpec<CancelReservationDriveState> =
  {
    templateId: "cert16-tc051-cancel-reservation",
    ocppVersion: "OCPP-1.6J",
    tags: ["reservation"],
    description:
      "TC_051 Cancel Reservation: ReserveNow then CancelReservation for the reservation it just created, both Accepted.",
    connector: 1,
    bootWaitSecs: 4,
    holdSecs: 20,
    async drive({ cpId, records, csms16 }): Promise<CancelReservationDriveState> {
      await sleep(2000);
      try {
        await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT-TAG-1",
        expiryDate: inMinutes(10),
      });
      } catch (err) {
        warnOpFailed("ReserveNow", err);
      }

      // CSMS operation only confirms ReserveNow was QUEUED, not that SteVe has
      // finished writing the reservation row -- a one-shot read right after
      // queuing it can race the DB write and capture an empty/stale PK. Bound
      // the poll like the bash spec's wait_for_condition (15s/1s); a timeout
      // here throws and aborts the whole run, matching wait_for_condition's
      // `die` (fail-hard) semantics.
      const reservationPk = await waitForCondition(
        () => records.reservations.latest(cpId),
        {
          timeoutMs: 15_000,
          intervalMs: 1_000,
          description: `reservation row for ${cpId} exists`,
        },
      );

      try {
        await csms16.execute(cpId, { action: "CancelReservation", reservation: reservationPk });
      } catch (err) {
        warnOpFailed("CancelReservation", err);
      }

      return { reservationPk };
    },
    async assert({ frames, lines, rec, records, driveState }) {
      assertResponseStatus(
        rec,
        frames,
        "ReserveNow",
        "Accepted",
        "ReserveNow accepted",
      );
      assertResponseStatus(
        rec,
        frames,
        "CancelReservation",
        "Accepted",
        "CancelReservation accepted",
      );
      // #186: both reservation transitions are now OCPP-visible. ReserveNow
      // drives Reserved; CancelReservation flips it back to Available -- both
      // through updateConnectorStatus, so each emits a StatusNotification.req
      // the CSMS can see (this scenario previously sent nothing for either).
      assertLineAfter(
        rec,
        lines,
        /Received: \[2,.*"ReserveNow"/,
        /Sent: \[2,.*"StatusNotification".*"status":"Reserved"/,
        "StatusNotification(Reserved) sent after ReserveNow (#186)",
      );
      assertLineAfter(
        rec,
        lines,
        /Received: \[2,.*"CancelReservation"/,
        /Sent: \[2,.*"StatusNotification".*"status":"Available"/,
        "StatusNotification(Available) sent after CancelReservation (#186)",
      );
      // TC_051 steps 4 and 8. Before the DB block: the early return below
      // would otherwise skip this whenever the reservation id was not captured.
      assertAllAnswered(rec, frames, "StatusNotification");

      if (!driveState.reservationPk) {
        rec.fail(
          "DB: reservation id captured",
          "db_latest_reservation_pk returned empty",
        );
        return;
      }
      assertEq(
        rec,
        await records.reservations.status(driveState.reservationPk),
        "CANCELLED",
        `DB: reservation ${driveState.reservationPk} is CANCELLED`,
      );
    },
  };

// ---------------------------------------------------------------------------
// TC_052 Cancel Reservation -- Rejected (nonexistent reservationId, no
// override needed -- core CancelReservationHandler answers Rejected).
// ---------------------------------------------------------------------------

export const tc052CancelReservationRejectedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc052-cancel-reservation-rejected",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation"],
  description: "TC_052 CancelReservation(reservationId=99999) -> Rejected.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 12,
  async drive({ cpId, csms16 }) {
    await sleep(2000);
    // The reservationId is deliberately one the station does not have: the
    // scenario's whole point is that the CHARGE POINT answers Rejected. A CSMS
    // that validates the id server-side and never puts the request on the wire
    // cannot drive this, and says so in its scope table.
    try {
      await csms16.execute(cpId, {
        action: "CancelReservation",
        reservation: "99999",
      });
    } catch (err) {
      warnOpFailed("CancelReservation", err);
    }
  },
  assert({ frames, rec }) {
    assertReceived(
      rec,
      frames,
      "CancelReservation",
      "CancelReservation.req received",
    );
    assertResponseStatus(
      rec,
      frames,
      "CancelReservation",
      "Rejected",
      "CancelReservation rejected (nonexistent reservationId)",
    );
    // TC_052 step 4.
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_053 Use a reserved Connector with parentIdTag -- the CSMS reserves
// connector 1 for CERT053-RES with parentIdTag CERT053-GRP, and CERT053-CHILD,
// another tag of the same group, charges on it.
// ---------------------------------------------------------------------------

/**
 * The parent the CSMS put in the idTagInfo answering the first sent `action`
 * for `idTag`.
 *
 * WHY IT IS HERE, and not only implied by the start that follows. OCPP 1.6
 * §5.13 lets the reserved connector admit a tag whose parent equals the
 * reservation's, and the station learns a stranger's parent from the
 * Authorize.conf (§4.1: idTagInfo MAY carry it). A CSMS that leaves it out
 * makes the station refuse the start, and the checks downstream then say "no
 * StartTransaction" -- true, and silent about why. This check names the cause
 * on the row where it happens.
 *
 * The arguments are literals at the call site so ASSERT-INVENTORY.txt pins
 * them -- see the rejected-refactor note beside `assertIdTagInfoStatus` in
 * assert.ts for why this is not a predicate handed to a generic helper.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames. Not part of
 * the driver-author surface: tck/index.ts deliberately re-exports no specs.
 */
export function assertIdTagInfoParent(
  rec: AssertRecorder,
  frames: readonly Frame[],
  action: string,
  idTag: string,
  expectedParent: string,
  description: string,
): void {
  const call = findAllCalls(frames, "sent", action).find(
    (c) => (c.payload as { idTag?: unknown } | null)?.idTag === idTag,
  );
  if (!call) {
    rec.fail(description, `no sent ${action} for idTag ${idTag}`);
    return;
  }
  const response = findResponseFor(frames, call);
  if (!response || response.kind === "callerror") {
    rec.fail(
      description,
      !response
        ? `no response frame found for uniqueId=${call.uniqueId} (${action})`
        : `expected CALLRESULT, got CALLERROR ${response.errorCode}: ${response.errorDescription}`,
    );
    return;
  }
  const parent = (
    response.payload as { idTagInfo?: { parentIdTag?: unknown } } | null
  )?.idTagInfo?.parentIdTag;
  if (parent === expectedParent) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `idTagInfo.parentIdTag is ${parent === undefined ? "absent" : JSON.stringify(parent)}, expected ${expectedParent}`,
    );
  }
}

/**
 * The StartTransaction.req the station sent for `idTag` names the
 * reservationId of the ReserveNow.req the CSMS sent.
 *
 * A CHARGE-POINT behaviour (§5.13), checked because it is where this case
 * becomes observable: the station sends the id only when it admitted the tag
 * to the reservation, which for a tag other than the reserved one is only
 * through the parent the CSMS supplied. The reservationId is the CSMS's own
 * allocation, so it is compared to the request rather than written here.
 *
 * Exported ONLY so tests/cert16-gap-checks.ts can hand it frames.
 */
export function assertStartUsesReservation(
  rec: AssertRecorder,
  frames: readonly Frame[],
  idTag: string,
  description: string,
): void {
  const reserve = findAllCalls(frames, "received", "ReserveNow")[0];
  const reservationId = (reserve?.payload as { reservationId?: unknown } | null)
    ?.reservationId;
  if (reservationId === undefined) {
    rec.fail(description, "no received ReserveNow carrying a reservationId");
    return;
  }
  const start = findAllCalls(frames, "sent", "StartTransaction").find(
    (c) => (c.payload as { idTag?: unknown } | null)?.idTag === idTag,
  );
  if (!start) {
    rec.fail(
      description,
      `no sent StartTransaction for idTag ${idTag} -- the station refused the start on the connector reserved for another idTag`,
    );
    return;
  }
  const carried = (start.payload as { reservationId?: unknown }).reservationId;
  if (carried === reservationId) {
    rec.pass(description);
  } else {
    rec.fail(
      description,
      `StartTransaction.reservationId is ${JSON.stringify(carried)}, ReserveNow's was ${JSON.stringify(reservationId)}`,
    );
  }
}

export const tc053ReservedConnectorParentIdTagSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc053-reserved-connector-parent-idtag",
  ocppVersion: "OCPP-1.6J",
  tags: ["reservation", "authorization", "transaction"],
  description:
    "TC_053 Use a reserved Connector with parentIdTag: ReserveNow for CERT053-RES with parentIdTag CERT053-GRP accepted; CERT053-CHILD, of the same group, authorizes and charges on it.",
  // NO TEMPLATE: the pinned image ships none for TC_053, and the station side
  // is two commands -- start, then stop -- that drive() sends itself.
  runsSimTemplate: false,
  connector: 1,
  bootWaitSecs: 4,
  // What is left when drive() returns is the StopTransaction it sends last
  // and its answer, plus the trailing StatusNotifications: one round trip.
  holdSecs: 12,
  async drive({ cpId, connector, csms16, sim }) {
    await sleep(2000);
    try {
      // THE PARENT IS NAMED ON THE REQUEST because the case says the CSMS
      // sends one. A CSMS that derives it instead -- SteVe sends the reserved
      // tag's stored parent -- can drive this only when the two agree, and its
      // driver refuses otherwise; that refusal is an UnsupportedOperationError
      // and is rethrown below, so the row reads NOT APPLICABLE rather than as
      // a CSMS that never reserved.
      await csms16.execute(cpId, {
        action: "ReserveNow",
        connectorId: 1,
        idTag: "CERT053-RES",
        parentIdTag: "CERT053-GRP",
        expiryDate: inMinutes(10),
      });
    } catch (err) {
      if (err instanceof UnsupportedOperationError) throw err;
      warnOpFailed("ReserveNow", err);
    }
    // Long enough for the ReserveNow.conf and the Reserved StatusNotification
    // to go out before the station is asked to start.
    await sleep(3000);
    // A DIFFERENT TAG OF THE SAME GROUP, which is the case. The station does
    // not know CERT053-CHILD's parent, so it sends Authorize.req and reads the
    // parent from the answer before deciding whether the reservation admits it.
    await sim.send({
      command: "start_transaction",
      params: { connector, tagId: "CERT053-CHILD" },
    });
    await sleep(8000);
    // TEARDOWN, not part of the case: `runsSimTemplate: false` moves it here.
    await sim.send({ command: "stop_transaction", params: { connector } });
  },
  async assert({ cpId, frames, lines, rec, records }) {
    assertCallPayload(
      rec,
      frames,
      "received",
      "ReserveNow",
      { connectorId: 1, idTag: "CERT053-RES", parentIdTag: "CERT053-GRP" },
      "ReserveNow.req names connector 1 (not 0), CERT053-RES and parentIdTag CERT053-GRP",
    );
    assertResponseStatus(
      rec,
      frames,
      "ReserveNow",
      "Accepted",
      "ReserveNow accepted",
    );
    assertLineAfter(
      rec,
      lines,
      /Received: \[2,.*"ReserveNow"/,
      /Sent: \[2,.*"StatusNotification".*"status":"Reserved"/,
      "StatusNotification(Reserved) sent after ReserveNow accepted",
    );
    assertCallPayload(
      rec,
      frames,
      "sent",
      "Authorize",
      { idTag: "CERT053-CHILD" },
      "Authorize.req sent for CERT053-CHILD, a tag the reservation does not name",
    );
    assertIdTagInfoStatus(
      rec,
      frames,
      "Authorize",
      "Accepted",
      "Authorize for CERT053-CHILD answered Accepted",
    );
    assertIdTagInfoParent(
      rec,
      frames,
      "Authorize",
      "CERT053-CHILD",
      "CERT053-GRP",
      "Authorize.conf for CERT053-CHILD carries parentIdTag CERT053-GRP",
    );
    assertStartUsesReservation(
      rec,
      frames,
      "CERT053-CHILD",
      "StartTransaction for CERT053-CHILD carries the reservation's id",
    );
    assertIdTagInfoStatus(
      rec,
      frames,
      "StartTransaction",
      "Accepted",
      "StartTransaction on the reservation answered Accepted",
    );
    // TC_053 step 4, plus the reusable state "Charging" it executes at step 5
    // (reference section 3.22): Authorized + StatusNotification.conf x2 +
    // StartTransaction.conf.
    assertAllAnswered(rec, frames, "StatusNotification");
    assertAllAnswered(rec, frames, "Authorize");
    assertAllAnswered(rec, frames, "StartTransaction");

    const txPk = await records.latestTransaction(cpId);
    if (!txPk) {
      rec.fail(
        `DB: transaction row exists for ${cpId}`,
        "no transaction found",
      );
      return;
    }
    rec.pass(`DB: transaction row exists for ${cpId} (pk=${txPk})`);
    assertEq(
      rec,
      await records.transactionIdTag(txPk),
      "CERT053-CHILD",
      "DB: id_tag is CERT053-CHILD",
    );
  },
};

// See specs/core.ts's CORE_SPECS comment: ScenarioSpec<D> is effectively
// invariant in D, so a single array holding specs with different
// driveState types needs `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AUTHLIST_RESERVATION_SPECS: ScenarioSpec<any>[] = [
  tc0421GetLocalListVersionNotSupportedSpec,
  tc0422GetLocalListVersionEmptySpec,
  tc0431SendLocalListNotSupportedSpec,
  tc0433SendLocalListFailedSpec,
  tc0434SendLocalListFullSpec,
  tc0435SendLocalListDifferentialSpec,
  reservationBasicSpec,
  tc0481ReserveNowFaultedSpec,
  tc0482ReserveNowOccupiedSpec,
  tc0483ReserveNowUnavailableSpec,
  tc0484ReserveNowRejectedSpec,
  tc051CancelReservationSpec,
  tc052CancelReservationRejectedSpec,
  tc053ReservedConnectorParentIdTagSpec,
];
