// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * state-plan-201.ts -- the OCPP 2.0.1 Reusable State mechanism, whole, offline.
 *
 * THE PROPERTY, in five parts. `tck/states-201.ts` turns what a scenario
 * DECLARES into what the runner RUNS, and every step of that is a decision no
 * sweep can show you:
 *
 *   1. A DECLARED DEPENDENCY EDGE RUNS WHEN THE CONDITION IS NOT ALREADY
 *      THERE, AND IS SKIPPED WHEN IT IS. Part 6 writes every edge as "If State
 *      is NOT <X> then execute <X>"; both halves of that sentence are load
 *      bearing, and only the first is exercised by any scenario in the tree.
 *   2. DEDUPLICATION IS BY CONDITION, NOT BY A VISITED SET. The two agree on
 *      every declaration that runs each state once, which is nearly all of
 *      them, and disagree exactly where it matters -- so a set-based
 *      implementation passes claims 1, 4 and 5 unchanged and is wrong.
 *   3. A SCENARIO'S `states:` DECLARATION IS VISIBLE IN ASSERT-INVENTORY.txt.
 *      The extractor renders a non-literal as `·` and then OMITS the field
 *      rather than marking it, so a declaration factored into a shared const
 *      takes every fixture parameter out of the committed artifact WITHOUT A
 *      DIFF. That is a scenario's setup no guard can see change, which is the
 *      failure issue #88 names. tests/spec-invariants.sh sees the field
 *      DISAPPEAR from the artifact and reports it as a diff, which reads as
 *      "we factored the states out, regenerate" and gets waved through; this
 *      refuses the shape instead of narrating its consequence.
 *   4. BRANCH SELECTION READS THE CONDITION AND NOTHING ELSE, and the planner
 *      is pure. A state is a transition, not a script.
 *   5. A STATE A SCENARIO NAMES HAS A RUNNABLE PLAN, and the edge graph
 *      terminates. Nine of the fourteen states are declared with no reach
 *      this build can execute; naming one must fail HERE, at build time, and
 *      not as an orange scenario for a reason the build already knew.
 *   6. A REACH THAT FAILS IS CLASSIFIED, AND TWO CLASSES ARE NOT "THE
 *      PRECONDITION DID NOT HOLD". `establishStates` turns a failed reach into
 *      an unestablished fixture, which a scenario reports as SKIPPED and the
 *      sweep as PARTIAL -- the right answer for a station that did not reach
 *      the condition, and the WRONG one for an operation that never became an
 *      OCPP CALL or that the driver cannot express at all. Three reaches are
 *      CSMS operations now, so both wrong answers are reachable, and the way
 *      they are wrong is silent: a driver pointed at the wrong base URL turns
 *      every scenario declaring one of those states into a row that says the
 *      gap is in OUR scenarios. `UNEXERCISED_PREFIX` is defined to carry
 *      exactly the opposite claim.
 *   7. A FIXTURE THAT PROMISES LESS THAN THE REFERENCE HAS NO READER. Two
 *      states are `established: true` after a reach that does not reach the
 *      reference's post condition -- the pinned station refuses both requests
 *      from a canned handler -- and `tck/states-201.ts` declares that on the
 *      definition and argues it is safe because nothing depends on those post
 *      conditions. That argument is a claim about the REST of the table: no
 *      edge invokes them and their `establishes` is the identity. Both halves
 *      are checked here, and which states carry the divergence is pinned, so a
 *      third one cannot arrive silently.
 *
 * WHY IT IS A GUARD AND NOT A SWEEP, and why TypeScript, like
 * tests/expected-failure-standing.ts. Reaching claim 1's second row means a
 * CSMS, a container and a station already in a named condition. Reaching claim
 * 2's row means a five-state chain re-entered from its far end -- and only two
 * of the five states that chain names have a reach this build can execute, so
 * no sweep, live or offline, could ever run it. `planStates` is a total
 * function of a declaration and a starting condition precisely so this file
 * can be a table.
 *
 * CLAIMS 1 AND 2 ALSO PIN THE FIVE EDGES. Their expected step sequences are
 * derived orders: EnergyTransferStarted -> Authorized in claim 1, and the whole
 * EVDisconnected -> EVConnectedPostSession -> StopAuthorized ->
 * EnergyTransferStarted -> Authorized chain in claim 2. An edge added, removed
 * or re-pointed moves one of those two sequences, so the graph does not need a
 * claim of its own.
 *
 * WHAT IT CANNOT CHECK: that the fourteen identifiers, their parameters and
 * their edges are FAITHFUL to Part 6. That is a reading of a reference this
 * repository does not contain, the method is recorded on the issue, and
 * tck/states-201.ts's header says which edition it was read at and which of its
 * oddities are modelled as written rather than smoothed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import * as specModules from "../tck/specs/index";
