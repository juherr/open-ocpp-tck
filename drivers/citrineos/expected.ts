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
 * EMPTY AT THE PINNED DIGEST, and kept rather than deleted: the mechanism is
 * the driver contract's, and the day a row is needed again this is where it
 * goes. It held four rows against `v2.0.0-beta3`, and all four closed when
 * the pin moved to `v2.0.0-beta4` -- `cert16-tc023-3-authorize-blocked`, a
 * stored `Blocked` answered `Invalid` because the 1.6 Authorize handler
 * reached its status mapper only through its Accepted branch
 * (citrineos-core#907), and `cert16-tc044-{1,2,3}`, every 1.6
 * `FirmwareStatusNotification` answered with a `NotSupported` CALLERROR
 * because no request handler existed (citrineos-core#890). Each came back
 * UNEXPECTED PASS on the new digest, which is the exit this table is designed
 * to have: a row leaves by turning green and failing the build until it is
 * deleted, never by being forgotten. The history lives in
 * drivers/citrineos/README.md's gap table, marked fixed.
 *
 * WHEN A ROW COMES BACK, THE MECHANISM SENTENCE LIVES HERE and scope.ts
 * imports it, the same way variant.ts owns NO_RESERVATIONS for both scope.ts
 * and requests.ts. The two halves a reader compares -- "this row is drivable,
 * and here is what the CSMS does with it" and "this row is expected to fail,
 * and here is why" -- must not be free to disagree.
 */
import type { ExpectedFailureTable } from "../../tck/expected";
import type { CitrineVariant } from "./variant";

const V2_EXPECTED_FAILURES: ExpectedFailureTable = {};

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
