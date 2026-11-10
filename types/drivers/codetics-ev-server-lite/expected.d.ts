/**
 * expected.ts -- the scenarios this CSMS drives and is known to get wrong.
 *
 * ONE ENTRY, AND MEASURED: an entry is a finding, and a finding needs the run
 * that produced it. The two sweeps of 2026-11-10 at the pinned commit gave no
 * FAIL and no ERROR (README.md's "Coverage"); the one entry below comes from a
 * scenario added after them, run on its own the same day. A red row of a
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
export declare const EVSL_EXPECTED_FAILURES: ExpectedFailureTable;
