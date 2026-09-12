/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/sim.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: the hardcoded docker argv is now built from SimConfig; the `-v <repoRoot>:/app -w /app` bind mount and `repoRoot` are gone (the published image ships the CLI sources); the image is pinned by digest; `--network` left the default path; outgoing WS Basic auth and an optional cpId-in-path WS URL were added; every trace of the command redacts the password; the waiter list takes a predicate so `call()` can correlate a JSON command with its response by id, waitForLine is that predicate applied to a RegExp, and stdout's EOF rejects every pending wait with the exit code instead of leaving it to its timeout. The line pump, stop(), container cleanup and signal handlers are byte-for-byte upstream.
 *
 * sim.ts -- docker-spawned simulator process: launches the ocpp-cp-simulator
 * CLI in JSON Lines mode inside a container (port of lib.sh's sim_start),
 * feeds it JSON commands directly over the child's stdin (no intermediate
 * feeder shell script -- lib.sh needed one only because its `docker run -d`
 * detaches immediately; spawning attached via Bun.spawn lets this driver
 * write commands with real timing control instead), and streams stdout back
 * as lines for the caller to parse (ocpp.ts) or wait on.
 *
 * Upstream ran `oven/bun:1.3-alpine` with the checkout bind-mounted at /app.
 * Here the published image `ghcr.io/shiv3/ocpp-cp-simulator` carries the CLI
 * sources itself, so there is no repo to mount -- but its default entrypoint
 * (`/usr/local/bin/entrypoint.sh`) always appends
 * `--http-host 0.0.0.0 --unsafe-remote --web-console $HTTP_PORT`, which puts
 * the CLI in daemon/web-console mode: it auto-connects on startup and emits
 * `[server] …` lines instead of the JSON Lines event stream this runner
 * parses (upstream's `docker/entrypoint.sh` composes that flag bundle; re-read
 * at v0.7.12 and observed live on the pinned digest). The entrypoint is
 * therefore overridden back to `bun src/cli/main.ts`, which runs the very
 * same embedded sources in true JSON Lines mode.
 */

import { basename, dirname } from "node:path";

const STOP_GRACE_MS = 10_000;

/**
 * Where {@link SimConfig.tracePath}'s directory is mounted in the container.
 *
 * A directory rather than the file: docker creates a missing bind-mount source
 * as a DIRECTORY, so mounting the trace file itself turns a first run -- the
 * one where the file cannot exist yet -- into a container writing to a path
 * that is a directory. The runner's own results directory is what gets mounted,
 * which means the container can write beside our logs; accepted, because it is
 * our artifact directory and the alternative puts a scenario's trace somewhere
 * other than next to the log it belongs to.
 */
const TRACE_MOUNT = "/trace";

/**
 * Default simulator image, PINNED BY DIGEST (repo convention: never
 * `latest`, never a bare tag). This is the multi-arch index digest of
 * `ghcr.io/shiv3/ocpp-cp-simulator:0.7.12`, resolved 2026-09-12 with
 * `docker buildx imagetools inspect`; it therefore still selects the right
 * per-platform manifest on amd64 and arm64. Override with `SIM_IMAGE`.
 *
 * THE ONLY DECLARATION OF THIS DIGEST. A shell caller that needs to `docker
 * pull` or smoke-test the image before a campaign must read it back with
 * `ocpp-tck print-sim-image` rather than repeat the literal: a second copy in
 * a wrapper script lets the preflight validate one image while the run uses
 * another, and once the wrapper lives in a different repository from this
 * file, nothing can ever make the two agree again.
 */
export const DEFAULT_SIM_IMAGE =
  "ghcr.io/shiv3/ocpp-cp-simulator@sha256:b94ee6c78e3976943a268ce68e6095564db1f048d049ea020cb204b2d826504b";

/** What the entrypoint override runs inside the image (WorkingDir /app). */
const DEFAULT_SIM_ENTRYPOINT = "bun";
const DEFAULT_SIM_COMMAND = ["src/cli/main.ts"];

/** Replaces a secret in any human-visible rendering of the docker argv. */
const REDACTED = "<redacted>";

/** How long {@link SimProcess.call} waits for the CLI to answer. The commands
 *  it carries are in-process on the CLI's side -- loading a definition, reading
 *  one back -- so this bounds a hung CLI, not a slow CSMS. */
const CALL_TIMEOUT_MS = 10_000;

/** How long {@link startSim} waits for the CLI's first answer. This one
 *  covers the container START, which on a machine that has never seen the
 *  image includes pulling it -- see the probe in startSim. */
