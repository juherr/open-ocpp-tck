#!/usr/bin/env bun
// Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/main.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: the STEVE_DRIVER=api|ui selection is replaced by a CSMS driver loaded through ./driver-registry; a per-driver scope table (./scope) is consulted BEFORE any container starts and yields the NOT APPLICABLE verdict; UnsupportedOperationError (./driver) thrown out of drive() degrades to NOT APPLICABLE with a stderr WARNING; the PARTIAL verdict and the `skipped` summary column were added; the exit code is non-zero only for FAIL/ERROR; parallel lanes derive from the resolved station list instead of the fixed CERTCP1..3 trio; the SteVe capability probe is dropped.

/**
 * main.ts -- TypeScript OCPP conformance runner CLI.
 *
 * Usage: ocpp-tck run <template-id> [--cp CP1] [--timeout N] [--connector N]
 *        ocpp-tck run --group core|authlist-reservation|remotetrigger-smartcharging|firmware|authorize|all [--parallel]
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
 *   - PARTIAL -- zero FAILs but at least one check degraded to SKIPPED
 *     because the driver answered with assert.ts's UNVERIFIABLE sentinel.
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

import { mkdirSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { resolve } from "node:path";
import { AssertRecorder } from "./assert";
import {
  CSMS_OPERATION_ACTIONS,
  driverCapabilities,
  driverExpectedFailures,
  driverScope,
  UnsupportedOperationError,
} from "./driver";
import { loadDriverModule } from "./driver-registry";
import {
  expectedFailureCoverage,
  expectedFailureFor,
  type ExpectedFailureEntry,
  type ExpectedFailureTable,
} from "./expected";
import {
  scopeCoverage,
  templateIdsWithStatus,
  type ScopeStatus,
  type ScopeTable,
} from "./scope";
import {
  declaredButErroredDetail,
  effectivelyFailed,
  endsTheBuild,
  isFailure,
  standingOf,
  unexpectedPassDetail,
  type DeclaredStanding,
  type SweepStanding,
  type Verdict,
} from "./standing";
import {
  unsupportedChargingProfiles,
  unsupportedReservations,
} from "./capabilities";
import { parseLog } from "./ocpp";
import {
  DEFAULT_SIM_IMAGE,
  defaultSimConfig,
  startSim,
  type SimConfig,
  assertNoForeignSweep,
} from "./sim";
import type {
  CsmsCapabilities,
  CsmsDriverModule,
  CsmsDriverParts,
  CsmsEnv,
  CsmsRecords,
  SimTransportDefaults,
} from "./driver";
import {
  AUTHLIST_RESERVATION_SPECS,
  AUTHORIZE_SPECS,
  CORE_SPECS,
  FIRMWARE_SPECS,
  REMOTETRIGGER_SMARTCHARGING_SPECS,
} from "./specs/index";
import type { ScenarioSpec } from "./spec-types";
import { sleep } from "./util";
import { WaitTimeoutError } from "./wait";

/**
 * Where per-scenario logs and summary.md are written.
 *
 * Rooted at the CURRENT WORKING DIRECTORY, never at this module. This package
 * is installed under `node_modules/`, which is read-only in some installs,
 * shared by every consumer in the workspace, and erased by the next
 * `bun install` -- a run's evidence must not live there. `--results-dir` beats
 * `OCPP_TCK_RESULTS_DIR` beats `./results`.
 */
function resultsDir(argvDir?: string, env: CsmsEnv = process.env): string {
  const chosen = argvDir?.trim() || env.OCPP_TCK_RESULTS_DIR?.trim() || "results";
  return resolve(process.cwd(), chosen) + "/";
}

/** Set once by the CLI, so the run functions below stay argument-clean. */
let RESULTS_DIR = resultsDir();

// ---------------------------------------------------------------------------
// Runner core
// ---------------------------------------------------------------------------

interface RunOptions {
  cpId: string;
  connector?: number;
  timeoutSecs?: number;
}

/** 0 FAIL + >=1 SKIPPED is PARTIAL; anything with a FAIL is FAIL. */
function verdictForRecorder(rec: AssertRecorder): Verdict {
  if (rec.failed > 0) return "FAIL";
  return rec.skipped > 0 ? "PARTIAL" : "PASS";
}

/**
 * The scope table's answer for one scenario, or undefined when the table
 * has no entry at all (treated as "run it and find out" -- the
 * UnsupportedOperationError catch below is the backstop).
 */
async function scopeEntryFor(
  templateId: string,
): Promise<{ status: string; reason: string } | undefined> {
  // Reads the MODULE, and deliberately never calls create(). A driver is
  // entitled to build its HTTP client in create() and throw when its token is
  // unset -- so going through create() here made `run` demand a credential in
  // order to tell you it was not going to use one, contradicting the promise
  // three lines below. Importing a module does not contact the CSMS, and
  // neither may the table's own resolution.
  return (await scopeTable())?.[templateId];
}

/**
 * The driver's expected-failure entry for one scenario, or undefined when it
 * declared none -- in which case every failure is a failure, which is what a
 * driver with nothing to declare should keep saying.
 *
 * Offline for the same reason {@link scopeEntryFor} is, and it matters here
 * too: `ocpp-tck run` must be able to tell you a red scenario was expected
 * without first demanding the credential it is not going to use.
 */
async function expectedFailureEntryFor(
  templateId: string,
): Promise<ExpectedFailureEntry | undefined> {
  return expectedFailureFor(await expectedFailureTable(), templateId);
}

/** Result of one scenario execution -- either it produced checks, or the
 *  driver declared the scenario undrivable partway through drive(). */
type ScenarioRun =
  | { kind: "checked"; rec: AssertRecorder }
  | { kind: "not-applicable"; reason: string };

/**
 * The driver, loaded once per process and shared by every lane. Replaces
 * upstream's `STEVE_DRIVER=api|ui` fork: which CSMS is under test is a
 * `CSMS_DRIVER` module specifier, and specs never learn which.
 *
 * TWO STAGES, and the split is the point. Importing the module is free and
 * credential-free; `create()` is where a driver is allowed to demand its
 * configuration. The scope table is consulted BEFORE any container starts, so
 * a scenario this CSMS cannot drive is reported NOT APPLICABLE without the
 * driver ever needing valid credentials -- which is what makes the scope table
 * reviewable offline. That only holds because the preflight stops at stage one.
 */
let driverModulePromise: Promise<CsmsDriverModule> | undefined;
let driverPartsPromise: Promise<CsmsDriverParts> | undefined;
let scopeTablePromise: Promise<ScopeTable | undefined> | undefined;
let expectedFailurePromise:
  | Promise<ExpectedFailureTable | undefined>
  | undefined;

/**
 * The one environment this process shows a driver, named once so that the
 * scope table and the requests cannot describe different servers.
 *
 * A live alias of `process.env`, not a copy: `check-driver --driver` writes
 * CSMS_DRIVER into it after this line has run.
 */
const ENV: CsmsEnv = process.env;

async function driverModule(): Promise<CsmsDriverModule> {
  driverModulePromise ??= loadDriverModule();
  return driverModulePromise;
}

async function driver(): Promise<CsmsDriverParts> {
  driverPartsPromise ??= (async () => {
    const module = await driverModule();
    return module.create(ENV);
  })();
  return driverPartsPromise;
}

/** Resolved once: a driver is free to compute the table, and `run-all` asks it
 *  one question per scenario. */
async function scopeTable(): Promise<ScopeTable | undefined> {
  scopeTablePromise ??= driverModule().then((module) =>
    driverScope(module, ENV),
  );
  return scopeTablePromise;
}

/** The expected-failure list, resolved once with the SAME `ENV` as the scope
 *  table and as `create()`. A list describing one release line while the
 *  requests target the other excuses the wrong scenarios. */
async function expectedFailureTable(): Promise<
  ExpectedFailureTable | undefined
> {
  expectedFailurePromise ??= driverModule().then((module) =>
    driverExpectedFailures(module, ENV),
  );
  return expectedFailurePromise;
}

/**
 * Fills in the optional halves of CsmsRecords with stubs that throw
 * UnsupportedOperationError, carrying the driver's own reason.
 *
 * This is what keeps `if (driver.hasReservations)` out of the scenarios: a
 * spec calls records.reservations.latest() unconditionally, and on a CSMS
 * without reservations the call produces a NOT APPLICABLE verdict through the
 * normal escape instead of a branch inside a shared scenario.
 */
function withCapabilityStubs(parts: CsmsDriverParts): CsmsRecords {
  const base = parts.records;
  // Delegated explicitly, NOT spread. `{...base}` copies only own enumerable
  // properties, so a driver whose records are a class instance loses every
  // prototype method -- and tsc says nothing, because it types the spread as
  // structurally complete. Found by running against a real CSMS: the object
  // type-checked, and then `records.latestTransaction is not a function` at
  // the first scenario that asked the CSMS a question.
  return {
    latestTransaction: (cpId) => base.latestTransaction(cpId),
    waitForActiveTransaction: (cpId, idTag, timeoutSecs) =>
      base.waitForActiveTransaction(cpId, idTag, timeoutSecs),
    transactionIdTag: (tx) => base.transactionIdTag(tx),
    transactionStopTimestamp: (tx) => base.transactionStopTimestamp(tx),
    transactionStopReason: (tx) => base.transactionStopReason(tx),
    transactionCountForIdTag: (cpId, idTag) =>
      base.transactionCountForIdTag(cpId, idTag),
    reservations:
      base.reservations ??
      unsupportedReservations("this CSMS has no reservation resource"),
    chargingProfiles:
      base.chargingProfiles ??
      unsupportedChargingProfiles("this CSMS has no charging-profile registry"),
  };
}