import { CsmsNotDispatchedError, UnsupportedOperationError } from "../tck/driver";
import type { CsmsOperation201, CsmsOperations201, CsmsRecords } from "../tck/driver";
import type { SimProcess } from "../tck/sim";
import {
  divergesFromReference,
  edgeTargetOf,
  establishesFrom,
  establishStates,
  INITIAL_CONDITION,
  isPlanned,
  isRunnable,
  planStates,
  REUSABLE_STATES_201,
  type Condition,
  type ReusableState201,
  type StateInvocation,
} from "../tck/states-201";

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

/** The states a plan runs, in order, as one string -- so a failure prints the
 *  sequence rather than an index into it. */
function orderOf(declared: readonly StateInvocation[], from?: Condition): string {
  return planStates(declared, from)
    .steps.map((step) => step.state)
    .join(" -> ");
}

const TAG = "CE712001";
const ETS: StateInvocation = {
  state: "EnergyTransferStarted",
  connectorId: 1,
  idToken: TAG,
};

// ---------------------------------------------------------------------------
// Claim 1 -- the edge runs when the condition is not there, and not when it is.
// ---------------------------------------------------------------------------

check(
  orderOf([ETS], INITIAL_CONDITION) === "Authorized -> EnergyTransferStarted",
  "EnergyTransferStarted declared from a freshly booted station no longer " +
    "pulls in Authorized first -- the dependency edge Part 6 writes is not " +
    `being executed. Got: ${orderOf([ETS], INITIAL_CONDITION)}`,
);

check(
  orderOf([ETS], { state: "Authorized", evConnected: false }) ===
    "EnergyTransferStarted",
  "EnergyTransferStarted declared against a station ALREADY Authorized " +
    "still executes Authorized. Part 6's edge is \"If State is NOT X then " +
    "execute X\", so this half of the sentence is what makes a state " +
    "reusable at all: it re-authorizes a station that is already authorized " +
    `and the fixture waits for an Authorize nobody asked for. Got: ${orderOf(
      [ETS],
      { state: "Authorized", evConnected: false },
    )}`,
);

// ---------------------------------------------------------------------------
// Claim 2 -- dedup by condition, not by a visited set.
//
// THE ROW A VISITED SET GETS WRONG, and the only one. Walking the chain leaves
// the condition at EVDisconnected, so the second declaration's edge fires again
// and Authorized runs a SECOND time. A `seen.has(state)` guard drops it, the
// station is never asked to authorize, and the fixture waits for an Authorize
// that cannot come -- reported as an unestablished precondition, i.e. as an
// orange scenario blamed on the station.
// ---------------------------------------------------------------------------

const CHAIN: readonly StateInvocation[] = [{ state: "EVDisconnected" }, ETS];
const CHAIN_ORDER =
  "Authorized -> EnergyTransferStarted -> StopAuthorized -> " +
  "EVConnectedPostSession -> EVDisconnected -> Authorized -> " +
  "EnergyTransferStarted";

check(
  orderOf(CHAIN, INITIAL_CONDITION) === CHAIN_ORDER,
  "re-entering EnergyTransferStarted after the EVDisconnected chain no " +
    "longer re-executes Authorized. Deduplication has become a visited SET " +
    "rather than the condition guard Part 6 writes -- the two agree on every " +
    "single-entry declaration, so nothing else here moves. Expected " +
    `${CHAIN_ORDER}, got ${orderOf(CHAIN, INITIAL_CONDITION)}`,
);

check(
  planStates(CHAIN, INITIAL_CONDITION).steps.length === 7,
  "the EVDisconnected chain plans a different number of steps than the " +
    "seven it has: five to walk the chain and two to re-enter it.",
);