const START_TIMEOUT_MS = 120_000;

/** What the CLI writes back for a command that carried an `id`
 *  (`toJsonResponse` in the pinned image's `src/cli/output.ts`). */
export type SimResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/**
 * The response to the call whose id is `id`, or undefined when `line` is
 * anything else -- an event, another call's response, a frame log line.
 *
 * ATTRIBUTED BY THE `id` MEMBER AND NOTHING ELSE. Not by position in the
 * stream (events interleave with responses on the same stdout), and not by
 * where `id` sits in the line: the CLI happens to serialise it first, and a
 * pattern anchored on that would be a fact about upstream's key order wearing
 * the shape of a protocol. The line is parsed, then asked.
 */
export function parseResponse(line: string, id: string): SimResponse | undefined {
  if (!line.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const response = parsed as { id?: unknown; ok?: unknown; data?: unknown; error?: unknown };
  if (response.id !== id || typeof response.ok !== "boolean") return undefined;
  return response.ok
    ? { ok: true, data: response.data }
    : { ok: false, error: String(response.error ?? "") };
}

// ---------------------------------------------------------------------------
// Signal-safe cleanup -- a bare try/finally around a run does NOT survive
// Ctrl-C (SIGINT) or a `docker stop`/CI-cancel-driven SIGTERM arriving while
// the runner is `await sleep(...)`-ing (e.g. holdSecs): Node/Bun's default
// disposition for those signals is immediate process termination, which
// unwinds nothing -- no `finally` block runs, so `sim.stop()`'s unconditional
// `docker stop`/`docker rm -f` (below) never fires and the container is
// orphaned. Registering a handler here overrides that default and gives
// every SimProcess started via startSim() a chance to actually run that
// cleanup path before the process exits. Installed lazily (on first
// startSim() call) so importing this module for its types/tests never has
// the side effect of installing process-wide signal handlers.
// ---------------------------------------------------------------------------

const activeSims = new Set<SimProcess>();
let signalHandlersInstalled = false;

function installSignalHandlersOnce(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    process.stderr.write(
      `[runner] received ${signal} -- stopping ${activeSims.size} active sim container(s) before exit\n`,
    );
    void (async () => {
      await Promise.allSettled([...activeSims].map((sim) => sim.stop()));
      process.exit(signal === "SIGINT" ? 130 : 143);
    })();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

/**
 * The OCPP versions the pinned image's CLI accepts, spelled as it spells them.
 *
 * TYPED ON WHAT THE CLI TAKES, NOT ON WHAT THIS SUITE TESTS. The list is read
 * off `--help` at {@link DEFAULT_SIM_IMAGE} (issue #57), and it is wider than
 * the versions any scenario here drives -- narrowing it to those would make the
 * type a statement about our scenarios wearing the shape of a statement about
 * the simulator, and the first `OCPP-1.6S` question would be a type error
 * instead of an experiment.
 */
export const SIM_OCPP_VERSIONS = [
  "OCPP-1.2",
  "OCPP-1.5",
  "OCPP-1.6J",
  "OCPP-1.6S",
  "OCPP-2.0.1",
  "OCPP-2.1",
] as const;

export type SimOcppVersion = (typeof SIM_OCPP_VERSIONS)[number];

/** What the CLI itself defaults to when `--ocpp-version` is absent, so the 47
 *  `cert16-` scenarios keep running exactly what they have always run. */
export const DEFAULT_SIM_OCPP_VERSION: SimOcppVersion = "OCPP-1.6J";

export interface SimConfig {
  /** Simulator container image. Pinned by digest by default
   *  ({@link DEFAULT_SIM_IMAGE}); `SIM_IMAGE` overrides. */
  image: string;
  /** CSMS WebSocket base URL the charge point dials out to. */
  wsUrl: string;
  /** docker network for the container. Undefined (the default) means the
   *  stock bridge network, which is what a PUBLIC CSMS needs: the container
   *  must reach the internet. `SIM_NETWORK` is the escape hatch for a CSMS
   *  reachable only on a user-defined docker network -- a CSMS addressed by
   *  container name rather than by public hostname. */
  network?: string;
  /** Whether the charge point id is appended as a path segment to
   *  {@link wsUrl} (`ws://host/path/<cpId>`) or passed only via `--cp-id`.
   *  OCPP 1.6-J convention is to append it, and every CSMS this harness has
   *  driven so far does -- but the target CSMS's exact URL shape is not
   *  settled, so `SIM_WS_APPEND_CP_ID=0` turns it off. */
  appendCpIdToWsPath: boolean;
  /** Basic auth username for the OUTGOING CP -> CSMS WebSocket. Undefined
   *  when `SIM_WS_BASIC_USER` is unset: no auth flags are passed at all. */
  basicAuthUser?: string;
  /** Basic auth password for the OUTGOING CP -> CSMS WebSocket
   *  (`SIM_WS_BASIC_PASS`). NEVER rendered in a trace -- see
   *  {@link renderDockerArgs}. */
  basicAuthPass?: string;
  /** Container entrypoint override. See this module's header for why the
   *  image's own entrypoint is bypassed; `SIM_ENTRYPOINT` restores it (pass
   *  an empty string to use the image default). */
  entrypoint?: string;
  /** Argv handed to {@link entrypoint} ahead of the connection flags. */
  command: string[];
  /** OCPP version the charge point speaks (`SIM_OCPP_VERSION`). A PROPERTY OF
   *  THE SCENARIO, not of the CSMS -- and deliberately not on the driver's
   *  {@link https://github.com/juherr/open-ocpp-tck/issues/57 transport
   *  defaults}, see the note beside `SimTransportDefaults` in driver.ts. */
  ocppVersion: SimOcppVersion;
  /**
   * HOST path of the JSONL wire trace this container appends to, or undefined
   * for no trace at all -- in which case the argv carries neither a mount nor
   * the flag.
   *
   * A host path, not the container's, because the mount is this function's
   * business: the file has to outlive `docker rm -f` (see {@link SimProcess} and
   * `stop()`), and a `--trace-output` pointing anywhere else writes into a
   * container that is deleted seconds later. That is exactly how the format was
   * unreachable through this runner until now.
   *
   * Set per scenario by the runner. `startSim` itself leaves it undefined, so a
   * library caller gets today's argv unless it asks for a trace.
   */
  tracePath?: string;
  /**
   * Extra CLI flags appended verbatim, whitespace-split from `SIM_EXTRA_ARGS`
   * (e.g. `--connectors 2`).
   *
   * THE LAST WORD ON THE TWO FLAGS THIS MODULE PASSES AS A PREFERENCE --
   * `--ocpp-version` and `--trace-output`, see {@link buildDockerArgs}. It is
   * NOT the last word on the connection flags: `--ws-url`, `--cp-id` and
   * `--json` are how this runner finds, names and parses the charge point at
   * all, and a scenario whose container answered on another id would report
   * another station's wire. Overriding those is `SIM_WS_URL` and
   * `OCPP_CP_IDS`, which change the run rather than one container's argv.
   */
  extraArgs: string[];
}

function splitArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/\s+/).filter((token) => token !== "");
}