/**
 * Driver transport defaults under operator overrides.
 *
 * Precedence is explicit `SIM_*` environment > driver default > harness
 * default, and it is enforced by only filling a field the environment left
 * unset. An operator who exported SIM_WS_URL to chase a handshake problem must
 * not have it silently replaced by what the driver believes the URL should be.
 */
function mergeSimTransport(
  base: SimConfig,
  fromDriver: SimTransportDefaults | undefined,
  env: CsmsEnv = process.env,
): SimConfig {
  if (!fromDriver) return base;
  const keep = <T>(envVar: string, driverValue: T | undefined, current: T): T =>
    env[envVar] ? current : (driverValue ?? current);
  return {
    ...base,
    wsUrl: keep("SIM_WS_URL", fromDriver.wsUrl, base.wsUrl),
    network: keep("SIM_NETWORK", fromDriver.network, base.network),
    appendCpIdToWsPath: keep(
      "SIM_WS_APPEND_CP_ID",
      fromDriver.appendCpIdToWsPath,
      base.appendCpIdToWsPath,
    ),
    basicAuthUser: keep(
      "SIM_WS_BASIC_USER",
      fromDriver.basicAuthUser,
      base.basicAuthUser,
    ),
    basicAuthPass: keep(
      "SIM_WS_BASIC_PASS",
      fromDriver.basicAuthPass,
      base.basicAuthPass,
    ),
  };
}

