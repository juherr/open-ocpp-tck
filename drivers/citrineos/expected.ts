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

const V2_EXPECTED_FAILURES: ExpectedFailureTable = {
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
