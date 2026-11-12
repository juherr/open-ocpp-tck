// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * expected.ts -- the scenarios EVtivity drives and is known to get wrong.
 *
 * MEASURED, AND EMPTY: an entry is a finding, and a finding needs the run that
 * produced it. The first sweep, 2026-11-12 at the pinned images, gave no FAIL
 * and no ERROR (README.md's "Coverage"). A red row of a later sweep is read
 * from its trace and classified -- a fault in this driver is fixed here, a
 * deviation of the CSMS gets an entry below whose `reason` names the mechanism
 * and whose `finding` points at the deviations section of this driver's
 * README.
 *
 * NEVER for a red that depends on the run order. EVtivity's first-boot
 * configuration push and its offline-command queue both act once per station
 * rather than once per scenario, so a row they turn red is red for whichever
 * scenario ran first on that cp id -- an entry would fail the sweep as
 * UNEXPECTED PASS the next time the order changed. Those are handled where they
 * arise: the push by the scenario selecting its own request, the queue by the
 * settings compose.yaml seeds.
 *
 * A scenario declared here keeps its DRIVABLE scope row and still prints FAIL;
 * one that passes fails the sweep as UNEXPECTED PASS. CONTRIBUTING.md's
 * "Expected failures" has the rules.
 */
import type { ExpectedFailureTable } from "../../tck/expected";

export const EVTIVITY_EXPECTED_FAILURES: ExpectedFailureTable = {};