async function runScenario<D>(
  spec: ScenarioSpec<D>,
  options: RunOptions,
): Promise<ScenarioRun> {
  const connector = options.connector ?? spec.connector ?? 1;
  const bootWaitSecs = spec.bootWaitSecs ?? 4;
  const holdSecs = options.timeoutSecs ?? spec.holdSecs ?? 20;

  const parts = await driver();
  const simCfg = mergeSimTransport(
    defaultSimConfig(),
    await parts.simTransport?.(options.cpId),
  );
  const csms = parts.operations;
  const records = withCapabilityStubs(parts);

  // A write, and the driver's own business: closing a transaction an
  // interrupted run left open, so the next scenario is not blocked by it.
  await parts.prepareStation?.(options.cpId);

  process.stderr.write(
    `[runner] === ${spec.templateId} on ${options.cpId} (connector ${connector}, boot-wait ${bootWaitSecs}s, hold ${holdSecs}s) ===\n`,
  );

  const sim = await startSim(options.cpId, spec.templateId, simCfg);
  process.stderr.write(`[runner] simulator container: ${sim.container}\n`);

  let driveState!: D;
  /** Set only when drive() reported an operation the CSMS cannot do. */
  let unsupported: string | undefined;
  try {
    await sim.send({ command: "connect" });
    // Post-boot stdin method, made event-driven: a fixed bootWaitSecs sleep
    // alone can let run_scenario_template fire while the CP is still
    // booting -- either the scenario's opening traffic is dropped by the
    // boot gate or the command lands before the CLI is ready at all. Wait
    // for the actual BootNotification.conf line (bounded,
    // warn-and-continue on timeout like every other soft wait here), THEN
    // apply the spec's bootWaitSecs settle on top, preserving each spec's
    // tuned timing.
    try {
      // Upstream matched `"status":"Accepted","currentTime"` -- SteVe's key
      // order. JSON object key order carries no meaning, and a CSMS serialises
      // the same payload as {currentTime, interval, status}, so the wait
      // always timed out: 30s burned per scenario, and the event-driven gate
      // silently degraded back into the fixed sleep it exists to replace.
      // Match both keys without constraining their order.
      await sim.waitForLine(
        /Received: \[3,(?=[^\]]*"status":"Accepted")(?=[^\]]*"currentTime")/,
        30_000,
      );
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: did not see BootNotification.conf within 30s -- continuing anyway (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }
    await sleep(bootWaitSecs * 1000);
    await sim.send({
      command: "run_scenario_template",
      params: { connector, templateId: spec.templateId },
    });

    try {
      await sim.waitForLine(/"event":"scenario_started"/, 20_000);
    } catch (err) {
      process.stderr.write(
        `[runner] WARN: did not see scenario_started within 20s -- continuing anyway, assert() will likely fail if the scenario never ran (${
          err instanceof Error ? err.message : String(err)
        })\n`,
      );
    }

    if (spec.drive) {
      process.stderr.write(`[runner] running drive() for ${spec.templateId}\n`);
      // The UnsupportedOperationError catch lives HERE, around the whole
      // drive() call -- never inside a spec (the specs are vendored
      // verbatim and must stay CSMS-agnostic). A driver that throws it is
      // telling us the scope table missed this scenario.
      try {
        driveState = await spec.drive({
          cpId: options.cpId,
          connector,
          sim,
          csms,
          records,
        });
      } catch (err) {
        if (!(err instanceof UnsupportedOperationError)) throw err;
        unsupported = `${err.operation}: ${err.reason}`;
        process.stderr.write(
          `WARNING: scope table out of date for ${spec.templateId} -- driver reported "${err.operation}" unsupported (${err.reason}); recording NOT APPLICABLE\n`,
        );
      }
    } else {
      process.stderr.write(
        `[runner] no drive() defined (CP-only scenario) -- nothing to do while it runs\n`,
      );
      driveState = undefined as D;
    }

    // No point holding the wire open for a scenario we already know we
    // cannot assert on.
    if (unsupported === undefined) {
      await sleep(holdSecs * 1000);
    }
  } finally {
    await sim.stop();
  }

  const lines = sim.lines;

  // Persist the full captured wire log to results/<template-id>.log. Without
  // it a FAIL in a swept scenario is un-post-mortem-able: the sim container
  // is already stopped+removed by the time assert() reports, so this
  // capture is the only surviving record of what was (or wasn't) on the
  // wire. Best-effort: a write failure must not turn a finished scenario
  // run into an error.
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    await Bun.write(
      `${RESULTS_DIR}${spec.templateId}.log`,
      lines.join("\n") + "\n",
    );
  } catch (err) {
    process.stderr.write(
      `[runner] WARN: could not write results/${spec.templateId}.log: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  if (unsupported !== undefined) {
    return { kind: "not-applicable", reason: unsupported };
  }

  const frames = parseLog(lines.join("\n"));
  const rec = new AssertRecorder();

  process.stderr.write(`[runner] running assert() for ${spec.templateId}\n`);
  await spec.assert({
    cpId: options.cpId,
    connector,
    frames,
    lines,
    rec,
    records,
    driveState,
  });

  for (const check of rec.results) {
    if (check.status === "PASS") {
      process.stdout.write(`  PASS: ${check.description}\n`);
    } else if (check.status === "SKIPPED") {
      process.stdout.write(`  SKIPPED: ${check.description}\n`);
      if (check.detail) process.stdout.write(`           ${check.detail}\n`);
    } else {
      process.stdout.write(`  FAIL: ${check.description}\n`);
      if (check.detail) process.stdout.write(`        ${check.detail}\n`);
    }
  }
  process.stderr.write(
    `[runner] RESULT: ${spec.templateId} ${verdictForRecorder(rec)} (${rec.total} checks, ${rec.failed} failed, ${rec.skipped} skipped)\n`,
  );

  return { kind: "checked", rec };
}

// ---------------------------------------------------------------------------
// Spec registry -- the five groups mirror the upstream group names and array
// membership/order exactly (47 scenarios total: 15 core + 13
// authlist-reservation + 12 remotetrigger-smartcharging + 4 firmware + 3
// authorize).
//
// DIVERGENCE FROM UPSTREAM, deliberate: "all" includes "authorize". Upstream
// leaves the 3 TC_023 scenarios outside it, and this registry used to mirror
// that, with a TODO saying the fix belonged upstream because fidelity was
// worth more than tidiness and every re-sync would otherwise re-litigate it.
//
// That trade was wrong, and the comment made the case against itself: anyone
// running "all" and reading "44 scenarios, no failures" believes they ran the
// suite. They did not run the three scenarios that most directly exercise
// CSMS-side authorization state -- the ones that prove `driver provision`
// seeded anything at all. A default that silently under-reports coverage is a
// correctness problem, not a cosmetic one, and no amount of re-sync
// convenience buys it back.
//
// The divergence is cheap to carry because it is recorded: this file is
// upstream-patched, so the delta lives in patches/tck/main.ts.patch and any
// re-sync has to look at it. That is what the vendoring machinery is FOR.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GROUPS: Record<string, ScenarioSpec<any>[]> = {
  core: CORE_SPECS,
  "authlist-reservation": AUTHLIST_RESERVATION_SPECS,
  "remotetrigger-smartcharging": REMOTETRIGGER_SMARTCHARGING_SPECS,
  firmware: FIRMWARE_SPECS,
  authorize: AUTHORIZE_SPECS,
  all: [
    ...CORE_SPECS,
    ...AUTHLIST_RESERVATION_SPECS,
    ...REMOTETRIGGER_SMARTCHARGING_SPECS,
    ...FIRMWARE_SPECS,
    ...AUTHORIZE_SPECS,
  ],
};

// Built from every group rather than from "all" alone. Since "all" now holds
// every scenario the two are equivalent, and that is exactly why this stays
// as it is: it keeps `run <template-id>` resolving from the groups, so a
// future group excluded from "all" cannot silently become unrunnable by id.
// Map construction dedupes the same spec object appearing under both its own
// group and "all".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SPECS_BY_TEMPLATE_ID = new Map<string, ScenarioSpec<any>>(
  Object.values(GROUPS)
    .flat()
    .map((spec) => [spec.templateId, spec]),
);

/**
 * Charge points a sweep round-robins over, so adjacent scenarios don't
 * collide on the same station's transaction state. Upstream hardcoded the
 * CERTCP1..3 trio provisioned by its own SteVe bootstrap; here the list is
 * whatever the CSMS actually has registered, and the parallel lane count is
 * derived from it -- one station means one lane, i.e. sequential.
 */
export function resolveStations(env: CsmsEnv = process.env): string[] {
  // OCPP_CP_IDS is the roster (bare ocpp ids); OCPP_STATIONS is the separate
  // `ocpp_id=station_id` resolution override, which a driver reads when the
  // CSMS addresses a station by an internal id. Two names, two jobs, no
  // overlap.
  const raw = env.OCPP_CP_IDS ?? env.DEFAULT_CP_ID ?? "CERTCP1";
  const stations = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (stations.length === 0) {
    throw new Error(
      "no charge point resolved: OCPP_CP_IDS/DEFAULT_CP_ID is set but empty",
    );
  }
  return stations;
}

// ---------------------------------------------------------------------------
// Group sweep -- sequential (default) or parallel (one lane per resolved
// station, batched a station-count at a time).
// ---------------------------------------------------------------------------

interface RetryOutcome {
  verdict: Verdict;
  checks: number | null;
  failed: number | null;
  skipped: number | null;
  errorMessage?: string;
}

interface ScenarioOutcome extends RetryOutcome {
  templateId: string;
  cpId: string;
  /** Why the scenario was NOT APPLICABLE (scope table entry or the
   *  driver's UnsupportedOperationError message). */
  reason?: string;
  /**
   * --retry-failed-isolated safety net: set only for an outcome whose
   * PARALLEL verdict was a failure, re-run once sequentially (same CP, no
   * concurrent lane) against the SAME CSMS, so any difference is
   * attributable to parallel-lane contention rather than a spec/environment
   * change. A non-failing isolated retry means the parallel FAIL/ERROR was
   * a flake.
   */
  isolatedRetry?: RetryOutcome;
  /** The driver's declaration that this scenario is known to fail, attached
   *  whether or not it did. Both directions are reported: a declared FAIL is
   *  excused, a declared PASS fails the sweep. */
  expected?: ExpectedFailureEntry;
}

/** {@link standingOf} for a sweep outcome. The single-scenario path in `cli()`
 *  has no ScenarioOutcome and calls the fields form directly, which is the
 *  point of the split: the two paths cannot decide differently. */
function standingOfOutcome(outcome: ScenarioOutcome): SweepStanding {
  return standingOf(outcome.verdict, outcome.expected, outcome.isolatedRetry?.verdict);
}

/** An outcome whose declaration is known present -- every standing except
 *  "ok" implies one, but a `SweepStanding` is a string and cannot say so. */
type DeclaredOutcome = ScenarioOutcome & { expected: ExpectedFailureEntry };

/**
 * Outcomes with a given DECLARED standing, narrowed so the declaration can be
 * read without `?.`.
 *
 * The narrowing is the point rather than the filtering. Reaching for
 * `o.expected?.finding` inside a list already filtered to a declared standing
 * compiles, and renders the literal "undefined" into a report if the standing
 * rule and the declaration ever disagree -- a report saying a finding was
 * excused while naming nothing.
 *
 * The parameter is {@link DeclaredStanding}, not SweepStanding, and that is
 * what makes the promise honest rather than merely asserted: an undeclared
 * standing cannot be passed, so "this standing implies a declaration" is
 * checked at every call site instead of stated in this comment.
 */
function withStanding(
  outcomes: readonly ScenarioOutcome[],
  standing: DeclaredStanding,
): DeclaredOutcome[] {
  return outcomes.filter(
    (o): o is DeclaredOutcome =>
      o.expected !== undefined && standingOfOutcome(o) === standing,
  );
}

/**
 * Every bucket the sweep reports, in ONE pass and ONE definition.
 *
 * Both the markdown summary and the stderr conclusion partition the same
 * outcomes the same way, and they used to do it with two identical-looking
 * blocks in different functions -- the drift hazard `effectivelyFailed`'s own
 * doc warns about, one level up. `flakes` is here for the same reason: it was
 * spelled out by hand in three places, twice differently.
 */
interface StandingPartition {
  unexpectedFails: ScenarioOutcome[];
  expectedFails: DeclaredOutcome[];
  declaredButErrored: DeclaredOutcome[];
  unexpectedPasses: DeclaredOutcome[];
  /** Failed in a lane, did not fail isolated. Not a failure; reported so a
   *  red-looking run explains itself. */
  flakes: ScenarioOutcome[];
}

function partitionByStanding(
  outcomes: readonly ScenarioOutcome[],
): StandingPartition {
  return {
    unexpectedFails: outcomes.filter(
      (o) => standingOfOutcome(o) === "unexpected-fail",
    ),
    expectedFails: withStanding(outcomes, "expected-fail"),
    declaredButErrored: withStanding(outcomes, "declared-but-errored"),
    unexpectedPasses: withStanding(outcomes, "unexpected-pass"),
    flakes: outcomes.filter(
      (o) =>
        isFailure(o.verdict) &&
        !effectivelyFailed(o.verdict, o.isolatedRetry?.verdict),
    ),
  };
}

/**
 * The driver's declaration, as the one sentence every report renders --
 * `undefined` when it declared nothing about this scenario.
 *
 * Written once because it was written three times, and one copy had already
 * drifted to a different separator. The two sweep renderers -- the markdown
 * verdict cell and the stderr list -- go through here. exitForSingleRun()
 * deliberately does NOT: its sentences have to explain an exit code and
 * interleave the declaration differently, so forcing them through one renderer
 * would cost more than the labels it shares.
 *
 * Narrowing `expected` here also removes the `?.` chains the call sites needed:
 * they could not see that a standing of `expected-fail` implies an entry, so a
 * broken invariant would have rendered the string "undefined" into a report.
 */
function declarationNote(outcome: ScenarioOutcome): string | undefined {
  const { expected, verdict } = outcome;
  const retryVerdict = outcome.isolatedRetry?.verdict;
  if (!expected) return undefined;
  // standingOfOutcome(), not standingOf() on unpacked fields: unpacking here
  // would be a third place that maps an outcome to a standing, and the exit
  // code reads the other one.
  switch (standingOfOutcome(outcome)) {
    case "expected-fail":
      return `EXPECTED FAIL: ${expected.reason} (${expected.finding})`;
    case "unexpected-pass":
      return (
        "UNEXPECTED PASS: declared expected-failing, but " +
        unexpectedPassDetail(verdict, retryVerdict)
      );
    case "declared-but-errored":
      return (
        `DECLARED, BUT ERRORED (${expected.reason} -- ${expected.finding}): ` +
        declaredButErroredDetail(verdict, retryVerdict)
      );
    case "ok":
    case "unexpected-fail":
      // Unreachable: `expected` is non-undefined here, and both of these are
      // the undeclared standings. There is no note to write for a scenario
      // this driver said nothing about.
      return undefined;
  }
}

/**
 * Runs one scenario for a group sweep, isolating a thrown exception (e.g. a
 * bounded wait's fail-hard timeout rejection propagating out of drive()) to
 * THIS scenario's outcome instead of aborting the whole sweep.
 *
 * The scope table is consulted FIRST -- a NOT_APPLICABLE scenario never
 * starts a container.
 */
async function runOneForSweep<D>(
  spec: ScenarioSpec<D>,
  cpId: string,
): Promise<ScenarioOutcome> {
  // What every branch below shares, stated once. `expected` is read BEFORE the
  // run and carried even by the branches that never start a container: a
  // declaration attached only to failures could never report the case the list
  // exists to catch, which is the row that stopped failing. Hoisting it makes
  // that structural instead of four sites each remembering.
  const common = {
    templateId: spec.templateId,
    cpId,
    checks: null,
    failed: null,
    skipped: null,
    expected: await expectedFailureEntryFor(spec.templateId),
  };

  const scope = await scopeEntryFor(spec.templateId);
  if (scope?.status === "NOT_APPLICABLE") {
    process.stderr.write(
      `[runner] === ${spec.templateId} NOT APPLICABLE (no container started): ${scope.reason}\n`,
    );
    return { ...common, verdict: "NOT APPLICABLE", reason: scope.reason };
  }

  try {
    const run = await runScenario(spec, { cpId });
    if (run.kind === "not-applicable") {
      return { ...common, verdict: "NOT APPLICABLE", reason: run.reason };
    }
    return {
      ...common,
      verdict: verdictForRecorder(run.rec),
      checks: run.rec.total,
      failed: run.rec.failed,
      skipped: run.rec.skipped,
    };
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(
      `[runner] ERROR: ${spec.templateId} on ${cpId} threw before completing: ${message}\n`,
    );
    return { ...common, verdict: "ERROR", errorMessage: message };
  }
}

/**
 * --retry-failed-isolated: re-runs every FAIL/ERROR outcome from a
 * --parallel sweep ONE more time, sequentially -- one scenario at a time,
 * no concurrent lane -- and records the second verdict on the SAME outcome
 * object as `isolatedRetry`, mutating `outcomes` in place.
 *
 * Parallel lanes are not fully isolated from each other: host CPU/docker
 * contention can push a CSMS-initiated async push past a scenario's fixed
 * holdSecs wire-log window, producing a false FAIL that disappears with no
 * contention. This function does not fix that timing race -- it gives the
 * sweep a way to distinguish a flake from a real failure without giving up
 * --parallel's wall-clock win.
 *
 * PARTIAL and NOT APPLICABLE are never retried: neither is a failure.
 *
 * A DECLARED expected failure IS retried, and that is not waste. The retry is
 * what turns "it failed" into "it failed with no lane contending", which is
 * the only evidence that would let the declaration be deleted; a declared row
 * that passes its isolated retry is reported as an unexpected pass, because
 * there is no "expected flaky".
 */
async function retryFailedOutcomesIsolated(
  outcomes: ScenarioOutcome[],
): Promise<void> {
  const toRetry = outcomes.filter((o) => isFailure(o.verdict));
  if (toRetry.length === 0) {
    process.stderr.write(
      "[runner] --retry-failed-isolated: no failing outcomes from the parallel sweep -- nothing to retry.\n",
    );
    return;
  }

  process.stderr.write(
    `[runner] --retry-failed-isolated: re-running ${toRetry.length} failing outcome(s) sequentially, isolated from every other lane...\n`,
  );

  for (const outcome of toRetry) {
    const spec = SPECS_BY_TEMPLATE_ID.get(outcome.templateId);
    if (!spec) {
      // Should be unreachable (outcome.templateId always comes from a spec
      // in SPECS_BY_TEMPLATE_ID), but fail soft rather than crash the whole
      // sweep's reporting over a lookup that can't happen in practice.
      process.stderr.write(
        `[runner] WARN: --retry-failed-isolated: no spec found for ${outcome.templateId}, skipping retry\n`,
      );
      continue;
    }
    process.stderr.write(
      `[runner] isolated retry: ${outcome.templateId} on ${outcome.cpId} (parallel verdict was ${outcome.verdict})\n`,
    );
    const retryOutcome = await runOneForSweep(spec, outcome.cpId);
    outcome.isolatedRetry = {
      verdict: retryOutcome.verdict,
      checks: retryOutcome.checks,
      failed: retryOutcome.failed,
      skipped: retryOutcome.skipped,
      errorMessage: retryOutcome.errorMessage,
    };
    const flake = !isFailure(retryOutcome.verdict);
    process.stderr.write(
      `[runner] isolated retry result: ${outcome.templateId} ${retryOutcome.verdict}` +
        (flake
          ? " -- FLAKE (parallel-only false negative, isolated non-failure)\n"
          : " -- CONFIRMED (fails isolated too, not a parallel-lane artifact)\n"),
    );
  }
}

function timestampUtc(): string {
  // date -u +%FT%TZ equivalent: ISO-8601 down to the second, "Z" suffix
  // (toISOString() always yields millisecond precision + "Z"; drop the
  // milliseconds to match).
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * What the HOST was doing, recorded beside the verdict.
 *
 * A parallel sweep measures the machine as much as the CSMS: these scenarios
 * hold fixed observation windows open while three lanes and their simulator
 * containers compete for the same cores, so a saturated box turns green
 * scenarios red. That happened here, twice, and cost two investigations of the
 * code before anyone thought to look at `uptime` -- the second one reported a
 * failure that passed on every isolated re-run.
 *
 * One line in the summary makes the next red sweep self-diagnosing. It answers
 * a question, not a policy: nothing here refuses to run on a busy machine,
 * because the operator's laptop is a legitimate place to run this.
 */
function hostLoad(): string {
  const cores = cpus().length;
  const averages = loadavg();
  // Windows -- and any platform without a load average -- answers [0, 0, 0].
  // Printing "0.00" there would read as a perfectly idle machine, which is a
  // stronger claim than "we do not know", and the whole point of this line is
  // to be trustworthy when a sweep goes red.
  if (averages.every((value) => value === 0)) {
    return `Host load unavailable on this platform, ${cores} core(s).`;
  }
  const [one] = averages as [number, number, number];
  const ratio = one / Math.max(cores, 1);
  const note =
    ratio >= 0.9
      ? " -- SATURATED: parallel-lane failures here are unreliable, trust the isolated retry"
      : "";
  return `Host load ${one.toFixed(2)} over ${cores} core(s)${note}.`;
}

/** Renders + writes results/summary.md. Same columns as upstream plus
 *  `skipped`; when any outcome carries an `isolatedRetry`
 *  (--retry-failed-isolated ran), an extra "isolated retry" column and a
 *  flake-count note are added. */
async function writeSummary(
  groupName: string,
  outcomes: ScenarioOutcome[],
  parts: StandingPartition,
): Promise<string> {
  const anyRetried = outcomes.some((o) => o.isolatedRetry !== undefined);

  const rows = outcomes.map((o) => {
    const checks = o.checks === null ? "-" : String(o.checks);
    const failed = o.failed === null ? "-" : String(o.failed);
    const skipped = o.skipped === null ? "-" : String(o.skipped);
    // The declaration is rendered INTO the verdict cell rather than into a
    // column of its own, so that a reader scanning for red sees, in the same
    // glance, whether it was already known -- and, for an unexpected pass,
    // sees the row that has to be looked at.
    const note = declarationNote(o);
    const verdict =
      (o.reason ? `${o.verdict} (${o.reason})` : o.verdict) +
      (note ? ` — ${note}.` : "");
    const base = `| ${o.templateId} | ${o.cpId} | ${verdict} | ${checks} | ${failed} | ${skipped} |`;
    if (!anyRetried) return base;
    if (!o.isolatedRetry) return `${base} - |`;
    const flake = !isFailure(o.isolatedRetry.verdict);
    const label = `${o.isolatedRetry.verdict}${flake ? " (flake)" : " (confirmed)"}`;
    return `${base} ${label} |`;
  });

  const header = anyRetried
    ? "| scenario | cp | verdict | checks | failed | skipped | isolated retry |"
    : "| scenario | cp | verdict | checks | failed | skipped |";
  const separator = anyRetried
    ? "| --- | --- | --- | --- | --- | --- | --- |"
    : "| --- | --- | --- | --- | --- | --- |";

  const notes: string[] = [];
  const partialCount = outcomes.filter((o) => o.verdict === "PARTIAL").length;
  const naCount = outcomes.filter(
    (o) => o.verdict === "NOT APPLICABLE",
  ).length;
  if (partialCount > 0 || naCount > 0) {
    notes.push(
      "",
      `${partialCount} PARTIAL (checks the driver could not evaluate were SKIPPED), ` +
        `${naCount} NOT APPLICABLE (out of scope for this CSMS). Neither fails the sweep.`,
    );
  }
  const { expectedFails, unexpectedPasses, declaredButErrored } = parts;
  if (expectedFails.length > 0) {
    notes.push(
      "",
      `${expectedFails.length} EXPECTED FAIL — declared by this driver as a ` +
        "known finding about the CSMS, so the sweep still exits 0. The scope " +
        "rows stay DRIVABLE and the scenarios still ran; only the exit code " +
        "changed. Each entry names where the finding is written down:",
      ...expectedFails.map(
        (o) => `- \`${o.templateId}\` — ${o.expected.finding}`,
      ),
    );
  }
  if (declaredButErrored.length > 0) {
    notes.push(
      "",
      `${declaredButErrored.length} DECLARED, BUT ERRORED — declared ` +
        "expected-failing and did not produce the declared failure; it never " +
        "got an answer out of the CSMS at all. **This fails the sweep**: an " +
        "entry excuses what a CSMS answers, never a crash, and a job that went " +
        "green on this would be blind to the kind of breakage it exists to " +
        "catch. The entries below are probably still good:",
      ...declaredButErrored.map(
        (o) =>
          `- \`${o.templateId}\` — ${declaredButErroredDetail(o.verdict, o.isolatedRetry?.verdict)}`,
      ),
    );
  }
  if (unexpectedPasses.length > 0) {
    notes.push(
      "",
      `${unexpectedPasses.length} UNEXPECTED PASS — declared expected-failing ` +
        "and did not fail. **This fails the sweep**, on purpose: it is how a " +
        "known-red entry gets deleted when it stops being true, instead of " +
        "outliving the defect it documents.",
      ...unexpectedPasses.map(
        (o) => `- \`${o.templateId}\` — ${unexpectedPassDetail(o.verdict, o.isolatedRetry?.verdict)}`,
      ),
    );
  }
  if (anyRetried) {
    const flakeCount = parts.flakes.length;
    const confirmedCount = outcomes.filter(
      (o) => o.isolatedRetry !== undefined && isFailure(o.isolatedRetry.verdict),
    ).length;
    notes.push(
      "",
      `--retry-failed-isolated: ${flakeCount} flake(s) (parallel FAIL/ERROR, isolated non-failure), ` +
        `${confirmedCount} confirmed failure(s) (fails isolated too).`,
      "Sequential (`run-all` without `--parallel`) remains the reliable reporting mode.",
    );
  }

  const content =
    [
      `# OCPP verification results — group: ${groupName}`,
      "",
      `Run at ${timestampUtc()}. ${hostLoad()}`,
      "",
      header,
      separator,
      ...rows,
      ...notes,
    ].join("\n") + "\n";

  mkdirSync(RESULTS_DIR, { recursive: true });
  const summaryPath = `${RESULTS_DIR}summary.md`;
  await Bun.write(summaryPath, content);
  return summaryPath;
}

