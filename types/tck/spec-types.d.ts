/**
 * spec-types.ts -- the shape a scenario spec (port of specs/<id>.spec.sh)
 * takes in the TypeScript runner. Task 1 wires two specs directly in
 * main.ts against this shape; Task 2 grows a specs/ directory of these.
 */
import type { AssertRecorder } from "./assert";
import type { Frame } from "./ocpp";
import type { SimOcppVersion, SimProcess } from "./sim";
import type { CsmsOperations16, CsmsOperations201, CsmsRecords } from "./driver";
export interface DriveContext {
    cpId: string;
    connector: number;
    sim: SimProcess;
    /** The CSMS under test, whichever driver CSMS_DRIVER selected. A spec
     *  asks for OCPP operations and never learns which CSMS carried them
     *  out -- see driver.ts's CsmsOperation16 for the vocabulary. */
    csms16: CsmsOperations16;
    /** The OCPP 2.0.1 half of the same CSMS, for a cert201- scenario. NON-
     *  OPTIONAL as a spec sees it, exactly like records.reservations: a driver
     *  that speaks only 1.6 omits it and the runner substitutes a stub that
     *  throws, so a spec never writes `?.` and never branches on which driver is
     *  loaded -- see capabilities.ts. Absence therefore reads as NOT APPLICABLE
     *  rather than as a green scenario that drove nothing. */
    csms201: CsmsOperations201;
    /** What the CSMS believes happened: transactions, reservations, charging
     *  profiles. Read-only, and a driver that cannot answer says so rather
     *  than inventing a value -- see driver.ts's CsmsRecords. */
    records: CsmsRecords;
}
export interface AssertContext<D> {
    cpId: string;
    connector: number;
    /** Every parsed OCPP-J frame from the run, uniqueId-correlatable via
     *  ocpp.ts's findCall/findResponseFor. */
    frames: readonly Frame[];
    /** Every raw stdout line from the run (structured JSON events + plain
     *  Logger lines), for checks that aren't about a specific OCPP frame
     *  (scenario lifecycle events, boot-gate-suppression absence, ...). */
    lines: readonly string[];
    rec: AssertRecorder;
    records: CsmsRecords;
    /** Whatever `drive()` returned (e.g. a baseline captured before
     *  triggering a CSMS op), threaded through for a later negative check. */
    driveState: D;
}
export interface ScenarioSpec<D = void> {
    /**
     * TWO JOBS, and the second one is optional. It is this scenario's identity
     * everywhere -- the registry, a driver's scope table, the results filenames,
     * the container name, both pinned artifacts -- AND, unless
     * {@link runsSimTemplate} says otherwise, the name of the simulator-side
     * scenario template the charge point is asked to act out. Every scenario
     * ported from the bash suite is named after its template because it has one.
     */
    templateId: string;
    description?: string;
    /**
     * The OCPP version this scenario is written for, when it is written for one.
     *
     * ABSENT MEANS "whatever the environment resolves", which is what keeps the
     * 47 scenarios that predate this field running exactly what they have always
     * run. Declared, it WINS over `SIM_OCPP_VERSION`: the version is a property
     * of the scenario -- see SimConfig.ocppVersion, which said so before anything
     * could express it -- and an operator's export is not an opinion about which
     * protocol a certification case is about.
     *
     * The alternative, leaving the environment in charge, was measured and is
     * why this exists: a scenario driven on the version it was NOT written for
     * goes six checks out of seven green
     * ({@link https://github.com/juherr/open-ocpp-tck/issues/57#issuecomment-5315202272 §C}),
     * so the one thing a green sweep cannot tell you is that it ran the wrong
     * protocol. `SIM_EXTRA_ARGS` remains the escape hatch and still wins, by the
     * structural rule in buildDockerArgs rather than by anything here.
     */
    ocppVersion?: SimOcppVersion;
    /** Connector the scenario runs on: the one its template is started on, and
     *  the one threaded into `drive()` and `assert()`. Default 1. A scenario
     *  with no template still has one -- it is what a CSMS operation addresses. */
    connector?: number;
    /** Seconds to wait after `connect` before running the scenario template
     *  (past BootNotification.conf) -- mirrors lib.sh's SPEC_BOOT_WAIT. */
    bootWaitSecs?: number;
    /** Seconds to hold the sim open after triggering the scenario, for the
     *  scenario + any drive() traffic to finish -- mirrors SPEC_HOLD_SECS. */
    holdSecs?: number;
    /**
     * Whether the simulator is asked to run a scenario template named
     * {@link templateId} once the charge point has booted. Default true, which
     * is what every scenario ported from the bash suite needs.
     *
     * `false` says the charge point has nothing to act out on its own: the whole
     * scenario is `connect`, plus whatever `drive()` asks the CSMS for. It is
     * not an optimisation -- the simulator image ships a template per ported
     * scenario and none for anything else, so a scenario with no template of its
     * own would otherwise spend 20s waiting for a `scenario_started` that cannot
     * come, and report that as a warning rather than as the misconfiguration it
     * would be for the 47 that do have one.
     *
     * A `simTemplateId?: string | null` -- absent meaning `templateId`, null
     * meaning none -- is the shape this invites, and it is declined, but not for
     * the reason it first looks like. Its real merit is that it would make
     * `templateId`'s second job explicit instead of leaving a boolean to switch
     * off something the type never mentions; its cost is a second way to say
     * "none" and the ability to run a template under another name, which nothing
     * has wanted. The doc comment on `templateId` buys the first at no cost, so
     * what is left is the one bit actually being asked for. The day a scenario
     * needs a template it is not named after, this becomes that.
     */
    runsSimTemplate?: boolean;
    /** Runs concurrently with the sim's scenario execution, for scenarios
     *  that need CSMS-side operator action (steve_op equivalent). Its
     *  return value is threaded into assert() as `driveState`. Omitted
     *  entirely for CP-only scenarios that just need to be watched. */
    drive?: (ctx: DriveContext) => Promise<D>;
    /** Runs once against the full captured frame/line list + driveState. */
    assert: (ctx: AssertContext<D>) => Promise<void> | void;
}
