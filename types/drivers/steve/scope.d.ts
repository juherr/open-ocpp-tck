/**
 * scope.ts -- what SteVe can drive: everything.
 *
 * This table is not padding. It is the regression guard on the whole
 * generalization: the scenarios were WRITTEN against SteVe, so if making the
 * harness CSMS-neutral had dropped a capability, the loss would surface here
 * as a row that has to be demoted to NOT_APPLICABLE.
 * tests/ocpp-verify-scope-coverage.sh asserts that no row ever is, which turns
 * "the refactor kept everything working" from a claim into a check.
 *
 * A driver for a CSMS with a smaller API says so row by row, citing the
 * precise limitation -- see tck/scope.ts for the rules.
 */
import type { ScopeTable } from "../../tck/scope";
export declare const STEVE_SCOPE: ScopeTable;