/** Sequential or parallel group sweep. Writes results/summary.md and exits
 *  the process (non-zero only if a scenario FAILed or errored). */
async function runGroupSweep(
  groupName: string,
  parallel: boolean,
  retryFailedIsolated: boolean,
): Promise<number> {
  const specs = GROUPS[groupName];
  if (!specs) {
    process.stderr.write(
      `Unknown group: ${groupName} (known: ${Object.keys(GROUPS).join(", ")})\n`,
    );
    return 1;
  }

  const stations = resolveStations();
  // Before `driver provision` state or prepareStation() touches anything.
  await assertNoForeignSweep(stations);
  // Lane count IS the station count: one lane per station, never more. A
  // single resolved station therefore forces sequential execution however
  // --parallel was passed.
  const lanes = stations.length;
  const effectiveParallel = parallel && lanes > 1;
  if (parallel && !effectiveParallel) {
    process.stderr.write(
      `[runner] --parallel requested but only ${lanes} station resolved (${stations.join(", ")}) -- running sequentially.\n`,
    );
  }

  process.stderr.write(
    `[runner] group '${groupName}': ${specs.length} scenario(s), stations=[${stations.join(", ")}], lanes=${effectiveParallel ? lanes : 1}\n`,
  );

  const cpFor = specs.map((_, i) => stations[i % lanes]);
  const outcomes: ScenarioOutcome[] = [];

  if (effectiveParallel) {
    for (let start = 0; start < specs.length; start += lanes) {
      const batchSpecs = specs.slice(start, start + lanes);
      const batchCps = cpFor.slice(start, start + lanes);
      const batchOutcomes = await Promise.all(
        batchSpecs.map((spec, idx) => runOneForSweep(spec, batchCps[idx])),
      );
      outcomes.push(...batchOutcomes);
    }
    process.stderr.write(
      "[runner] NOTE: --parallel lanes are not fully isolated -- a FAIL/ERROR " +
        "here may be a parallel-only false negative. Sequential (no " +
        "--parallel) remains the reliable reporting mode; pass " +
        "--retry-failed-isolated for a same-run safety net.\n",
    );
  } else {
    for (let i = 0; i < specs.length; i++) {
      outcomes.push(await runOneForSweep(specs[i], cpFor[i]));
    }
  }

  if (retryFailedIsolated) {
    if (effectiveParallel) {
      await retryFailedOutcomesIsolated(outcomes);
    } else {
      process.stderr.write(
        "[runner] --retry-failed-isolated has no effect without parallel lanes " +
          "(a sequential sweep is already isolated).\n",
      );
    }
  }

  process.stderr.write(`\n[runner] group '${groupName}' results:\n`);
  for (const o of outcomes) {
    const retrySuffix = o.isolatedRetry
      ? ` [isolated retry: ${o.isolatedRetry.verdict}${
          isFailure(o.isolatedRetry.verdict) ? " -- confirmed" : " -- flake"
        }]`
      : "";
    const reasonSuffix = o.reason ? ` -- ${o.reason}` : "";
    const note = declarationNote(o);
    const declaredSuffix = note ? ` [${note}]` : "";
    process.stderr.write(
      `  ${o.verdict}: ${o.templateId} (${o.cpId}, ${o.checks ?? "-"} checks, ${o.failed ?? "-"} failed, ${o.skipped ?? "-"} skipped)${retrySuffix}${declaredSuffix}${reasonSuffix}\n`,
    );
  }

  const parts = partitionByStanding(outcomes);
  const summaryPath = await writeSummary(groupName, outcomes, parts);
  process.stderr.write(`[runner] results table: ${summaryPath}\n`);

  const { unexpectedFails, expectedFails, unexpectedPasses, declaredButErrored, flakes } =
    parts;
  // A parallel-lane FAIL/ERROR that did not fail on its isolated retry is a
  // flake, not a real failure -- it does not fail the sweep. Everything here
  // reads that through effectivelyFailed(), via standingOf().
  const flakeCount = flakes.length;
  if (flakeCount > 0) {
    process.stderr.write(
      `[runner] ${flakeCount} parallel-only flake(s) in group '${groupName}' (did not fail on isolated retry) -- see ${summaryPath}\n`,
    );
  }
  if (expectedFails.length > 0) {
    process.stderr.write(
      `[runner] ${expectedFails.length} scenario(s) in group '${groupName}' failed as this driver declared they would -- not a build failure; see ${summaryPath}\n`,
    );
  }
  // Its own standing, and its own line, because it reads as a regression of the
  // DECLARATION when it is nothing of the sort: the entry is almost certainly
  // still good and something new stopped the scenario ever reaching the CSMS.
  // Folded in with the ordinary failures, the maintainer sees a red build on
  // the one row they were told would be red, and goes looking in the wrong
  // place.
  if (declaredButErrored.length > 0) {
    process.stderr.write(
      `[runner] ${declaredButErrored.length} scenario(s) in group '${groupName}' are declared expected-failing and ERRORED, which is not the declared failure:\n`,
    );
    for (const o of declaredButErrored) {
      process.stderr.write(
        `  ${o.templateId}: ${declaredButErroredDetail(o.verdict, o.isolatedRetry?.verdict)}.\n`,
      );
    }
  }
  // Reported BEFORE the ordinary failures and counted separately, because the
  // two need opposite fixes: an unexpected failure is a defect to chase, an
  // unexpected pass is a line to look at.
  if (unexpectedPasses.length > 0) {
    process.stderr.write(
      `[runner] ${unexpectedPasses.length} scenario(s) in group '${groupName}' are declared expected-failing and did NOT fail:\n`,
    );
    for (const o of unexpectedPasses) {
      process.stderr.write(
        `  ${o.templateId}: ${unexpectedPassDetail(o.verdict, o.isolatedRetry?.verdict)}.\n`,
      );
    }
  }
  if (unexpectedFails.length > 0) {
    process.stderr.write(
      `[runner] ${unexpectedFails.length}/${outcomes.length} scenario(s) in group '${groupName}' FAILed or errored -- see ${summaryPath}\n`,
    );
  }
  // The disjunction lives in standing.ts, so a sixth standing cannot be added
  // and silently left out of the exit code here.
  if (outcomes.some((o) => endsTheBuild(standingOfOutcome(o)))) return 1;

  const partialCount = outcomes.filter((o) => o.verdict === "PARTIAL").length;
  const naCount = outcomes.filter((o) => o.verdict === "NOT APPLICABLE").length;
  process.stderr.write(
    `[runner] no unexpected failures in group '${groupName}': ${outcomes.length} scenario(s), ` +
      `${partialCount} PARTIAL, ${naCount} NOT APPLICABLE` +
      (expectedFails.length > 0
        ? `, ${expectedFails.length} EXPECTED FAIL`
        : "") +
      (flakeCount > 0 ? `, ${flakeCount} flake(s) resolved by isolated retry` : "") +
      ".\n",
  );
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  templateId?: string;
  group?: string;
  runAll: boolean;
  parallel: boolean;
  retryFailedIsolated: boolean;
  cpId: string;
  connector?: number;
  timeoutSecs?: number;
  /** `--results-dir`; beats OCPP_TCK_RESULTS_DIR, which beats ./results. */
  resultsDir?: string;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    process.stderr.write(`Error: ${flag} requires a value\n`);
    process.exit(1);
  }
  return value;
}

