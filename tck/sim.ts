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

const STOP_GRACE_MS = 10_000;

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
  /** Extra CLI flags appended verbatim, whitespace-split from
   *  `SIM_EXTRA_ARGS` (e.g. `--connectors 2`). */
  extraArgs: string[];
}

function splitArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/\s+/).filter((token) => token !== "");
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
  if (cfg.entrypoint) args.push("--entrypoint", cfg.entrypoint);
  args.push(cfg.image, ...cfg.command);
  args.push("--ws-url", resolveWsUrl(cpId, cfg));
  args.push("--cp-id", cpId);
  args.push("--json");
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

function containerName(cpId: string, templateId: string): string {
  return `simts-${cpId.toLowerCase()}-${templateId}`.slice(0, 63);
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
