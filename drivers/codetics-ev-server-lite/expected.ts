// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * expected.ts -- the scenarios this CSMS drives and is known to get wrong.
 *
 * MEASURED: an entry is a finding, and a finding needs the run that produced
 * it. The two sweeps of 2026-11-10 at the pinned commit gave no FAIL and no
 * ERROR (README.md's "Coverage"); the entries below come from scenarios added
 * after them, each run on its own. A red row of a
 * later sweep is read from its trace and classified -- a fault in this driver
 * is fixed here, a deviation of the CSMS gets an entry below whose `reason`
 * names the mechanism and whose `finding` points at the deviations section of
 * this driver's README.
 *
 * A scenario declared here keeps its DRIVABLE scope row and still prints FAIL;
 * one that passes fails the sweep as UNEXPECTED PASS. CONTRIBUTING.md's
 * "Expected failures" has the rules.
 */
import type { ExpectedFailureTable } from "../../tck/expected";

export const EVSL_EXPECTED_FAILURES: ExpectedFailureTable = {
  "cert16-spec48-start-transaction-busy-connector": {
    reason:
      "OcppService#start answers a StartTransaction.req for a connector that " +
      "already has an open transaction with CALLERROR GenericError (\"Une " +
      "session est déjà en cours sur ce connecteur.\", ocpp/OcppService.kt:452-460) " +
      "unless it is a resend of that transaction (same tag, timestamp and " +
      "meterStart), where OCPP 1.6 §4.8 has the Central System answer with a " +
      "StartTransaction.conf whatever its own checks conclude.",
    finding:
      "drivers/codetics-ev-server-lite/README.md, Deviations: " +
      "\"StartTransaction on a busy connector\"",
  },
};