// ---------------------------------------------------------------------------
// Claim 4 -- branch selection reads the condition, and the planner is pure.
//
// Asserted on SEGMENT indices rather than on state names, which is the half
// claims 1 and 2 cannot reach: dropping the guards makes every selection 0,
// and every declaration that starts from a booted station selects 0 anyway.
// ---------------------------------------------------------------------------

const notConnected = planStates([ETS], { state: "Authorized", evConnected: false });
const alreadyConnected = planStates([ETS], { state: "Authorized", evConnected: true });

check(
  notConnected.steps[0]?.segment === 0,
  "EnergyTransferStarted against a station whose EV is not connected no " +
    "longer selects the segment guarded on that -- it is the only one with a " +
    `reach, so the fixture now runs nothing. Got segment ${notConnected.steps[0]?.segment}`,
);

check(
  alreadyConnected.steps[0]?.segment === 1,
  "EnergyTransferStarted against an ALREADY-connected station selects the " +
    "not-connected segment. A state is a transition into a condition from " +
    "wherever the system is, and a planner that ignores its guards runs the " +
    `first segment always. Got segment ${alreadyConnected.steps[0]?.segment}`,
);

check(
  JSON.stringify(planStates(CHAIN, INITIAL_CONDITION)) ===
    JSON.stringify(planStates(CHAIN, INITIAL_CONDITION)),
  "planStates is not pure: the same declaration and the same starting " +
    "condition produced two different plans. Everything above is a table " +
    "only because it is.",
);

// ---------------------------------------------------------------------------
// Claim 5 -- a named state has a runnable plan, and the edges terminate.
// ---------------------------------------------------------------------------

/** One invocation per state, so the edges can be walked without a scenario.
 *  A table, on purpose: it is also what makes `tsc` refuse this file when a
 *  state's parameters change and nothing else in the tree names it. */
const SAMPLES: { [S in ReusableState201]: Extract<StateInvocation, { state: S }> } = {
  Authorized: { state: "Authorized", connectorId: 1, idToken: TAG },
  Booted: { state: "Booted", model: "SingleSocketCharger" },
  CertificateInstalled: {
    state: "CertificateInstalled",
    certificateType: "CSMSRootCertificate",
  },
  EVConnectedPostSession: { state: "EVConnectedPostSession" },
  EVConnectedPreSession: { state: "EVConnectedPreSession", evseId: 1, connectorId: 1 },
  EVDisconnected: { state: "EVDisconnected" },
  EnergyTransferStarted: { state: "EnergyTransferStarted", connectorId: 1, idToken: TAG },
  EnergyTransferSuspended: {
    state: "EnergyTransferSuspended",
    transactionDurationSecs: 60,
  },
  GetInstalledCertificates: {
    state: "GetInstalledCertificates",
    certificateType: "CSMSRootCertificate",
  },
  ISO15118SmartCharging: { state: "ISO15118SmartCharging", evseId: 1 },
  RenewChargingStationCertificate: { state: "RenewChargingStationCertificate" },
  Reserved: { state: "Reserved", evseId: 1, idToken: TAG },
  StopAuthorized: { state: "StopAuthorized", transactionDurationSecs: 60 },
  Unavailable: { state: "Unavailable", evseId: 1 },
};

// A plan that hit the depth backstop reports it, so this is how "the edges
// terminate" is asserted without re-deriving the graph: every state, planned
// alone, must reach a plan with no `depth` refusal in it.
for (const state of REUSABLE_STATES_201) {
  const plan = planStates([SAMPLES[state]]);
  check(
    !plan.refusals.some((refusal) => refusal.kind === "depth"),
    `planning ${state} on its own hit the edge-depth backstop, which means ` +
      "the requires graph has a cycle. The runner would throw rather than " +
      "loop, but a cycle is a declaration error and belongs here.",
  );
  check(
    !plan.refusals.some((refusal) => refusal.kind === "no-segment"),
    `planning ${state} on its own selected no segment: its guards do not ` +
      "cover the condition its own edges leave behind, so the state can " +
      "never be established however a scenario declares it.",
  );
}

check(
  REUSABLE_STATES_201.filter((state) => !isPlanned(state)).join(",") ===
    "Authorized,CertificateInstalled,EnergyTransferStarted,GetInstalledCertificates,Unavailable",
  "the set of states with a reach this build can execute has changed. That " +
    "is a legitimate thing to do -- say so in the pull request, and move " +
    "OCA-201-SLICE.txt's reasons that cite a planned state by name. Got: " +
    REUSABLE_STATES_201.filter((state) => !isPlanned(state)).join(","),
);

