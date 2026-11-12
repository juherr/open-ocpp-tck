/**
 * scope.ts -- what EVtivity can drive, one row per OCPP 1.6 scenario.
 *
 * EVtivity also serves OCPP 2.0.1, but this driver declares
 * `protocols: ["OCPP-1.6J"]` (index.ts), so every `cert201-` scenario is NOT
 * APPLICABLE through that declaration and needs no row here -- tck/scope.ts's
 * rule.
 *
 * Every status below is read off what the REST API can EXPRESS at v0.1.51 and
 * off the step 0 spike, not off a sweep: the first live sweep is what turns a
 * DRIVABLE row green or red, and a red one goes to expected.ts with its
 * evidence, never back here as a demotion. Every operation travels its own
 * route, `POST /v1/ocpp/commands/v16/{Action}`, which forwards the OCPP payload
 * this driver builds and answers with the station's response; every record
 * comes from the session routes (records.ts).
 */
import type { ScopeTable } from "../../tck/scope";
export declare const EVTIVITY_SCOPE: ScopeTable;