function requireNumber(argv: string[], index: number, flag: string): number {
  const raw = requireValue(argv, index, flag);
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    process.stderr.write(`Error: ${flag} expects a number, got "${raw}"\n`);
    process.exit(1);
  }
  return n;
}

const VERBS = [
  "run",
  "run-all",
  "list-scenarios",
  "check-driver",
  "print-sim-image",
  "driver",
] as const;

async function printUsage(): Promise<void> {
  process.stderr.write(
    "Usage: ocpp-tck run <template-id> [--cp CP1] [--timeout N] " +
      "[--connector N] [--results-dir DIR]\n" +
      "       ocpp-tck run --group " +
      `${Object.keys(GROUPS).join("|")} [--parallel] [--retry-failed-isolated]\n` +
      "       ocpp-tck run-all [--group <name>] [--parallel] " +
      "[--retry-failed-isolated] [--results-dir DIR]\n" +
      "       ocpp-tck list-scenarios [--group <name>] [--json]\n" +
      "       ocpp-tck check-driver [--driver SPEC] [--json]\n" +
      "       ocpp-tck print-sim-image\n" +
      "       ocpp-tck driver <verb> [args...]\n" +
      "\n" +
      "check-driver is fully offline: it reads the driver MODULE (never " +
      "create()), so it needs no CSMS, no docker, no network and no " +
      "credentials.\n" +
      "\n" +
      "--retry-failed-isolated: after a parallel sweep, re-run any " +
      "FAIL/ERROR scenario once more, sequentially and isolated, and report " +
      "both verdicts (parallel-fail -> isolated-pass = flake; still fails " +
      "isolated = real fail). No effect without parallel lanes.\n" +
      "\n" +
      "Environment: CSMS_DRIVER (module specifier of the driver to load), " +
      "OCPP_TCK_RESULTS_DIR (default ./results), OCPP_TCK_DRIVERS_DIR " +
      "(default ./drivers, used only to list candidates in errors), " +
      "OCPP_CP_IDS (comma-separated charge point ids; the " +
      "parallel lane count derives from it -- one station means sequential), " +
      "OCPP_STATIONS (ocpp_id=station_id[,...] override when the stations were " +
      "created by hand), SIM_WS_URL, SIM_IMAGE, SIM_NETWORK, " +
      "SIM_WS_APPEND_CP_ID, SIM_WS_BASIC_USER/SIM_WS_BASIC_PASS.\n",
  );

  // The driver's own environment, if one is selected and declares it. Best
  // effort: `--help` must still work when CSMS_DRIVER is unset or broken,
  // which is exactly when somebody is reading it.
  try {
    const module = await driverModule();
    if (module.envHelp) {
      process.stderr.write(
        `\nDriver environment (${module.displayName}):\n${module.envHelp}\n`,
      );
    }
    // `selftest` first and always: it is core, so it is the one verb every
    // driver answers, and it is the fastest way to find out whether this one
    // can talk to its CSMS at all.
    const verbs = ["selftest", ...Object.keys(module.commands ?? {})];
    process.stderr.write(
      `\nDriver verbs (ocpp-tck driver <verb>): ${verbs.join(", ")}\n` +
        "  selftest calls every CsmsRecords method once against the running " +
        "CSMS -- seconds, no simulator. Run it before a sweep.\n",
    );
  } catch {
    /* no driver selected, or it failed to load -- usage is still useful */
  }
}