// ---------------------------------------------------------------------------
// Claims 3 and 5, against the scenarios as written.
//
// The extractor is RUN rather than reimplemented, and the committed artifact is
// deliberately not read: tests/spec-invariants.sh already pins that file, and
// what is in question here is whether a declaration written today would still
// REACH it. A guard comparing two committed files would go green on a
// declaration factored into a const, because the artifact it read was generated
// before the factoring.
// ---------------------------------------------------------------------------

const SPECS_DIR = "tck/specs";

/** Every spec that declares `states`, by templateId, from the sources. */
function specsDeclaringStates(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SPECS_DIR).filter((name) => name.endsWith(".ts"))) {
    const path = join(SPECS_DIR, file);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.ESNext,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!initializer || !ts.isObjectLiteralExpression(initializer)) continue;
        let templateId: string | null = null;
        let declaresStates = false;
        for (const property of initializer.properties) {
          if (!property.name || !ts.isIdentifier(property.name)) continue;
          if (
            property.name.text === "templateId" &&
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.initializer)
          ) {
            templateId = property.initializer.text;
          }
          if (property.name.text === "states") declaresStates = true;
        }
        if (templateId !== null && declaresStates) found.push(templateId);
      }
    }
  }
  return found.sort();
}

const declaringStates = specsDeclaringStates();

const rendered = Bun.spawnSync({
  cmd: ["bun", "tools/extract-assert-inventory.ts", SPECS_DIR],
  stdout: "pipe",
  stderr: "pipe",
});
if (!rendered.success) {
  failures.push(
    "tools/extract-assert-inventory.ts could not be run, so claim 3 was not " +
      `checked at all: ${new TextDecoder().decode(rendered.stderr)}`,
  );
}
const inventory = new TextDecoder().decode(rendered.stdout);

for (const templateId of declaringStates) {
  const line = inventory
    .split("\n")
    .find((candidate) => candidate.startsWith(`  SPEC ${templateId} `));
  check(
    line !== undefined && line.includes(" states=[{"),
    `${templateId} declares Reusable States and ASSERT-INVENTORY.txt's SPEC ` +
      "line does not carry them. The extractor renders a non-literal as `·` " +
      "and then omits the field, so this is what a declaration written as a " +
      "shared const, a spread or a shorthand looks like: the fixture " +
      "parameters stop being pinned and nothing goes red. Write the array " +
      `out as literals. Line was: ${line ?? "<no SPEC line found>"}`,
  );
}

// The other direction: a rendered `states=` for a spec whose source this file
// did not find is the extractor and the sources disagreeing about what a
// declaration is, which would leave the check above ranging over nothing.
for (const line of inventory.split("\n")) {
  if (!line.startsWith("  SPEC ") || !line.includes(" states=")) continue;
  const templateId = line.slice("  SPEC ".length).split(" ")[0] ?? "";
  check(
    declaringStates.includes(templateId),
    `ASSERT-INVENTORY.txt renders states for ${templateId} and this guard ` +
      "does not see the declaration in the sources, so claim 3 is ranging " +
      "over a set it cannot trust.",
  );
}

