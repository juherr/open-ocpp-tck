/**
 * states-201.ts -- the OCPP 2.0.1 `Reusable State` fixture mechanism: a named,
 * parameterised, dependency-ordered way to put the station into the condition
 * a certification case declares as its precondition.
 *
 * WHAT PART 6 ACTUALLY DEFINES, because the obvious design does not fit it.
 * Fourteen states for the CSMS role (thirteen labelled `Reusable State`, one
 * labelled `Memory State` and invoked as a reusable one by the case that uses
 * it), and three properties a flat set of named setup functions cannot express:
 *
 *   1. THEY ARE PARAMETERISED -- by EVSE, by idToken, by certificate type.
 *   2. THEY BRANCH ON THE CONDITION ALREADY IN EFFECT. Every dependency edge is
 *      written "If State is NOT <X> then execute <X>", and one state also
 *      branches on a flag. A state is a TRANSITION INTO a condition from
 *      whatever condition holds, not a fixed script.
 *   3. THEY DEPEND ON EACH OTHER -- five edges among the fourteen, so a case
 *      naming one state may execute several, in order.
 *
 * THE BRANCHING IS NOT SOMETHING THIS RUNNER HAS TO OBSERVE, which is the one
 * measurement that made a mechanism possible at all. Every state declares its
 * own POST CONDITION in the same vocabulary its guards read -- a single `State`
 * value plus one flag -- so the condition is FOLDED from the declarations
 * rather than queried from the CSMS. {@link planStates} is therefore a pure
 * function of the declaration and the starting condition: no clock, no docker,
 * no CSMS. That is the `tck/standing.ts` split, for the `tck/standing.ts`
 * reason -- reaching these rules through the CLI costs a container per row, and
 * for the row that matters, a five-state chain nothing here can stage.
 *
 * WHAT A FIXTURE MAY PROMISE IS THE POST CONDITION, NOT THE STEPS. Parts 5 and
 * 6 are CC BY-ND 4.0: the states' step text may not be brought into ours, and
 * `OCA-201-SELECTION.md`'s "What may be committed here, and what may not" is
 * where that is argued. Identifiers, parameter names and the dependency edges
 * are facts about the reference and are committable; the sequences are not. So
 * a {@link StateDefinition} declares the parameters, the guarded edge and the
 * post condition -- all facts -- plus OUR OWN reach sequence, which is ours to
 * write and is the only part a simulator constrains. A state is established
 * when the station is in the declared condition, however we got it there.
 *
 * WHICH PARAMETERS A STATE DECLARES, and the rule is different for the two
 * kinds of state here. An IMPLEMENTED state declares only what its reach
 * consumes: a parameter nothing can vary makes a scenario measure a spelling,
 * which is what `tests/get-configuration-filter.ts` exists to have caught once
 * already. A PLANNED state declares the reference's own parameter shape, since
 * there is no reach to consume anything and the shape is what a scenario will
 * be type-checked against the day one is written -- and no scenario can name a
 * planned state anyway, because `tests/state-plan-201.ts` refuses it.
 *
 * MEASURED AT EDITION 3 (2024-05-06). Issue #88 says not to treat the graph's
 * shape as settled until it is re-read at the edition this repository's other
 * tables are measured against (Part 5 Edition 4). One consequence of reading it
 * literally is visible below and is worth naming rather than smoothing: the
 * `evConnected` flag is WRITTEN by exactly one state and READ by exactly one
 * state, both `EnergyTransferStarted`. `EVConnectedPreSession` does not publish
 * it, which reads like an oversight in the reference and is modelled as
 * written. Inferring the tidier graph is the change a re-read would authorise;
 * guessing it here would put an inference where a measurement is.
 *
 * NOT BUILT FOR OCPP 1.6, and here is where that gets re-proposed. Three 1.6
 * scenarios inline a reusable state today (`tck/specs/core.ts:393`,
 * `tck/specs/authlist-reservation.ts:355`, recorded in `OCA-COVERAGE.md`
 * §3.22), and three copies is manageable duplication. `Reusable State` is Part
 * 6's vocabulary; the 1.6 reference does not use it, so retrofitting this would
 * import a model that document does not have in exchange for no reduction in
 * copies. If the 1.6 side ever reaches a dozen it wants a mechanism of its own
 * shape, not this one widened.
 */
