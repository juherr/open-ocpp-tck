#!/usr/bin/env bun
import type { CsmsEnv } from "./driver";
/**
 * Charge points a sweep round-robins over, so adjacent scenarios don't
 * collide on the same station's transaction state. Upstream hardcoded the
 * CERTCP1..3 trio provisioned by its own SteVe bootstrap; here the list is
 * whatever the CSMS actually has registered, and the parallel lane count is
 * derived from it -- one station means one lane, i.e. sequential.
 */
export declare function resolveStations(env?: CsmsEnv): string[];
/**
 * The whole CLI, as a function of argv, RETURNING an exit code.
 *
 * The single `process.exit` for a completed run lives in bin/ocpp-tck.ts, not
 * here: this module is also imported as a library (`open-ocpp-tck/runner`),
 * and a library that can terminate its host process is not one.
 */
export declare function cli(argv: string[]): Promise<number>;