function parseArgs(argv: string[]): CliArgs {
  let templateId: string | undefined;
  let group: string | undefined;
  let parallel = false;
  let retryFailedIsolated = false;
  let cpId = resolveStations()[0];
  let connector: number | undefined;
  let timeoutSecs: number | undefined;
  let resultsDirArg: string | undefined;

  if (argv[0] === "run-all") {
    group = "all";
    for (let i = 1; i < argv.length; i++) {
      switch (argv[i]) {
        case "--group":
          group = requireValue(argv, ++i, "--group");
          break;
        case "--parallel":
          parallel = true;
          break;
        case "--retry-failed-isolated":
          retryFailedIsolated = true;
          break;
        case "--results-dir":
          resultsDirArg = requireValue(argv, ++i, "--results-dir");
          break;
        default:
          process.stderr.write(`Unknown argument: ${argv[i]}\n`);
          process.exit(1);
      }
    }
    return {
      group,
      runAll: true,
      parallel,
      retryFailedIsolated,
      cpId,
      resultsDir: resultsDirArg,
    };
  }

  // argv[0] === "run"
  if (!argv[1]) {
    process.stderr.write("run needs a <template-id> or --group <name>.\n");
    process.exit(1);
  }

  let startIndex: number;
  if (argv[1] === "--group") {
    group = requireValue(argv, 2, "--group");
    startIndex = 3;
  } else {
    templateId = argv[1];
    startIndex = 2;
  }

  for (let i = startIndex; i < argv.length; i++) {
    switch (argv[i]) {
      case "--cp":
        cpId = requireValue(argv, ++i, "--cp");
        break;
      case "--connector":
        connector = requireNumber(argv, ++i, "--connector");
        break;
      case "--timeout":
        timeoutSecs = requireNumber(argv, ++i, "--timeout");
        break;
      case "--parallel":
        parallel = true;
        break;
      case "--retry-failed-isolated":
        retryFailedIsolated = true;
        break;
      case "--results-dir":
        resultsDirArg = requireValue(argv, ++i, "--results-dir");
        break;
      default:
        process.stderr.write(`Unknown argument: ${argv[i]}\n`);
        process.exit(1);
    }
  }
  return {
    templateId,
    group,
    runAll: false,
    parallel,
    retryFailedIsolated,
    cpId,
    connector,
    timeoutSecs,
    resultsDir: resultsDirArg,
  };
}

// ---------------------------------------------------------------------------
// Offline verbs
// ---------------------------------------------------------------------------

/** Every registered templateId, with the group it is first reachable from. */
function registeredScenarios(): Array<{ templateId: string; group: string }> {
  const seen = new Map<string, string>();
  for (const [group, specs] of Object.entries(GROUPS)) {
    if (group === "all") continue;
    for (const spec of specs) {
      if (!seen.has(spec.templateId)) seen.set(spec.templateId, group);
    }
  }
  return [...seen].map(([templateId, group]) => ({ templateId, group }));
}

function listScenarios(argv: string[]): number {
  let group: string | undefined;
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--group") group = requireValue(argv, ++i, "--group");
    else if (argv[i] === "--json") asJson = true;
    else {
      process.stderr.write(`Unknown argument: ${argv[i]}\n`);
      return 1;
    }
  }
  let rows = registeredScenarios();
  if (group !== undefined) {
    if (!(group in GROUPS)) {
      process.stderr.write(
        `Unknown group: ${group} (known: ${Object.keys(GROUPS).join(", ")})\n`,
      );
      return 1;
    }
    const ids = new Set(GROUPS[group].map((s) => s.templateId));
    rows = rows.filter((r) => ids.has(r.templateId));
  }
  process.stdout.write(
    asJson
      ? `${JSON.stringify(rows, null, 2)}\n`
      : `${rows.map((r) => `${r.templateId}\t${r.group}`).join("\n")}\n`,
  );
  return 0;
}

/**
 * Offline conformance check of a driver against THIS core.
 *
 * Everything here reads the driver MODULE and the scenario registry, and
 * nothing else -- no `create()`, so no credentials; no container, so no
 * docker; no CSMS, so no network. That is what makes it runnable in CI by
 * whoever wrote the driver, in a repository that has never seen the CSMS.
 */
