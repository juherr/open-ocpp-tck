// Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/sim.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: the hardcoded docker argv is now built from SimConfig; the `-v <repoRoot>:/app -w /app` bind mount and `repoRoot` are gone (the published image ships the CLI sources); the image is pinned by digest; `--network` left the default path; outgoing WS Basic auth and an optional cpId-in-path WS URL were added; every trace of the command redacts the password. The line pump, waitForLine, stop(), container cleanup and signal handlers are byte-for-byte upstream.

/**
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
 * parses (verified live against 0.7.5 -- see P0-FINDINGS.md §9). The
 * entrypoint is therefore overridden back to `bun src/cli/main.ts`, which
 * runs the very same embedded sources in true JSON Lines mode.
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
 * `ghcr.io/shiv3/ocpp-cp-simulator:0.7.5`, resolved 2026-07-31 with
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
  "ghcr.io/shiv3/ocpp-cp-simulator@sha256:ac35788f136c27db9371051b446af2b49270f1fc007d2172556fb761c7b01026";

/** What the entrypoint override runs inside the image (WorkingDir /app). */
const DEFAULT_SIM_ENTRYPOINT = "bun";
const DEFAULT_SIM_COMMAND = ["src/cli/main.ts"];

/** Replaces a secret in any human-visible rendering of the docker argv. */
const REDACTED = "<redacted>";

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
  /** Extra CLI flags appended verbatim, whitespace-split from
   *  `SIM_EXTRA_ARGS` (e.g. `--connectors 2`). The LAST WORD on any flag this
   *  module also passes -- see {@link buildDockerArgs}. */
  extraArgs: string[];
}

function splitArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/\s+/).filter((token) => token !== "");
}

/** Whether `extraArgs` already carries `flag`, in either spelling the CLI's
 *  parser accepts. What makes {@link SimConfig.extraArgs} the last word without
 *  depending on how upstream resolves a repeated option. */
function namesFlag(extraArgs: readonly string[], flag: string): boolean {
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
  // only place a run says which protocol it spoke: it goes to stderr and into
  // results/*.log through renderDockerArgs. A 1.6 scenario driven on 2.0.1
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
  /** Every stdout line seen so far, in order (JSON events, JSON command
   *  responses, and the plain-text Logger lines ocpp.ts parses). */
  readonly lines: readonly string[];
  /** Writes one JSON command line to the CLI's stdin (JSON Lines protocol). */
  send(command: Record<string, unknown>): Promise<void>;
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
  process.stderr.write(
    `[runner] NOTE: ${containers.length} simulator container(s) from another ` +
      `sweep are running (${others.join(", ")}), none on this roster. Fine if ` +
      "they drive their own CSMS; a shared one still interleaves in the " +
      "database.\n",
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
  process.stderr.write(`[runner] ${renderDockerArgs(dockerArgs)}\n`);

  const proc = Bun.spawn(["docker", ...dockerArgs], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const lines: string[] = [];
  const stderrLines: string[] = [];
  interface Waiter {
    pattern: RegExp;
    resolve: (line: string) => void;
  }
  const waiters: Waiter[] = [];

  const stdoutTask = readLines(proc.stdout, (line) => {
    lines.push(line);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pattern.test(line)) {
        const [waiter] = waiters.splice(i, 1);
        waiter.resolve(line);
      }
    }
  });
  const stderrTask = readLines(proc.stderr, (line) => {
    stderrLines.push(line);
  });

  function waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
    const existing = lines.find((line) => pattern.test(line));
    if (existing !== undefined) return Promise.resolve(existing);

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        pattern,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
      };
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for /${pattern.source}/ on ${container}; ` +
              `last stderr:\n${stderrLines.slice(-20).join("\n")}`,
          ),
        );
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  async function send(command: Record<string, unknown>): Promise<void> {
    proc.stdin.write(`${JSON.stringify(command)}\n`);
    await proc.stdin.flush();
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
    get lines(): readonly string[] {
      return lines;
    },
    send,
    waitForLine,
    stop,
  };
  activeSims.add(simProcess);
  return simProcess;
}