import { type AssertRecorder } from "./assert";
import { type CsmsOperations201, type CsmsRecords, type GetCertificateIdUse201 } from "./driver";
import type { SimProcess } from "./sim";
/**
 * Every state, once, as the list -- and the type is DERIVED from it, which is
 * `tck/standing.ts`'s VERDICTS rule applied for its reason rather than by
 * habit. A union declared beside a `readonly Name[]` checks one direction: it
 * requires every element to BE a state and nothing requires every state to be
 * an element, so a name could be dropped from the array with the type intact
 * and every table below would then be missing a row nothing asks for.
 *
 * `Reserved` has no consumer: no case in the 147 the selection rule picks
 * declares it. It is here because the list is the reference's, not ours, and a
 * fourteenth state omitted for having no caller today is a fact this file would
 * be quietly wrong about.
 */
export declare const REUSABLE_STATES_201: readonly ["Authorized", "Booted", "CertificateInstalled", "EVConnectedPostSession", "EVConnectedPreSession", "EVDisconnected", "EnergyTransferStarted", "EnergyTransferSuspended", "GetInstalledCertificates", "ISO15118SmartCharging", "RenewChargingStationCertificate", "Reserved", "StopAuthorized", "Unavailable"];
export type ReusableState201 = (typeof REUSABLE_STATES_201)[number];
/**
 * The condition Part 6's guards read, and nothing else.
 *
 * `state` is a VALUE and not a set, because every edge is written "If State is
 * NOT <X>", singular -- which is also what makes the deduplication below right.
 * `evConnected` is the one flag any state publishes; see the header on why it
 * has exactly one writer and one reader.
 */
export interface Condition {
    state: ReusableState201 | null;
    evConnected: boolean;
}
/** A station that has booted and done nothing else. */
export declare const INITIAL_CONDITION: Condition;
/**
 * Certificate uses Part 6 parameterises `CertificateInstalled` by, and the
 * enumeration `InstallCertificate` ranges over on the wire. Spelled out rather
 * than imported from a generated OCPP model because nothing in this tree has
 * one.
 *
 * ONE STATE AND NOT TWO, which it was until `GetInstalledCertificates` got a
 * reach. That state is parameterised by the enumeration the LISTING request
 * ranges over -- five values, the extra one being `V2GCertificateChain` -- and
 * takes {@link GetCertificateIdUse201} for it. A shared type would let a
 * scenario ask to install a chain, which is a request the schema rejects.
 */
export type CertificateUse201 = "V2GRootCertificate" | "MORootCertificate" | "CSMSRootCertificate" | "ManufacturerRootCertificate";
/**
 * A state plus the arguments it is invoked with -- a discriminated union rather
 * than a name and a bag, so `tsc` refuses a parameter the state does not take
 * and a state written without one it needs.
 *
 * IT MUST STAY WRITABLE AS A PLAIN OBJECT LITERAL, which is the whole reason
 * this is data on the spec rather than a call to a helper.
 * `tools/extract-assert-inventory.ts` renders every NON-LITERAL argument as
 * `·`, so a parameter reaching the mechanism through an identifier, a spread or
 * a shorthand property becomes invisible in `ASSERT-INVENTORY.txt` -- a
 * scenario's setup that no guard can see change, which is the failure issue #88
 * names. Declared as a literal array of literal objects, every parameter lands
 * verbatim on the artifact's SPEC line. `tests/state-plan-201.ts` holds that
 * both ways, because the extractor OMITS a field it cannot render rather than
 * marking it, so the failure is silent.
 */
