#!/usr/bin/env bun
/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/main.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: the STEVE_DRIVER=api|ui selection is replaced by a CSMS driver loaded through ./driver-registry; a per-driver scope table (./scope) is consulted BEFORE any container starts and yields the NOT APPLICABLE verdict; UnsupportedOperationError (./driver) thrown out of drive() degrades to NOT APPLICABLE with a stderr WARNING; the PARTIAL verdict and the `skipped` summary column were added; the exit code is non-zero only for FAIL/ERROR; parallel lanes derive from the resolved station list instead of the fixed CERTCP1..3 trio; the SteVe capability probe is dropped.
 *
 * main.ts -- TypeScript OCPP conformance runner CLI.
 *
 * Usage: ocpp-tck run <template-id> [--cp CP1] [--timeout N] [--connector N]
 *        ocpp-tck run --group core|authlist-reservation|remotetrigger-smartcharging|firmware|authorize|core-201|all [--parallel]
 *        ocpp-tck run-all [--group <name>] [--parallel]
 *
 * Brings its own simulator container up (sim.ts), drives it over the JSON
 * Lines stdin protocol, captures its full stdout, parses OCPP-J frames
 * (ocpp.ts) and runs the named spec's drive()/assert() against a live CSMS
 * through the loaded CSMS driver.
 *
 * Two verdicts beyond the upstream PASS/FAIL/ERROR trio:
 *   - NOT APPLICABLE -- the scope table (scope.ts) marks the scenario
 *     NOT_APPLICABLE for this CSMS, or the driver threw
 *     UnsupportedOperationError out of drive(). No container is started in
 *     the first case. Exit code 0.
 *   - PARTIAL -- zero FAILs but at least one check degraded to SKIPPED,
 *     either because this driver could not evaluate it (UNVERIFIABLE) or
 *     because the scenario never makes the request the OCA case obliges the
 *     CSMS to answer (UNEXERCISED). Both are orange: neither is a defect of
 *     the CSMS under test, and neither fails the sweep. Which of the two it
 *     was is in the check's detail, printed under the SKIPPED line.
 *     Exit code 0: a check that could not be evaluated is not a defect.
 *
 * The verdict is what the CSMS did; the EXIT CODE is what that means for this
 * driver, and the two stopped being the same thing when expected.ts arrived.
 * A FAIL the driver declared expected exits 0 -- it is a finding already
 * written down, not news -- and a PASS it declared expected exits 1, because
 * a list that cannot shrink is a mute. An ERROR is never excused: a
 * declaration covers what a CSMS ANSWERS, and an ERROR is the scenario never
 * getting an answer. So:
 *
 *   exit non-zero  <=  an undeclared FAIL/ERROR, or a declared scenario that
 *                      passed, or a declared scenario that errored.
 *
 * The rule itself lives in ./standing, where it is a pure function and a guard
 * can assert the whole table without a container. A driver that declares
 * nothing keeps the original rule exactly.
 */
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
