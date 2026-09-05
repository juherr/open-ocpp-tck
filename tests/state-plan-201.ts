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
 *      terminates. Eleven of the fourteen states are declared with no reach
 *      this build can execute; naming one must fail HERE, at build time, and
 *      not as an orange scenario for a reason the build already knew.
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
import {
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
    "Authorized,EnergyTransferStarted,Unavailable",
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