async function checkDriver(argv: string[]): Promise<number> {
  let asJson = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--driver") {
      process.env.CSMS_DRIVER = requireValue(argv, ++i, "--driver");
    } else if (argv[i] === "--json") {
      asJson = true;
    } else {
      process.stderr.write(`Unknown argument: ${argv[i]}\n`);
      return 1;
    }
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  // Resolution shares the module's try/catch, and that is not tidiness: a
  // driver that reads a declaration from the environment -- which release line
  // it is pointed at -- rejects a bad value by throwing, and it used to throw
  // at import. Outside the catch, `CITRINE_VARIANT=typo` would print a stack
  // where it used to print one sentence.
  let module: CsmsDriverModule;
  let scope: ScopeTable | undefined;
  let capabilities: CsmsCapabilities | undefined;
  let expected: ExpectedFailureTable | undefined;
  try {
    module = await driverModule();
    scope = await scopeTable();
    capabilities = driverCapabilities(module, ENV);
    expected = await expectedFailureTable();
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  if (!module.id?.trim()) problems.push("the module declares no `id`.");
  if (!module.displayName?.trim()) {
    problems.push("the module declares no `displayName`.");
  }

  const scenarios = registeredScenarios();
  const registered = scenarios.map((s) => s.templateId);
  const groupOf = new Map(scenarios.map((s) => [s.templateId, s.group]));

  if (!scope) {
    warnings.push(
      "no scope table: every scenario will be run and undrivable ones " +
        "discovered at runtime, after a container has started and touched " +
        "the CSMS. Legal, but the table is what makes that cheap.",
    );
  } else {
    const { missing, stale } = scopeCoverage(scope, registered);
    if (missing.length > 0) {
      problems.push(
        `${missing.length} registered scenario(s) have NO row:\n` +
          missing
            .map((id) => `      ${id} (group ${groupOf.get(id) ?? "?"})`)
            .join("\n") +
          "\n    -> add a row with its status and a reason citing the precise " +
          "API limitation.",
      );
    }
    if (stale.length > 0) {
      problems.push(
        `${stale.length} row(s) point at a scenario nobody registers:\n` +
          stale.map((id) => `      ${id}`).join("\n") +
          "\n    -> delete the row, or fix the templateId if the scenario " +
          "was renamed.",
      );
    }

    const buckets: ScopeStatus[] = [
      "DRIVABLE",
      "CONDITIONAL",
      "NOT_APPLICABLE",
    ];
    const classified = new Set(
      buckets.flatMap((status) => templateIdsWithStatus(scope, status)),
    );
    const unclassified = Object.keys(scope).filter(
      (id) => !classified.has(id),
    );
    if (unclassified.length > 0) {
      problems.push(
        `${unclassified.length} row(s) carry a status outside ` +
          `${buckets.join("/")}: ${unclassified.join(", ")}. ` +
          "The runner only reacts to NOT_APPLICABLE, so such a row is " +
          "invisible to every consumer.",
      );
    }

    const reasonless = Object.entries(scope)
      .filter(([, entry]) => !entry.reason?.trim())
      .map(([id]) => id);
    if (reasonless.length > 0) {
      problems.push(
        `${reasonless.length} row(s) carry an empty reason: ` +
          `${reasonless.join(", ")}. A row without a cited limitation is a ` +
          "claim nobody can review.",
      );
    }
  }

  // Everything about the expected-failure list that is knowable offline. What
  // is NOT knowable here is whether those scenarios still fail -- only a sweep
  // answers that, by reporting an UNEXPECTED PASS.
  if (expected) {
    const drift = expectedFailureCoverage(expected, scope, registered);
    if (drift.stale.length > 0) {
      problems.push(
        `${drift.stale.length} expected-failure entry(ies) name a scenario ` +
          `nobody registers: ${drift.stale.join(", ")}.\n` +
          "    -> delete the entry, or fix the templateId if the scenario was " +
          "renamed. An entry under an old id excuses nothing and can never be " +
          "cleaned up by a passing run.",
      );
    }
    if (drift.notApplicable.length > 0) {
      problems.push(
        `${drift.notApplicable.length} expected-failure entry(ies) are also ` +
          `NOT_APPLICABLE in the scope table: ${drift.notApplicable.join(", ")}.\n` +
          "    -> both cannot be true. A NOT_APPLICABLE scenario never starts, " +
          "so it can neither fail as declared nor ever pass and delete the entry.",
      );
    }
    if (drift.reasonless.length > 0) {
      problems.push(
        `${drift.reasonless.length} expected-failure entry(ies) carry an ` +
          `empty reason: ${drift.reasonless.join(", ")}. "Known red" is the ` +
          "observation, not the mechanism.",
      );
    }
    if (drift.findingless.length > 0) {
      problems.push(
        `${drift.findingless.length} expected-failure entry(ies) carry an ` +
          `empty finding: ${drift.findingless.join(", ")}.\n` +
          "    -> name where it is written down: an upstream issue, or the row " +
          "of this driver's README gap table that carries the evidence. A " +
          "known-red with nowhere to read about it is how the list rots.",
      );
    }
  }

  if (capabilities) {
    const known = new Set<string>(CSMS_OPERATION_ACTIONS);
    const unknown = [...capabilities.operations].filter(
      (op) => !known.has(op),
    );
    if (unknown.length > 0) {
      problems.push(
        `capabilities.operations names ${unknown.length} operation(s) this ` +
          `core does not define: ${unknown.join(", ")}.`,
      );
    }
    const undeclared = CSMS_OPERATION_ACTIONS.filter(
      (op) => !capabilities.operations.has(op),
    );
    if (undeclared.length > 0) {
      warnings.push(
        `${undeclared.length} operation(s) are not declared: ` +
          `${undeclared.join(", ")}. Each MUST throw ` +
          "UnsupportedOperationError from execute().",
      );
    }
  }

  const summary = {
    driver: module.id ?? "",
    displayName: module.displayName ?? "",
    registeredScenarios: registered.length,
    scope: scope
      ? {
          DRIVABLE: templateIdsWithStatus(scope, "DRIVABLE").length,
          CONDITIONAL: templateIdsWithStatus(scope, "CONDITIONAL").length,
          NOT_APPLICABLE: templateIdsWithStatus(scope, "NOT_APPLICABLE").length,
        }
      : null,
    // The entries, not their count and not their ids: --json is what a
    // conformance report would read, and "which scenarios are excused, and on
    // what recorded evidence" is the question it has to answer without going
    // back to the driver's source. Sorted, so two runs of the same driver
    // diff cleanly.
    expectedFailures: expected
      ? Object.keys(expected)
          .sort()
          .map((templateId) => ({ templateId, ...expected[templateId] }))
      : null,
    problems,
    warnings,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return problems.length > 0 ? 1 : 0;
  }

  for (const warning of warnings) {
    process.stderr.write(`  WARN: ${warning}\n`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `FAIL: driver "${module.id}" does not agree with this core.\n`,
    );
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }
  process.stderr.write(
    `OK: driver "${module.id}" (${module.displayName}) covers all ` +
      `${registered.length} registered scenario(s)` +
      (summary.scope
        ? ` -- ${summary.scope.DRIVABLE} DRIVABLE, ` +
          `${summary.scope.CONDITIONAL} CONDITIONAL, ` +
          `${summary.scope.NOT_APPLICABLE} NOT_APPLICABLE`
        : "") +
      ".\n",
  );
  // Listed rather than counted: this is the one declaration whose whole job is
  // to shrink, and a number does not tell a reviewer which rows to go and check.
  if (summary.expectedFailures && summary.expectedFailures.length > 0) {
    process.stderr.write(
      `  ${summary.expectedFailures.length} scenario(s) declared expected-failing ` +
        "-- each still runs, still prints FAIL, and fails the sweep the day it " +
        "passes:\n",
    );
    for (const entry of summary.expectedFailures) {
      process.stderr.write(`    ${entry.templateId}: ${entry.finding}\n`);
    }
  }
  return 0;
}

/** Runs a driver-contributed bootstrap verb. */
/**
 * `ocpp-tck driver selftest` -- does this driver's data path work AT ALL?
 *
 * The gap this fills is a measured one. `check-driver` runs offline and never
 * touches the CSMS; the next rung up was a 47-scenario sweep costing ten
 * minutes and a docker image. So a driver whose record queries were broken in
 * a two-line way -- a column typed wrong, a field the server does not expose,
 * a relationship never created -- announced itself only after a full sweep,
 * once per bug. This calls every method of the contract once, against the
 * running CSMS, in seconds.
 *
 * WHAT IT ASSERTS IS THAT THE QUERY RAN, not what it returned. The values
 * depend on whatever the CSMS has recorded, which is the scenarios' business;
 * a selftest that expected data would need fixtures and would then be a sweep.
 * So a read that answers "" is a PASS -- it reached the CSMS and came back
 * shaped correctly -- and only a throw is a failure.
 *
 * A declared capability gap is a SKIP rather than a failure: reservations on a
 * CSMS that has none must throw UnsupportedOperationError, and that is the
 * contract working, not breaking.
 */