export type StateInvocation = {
    state: "Authorized";
    connectorId: number;
    idToken: string;
} | {
    state: "EnergyTransferStarted";
    connectorId: number;
    idToken: string;
} | {
    state: "Unavailable";
    evseId: number;
} | {
    state: "Booted";
    model: string;
} | {
    state: "CertificateInstalled";
    certificateType: CertificateUse201;
} | {
    state: "EVConnectedPostSession";
} | {
    state: "EVConnectedPreSession";
    evseId: number;
    connectorId: number;
} | {
    state: "EVDisconnected";
} | {
    state: "EnergyTransferSuspended";
    transactionDurationSecs: number;
} | {
    state: "GetInstalledCertificates";
    certificateType: GetCertificateIdUse201;
} | {
    state: "ISO15118SmartCharging";
    evseId: number;
} | {
    state: "RenewChargingStationCertificate";
} | {
    state: "Reserved";
    evseId: number;
    idToken: string;
} | {
    state: "StopAuthorized";
    transactionDurationSecs: number;
};
/** What an establisher is given. Narrower than DriveContext on purpose: a
 *  fixture puts the station into a condition, it does not measure anything, so
 *  it gets no frames and no recorder. */
export interface StateContext {
    cpId: string;
    sim: SimProcess;
    csms201: CsmsOperations201;
    records: CsmsRecords;
}
/** Whether a state has a reach this build can execute at all -- derived from
 *  the definitions rather than tabulated, so "planned" cannot disagree with
 *  what the code does. `OCA-201-SLICE.txt` cites this distinction by name. */
export declare function isPlanned(state: ReusableState201): boolean;
export interface PlannedStep {
    state: ReusableState201;
    invocation: StateInvocation;
    /** Which segment the condition selected. Exposed so a guard can assert WHICH
     *  branch was taken and not merely that one was -- dropping the guards makes
     *  every selection 0, which is indistinguishable from correct on any
     *  declaration that starts from the initial condition. */
    segment: number;
    /** The condition this step runs FROM. */
    from: Condition;
}
export type PlanRefusal = {
    kind: "planned";
    state: ReusableState201;
    reason: string;
} | {
    kind: "no-segment";
    state: ReusableState201;
} | {
    kind: "depth";
    state: ReusableState201;
};
export interface StatePlan {
    steps: readonly PlannedStep[];
    refusals: readonly PlanRefusal[];
    ends: Condition;
}
/** A plan the runner may execute. Exported so no caller rebuilds the
 *  disjunction -- `tck/standing.ts`'s `endsTheBuild` rule. */
export declare function isRunnable(plan: StatePlan): boolean;
/**
 * The steps a declaration means, from a starting condition.
 *
 * ORDERING AND DEDUPLICATION BOTH FALL OUT OF THE FOLD, and the second one is
 * where a plausible implementation is wrong. Dedup is BY CONDITION -- the
 * edge's own guard, `condition.state !== <prerequisite>` -- and NOT by a set of
 * states already visited. The two agree on every declaration that runs each
 * state once, which is most of them, and disagree exactly where it matters: a
 * declaration that walks the chain and then re-enters `EnergyTransferStarted`
 * must execute `Authorized` a SECOND time, because the chain left the condition
 * at `EVDisconnected`. A visited set silently drops it and the fixture then
 * waits for an Authorize the station was never asked to send.
 *
 * Pure: same declaration and same starting condition, same steps. No I/O, no
 * clock, no CSMS -- the condition is folded from the declarations, never
 * queried. Asking the system under test whether its own precondition holds is
 * the thing this shape exists to avoid.
 */
export declare function planStates(declared: readonly StateInvocation[], from?: Condition): StatePlan;
export interface FixtureOutcome {
    state: ReusableState201;
    established: boolean;
    /** Why not, when it was not. */
    reason?: string;
}
/**
 * What the fixtures did, threaded into `assert()`.
 *
 * A class rather than a record so a scenario asking about a state it never
 * declared gets `false` and not `undefined` -- a scenario that reads the wrong
 * name should skip its check, not crash mid-assert and turn a measurable
 * CSMS answer into an ERROR.
 */
