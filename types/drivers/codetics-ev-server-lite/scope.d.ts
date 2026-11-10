/**
 * scope.ts -- what this CSMS can drive, one row per OCPP 1.6 scenario.
 *
 * The server speaks OCPP 1.6J only (its WebSocket handler advertises the
 * `ocpp1.6` subprotocol and nothing else), and index.ts declares
 * `protocols: ["OCPP-1.6J"]`, so every `cert201-` scenario is NOT APPLICABLE
 * through that declaration and needs no row here -- tck/scope.ts's rule.
 *
 * Every status below is read off what the admin API can EXPRESS at the pinned
 * commit, not off a run: the first live sweep is what turns a DRIVABLE row
 * green or red, and a red one goes to expected.ts with its evidence, never
 * back here as a demotion. Every operation travels one route,
 * `POST /api/v1/stations/{id}/commands`, which forwards the OCPP payload this
 * driver builds; every record comes from `GET /api/v1/transactions`.
 */
import type { ScopeTable } from "../../tck/scope";
export declare const EVSL_SCOPE: ScopeTable;