async function driverSelftest(argv: string[] = []): Promise<number> {
  const withWrites = argv.includes("--with-writes");
  const module = await driverModule();
  const parts = await driver();
  const records = withCapabilityStubs(parts);
  const cpId = resolveStations()[0]!;
  // A tag no fixture defines. Every read below is a query exercise, and one
  // that cannot match keeps this verb from depending on provisioning.
  const idTag = "SELFTEST-NO-SUCH-TAG";

  const probes: { name: string; run: () => Promise<unknown> }[] = [
    { name: "latestTransaction", run: () => records.latestTransaction(cpId) },
    {
      name: "transactionIdTag",
      run: () => records.transactionIdTag(""),
    },
    {
      name: "transactionStopTimestamp",
      run: () => records.transactionStopTimestamp(""),
    },
    {
      name: "transactionStopReason",
      run: () => records.transactionStopReason(""),
    },
    {
      name: "transactionCountForIdTag",
      run: () => records.transactionCountForIdTag(cpId, idTag),
    },
    {
      // Contractually REJECTS when nothing shows up, so the timeout is the
      // expected answer here and proves the query underneath it ran. Only a
      // different error means the query itself is broken.
      name: "waitForActiveTransaction",
      run: async () => {
        try {
          return await records.waitForActiveTransaction(cpId, idTag, 1);
        } catch (err) {
          if (err instanceof WaitTimeoutError) return "(timed out, as expected)";
          throw err;
        }
      },
    },
    { name: "reservations.latest", run: () => records.reservations.latest(cpId) },
    // Twice, because the two arguments take different paths. An empty ref is
    // the contract's "none" and a driver may answer it without asking the CSMS
    // at all -- SteVe's does, deliberately -- so only a well-formed ref
    // exercises the lookup itself. `0` is well-formed and matches nothing.
    { name: "reservations.status (empty ref)", run: () => records.reservations.status("") },
    { name: "reservations.status (absent ref)", run: () => records.reservations.status("0") },
    {
      name: "chargingProfiles.refByDescription",
      run: () => records.chargingProfiles.refByDescription("SELFTEST"),
    },
  ];
  // prepareStation is the one WRITE the contract defines, and it is off by
  // default: it closes a station's open transaction and clears its local list,
  // which is right before a scenario and surprising from something called a
  // selftest -- especially against a CSMS the operator did not bring up for
  // this. `--with-writes` asks for it; every scenario exercises it anyway.
  if (withWrites && parts.prepareStation) {
    probes.push({
      name: "prepareStation",
      run: () => parts.prepareStation!(cpId),
    });
  }

  process.stdout.write(
    `selftest: ${module.displayName} against ${cpId}\n`,
  );
  let failed = 0;
  for (const probe of probes) {
    // The try covers the CALL and nothing else. Rendering the answer is this
    // verb's own business, and a value JSON.stringify refuses -- a BigInt, a
    // cycle -- would otherwise be reported as the driver failing a query it
    // actually answered.
    let value: unknown;
    try {
      value = await probe.run();
    } catch (err) {
      if (err instanceof UnsupportedOperationError) {
        process.stdout.write(`  SKIP    ${probe.name} -- ${err.reason}\n`);
        continue;
      }
      failed += 1;
      process.stdout.write(
        `  FAIL    ${probe.name}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      continue;
    }
    process.stdout.write(`  OK      ${probe.name} -> ${render(value)}\n`);
  }

  if (failed > 0) {
    process.stderr.write(
      `selftest: ${failed} of ${probes.length} call(s) failed -- the driver cannot answer the contract.\n`,
    );
    return 1;
  }
  process.stdout.write(`selftest: ${probes.length} call(s), all answered\n`);
  return 0;
}

/** One probe's answer, for the log. Never throws: a value that cannot be
 *  serialised is still a value the driver returned. */
function render(value: unknown): string {
  if (value === undefined) return "(void)";
  try {
    return JSON.stringify(value) || "(empty)";
  } catch {
    return `(unserialisable ${typeof value})`;
  }
}

async function runDriverCommand(argv: string[]): Promise<number> {
  const name = argv[0];
  const module = await driverModule();
  const commands = module.commands ?? {};
  // Core-provided, so every driver has it without contributing anything --
  // including a driver written outside this repository.
  if (name === "selftest") return driverSelftest(argv.slice(1));
  if (!name || !(name in commands)) {
    const known = ["selftest", ...Object.keys(commands)];
    process.stderr.write(
      `Usage: ocpp-tck driver <verb> [args...]\n` +
        `Verbs: ${known.join(", ")}` +
        (Object.keys(commands).length > 0
          ? ` (all but selftest contributed by ${module.displayName})\n`
          : ` (selftest is core; ${module.displayName} contributes none)\n`),
    );
    return 1;
  }
  return commands[name](argv.slice(1));
}

/**
 * The whole CLI, as a function of argv, RETURNING an exit code.
 *
 * The single `process.exit` for a completed run lives in bin/ocpp-tck.ts, not
 * here: this module is also imported as a library (`open-ocpp-tck/runner`),
 * and a library that can terminate its host process is not one.
 */
export async function cli(argv: string[]): Promise<number> {
  const verb = argv[0];

  if (verb === "--help" || verb === "-h" || verb === "help") {
    await printUsage();
    return 0;
  }
  if (!verb || !(VERBS as readonly string[]).includes(verb)) {
    if (verb) process.stderr.write(`Unknown command: ${verb}\n`);
    await printUsage();
    return 1;
  }

  if (verb === "print-sim-image") {
    process.stdout.write(`${DEFAULT_SIM_IMAGE}\n`);
    return 0;
  }
  if (verb === "list-scenarios") return listScenarios(argv.slice(1));
  if (verb === "check-driver") return checkDriver(argv.slice(1));
  if (verb === "driver") return runDriverCommand(argv.slice(1));

  const args = parseArgs(argv);
  RESULTS_DIR = resultsDir(args.resultsDir);

  if (args.runAll || args.group !== undefined) {
    return runGroupSweep(
      args.group ?? "all",
      args.parallel,
      args.retryFailedIsolated,
    );
  }

  if (!args.templateId) {
    await printUsage();
    return 1;
  }

  const spec = SPECS_BY_TEMPLATE_ID.get(args.templateId);
  if (!spec) {
    process.stderr.write(
      `Unknown template id: ${args.templateId} (known: ${[...SPECS_BY_TEMPLATE_ID.keys()].join(", ")})\n`,
    );
    return 1;
  }

  // The same declaration the sweep reads, so that running one scenario by
  // hand means what running it in the sweep means. Without this,
  // `bun run e2e:smoke` -- which names an expected-failing scenario
  // explicitly -- would contradict `bun run e2e` on the same commit.
  const expected = await expectedFailureEntryFor(spec.templateId);

  // Scope table first -- a NOT_APPLICABLE scenario never starts a container.
  const scope = await scopeEntryFor(spec.templateId);
  if (scope?.status === "NOT_APPLICABLE") {
    process.stderr.write(
      `[runner] RESULT: ${spec.templateId} NOT APPLICABLE (no container started): ${scope.reason}\n`,
    );
    return exitForSingleRun(spec.templateId, "NOT APPLICABLE", expected);
  }

  await assertNoForeignSweep([args.cpId]);

  const options: RunOptions = {
    cpId: args.cpId,
    connector: args.connector,
    timeoutSecs: args.timeoutSecs,
  };
  const run = await runScenario(spec, options);
  if (run.kind === "not-applicable") {
    process.stderr.write(
      `[runner] RESULT: ${spec.templateId} NOT APPLICABLE: ${run.reason}\n`,
    );
    return exitForSingleRun(spec.templateId, "NOT APPLICABLE", expected);
  }

  return exitForSingleRun(
    spec.templateId,
    verdictForRecorder(run.rec),
    expected,
  );
}

/**
 * Exit code for one scenario run by hand, through the SAME classifier the
 * sweep's exit code reads.
 *
 * It used to re-implement the rule in nested ifs, because standingOf() took a
 * ScenarioOutcome this path does not have. That is the mistake
 * unexpectedPassDetail() was reshaped to fix one level down -- the two paths
 * had already disagreed once, about NOT APPLICABLE -- so the decision gets the
 * same treatment as the message that explains it.
 *
 * A single run has no isolated retry, so no flake to weigh: one outcome IS the
 * whole evidence, and unexpectedPassDetail() says which kind of evidence.
 *
 * Only an ASSERTION failure reaches this function. A throw out of runScenario
 * -- a bounded wait giving up, a driver blowing up -- propagates to
 * bin/ocpp-tck.ts and exits 1 whatever the declaration says, where the sweep
 * would have caught it as ERROR and excused it. Deliberate: this is the
 * debugging mode, a stack trace is the thing worth having, and a declared
 * finding about what a CSMS ANSWERS is not a licence to swallow a crash.
 */
function exitForSingleRun(
  templateId: string,
  verdict: Verdict,
  expected: ExpectedFailureEntry | undefined,
): number {
  const standing = standingOf(verdict, expected);
  // Undeclared first, so `expected` is narrowed for the rest. Reading it
  // through `?.` under a standing the compiler cannot tie back to it is how a
  // report ends up saying a finding was excused while naming nothing -- see
  // withStanding() for the same hazard on the sweep side.
  if (expected === undefined) {
    return standing === "unexpected-fail" ? 1 : 0;
  }
  switch (standing) {
    case "expected-fail":
      process.stderr.write(
        `[runner] ${templateId} EXPECTED FAIL: ${expected.reason} ` +
          `(${expected.finding}) -- declared by this driver, exit 0.\n`,
      );
      return 0;
    case "unexpected-pass":
      process.stderr.write(
        `[runner] ${templateId} UNEXPECTED PASS: this driver declares it ` +
          `expected-failing (${expected.reason} -- ${expected.finding}), ` +
          `and ${unexpectedPassDetail(verdict)}.\n`,
      );
      return 1;
    case "declared-but-errored":
      // Not reachable today -- a throw never reaches this function, so
      // `verdict` is never ERROR here and a declared FAIL is expected-fail.
      // Written out anyway rather than folded into a default: this is the case
      // the sweep exists to report, and the day this path learns to catch a
      // throw it must not silently exit 1 with no word about the declaration
      // it was carrying.
      process.stderr.write(
        `[runner] ${templateId} DECLARED, BUT ERRORED (${expected.reason} -- ` +
          `${expected.finding}): ${declaredButErroredDetail(verdict)}.\n`,
      );
      return 1;
    case "ok":
    case "unexpected-fail":
      // Unreachable: both are the undeclared standings, and undeclared
      // returned above.
      return endsTheBuild(standing) ? 1 : 0;
  }
}