export declare class FixtureLog {
    private readonly records;
    constructor(records?: readonly FixtureOutcome[]);
    established(state: ReusableState201): boolean;
    reasonFor(state: ReusableState201): string | undefined;
    get outcomes(): readonly FixtureOutcome[];
}
/**
 * Runs a plan against a live station.
 *
 * A REACH THAT DOES NOT COMPLETE IS NOT A CSMS FAILURE, and the whole shape of
 * this function follows from that. The station failing to produce a frame in
 * the window says the precondition did not hold; reporting it as a red check
 * would file a non-conformance against a CSMS that did exactly what it was
 * asked, which is the one mistake a conformance tool may not make. So a reach
 * that times out is recorded as unestablished, the remaining steps are
 * abandoned (they were written for a condition that is not there), and the
 * scenario's own `assertStateEstablished` degrades to SKIPPED -- PARTIAL, which
 * already means "at least one check could not be evaluated".
 *
 * AN UNSUPPORTED OPERATION IS NOT CAUGHT HERE. A CSMS-initiated state whose
 * driver cannot dispatch throws `UnsupportedOperationError`, and the runner's
 * existing catch around drive() is what turns that into NOT APPLICABLE -- the
 * scope table missed the scenario, which means the same thing whether the
 * operation was asked for by a fixture or by the scenario. Rethrown explicitly
 * rather than left to fall through, so a later `catch` added here cannot
 * swallow it by accident.
 *
 * NO TEARDOWN, and this is where it gets asked for. A fixture that opens a
 * transaction leaves one open, exactly as the inline setup it replaces did, and
 * a driver's `prepareStation` is what closes a stale one before the next
 * scenario. Symmetry argues for undoing here what was done here; what stops it
 * is that the case's own `drive()` runs after this and may have moved the
 * station anywhere -- so a teardown would either have to observe the station,
 * which is the thing this whole shape avoids, or unwind a condition that is no
 * longer the one it established. The day `prepareStation` stops being enough,
 * the honest fix is a post condition the runner drives the station BACK to, not
 * a reversed reach.
 *
 * NO ASSERTIONS ON WHAT THE CSMS ANSWERS A FIXTURE, which is the other thing a
 * reader expects to find here: Part 6 attaches tool validations to a state, and
 * mirroring them would look like more coverage. Two reasons not to. A check
 * emitted from this function has no row in `tck/specs/OCA-OBLIGATIONS.txt` and
 * fails `tests/oca-obligations.sh`, which is the guard saying the same thing:
 * an assertion nobody can trace to a case is an assertion nobody can act on.
 * And one defective `Authorize` answer would be reported once per scenario
 * declaring the state -- eighteen copies of one finding for
 * `EnergyTransferStarted` across the selected cases. Judging a CSMS answer is
 * the case's job; this one's is to reach a condition and say whether it did.
 */
export declare function establishStates(plan: StatePlan, ctx: StateContext, 
/** Called with the STEP rather than with a sentence, so the two callers can
 *  render it differently: the runner writes prose to stderr, and
 *  tools/extract-drive-trace.ts writes the committed artifact's STATE line.
 *  A message-shaped callback would have made the artifact depend on the
 *  runner's wording. */
onStep?: (step: PlannedStep) => void): Promise<FixtureLog>;
/**
 * The precondition, reported rather than assumed.
 *
 * SKIPPED AND NEVER FAIL, which is the rule TC_B_21 wrote inline before there
 * was a mechanism to hold it: a station that did not reach the condition makes
 * the case's distinguishing outcome unreachable, and a CSMS that answered
 * faithfully anyway did nothing wrong. `UNEXERCISED_PREFIX` and not
 * `UNVERIFIABLE`: the reason is identical for every driver, so it is a gap in
 * OUR scenarios rather than a limitation of the CSMS under test -- which is
 * exactly the distinction that prefix is defined to carry.
 *
 * HERE AND NOT IN assert.ts, by the rule core-201.ts states for
 * `assertResponseTimestamp`: a Reusable State is 2.0.1 knowledge, and assert.ts
 * is message-agnostic by construction.
 *
 * Named `assert*` so `tools/extract-assert-inventory.ts` pins the CALL --
 * including the state's name as a literal, which is what makes a scenario
 * silently re-pointed at another fixture a diff in the committed artifact.
 */
export declare function assertStateEstablished(rec: AssertRecorder, fixtures: FixtureLog, state: ReusableState201, description: string): void;
