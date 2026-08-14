/**
 * specs/firmware.ts -- typed port of the "Firmware" bash specs
 * (scripts/steve-verify/specs/cert16-{tc044-1,tc044-2,tc044-3,tc045-1}-*.spec.sh),
 * mirroring run-all.sh's FIRMWARE array exactly (4 scenarios). Each spec
 * asserts AT LEAST what its bash predecessor asserted.
 */

import {
  assertAllAnswered,
  assertLineMatches,
  assertLineOrder,
  assertNoLineMatches,
  assertReceived,
} from "../assert";
import type { ScenarioSpec } from "../spec-types";
import { inSeconds } from "../time";
import { sleep } from "../util";

function warnOpFailed(op: string, err: unknown): void {
  process.stderr.write(
    `[runner] WARN: CSMS operation ${op} failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
  );
}

// ---------------------------------------------------------------------------
// The assertAllAnswered calls below are the whole of issue #11, and this file
// is where it was found. OCA TC_044_{1,2,3}_CSMS put "The Central responds
// with a FirmwareStatusNotification.conf" on the Central System at steps 4, 6,
// 10 and 16; the assertions above them check only the statuses the CHARGE
// POINT sent, so a CSMS answering every one with a CALLERROR passed. It is not
// a hypothetical: that is what these scenarios did.
//
// The checks are per ACTION, not per numbered step, which is why the reboot
// steps (TC_044.1 and .3, steps 11-14) need no special handling: the
// obligation is "the Central System answers BootNotification.req", and
// asserting it over every BootNotification the run produced is both simpler
// and stricter than tying it to one step that may or may not be reached.
//
// OCA-COVERAGE.md is the table these come from.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TC_044.1 Firmware Update -- Download and Install -- CSMS sends
// UpdateFirmware.req; the CP genuinely waits until wall-clock retrieveDate
// before starting the FirmwareStatusNotification train (confirmed live in
// the bash suite: this is correct OCPP 1.6 semantics, not a bug), then
// progresses Downloading -> Downloaded -> Installing -> Installed.
//
// THE OFFSET IS SMALL ON PURPOSE, and the three TC_044 scenarios below share
// the reason. A driver may only round a retrieveDate UP -- the contract says
// so, because a CSMS whose form has no seconds field must still receive a
// strictly future instant -- so the CP can wait up to a whole resolution step
// LONGER than asked. SteVe's UpdateFirmware form is minute-resolution, which
// makes the real wait `offset + up to 60s`. At the +90s this used to ask for,
// that is up to 150s against a 115s window: the scenario passed or failed on
// where the wall clock happened to sit within the minute, and the three ran
// back to back at a ~120s period, so they drew the same unlucky phase together.
//
// Budget, which any edit here has to keep: offset + 60s of driver rounding +
// ~10s of status train + tail buffer <= holdSecs.
// ---------------------------------------------------------------------------

export const tc0441FirmwareUpdateSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc044-1-firmware-update",
  description:
    "TC_044.1 Firmware Update: full Downloading -> Downloaded -> Installing -> Installed train.",
  connector: 1,
  bootWaitSecs: 4,
  // 15s + up to 60s of rounding + ~10s train, inside a 115s window.
  holdSecs: 115,
  async drive({ cpId, csms }) {
    await sleep(2000);
    try {
      await csms.execute(cpId, {
        action: "UpdateFirmware",
        location: "http://example.com/fw.bin",
        retrieveDate: inSeconds(15),
      });
    } catch (err) {
      warnOpFailed("UpdateFirmware", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Received: \[2,.*"UpdateFirmware"/,
      "UpdateFirmware.req received",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Downloading"/,
      "Downloading sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Downloaded"/,
      "Downloaded sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Installing"/,
      "Installing sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Installed"/,
      "Installed sent",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Downloading"/,
      /"status":"Downloaded"/,
      "Downloading precedes Downloaded",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Downloaded"/,
      /"status":"Installing"/,
      "Downloaded precedes Installing",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Installing"/,
      /"status":"Installed"/,
      "Installing precedes Installed",
    );
    // TC_044.1 steps 4, 6, 8, 10, 12, 14, 16.
    assertAllAnswered(rec, frames, "FirmwareStatusNotification");
    assertAllAnswered(rec, frames, "BootNotification");
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_044.2 Firmware Update -- Download Failed -- the scenario arms
// SimulatedFirmwareUpdateFailure=DownloadFailed via a configSet node before
// parking (nothing for drive() to arm); CSMS sends UpdateFirmware.req; CP
// sends Downloading then DownloadFailed and stops -- Installing/Installed
// are never reached.
// ---------------------------------------------------------------------------

export const tc0442FirmwareDownloadFailedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc044-2-firmware-download-failed",
  description:
    "TC_044.2 Firmware Update — Download Failed: stops after DownloadFailed, Installing/Installed never reached.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 110,
  async drive({ cpId, csms }) {
    await sleep(2000);
    try {
      await csms.execute(cpId, {
        action: "UpdateFirmware",
        location: "http://example.com/fw.bin",
        retrieveDate: inSeconds(15),
      });
    } catch (err) {
      warnOpFailed("UpdateFirmware", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Downloading"/,
      "Downloading sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"DownloadFailed"/,
      "DownloadFailed sent",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Downloading"/,
      /"status":"DownloadFailed"/,
      "Downloading precedes DownloadFailed",
    );
    // Never-reached negative assertions -- deliberately kept (not merely
    // "no CALLRESULT" but "the status train stops here"), same as the bash
    // spec: DownloadFailed is a terminal failure state for this scenario.
    assertNoLineMatches(
      rec,
      lines,
      /"status":"Installing"/,
      "Installing never reached",
    );
    assertNoLineMatches(
      rec,
      lines,
      /"status":"Installed"/,
      "Installed never reached",
    );
    // TC_044.2 steps 4 and 6. This case mandates nothing else: it has no
    // reboot, so no BootNotification/StatusNotification obligation.
    assertAllAnswered(rec, frames, "FirmwareStatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_044.3 Firmware Update -- Installation Failed -- the scenario arms
// SimulatedFirmwareUpdateFailure=InstallationFailed via a configSet node
// before parking; CSMS sends UpdateFirmware.req; CP progresses Downloading
// -> Downloaded -> Installing, then sends InstallationFailed instead of
// Installed.
// ---------------------------------------------------------------------------

export const tc0443FirmwareInstallFailedSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc044-3-firmware-install-failed",
  description:
    "TC_044.3 Firmware Update — Installation Failed: full download train, then InstallationFailed instead of Installed.",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 115,
  async drive({ cpId, csms }) {
    await sleep(2000);
    try {
      await csms.execute(cpId, {
        action: "UpdateFirmware",
        location: "http://example.com/fw.bin",
        retrieveDate: inSeconds(15),
      });
    } catch (err) {
      warnOpFailed("UpdateFirmware", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Downloading"/,
      "Downloading sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Downloaded"/,
      "Downloaded sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"Installing"/,
      "Installing sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"FirmwareStatusNotification".*"status":"InstallationFailed"/,
      "InstallationFailed sent",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Downloading"/,
      /"status":"Downloaded"/,
      "Downloading precedes Downloaded",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Downloaded"/,
      /"status":"Installing"/,
      "Downloaded precedes Installing",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Installing"/,
      /"status":"InstallationFailed"/,
      "Installing precedes InstallationFailed",
    );
    // Never-reached negative: Installed is the success terminal state, and
    // this scenario's arm forces failure at Install time instead -- ported
    // verbatim as its own assertion, not folded into the order check above.
    assertNoLineMatches(
      rec,
      lines,
      /"status":"Installed"/,
      "Installed (success terminal state) never reached",
    );
    // TC_044.3 steps 4, 6, 8, 10, 12, 14, 16.
    assertAllAnswered(rec, frames, "FirmwareStatusNotification");
    assertAllAnswered(rec, frames, "BootNotification");
    assertAllAnswered(rec, frames, "StatusNotification");
  },
};

// ---------------------------------------------------------------------------
// TC_045.1 Get Diagnostics -- CSMS sends GetDiagnostics.req with an upload
// location; CP responds with a fileName and sends
// DiagnosticsStatusNotification (Uploading, then Uploaded/UploadFailed
// depending on the HTTP response).
//
// Hermetic target (preserved from the bash spec, deliberate): SteVe's
// GetDiagnosticsHandler really does `fetch()` the location (unlike
// UpdateFirmware, which never dereferences its `location`), so this spec's
// target must stay reachable-but-failing without any real DNS/egress
// dependency. `http://app:9/upload` -- SteVe's own app container, port 9 has
// nothing listening -- gets an instant, deterministic connection-refused on
// the steve_default docker network (no external network needed at all), so
// UploadFailed is the EXPECTED and hermetic outcome here, not a defect.
// ---------------------------------------------------------------------------

export const tc0451GetDiagnosticsSpec: ScenarioSpec<void> = {
  templateId: "cert16-tc045-1-get-diagnostics",
  description:
    "TC_045.1 Get Diagnostics: fileName returned, Uploading -> UploadFailed (hermetic unreachable target).",
  connector: 1,
  bootWaitSecs: 4,
  holdSecs: 25,
  async drive({ cpId, csms }) {
    await sleep(2000);
    try {
      await csms.execute(cpId, { action: "GetDiagnostics", location: "http://app:9/upload" });
    } catch (err) {
      warnOpFailed("GetDiagnostics", err);
    }
  },
  assert({ frames, lines, rec }) {
    assertReceived(
      rec,
      frames,
      "GetDiagnostics",
      "GetDiagnostics.req received",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[3,.*"fileName":"diagnostics\.txt"/,
      "GetDiagnostics.conf returns fileName",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"DiagnosticsStatusNotification".*"status":"Uploading"/,
      "DiagnosticsStatusNotification(Uploading) sent",
    );
    assertLineMatches(
      rec,
      lines,
      /Sent: \[2,.*"DiagnosticsStatusNotification".*"status":"UploadFailed"/,
      "DiagnosticsStatusNotification(UploadFailed) sent (unreachable location, expected outcome)",
    );
    assertLineOrder(
      rec,
      lines,
      /"status":"Uploading"/,
      /"status":"UploadFailed"/,
      "Uploading precedes UploadFailed",
    );
    // TC_045.1 steps 4 and 6.
    assertAllAnswered(rec, frames, "DiagnosticsStatusNotification");
  },
};

export const FIRMWARE_SPECS: ScenarioSpec<void>[] = [
  tc0441FirmwareUpdateSpec,
  tc0442FirmwareDownloadFailedSpec,
  tc0443FirmwareInstallFailedSpec,
  tc0451GetDiagnosticsSpec,
];
