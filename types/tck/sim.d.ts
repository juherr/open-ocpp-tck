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
export declare const DEFAULT_SIM_IMAGE = "ghcr.io/shiv3/ocpp-cp-simulator@sha256:ac35788f136c27db9371051b446af2b49270f1fc007d2172556fb761c7b01026";
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
export declare function defaultSimConfig(env?: NodeJS.ProcessEnv): SimConfig;
/** The WebSocket URL this charge point dials, honouring
 *  {@link SimConfig.appendCpIdToWsPath}. Exported for the scope/driver
 *  modules and tests. */
export declare function resolveWsUrl(cpId: string, cfg: SimConfig): string;
/**
 * The full `docker` argv (without the leading "docker") for one simulator
 * container. Pure -- exported so the runner and its tests can inspect what
 * would be launched without launching it.
 */
export declare function buildDockerArgs(cpId: string, container: string, cfg: SimConfig): string[];
/**
 * Human-readable rendering of {@link buildDockerArgs} with the Basic auth
 * password replaced. Everything that logs the command -- stderr traces,
 * results/*.log, error messages -- MUST go through this: the raw argv holds
 * `SIM_WS_BASIC_PASS` in clear text.
 */
export declare function renderDockerArgs(args: readonly string[]): string;
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
/** Starts a detached-from-shell but attached-to-us simulator container for
 *  one charge point, running JSON-Lines mode. `templateId` is only used to
 *  build a readable, collision-avoiding container name (mirrors lib.sh's
 *  sim_container_name). */
export declare function startSim(cpId: string, templateId: string, cfg: SimConfig): Promise<SimProcess>;