/** Whether `extraArgs` already carries `flag`, in either spelling the CLI's
 *  parser accepts. What makes {@link SimConfig.extraArgs} the last word on the
 *  two flags that consult it, without depending on how upstream resolves a
 *  repeated option.
 *
 *  EXPORTED for the runner, which is the only place that can see both this and
 *  a scenario's declared protocol: being the last word is right for an operator
 *  overriding a default, and wrong -- silently -- when what it overrides is a
 *  certification case's own version. See the refusal in main.ts. */
export function namesFlag(extraArgs: readonly string[], flag: string): boolean {
  return extraArgs.some(
    (token) => token === flag || token.startsWith(`${flag}=`),
  );
}

/**
 * `SIM_OCPP_VERSION` as one of the values the CLI takes.
 *
 * REFUSED RATHER THAN PASSED THROUGH. A typo -- `OCPP-2.0` for `OCPP-2.0.1`,
 * `2.0.1` for `OCPP-2.0.1` -- reaches the CLI inside a container whose stdout
 * this runner parses for OCPP frames, so what the operator would see is a
 * scenario that boots nothing and a timeout, several minutes from the mistake.
 * Refusing here says the wrong word back to them, with the accepted list.
 */
function resolveOcppVersion(raw: string | undefined): SimOcppVersion {
  if (!raw) return DEFAULT_SIM_OCPP_VERSION;
  const known = SIM_OCPP_VERSIONS.find((version) => version === raw);
  if (known) return known;
  throw new Error(
    `SIM_OCPP_VERSION=${raw} is not a version this simulator image accepts. ` +
      `Spell it exactly as its CLI does: ${SIM_OCPP_VERSIONS.join(", ")}.`,
  );
}

