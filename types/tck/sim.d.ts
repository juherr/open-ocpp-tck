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
export declare const SIM_OCPP_VERSIONS: readonly ["OCPP-1.2", "OCPP-1.5", "OCPP-1.6J", "OCPP-1.6S", "OCPP-2.0.1", "OCPP-2.1"];
export type SimOcppVersion = (typeof SIM_OCPP_VERSIONS)[number];
/** What the CLI itself defaults to when `--ocpp-version` is absent, so the 47
 *  `cert16-` scenarios keep running exactly what they have always run. */
export declare const DEFAULT_SIM_OCPP_VERSION: SimOcppVersion;
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
/** Whether `extraArgs` already carries `flag`, in either spelling the CLI's
 *  parser accepts. What makes {@link SimConfig.extraArgs} the last word on the
 *  two flags that consult it, without depending on how upstream resolves a
 *  repeated option.
 *
 *  EXPORTED for the runner, which is the only place that can see both this and
 *  a scenario's declared protocol: being the last word is right for an operator
 *  overriding a default, and wrong -- silently -- when what it overrides is a
 *  certification case's own version. See the refusal in main.ts. */
export declare function namesFlag(extraArgs: readonly string[], flag: string): boolean;
export declare function defaultSimConfig(env?: NodeJS.ProcessEnv): SimConfig;
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
export declare function traceRequested(env?: NodeJS.ProcessEnv): boolean;
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
export declare function classifyForeignSims(containers: readonly string[], cpIds: readonly string[]): ForeignSweep;
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
export declare function assertNoForeignSweep(cpIds: readonly string[]): Promise<void>;
/** Starts a detached-from-shell but attached-to-us simulator container for
 *  one charge point, running JSON-Lines mode. `templateId` is only used to
 *  build a readable, collision-avoiding container name (mirrors lib.sh's
 *  sim_container_name). */
export declare function startSim(cpId: string, templateId: string, cfg: SimConfig): Promise<SimProcess>;
