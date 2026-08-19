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
 * The 2.0.1 rows are the opposite kind of fact and cost that guard nothing:
 * SteVe implements OCPP 1.6 and nothing else, so no capability of ours could
 * have been dropped to produce them. They are here one per scenario because
 * there is deliberately no protocol-level way to decline in one line -- the
 * note above `scopeCoverage` in tck/scope.ts has the argument.
 *
 * A driver for a CSMS with a smaller API says so row by row, citing the
 * precise limitation -- see tck/scope.ts for the rules.
 */
import type { ScopeTable } from "../../tck/scope";
export declare const STEVE_SCOPE: ScopeTable;