export function defaultSimConfig(
  env: NodeJS.ProcessEnv = process.env,
): SimConfig {
  const entrypoint = env.SIM_ENTRYPOINT ?? DEFAULT_SIM_ENTRYPOINT;
  return {
    image: env.SIM_IMAGE ?? DEFAULT_SIM_IMAGE,
    wsUrl: env.SIM_WS_URL ?? "ws://localhost:8080/ocpp/",
    network: env.SIM_NETWORK || undefined,
    appendCpIdToWsPath: env.SIM_WS_APPEND_CP_ID !== "0",
    basicAuthUser: env.SIM_WS_BASIC_USER || undefined,
    basicAuthPass: env.SIM_WS_BASIC_PASS || undefined,
    entrypoint: entrypoint === "" ? undefined : entrypoint,
    command:
      env.SIM_COMMAND !== undefined
        ? splitArgs(env.SIM_COMMAND)
        : [...DEFAULT_SIM_COMMAND],
    ocppVersion: resolveOcppVersion(env.SIM_OCPP_VERSION),
    extraArgs: splitArgs(env.SIM_EXTRA_ARGS),
  };
}

/**
 * Whether a run should ask its container for a wire trace at all --
 * `SIM_TRACE=0` is the one thing that says no.
 *
 * HERE BECAUSE THIS MODULE OWNS THE `SIM_*` NAMESPACE. Every other variable in
 * it resolves in {@link defaultSimConfig}, and a reader auditing which of them
 * exist reads this file; one resolved in the runner instead is one they would
 * not find. It is also what puts the off switch under the same offline guard as
 * its neighbours, which a `process.env` read inside the runner cannot be.
 *
 * NOT A `SimConfig` FIELD, and that was tried: the config already carries
 * {@link SimConfig.tracePath}, whose absence IS "no trace", so a boolean beside
 * it is a second source of the same truth that can contradict it -- and the
 * path is one file per scenario attempt, which this module has no way to name.
 * The caller asks this, then decides the path.
 */
export function traceRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIM_TRACE !== "0";
}

/** The WebSocket URL this charge point dials, honouring
 *  {@link SimConfig.appendCpIdToWsPath}. Exported for the scope/driver
 *  modules and tests. */
export function resolveWsUrl(cpId: string, cfg: SimConfig): string {
  if (!cfg.appendCpIdToWsPath) return cfg.wsUrl;
  return cfg.wsUrl.endsWith("/")
    ? `${cfg.wsUrl}${cpId}`
    : `${cfg.wsUrl}/${cpId}`;
}

/**
 * The full `docker` argv (without the leading "docker") for one simulator
 * container. Pure -- exported so the runner and its tests can inspect what
 * would be launched without launching it.
 */
export function buildDockerArgs(
  cpId: string,
  container: string,
  cfg: SimConfig,
): string[] {
  const args = ["run", "-i", "--rm", "--name", container];
  if (cfg.network) args.push("--network", cfg.network);
  if (cfg.tracePath) {
    args.push("-v", `${dirname(cfg.tracePath)}:${TRACE_MOUNT}`);
  }
  if (cfg.entrypoint) args.push("--entrypoint", cfg.entrypoint);
  args.push(cfg.image, ...cfg.command);
  args.push("--ws-url", resolveWsUrl(cpId, cfg));
  args.push("--cp-id", cpId);
  args.push("--json");
  // EMITTED EVEN WHEN IT IS THE CLI'S OWN DEFAULT, because this argv is the
  // only place a run says which protocol it spoke: it goes to stderr, and the
  // runner writes it as the first line of results/*.log through
  // renderDockerArgs -- which it did not until issue #63, so no archived run
  // before that one can answer the question this flag exists to answer. A 1.6 scenario driven on 2.0.1
  // passes six of its seven checks -- measured, issue #57 -- so "which version
  // was that run?" has to be answerable from the evidence rather than from
  // whichever environment the operator had exported.
  //
  // SIM_EXTRA_ARGS STAYS THE ESCAPE HATCH AND WINS. Not by appending both and
  // letting the CLI's parser pick the last one: that would make the outcome a
  // property of upstream's argument handling, which nothing here pins, tests or
  // could notice changing under a digest bump. Ours is simply not emitted.
  if (!namesFlag(cfg.extraArgs, "--ocpp-version")) {
    args.push("--ocpp-version", cfg.ocppVersion);
  }
  // Same rule for the same reason: an operator who spells their own
  // --trace-output gets theirs and only theirs. The mount still follows
  // tracePath, which is the only path this function knows exists on the host.
  if (cfg.tracePath && !namesFlag(cfg.extraArgs, "--trace-output")) {
    args.push("--trace-output", `${TRACE_MOUNT}/${basename(cfg.tracePath)}`);
  }
  // Only when BOTH halves are configured -- a lone username would make the
  // CLI dial with an empty password rather than no auth at all.
  if (cfg.basicAuthUser && cfg.basicAuthPass) {
    args.push("--basic-auth-user", cfg.basicAuthUser);
    args.push("--basic-auth-pass", cfg.basicAuthPass);
  }
  args.push(...cfg.extraArgs);
  return args;
}