// And claim 5 where it bites: every declaration actually written must plan.
//
// FROM THE BARREL, not from the directory, for the reason
// tools/extract-drive-trace.ts gives: `tck/specs/index` is where tck/main.ts
// gets its registry, so a scenario this loop cannot see is one the runner
// cannot run. Re-importing every file in the directory also imports the barrel
// itself and reports the same scenario twice, which is a guard telling you
// about a defect it invented.
for (const exported of Object.values(specModules)) {
  if (!Array.isArray(exported)) continue;
  for (const spec of exported as Array<{
    templateId?: string;
    states?: readonly StateInvocation[];
  }>) {
    if (!spec?.states || spec.states.length === 0) continue;
    const plan = planStates(spec.states);
    check(
      isRunnable(plan),
      `${spec.templateId} declares a Reusable State this build cannot ` +
        "establish, so the scenario would ERROR at run time for something " +
        "the build already knew. Either implement the segment or stop " +
        `declaring the state: ${plan.refusals
          .map((refusal) =>
            refusal.kind === "planned"
              ? `${refusal.state} is planned (${refusal.reason})`
              : `${refusal.state}: ${refusal.kind}`,
          )
          .join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Claim 7 -- a fixture that promises less than the reference has no reader.
//
// THE ARGUMENT IS CHECKED, NOT THE COMMENT. tck/states-201.ts says a diverging
// state is safe because `establishes` returns the condition untouched and
// nothing depends on it. Both halves are properties of the whole table, so a
// reach re-pointed at one, or a `...condition, state: X` slipped into one of
// their `establishes`, would falsify the argument somewhere other than where it
// is written. That is exactly the shape a guard is for.
// ---------------------------------------------------------------------------

const DIVERGING = REUSABLE_STATES_201.filter(
  (state) => divergesFromReference(state) !== undefined,
);

check(
  DIVERGING.join(",") === "CertificateInstalled,GetInstalledCertificates",
  "the set of states whose reach establishes LESS than the reference's post " +
    "condition has changed. That is a legitimate thing to do -- say so in the " +
    "pull request, and check that the scenarios naming the state describe " +
    "what is actually established rather than what the reference declares. " +
    `Got: ${DIVERGING.join(",") || "<none>"}`,
);

for (const state of DIVERGING) {
  check(
    !isPlanned(state),
    `${state} declares a post-condition divergence and has no reach this ` +
      "build can execute. The two are different axes and only one can be " +
      "true at a time: a divergence says the reach RUNS and promises less, " +
      "and a planned state does not run at all.",
  );

  // The identity half, over both members of the condition and from more than
  // the initial one -- an `establishes` that returned INITIAL_CONDITION would
  // pass a single from-the-start row and silently rewind every declaration
  // that reached this state from anywhere else.
  for (const from of [
    INITIAL_CONDITION,
    { state: "Authorized", evConnected: false } as Condition,
    { state: "EnergyTransferStarted", evConnected: true } as Condition,
  ]) {
    const after = establishesFrom(SAMPLES[state], from);
    check(
      after.state === from.state && after.evConnected === from.evConnected,
      `${state} declares a post-condition divergence AND moves the condition ` +
        `(${JSON.stringify(from)} -> ${JSON.stringify(after)}). Those cannot ` +
        "both be true: the condition is what a later state's guard reads, so " +
        "recording a state whose post condition this build does not reach is " +
        "the reader the divergence note claims does not exist.",
    );
  }
}

for (const state of REUSABLE_STATES_201) {
  const target = edgeTargetOf(SAMPLES[state]);
  check(
    target === undefined || divergesFromReference(target) === undefined,
    `${state}'s dependency edge invokes ${target}, whose reach does not reach ` +
      "the post condition the reference declares for it. The edge would then " +
      `run ${state} on the strength of a condition that is not there, which ` +
      "is the reader tck/states-201.ts's divergence note says nothing has.",
  );
}

// ---------------------------------------------------------------------------
// Claim 6 -- what establishStates does with a reach that throws.
//
// THE SEAM IS THE CONTEXT. `establishStates` takes its simulator and its
// CsmsOperations201 as arguments, so every branch below is reached by handing
// it a fake that fails a chosen way -- which is the only way to reach them at
// all: "the driver could not dispatch" and "the CSMS answered and refused" are
// two answers no CSMS here can be asked for on demand, and the difference
// between them is a whole verdict.
//
// `Unavailable` is the state under test because its reach is one CSMS
// operation followed by one wait, which is the shape all three CSMS-initiated
// reaches have -- and it is the one whose invocation carries no certificate.
// ---------------------------------------------------------------------------

const UNAVAILABLE_PLAN = planStates([SAMPLES.Unavailable]);

/** A simulator that answers every wait, or fails it the way a real timeout
 *  does -- a plain `Error`, which is what tck/sim.ts's waitForLine rejects
 *  with. */
function fakeSim(wait: "answers" | "times-out"): SimProcess {
  return {
    cpId: "CERTCP1",
    container: "simts-guard",
    argv: "docker run (guard)",
    lines: [],
    send: async () => {},
    waitForLine: async (pattern: RegExp) => {
      if (wait === "answers") return "Sent: [2,\"1\",\"StatusNotification\",{}]";
      throw new Error(`timed out after 15000ms waiting for /${pattern.source}/`);
    },
    stop: async () => {},
  };
}

function fakeOps(fail: (() => never) | null): CsmsOperations201 {
  return {
    execute: async (_cpId: string, _op: CsmsOperation201) => {
      if (fail) fail();
      return "";
    },
  };
}

const NO_RECORDS = {} as CsmsRecords;

/** Runs the one-step Unavailable plan and says what came back out: the
 *  established flag, or the class of the error that escaped. */
async function classify(
  sim: SimProcess,
  ops: CsmsOperations201,
): Promise<"established" | "not-established" | string> {
  try {
    const log = await establishStates(UNAVAILABLE_PLAN, {
      cpId: "CERTCP1",
      sim,
      csms201: ops,
      records: NO_RECORDS,
    });
    return log.established("Unavailable") ? "established" : "not-established";
  } catch (err) {
    return err instanceof Error ? err.constructor.name : `threw ${String(err)}`;
  }
}

const CLASSIFICATIONS: ReadonlyArray<{
  what: string;
  sim: SimProcess;
  ops: CsmsOperations201;
  want: string;
  why: string;
}> = [
  {
    what: "a reach that completes",
    sim: fakeSim("answers"),
    ops: fakeOps(null),
    want: "established",
    why:
      "a reach whose operation was dispatched and whose wait was answered is " +
      "the condition being reached, and nothing else here means anything if " +
      "this row is wrong.",
  },
  {
    what: "a wait that times out",
    sim: fakeSim("times-out"),
    ops: fakeOps(null),
    want: "not-established",
    why:
      "the station did not produce the frame the condition IS, and a " +
      "conformance tool may not file that as a finding against a CSMS that " +
      "did exactly what it was asked. SKIPPED, then PARTIAL.",
  },
  {
    what: "an operation the driver cannot express",
    sim: fakeSim("answers"),
    ops: fakeOps(() => {
      throw new UnsupportedOperationError("operations201.ChangeAvailability", "no route");
    }),
    want: "UnsupportedOperationError",
    why:
      "it must reach the runner's catch around drive(), which records NOT " +
      "APPLICABLE and warns that the scope table missed the scenario. Caught " +
      "here it would become an unestablished precondition, i.e. a gap in our " +
      "scenarios reported for a CSMS that never declared the operation.",
  },
  {
    what: "an operation that never became an OCPP CALL",
    sim: fakeSim("answers"),
    ops: fakeOps(() => {
      throw new CsmsNotDispatchedError("citrineos: POST /ocpp/2.0.1/...", "returned 401");
    }),
    want: "CsmsNotDispatchedError",
    why:
      "the station was never asked, so the condition's absence says nothing " +
      "about it. Caught here it becomes a SKIPPED precondition carrying " +
      "UNEXERCISED_PREFIX -- which claims the gap is in OUR scenarios and is " +
      "identical for every driver -- when the cause is a driver that cannot " +
      "reach the CSMS at all. That is issue #77's shape, and tck/op-warn.ts " +
      "lets this one class out of drive() for exactly this reason.",
  },
  {
    what: "an operation the CSMS answered and refused",
    sim: fakeSim("answers"),
    ops: fakeOps(() => {
      throw new Error("citrineos: POST ... returned a body that is not a confirmation array");
    }),
    want: "not-established",
    why:
      "a plain Error is what a driver throws when it has no evidence either " +
      "way, or when the CSMS refused an operation it did receive. The station " +
      "is not in the condition and nothing was misattributed, so the default " +
      "-- an unestablished precondition -- is the right one and must stay the " +
      "default.",
  },
];

for (const row of CLASSIFICATIONS) {
  const got = await classify(row.sim, row.ops);
  check(
    got === row.want,
    `establishStates classifies ${row.what} as ${got}, where it must be ` +
      `${row.want}. ${row.why}`,
  );
}

if (failures.length > 0) {
  process.stderr.write("FAIL: the Reusable State mechanism does not hold.\n");
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `Reusable State mechanism holds: ${REUSABLE_STATES_201.length} states, ` +
    `${REUSABLE_STATES_201.filter((state) => !isPlanned(state)).length} with a ` +
    `reach, ${declaringStates.length} scenario(s) declaring one -- edges ` +
    "executed on the condition and not on a visited set, branches selected " +
    "from the condition, every declaration runnable and pinned in " +
    "ASSERT-INVENTORY.txt.\n",
);
