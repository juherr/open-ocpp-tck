/**
 * scope.ts -- what SteVe can drive: every OCPP 1.6 scenario, and no OCPP 2.0.1
 * one.
 *
 * The 1.6 half is not padding. It is the regression guard on the whole
 * generalization: the scenarios were WRITTEN against SteVe, so if making the
 * harness CSMS-neutral had dropped a capability, the loss would surface here
 * as a row that had to be demoted to NOT_APPLICABLE. Every one of them still
 * says DRIVABLE, which is what turns "the refactor kept everything working"
 * from a claim into something a reader can check row by row.
 *
 * SteVe declares support for OCPP-1.6J only, so runtime marks 2.0.1 cases
 * NOT_APPLICABLE even if an individual row is absent. The explicit 2.0.1 rows
 * remain useful as reviewable reasons in check-driver output and scope data.
 *
 * A driver for a CSMS with a smaller API says so row by row, citing the
 * precise limitation -- see tck/scope.ts for the rules.
 */
import type { ScopeTable } from "../../tck/scope";
export declare const STEVE_SCOPE: ScopeTable;