/**
 * Human-readable rendering of {@link buildDockerArgs} with the Basic auth
 * password replaced. Everything that logs the command -- stderr traces,
 * results/*.log, error messages -- MUST go through this: the raw argv holds
 * `SIM_WS_BASIC_PASS` in clear text.
 */
export function renderDockerArgs(args: readonly string[]): string {
  const out = [...args];
  const idx = out.indexOf("--basic-auth-pass");
  if (idx !== -1 && idx + 1 < out.length) out[idx + 1] = REDACTED;
  return ["docker", ...out].join(" ");
}

export interface SimProcess {
  readonly cpId: string;
  readonly container: string;
  /** The docker command line this container was started with, rendered and
   *  password-redacted -- the record, not a reconstruction. It is here rather
   *  than rebuilt by callers because it is the only line that says which OCPP
   *  protocol a run spoke, and a caller re-deriving it from the same inputs
   *  can drift from what was actually spawned the moment either side gains an
   *  argument. `runScenario` writes it as the first line of `results/*.log`. */
  readonly argv: string;
  /** Every stdout line seen so far, in order (JSON events, JSON command
   *  responses, and the plain-text Logger lines ocpp.ts parses). */
  readonly lines: readonly string[];
  /** Writes one JSON command line to the CLI's stdin (JSON Lines protocol). */
  send(command: Record<string, unknown>): Promise<void>;
  /**
   * Sends one JSON command WITH an id and resolves with the `data` of the
   * response that carries that id, or rejects with the CLI's own error text
   * when it answers `ok: false` -- and after `timeoutMs` when it does not
   * answer at all.
   *
   * WHY A SECOND VERB BESIDE `send`. The commands the runner has always sent
   * are fire-and-forget by nature -- `connect` is answered by a frame on the
   * wire, `run_scenario_template` by a `scenario_started` event -- and their
   * responses were ignored, which is how a refused one (`already running`)
   * sat in every results/*.log for a year. The template-once sequence in
   * tck/template-once.ts is different in kind: its second command needs the
   * FIRST one's answer (the scenario id, then the definition), so the
   * response is the payload rather than a receipt.
   */
  call(
    command: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>;
  /** Resolves with the first line (existing or future) matching `pattern`,
   *  or rejects after `timeoutMs` -- every wait in this module is bounded. */
  waitForLine(pattern: RegExp, timeoutMs: number): Promise<string>;
  /** Closes stdin (lets the CLI exit on its own EOF handler), then
   *  docker-stop/rm the container unconditionally and reap the local
   *  process. Idempotent, never throws. */
  stop(): Promise<void>;
}

/** The prefix every simulator container driving `cpId` carries, whatever
 *  scenario it is running. The one declaration of that shape: the name is built
 *  from it and {@link classifyForeignSims} reads it back. */
function stationPrefix(cpId: string): string {
  return `simts-${cpId.toLowerCase()}-`;
}

function containerName(cpId: string, templateId: string): string {
  return `${stationPrefix(cpId)}${templateId}`.slice(0, 63);
}

/**
 * How a template id opens: its certification namespace -- `cert16-`,
 * `cert201-`, whatever the next protocol version is called. NO VERSION LITERAL,
 * because the guards below used to carry `cert16-` and went blind to everything
 * else without saying so.
 *
 * One declaration, two positions, and built rather than written twice on
 * purpose: the two readings below must agree, and a namespace narrowed in one
 * place and not the other is the same silent half-coverage in a new shape.
 */
const TEMPLATE_NAMESPACE = String.raw`cert\d+-`;

/** The template-id half of `simts-<cp-id>-<template-id>`, read where the name
 *  has already been attributed to a charge point. */
const TEMPLATE_HEAD = new RegExp(`^${TEMPLATE_NAMESPACE}`);

/** `simts-<cp-id>-<template-id>`. USED ONLY TO NAME a station that is not on
 *  our roster; see {@link classifyForeignSims} for why the refusal itself does
 *  not parse. */
const SIM_NAME = new RegExp(`^simts-(.+?)-${TEMPLATE_NAMESPACE}`);

/** Simulator container names this process did not start. Empty on an idle
 *  daemon. */
async function foreignSimContainers(): Promise<string[]> {
  const proc = Bun.spawn(
    ["docker", "ps", "--filter", "name=simts-", "--format", "{{.Names}}"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** What {@link assertNoForeignSweep} decides, split from how it learns the
 *  container names so the rule can be checked without a docker daemon. */
export interface ForeignSweep {
  /** OUR charge point ids that a container we did not start is already
   *  driving. Non-empty means refuse. */
  readonly shared: string[];
  /** The other sweeps' stations, for the note: the charge point id where the
   *  container name yields one, the container name itself where it does not. */
  readonly others: string[];
}

/**
 * Which of `cpIds` a foreign container is driving, and what else is running.
 *
 * THE REFUSAL DOES NOT PARSE THE CONTAINER NAME. It asks, of each id we are
 * about to drive, whether some foreign container's name starts with that id's
 * prefix -- so it carries no scenario namespace, and a `cert201-` container (or
 * a `cert21-` one, or a namespace nobody has proposed yet) is caught by the
 * same expression that catches `cert16-`. It was `/^simts-(.+?)-cert16-/`, and
 * the moment a 2.0.1 scenario existed half the suite would have lost the
 * protection silently.
 *
 * It also settles the ambiguity that regex could not: `cpId` comes from
 * `OCPP_CP_IDS`, so it may itself contain a hyphen, and no lazy or greedy
 * quantifier can say which hyphen of `simts-cp-1-cert16-tc001` ends the station.
 * Comparing against the roster asks the question the other way round: a
 * container belongs to `cpId` when its name is that station's prefix followed by
 * something that opens like a template id. Both halves are needed --
 * `simts-cp-` alone also prefixes station `cp-1`'s containers, so without the
 * second half a sweep on `cp` would refuse to start because a different sweep
 * is driving `cp-1`.
 *
 * WHERE A HYPHEN LEAVES TWO READINGS, IT ERRS TOWARDS REFUSING. A charge point
 * id containing `cert16-` makes `simts-cp-cert16-x-cert201-y` readable as
 * station `cp` or as station `cp-cert16-x`, and nothing in the name says which.
 * A spurious refusal costs a wait and names what it saw; a missed one costs the
 * sweep that attributes another sweep's rows to the CSMS under test.
 *
 * WHY NOT A DOCKER LABEL, which is the other shape proposed and removes the
 * class of bug rather than the instance: a label only exists on containers
 * started by code that carries it. Several checkouts of this repository drive
 * one daemon here, so a label-only guard is blind to every container started by
 * a checkout that predates the label -- silently, in exactly the situation this
 * guard exists for. The container name is the only identifier every sweep,
 * including the ones already running, agrees on.
 */
export function classifyForeignSims(
  containers: readonly string[],
  cpIds: readonly string[],
): ForeignSweep {
  const shared = new Set<string>();
  const attributed = new Set<string>();
  for (const cpId of cpIds) {
    const prefix = stationPrefix(cpId);
    // Both sides lowered: `containerName` lowers the id it builds with, and
    // docker itself accepts an upper-case name from whatever started the
    // other sweep.
    const mine = containers.filter((name) => {
      const lowered = name.toLowerCase();
      return (
        lowered.startsWith(prefix) &&
        TEMPLATE_HEAD.test(lowered.slice(prefix.length))
      );
    });
    if (mine.length === 0) continue;
    shared.add(cpId);
    for (const name of mine) attributed.add(name);
  }

  const others = new Set<string>();
  for (const name of containers) {
    if (attributed.has(name)) continue;
    // A name that does not parse is REPORTED, not skipped: `containerName`
    // caps at 63 characters, so a long enough charge point id truncates the
    // delimiter away, and an unattributable container is exactly the thing
    // worth putting in front of whoever is about to start a sweep.
    const match = SIM_NAME.exec(name);
    others.add(match ? match[1] : name);
  }

  return { shared: [...shared].sort(), others: [...others].sort() };
}

/**
 * Refuses to start when another sweep is already driving one of OUR charge
 * points, and says so when one is driving different ones.
 *
 * WHY. Several checkouts of this repository get worked on at once against one
 * docker daemon, and nothing warns you. Two sweeps sharing a charge point id
 * interleave their scenarios in one CSMS database, and the result is not a
 * clean failure: a scenario reads a transaction row the OTHER run created and
 * reports a conformance finding about the CSMS. That happened here -- a TC_005
 * assertion failed on `id_tag CERT018`, a tag belonging to a different
 * scenario entirely -- and it cost a full sweep to attribute.
 *
 * THE CHECK IS ON THE CHARGE POINT ID, NOT ON "IS ANYTHING RUNNING", because
 * running two sweeps at once is legitimate and is the documented way out: a
 * second CSMS on its own ports with its own OCPP_CP_IDS (see
 * drivers/citrineos/README.md). Refusing that would forbid the fix along with
 * the problem. Sharing a cp-id is the part that cannot be made safe -- the
 * container name is daemon-global, so `docker run --name` collides even when
 * the two CSMS are genuinely separate.
 *
 * CALLED ONCE PER PROCESS, FROM THE ENTRY POINTS, and that placement is the
 * point rather than tidiness: `prepareStation()` writes to the CSMS before the
 * first container starts, so a check inside startSim() would refuse only after
 * this process had already written into a database another sweep was using.
 * It also runs before any container of ours exists, so our own parallel lanes
 * never look foreign to each other.
 */
export async function assertNoForeignSweep(
  cpIds: readonly string[],
): Promise<void> {
  const containers = await foreignSimContainers();
  if (containers.length === 0) return;
  const { shared, others } = classifyForeignSims(containers, cpIds);
  if (shared.length > 0) {
    throw new Error(
      `another sweep is already driving ${shared.join(", ")}: simulator ` +
        "container(s) with that charge point id are running that this process " +
        "did not start. Two sweeps sharing a charge point id write into one " +
        "CSMS and report each other's state as findings. Wait for it, or run " +
        "isolated -- a separate CSMS and a different OCPP_CP_IDS.",
    );
  }
  // "NOT ATTRIBUTABLE TO THIS ROSTER" rather than "none on this roster", which
  // is a stronger claim than the parse can support: an entry printed as a full
  // `simts-…` container name is one no station id explains, and it may still be
  // driving one of ours under a name this runner did not build -- a
  // hand-launched debug container is exactly that shape. Read those against
  // your own ids.
  process.stderr.write(
    `[runner] NOTE: ${containers.length} simulator container(s) from another ` +
      `sweep are running (${others.join(", ")}); none is attributable to this ` +
      "roster. Fine if they drive their own CSMS; a shared one still " +
      "interleaves in the database. An entry printed as a full container name " +
      "is one this runner could not attribute to a station at all.\n",
  );
}

async function runDocker(args: string[]): Promise<void> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    let isDone = false;
    while (!isDone) {
      const result = await reader.read();
      if (result.done) {
        isDone = true;
        continue;
      }
      buffer += decoder.decode(result.value, { stream: true });
      let lineBreak = buffer.indexOf("\n");
      while (lineBreak !== -1) {
        onLine(buffer.slice(0, lineBreak).replace(/\r$/, ""));
        buffer = buffer.slice(lineBreak + 1);
        lineBreak = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer) onLine(buffer.replace(/\r$/, ""));
  } finally {
    reader.releaseLock();
  }
}

/** Starts a detached-from-shell but attached-to-us simulator container for
 *  one charge point, running JSON-Lines mode. `templateId` is only used to
 *  build a readable, collision-avoiding container name (mirrors lib.sh's
 *  sim_container_name). */
export async function startSim(
  cpId: string,
  templateId: string,
  cfg: SimConfig,
): Promise<SimProcess> {
  installSignalHandlersOnce();

  const container = containerName(cpId, templateId);

  // Best-effort cleanup of a stale container from an interrupted previous
  // run with the same name (mirrors lib.sh's sim_start).
  await runDocker(["rm", "-f", container]).catch(() => {});

  const dockerArgs = buildDockerArgs(cpId, container, cfg);
  const argv = renderDockerArgs(dockerArgs);
  process.stderr.write(`[runner] ${argv}\n`);

  const proc = Bun.spawn(["docker", ...dockerArgs], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const lines: string[] = [];
  const stderrLines: string[] = [];
  interface Waiter {
    test: (line: string) => boolean;
    what: string;
    resolve: (line: string) => void;
    reject: (err: Error) => void;
  }
  const waiters: Waiter[] = [];

  const recentStderr = (): string =>
    `last stderr:\n${stderrLines.slice(-20).join("\n")}`;

  const stdoutTask = readLines(proc.stdout, (line) => {
    lines.push(line);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].test(line)) {
        const [waiter] = waiters.splice(i, 1);
        waiter.resolve(line);
      }
    }
  });
  const stderrTask = readLines(proc.stderr, (line) => {
    stderrLines.push(line);
  });

  // A SIMULATOR THAT EXITED IS NOT ONE THAT IS SLOW TO ANSWER. stdout closing
  // is the one signal that no further line will come, and without it every
  // pending wait sat out its full budget -- START_TIMEOUT_MS of it for the
  // probe, when `docker run` had refused the image in the first second. So
  // the EOF, once the buffered output is drained, rejects every waiter with
  // the exit code and the stderr that explains it, and a wait armed after
  // that point is refused on the spot rather than parked.
  let exited: string | undefined;
  const EXIT_GRACE_MS = 2_000;
  void stdoutTask.then(async () => {
    const code = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), EXIT_GRACE_MS)),
    ]);
    exited = `simulator container ${container} exited (exit code ${code ?? "unknown"})`;
    for (const waiter of waiters.splice(0)) {
      waiter.reject(
        new Error(`${exited} before ${waiter.what}; ${recentStderr()}`),
      );
    }
  });

  /** The one wait: the first line (existing or future) `test` accepts, or a
   *  rejection after `timeoutMs` -- or as soon as the simulator has exited --
   *  naming `what` was waited for. */
  function waitFor(
    test: (line: string) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<string> {
    const existing = lines.find(test);
    if (existing !== undefined) return Promise.resolve(existing);
    if (exited !== undefined) {
      return Promise.reject(
        new Error(`${exited} before ${what}; ${recentStderr()}`),
      );
    }

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        test,
        what,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for ${what} on ${container}; ` +
              recentStderr(),
          ),
        );
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  function waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
    return waitFor((line) => pattern.test(line), `/${pattern.source}/`, timeoutMs);
  }

  async function send(command: Record<string, unknown>): Promise<void> {
    proc.stdin.write(`${JSON.stringify(command)}\n`);
    await proc.stdin.flush();
  }

  // Per container, so a response can only ever be matched against a call this
  // process made on this stdin.
  let nextCallId = 0;
  async function call(
    command: string,
    params?: Record<string, unknown>,
    timeoutMs: number = CALL_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = `tck-${++nextCallId}`;
    // The wait is armed BEFORE the write: the CLI answers in-process, and a
    // response that lands between the write and the wait is still in `lines`,
    // but ordering it this way makes that a fact rather than a guarantee.
    const answered = waitFor(
      (line) => parseResponse(line, id) !== undefined,
      `the response to ${command} (${id})`,
      timeoutMs,
    );
    try {
      await send(params === undefined ? { id, command } : { id, command, params });
    } catch (err) {
      // A write that failed (stdin closed under us) leaves a waiter that will
      // time out with nobody listening; own its rejection so the write's error
      // is the one that surfaces.
      answered.catch(() => {});
      throw err;
    }
    const response = parseResponse(await answered, id);
    if (response === undefined || !response.ok) {
      throw new Error(
        `${command} refused by the simulator on ${container}: ${response?.error ?? "unreadable response"}`,
      );
    }
    return response.data;
  }

  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    activeSims.delete(simProcess);

    try {
      await proc.stdin.end();
    } catch {
      // already closed
    }

    await Promise.race([
      proc.exited.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
    ]);

    // Always stop+rm explicitly, regardless of whether stdin-EOF already
    // made the CLI exit on its own -- mirrors lib.sh's sim_stop, which
    // never trusts `--rm` alone and never fails the caller.
    await runDocker(["stop", container]).catch(() => {});
    await runDocker(["rm", "-f", container]).catch(() => {});

    if (proc.exitCode === null && !proc.killed) {
      proc.kill("SIGKILL");
    }
    await proc.exited.catch(() => {});
    await Promise.allSettled([stdoutTask, stderrTask]);
  }

  const simProcess: SimProcess = {
    cpId,
    container,
    argv,
    get lines(): readonly string[] {
      return lines;
    },
    send,
    call,
    waitForLine,
    stop,
  };
  activeSims.add(simProcess);

  // THE CLI ANSWERS BEFORE THE CALLER GETS THE HANDLE. `docker run` returns
  // the moment the daemon accepts the command, and on a runner that has never
  // seen the image the pull happens between that and the CLI's first read of
  // stdin. Measured on CI, once: the first call of every lane timed out at
  // CALL_TIMEOUT_MS while the image was still downloading, and the isolated
  // retry passed on the cached image -- three ERROR rows per driver that read
  // as flakes. Until then the pull had been hiding inside the boot gate's soft
  // 30s, because nothing before `connect` waited on an answer. `status` is
  // answered from memory, so once it comes back every later call's budget is
  // the CLI's answer time and nothing else.
  try {
    await call("status", undefined, START_TIMEOUT_MS);
  } catch (err) {
    await stop();
    throw err;
  }
  return simProcess;
}
