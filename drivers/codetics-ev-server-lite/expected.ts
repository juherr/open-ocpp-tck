// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * expected.ts -- the scenarios this CSMS drives and is known to get wrong.
 *
 * EMPTY UNTIL THE FIRST LIVE SWEEP, and on purpose: an entry is a finding, and
 * a finding needs the run that produced it. Each red row of that sweep is read
 * from its trace and classified -- a fault in this driver is fixed here, a
 * deviation of the CSMS gets an entry below whose `reason` names the mechanism
 * and whose `finding` points at the gap table in this driver's README.
 *
 * A scenario declared here keeps its DRIVABLE scope row and still prints FAIL;
 * one that passes fails the sweep as UNEXPECTED PASS. CONTRIBUTING.md's
 * "Expected failures" has the rules.
 */
import type { ExpectedFailureTable } from "../../tck/expected";

export const EVSL_EXPECTED_FAILURES: ExpectedFailureTable = {};
