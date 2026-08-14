// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * expected.ts -- the scenarios CitrineOS is known to fail, and where each
 * finding is written down.
 *
 * The counterpart of scope.ts, not a part of it. A row here is DRIVABLE, runs,
 * starts a container and prints FAIL; what it does not do is end the build.
 * tck/scope.ts forbids demoting such a row to NOT_APPLICABLE -- that would turn
 * a finding about CitrineOS into a silence about the harness -- and before this
 * file the only alternative was `continue-on-error` on the whole CI job, which
 * muted the other 46 scenarios along with the one finding.
 *
 * THE MECHANISM SENTENCE LIVES HERE and scope.ts imports it, the same way
 * variant.ts owns NO_RESERVATIONS for both scope.ts and requests.ts. The two
 * halves a reader compares -- "this row is drivable, and here is what the CSMS
 * does with it" and "this row is expected to fail, and here is why" -- must not
 * be free to disagree.
 */
import type { ExpectedFailureTable } from "../../tck/expected";
import type { CitrineVariant } from "./variant";

/**
 * Why a stored `Blocked` idTag comes back `Invalid`, worded once.
 *
 * Read in the sources and confirmed on the running image, 3 runs out of 3:
 * `AuthorizeRequestOcpp16Handler` reaches its status mapper only through the
 * `status === Accepted` branch, so a stored `Blocked` falls through to the
 * default `Invalid`. The only route to a real `Blocked` is an `IAuthorizer`,
 * and `container.ts` registers `authorizers: asValue([])` with no setting that
 * changes it.
 */
export const BLOCKED_UNREACHABLE =
  "CitrineOS reaches its Authorize status mapper only through the " +
  "`status === Accepted` branch of AuthorizeRequestOcpp16Handler, so a stored " +
  "Blocked falls through to the default Invalid. The only route to a real " +
  "Blocked is an IAuthorizer, and container.ts registers " +
  "`authorizers: asValue([])` with no setting that changes it.";

/**
 * Why every FirmwareStatusNotification the charge point sends comes back as a
 * CALLERROR, worded once.
 *
 * Read in the sources and confirmed on the running image: CitrineOS registers
 * no 1.6 REQUEST handler for FirmwareStatusNotification --
 * `packages/core/src/handlers/requests/1.6/` has one for
 * DiagnosticsStatusNotification and none for this -- so the router answers
 * `[4,…,"NotSupported","No handler found for action: FirmwareStatusNotification
 * at module configuration"]`. Ten of them across the three TC_044 logs of a
 * sequential sweep, and the only CALLERROR the CSMS emits anywhere in the
 * suite.
 */
export const FIRMWARE_STATUS_NOT_HANDLED =
  "CitrineOS registers no 1.6 request handler for FirmwareStatusNotification, " +
  "so its router answers every one with " +
  '`[4,…,"NotSupported","No handler found for action: ' +
  'FirmwareStatusNotification at module configuration"]`. OCA ' +
  "TC_044_{1,2,3}_CSMS put the answer on the Central System -- \"The Central " +
  'responds with a FirmwareStatusNotification.conf" -- and a CALLERROR is not ' +
  "that conf.";

/** Where the TC_044 finding is written down, worded once for all three rows. */
const FIRMWARE_FINDING =
  'drivers/citrineos/README.md, gap table row "No 1.6 request handler for ' +
  'FirmwareStatusNotification". Upstream citrineos/citrineos#216.';

/**
 * None of the three TC_044 rows is a flake, which is the one thing this table
 * may never be used to quiet: the handler is absent, not intermittent. Why
 * they all arrived at once is in scope.ts, on the rows themselves.
 */
const V2_EXPECTED_FAILURES: ExpectedFailureTable = {
  "cert16-tc044-1-firmware-update": {
    reason:
      `${FIRMWARE_STATUS_NOT_HANDLED} The scenario drives the full Downloading -> Downloaded -> Installing -> Installed train and asserts all four answers; all four are CALLERRORs.`,
    finding: FIRMWARE_FINDING,
  },
  "cert16-tc044-2-firmware-download-failed": {
    reason:
      `${FIRMWARE_STATUS_NOT_HANDLED} The scenario stops at DownloadFailed, so it asserts two answers; both are CALLERRORs.`,
    finding: FIRMWARE_FINDING,
  },
  "cert16-tc044-3-firmware-install-failed": {
    reason:
      `${FIRMWARE_STATUS_NOT_HANDLED} The scenario runs to InstallationFailed and asserts four answers; all four are CALLERRORs. 10 of its 11 checks pass, which makes this the clearest reading of the finding in the suite.`,
    finding: FIRMWARE_FINDING,
  },
  "cert16-tc023-3-authorize-blocked": {
    reason:
      `${BLOCKED_UNREACHABLE} The scenario requires Blocked and gets ` +
      '{"idTagInfo":{"status":"Invalid"}} -- deterministic, 3 runs out of 3. ' +
      "A finding against CitrineOS, not a gap in this driver.",
    finding:
      "drivers/citrineos/README.md, gap table row \"Blocked is unreachable " +
      'from the 1.6 Authorize path". OCA TC_023.3 marks the behaviour M for ' +
      "the Central System. No upstream ticket.",
  },
};

/**
 * DELIBERATELY EMPTY for the v1.9.1 line, and the emptiness is a claim about
 * evidence rather than about CitrineOS.
 *
 * v1 fails far more than v2 -- 16 of 47 on 2026-08-11, nearly all of them
 * through upstream citrineos/citrineos#160, which scope.ts's V1_KNOWN
 * describes. But that measurement has not been repeated since, and CI never
 * runs this line, so nothing would ever report one of those entries as an
 * UNEXPECTED PASS. An expected-failure list that no run can shrink is exactly
 * the rot this mechanism exists to replace: it would read as sixteen reviewed
 * findings while being one stale snapshot.
 *
 * So on v1 every failure stays a failure. Whoever puts that line back under a
 * sweep gets the honest list from the run, and can fill this in from it.
 */
const V1_EXPECTED_FAILURES: ExpectedFailureTable = {};

/** The expected-failure list for a declared variant. See variant.ts. */
export function citrineosExpectedFailures(
  variant: CitrineVariant,
): ExpectedFailureTable {
  return variant === "v2" ? V2_EXPECTED_FAILURES : V1_EXPECTED_FAILURES;
}
