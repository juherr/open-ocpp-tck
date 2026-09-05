// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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

import { UNEXERCISED_PREFIX, type AssertRecorder } from "./assert";
import { UnsupportedOperationError, type CsmsOperations201, type CsmsRecords } from "./driver";
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
export const REUSABLE_STATES_201 = [
  "Authorized",
  "Booted",
  "CertificateInstalled",
  "EVConnectedPostSession",
  "EVConnectedPreSession",
  "EVDisconnected",
  "EnergyTransferStarted",
  "EnergyTransferSuspended",
  "GetInstalledCertificates",
  "ISO15118SmartCharging",
  "RenewChargingStationCertificate",
  "Reserved",
  "StopAuthorized",
  "Unavailable",
] as const;

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
export const INITIAL_CONDITION: Condition = { state: null, evConnected: false };

/**
 * Certificate uses Part 6 parameterises the two certificate states by. Spelled
 * out rather than imported from a generated OCPP model because nothing in this
 * tree has one, and because these four are what the two states below can be
 * asked for -- not the whole enumeration.
 */
export type CertificateUse201 =
  | "V2GRootCertificate"
  | "MORootCertificate"
  | "CSMSRootCertificate"
  | "ManufacturerRootCertificate";

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
export type StateInvocation =
  // --- the two with a reach ------------------------------------------------
  | { state: "Authorized"; connectorId: number; idToken: string }
  | { state: "EnergyTransferStarted"; connectorId: number; idToken: string }
  // --- the twelve planned: the reference's parameter shape -----------------
  | { state: "Booted"; model: string }
  | { state: "CertificateInstalled"; certificateType: CertificateUse201 }
  | { state: "EVConnectedPostSession" }
  | { state: "EVConnectedPreSession"; evseId: number; connectorId: number }
  | { state: "EVDisconnected" }
  | { state: "EnergyTransferSuspended"; transactionDurationSecs: number }
  | { state: "GetInstalledCertificates"; certificateType: CertificateUse201 }
  | { state: "ISO15118SmartCharging"; evseId: number }
  | { state: "RenewChargingStationCertificate" }
  | { state: "Reserved"; evseId: number; idToken: string }
  | { state: "StopAuthorized"; transactionDurationSecs: number }
  | { state: "Unavailable"; evseId: number };

/** The invocation shape for one state, so a definition's callbacks are typed
 *  against their own parameters rather than against the whole union. */
type InvocationOf<S extends ReusableState201> = Extract<StateInvocation, { state: S }>;

/** What an establisher is given. Narrower than DriveContext on purpose: a
 *  fixture puts the station into a condition, it does not measure anything, so
 *  it gets no frames and no recorder. */
export interface StateContext {
  cpId: string;
  sim: SimProcess;
  csms201: CsmsOperations201;
  records: CsmsRecords;
}

/**
 * One guarded segment of a state's reach.
 *
 * `run: null` says Part 6 defines a segment here and the pinned simulator
 * cannot produce it. It is a REFUSAL AND NOT A DEGRADATION: {@link planStates}
 * reports it, `tests/state-plan-201.ts` fails the build on a scenario whose
 * plan selects one, and no run ever reaches it. That ordering is deliberate --
 * a scenario that would go orange for a reason the build already knew is a
 * scenario the build should have refused.
 */
interface ReachSegment<S extends ReusableState201> {
  /** Guard on the condition this segment runs FROM. Absent means it always
   *  applies, which is how a definition spells its fallback. */
  when?: (condition: Condition) => boolean;
  run: ((ctx: StateContext, invocation: InvocationOf<S>) => Promise<void>) | null;
  /** Required when `run` is null: what is missing, so `OCA-201-SLICE.txt` can
   *  cite a state by name and get a reason that points at a thing in the tree
   *  rather than restating a blocker. */
  planned?: string;
}

interface StateDefinition<S extends ReusableState201> {
  /** The dependency edge, as the reference writes it: execute the prerequisite
   *  UNLESS the condition already says we are there. Absent for the nine roots
   *  (eight, plus `Reserved` which nothing invokes). */
  requires?: {
    on: (condition: Condition) => boolean;
    invoke: (invocation: InvocationOf<S>) => StateInvocation;
  };
  /** The post condition -- the whole of what a fixture promises. Four states
   *  move no `State` value at all (their post conditions are about a stored or
   *  retrieved certificate, or are absent), and those return the condition
   *  unchanged. That is not a stub: a case declaring one of them and then a
   *  state with an edge still executes the edge, because the condition never
   *  moved. */
  establishes: (condition: Condition, invocation: InvocationOf<S>) => Condition;
  reach: readonly ReachSegment<S>[];
}

type StateDefinitions = { [S in ReusableState201]: StateDefinition<S> };

// ---------------------------------------------------------------------------
// The two states with a reach.
// ---------------------------------------------------------------------------

/**
 * The one wait that says the station asked the CSMS to authorize.
 *
 * The action's position in an OCPP-J CALL is fixed by the framing, so matching
 * it positionally pins nothing about member order -- which matters here for the
 * reason the boot gate in `tck/main.ts` gives: JSON object key order carries no
 * meaning, and a pattern that assumes one always times out against a CSMS that
 * serialises differently. Matching the action as a bare substring would be
 * wrong in the other direction: `"triggerReason":"Authorized"` contains it.
 */
const SENT_AUTHORIZE = /Sent: \[2,"[^"]*","Authorize",/;

/**
 * A transaction-carrying TransactionEvent that reports energy flowing. The
 * member is matched by lookahead rather than in sequence, same rule.
 *
 * STRICTER THAN THE PATTERN IT REPLACES, AND MEASURED TO BE EQUIVALENT.
 * TC_B_21 waited on any `TransactionEvent` at all; this one is the state's
 * actual post condition, which is a stronger claim and could in principle turn
 * a green scenario orange. Checked against every archived run of that scenario
 * -- 57 of them across the CI corpus -- and the two patterns agree on all 57.
 * The five where NEITHER matches are the runs from before the tag became a
 * valid ISO 14443 UID: the CSMS refused the `Authorize`, the station opened no
 * transaction, and an unestablished precondition reported as SKIPPED is exactly
 * what those runs should say. That is the degradation path being exercised for
 * real rather than reasoned about.
 */
const SENT_TRANSACTION_EVENT_CHARGING =
  /Sent: \[2,"[^"]*","TransactionEvent",(?=[^\]]*"chargingState":"Charging")/;

/** How long a fixture waits for the station to produce a frame. Longer than the
 *  10s TC_B_21 used inline, because two waits now run where one did and the
 *  second is looking at a line the first may already have consumed the run-up
 *  to. Not `holdSecs`: fixtures run BEFORE drive(), and the hold is the window
 *  a scenario's own traffic gets. */
const REACH_TIMEOUT_MS = 15_000;

/** One command, because the pinned image gives no finer lever -- see the note
 *  on AUTHORIZED's segment for what it produces. Named rather than inlined so
 *  a definition's `run:` is one token: `tools/mutate.sh` edits a source file
 *  with a line-oriented substitution, and a guard whose mutation cannot be
 *  written is a guard nobody re-checks when the code moves. */
const reachAuthorized: NonNullable<ReachSegment<"Authorized">["run"]> = async (
  ctx,
  invocation,
) => {
  await ctx.sim.send({
    command: "start_transaction",
    params: { connector: invocation.connectorId, tagId: invocation.idToken },
  });
  await ctx.sim.waitForLine(SENT_AUTHORIZE, REACH_TIMEOUT_MS);
};

/** A wait and not a send: the command `reachAuthorized` issued is what carries
 *  the station into charging, and the pinned image emits the whole sequence off
 *  it. What is left for this state is to observe its own post condition. */
const reachEnergyTransferCharging: NonNullable<
  ReachSegment<"EnergyTransferStarted">["run"]
> = async (ctx) => {
  await ctx.sim.waitForLine(SENT_TRANSACTION_EVENT_CHARGING, REACH_TIMEOUT_MS);
};

const AUTHORIZED: StateDefinition<"Authorized"> = {
  establishes: (condition) => ({ state: "Authorized", evConnected: condition.evConnected }),
  reach: [
    {
      /**
       * ONE SEGMENT, AND THE REFERENCE HAS A BRANCH THIS CANNOT CARRY. Part 6's
       * `Authorized` varies a FIELD of the transaction-opening request -- not
       * which steps run -- according to whether `EVConnectedPreSession`
       * preceded it. The pinned simulator hard-codes that field, so the branch
       * is not expressible here and issue #114 is what would make it so.
       * Modelling it as a second, unreachable segment was considered and
       * rejected: `EVConnectedPreSession` is itself planned, so the guard would
       * be a row that can never be selected -- machinery standing in for a
       * sentence.
       *
       * THE COMMAND REACHES BOTH STATES AT ONCE, and the split below is still
       * right. Measured against the pinned image (archived
       * `cert201-tcb21-reset-scheduled.log`): one `start_transaction` produces
       * an `Authorize`, a `StatusNotification` and a single `TransactionEvent`
       * already carrying `chargingState: "Charging"`. So the send belongs to
       * this state, which is the one the reference has produce the `Authorize`,
       * and `EnergyTransferStarted` waits on the half of that traffic which is
       * its own post condition. A scenario declaring `Authorized` alone
       * therefore gets a station that is in fact charging; the model says less
       * than the station does, which is the safe direction.
       *
       * THE TAG'S SHAPE IS PART OF THE SETUP, and it is why no scenario here
       * authorizes with the `CERT-TAG-1` the 1.6 scenarios use. The station
       * sends the idToken typed `ISO14443` -- the simulator spells that type in
       * its own sources, so no command can change it, which is also why the
       * type is not a parameter -- and a CSMS is entitled to validate the
       * type's format before looking anything up. ISO 14443 is a card UID: 4 or
       * 7 bytes, so 8 or 14 hexadecimal characters, which no `CERT…` spelling
       * can be. A driver that wants a case measured provisions such a tag; one
       * that does not leaves the fixture unestablished and the scenario reports
       * that rather than a false finding.
       */
      run: reachAuthorized,
    },
  ],
};

const ENERGY_TRANSFER_STARTED: StateDefinition<"EnergyTransferStarted"> = {
  requires: {
    on: (condition) => condition.state !== "Authorized",
    invoke: (invocation) => ({
      state: "Authorized",
      connectorId: invocation.connectorId,
      idToken: invocation.idToken,
    }),
  },
  establishes: () => ({ state: "EnergyTransferStarted", evConnected: true }),
  reach: [
    {
      // The EV is not connected yet, so the transaction the `Authorized` edge
      // opened is what carries the station into charging. A wait and not a
      // send: the pinned image emits the whole sequence off one command.
      when: (condition) => !condition.evConnected,
      run: reachEnergyTransferCharging,
    },
    {
      // Already connected -- the reference reaches charging by a change of
      // charging state inside a transaction that is already open. The pinned
      // simulator's 2.0.1 TransactionEvent builder hard-codes triggerReason,
      // stoppedReason and chargingState, so it cannot be asked for one.
      run: null,
      planned:
        "the station must report a change of charging state inside an open " +
        "transaction, and the pinned simulator's 2.0.1 TransactionEvent " +
        "builder hard-codes chargingState and triggerReason -- issue #114.",
    },
  ],
};

// ---------------------------------------------------------------------------
// The twelve with none. Each carries the reference's parameter shape, its edge
// and its post condition -- all facts, all type-checked -- and a reason in
// place of a reach.
// ---------------------------------------------------------------------------

/** The blocker twelve of the fourteen share, in one place so twelve copies
 *  cannot drift into twelve slightly different claims. */
const TRANSACTION_EVENT_BUILDER =
  "the pinned simulator's 2.0.1 TransactionEvent builder hard-codes " +
  "triggerReason, stoppedReason and chargingState, so the station cannot be " +
  "asked to report the event this state turns on -- issue #114.";

const CSMS_INITIATED =
  "no case in the writable slice needs it yet, and its reach is a CSMS " +
  "operation rather than a station command, so it also needs a driver that " +
  "declares that operation.";

const STATE_DEFINITIONS: StateDefinitions = {
  Authorized: AUTHORIZED,
  EnergyTransferStarted: ENERGY_TRANSFER_STARTED,

  Booted: {
    establishes: (condition) => ({ ...condition, state: "Booted" }),
    reach: [
      {
        run: null,
        planned:
          "the runner already boots every station before a fixture runs, so " +
          "this state's reach would be a second boot -- which the pinned " +
          "image can only be asked for by restarting the container, i.e. by " +
          "moving it above the scenario rather than into a fixture.",
      },
    ],
  },

  CertificateInstalled: {
    // NO `State` VALUE. Its post condition is about a certificate being stored,
    // not about a transition, so the condition is returned untouched.
    establishes: (condition) => condition,
    reach: [{ run: null, planned: CSMS_INITIATED }],
  },

  EVConnectedPostSession: {
    requires: {
      on: (condition) => condition.state !== "StopAuthorized",
      invoke: () => ({ state: "StopAuthorized", transactionDurationSecs: 60 }),
    },
    establishes: (condition) => ({ ...condition, state: "EVConnectedPostSession" }),
    reach: [{ run: null, planned: TRANSACTION_EVENT_BUILDER }],
  },

  EVConnectedPreSession: {
    // Modelled as written: this state does NOT publish `evConnected`. See the
    // file header -- reading it literally is the point, and inferring the
    // tidier graph is what a re-read at the pinned edition would authorise.
    establishes: (condition) => ({ ...condition, state: "EVConnectedPreSession" }),
    reach: [{ run: null, planned: TRANSACTION_EVENT_BUILDER }],
  },

  EVDisconnected: {
    requires: {
      on: (condition) => condition.state !== "EVConnectedPostSession",
      invoke: () => ({ state: "EVConnectedPostSession" }),
    },
    establishes: (condition) => ({ ...condition, state: "EVDisconnected" }),
    reach: [{ run: null, planned: TRANSACTION_EVENT_BUILDER }],
  },

  EnergyTransferSuspended: {
    requires: {
      on: (condition) => condition.state !== "EnergyTransferStarted",
      invoke: () => ({
        state: "EnergyTransferStarted",
        connectorId: 1,
        idToken: "CE712001",
      }),
    },
    establishes: (condition) => ({ ...condition, state: "EnergyTransferSuspended" }),
    reach: [{ run: null, planned: TRANSACTION_EVENT_BUILDER }],
  },

  GetInstalledCertificates: {
    establishes: (condition) => condition,
    reach: [{ run: null, planned: CSMS_INITIATED }],
  },

  ISO15118SmartCharging: {
    // Post condition N/a in the reference: it moves nothing.
    establishes: (condition) => condition,
    reach: [
      {
        run: null,
        planned:
          "ISO 15118 charging-needs traffic is not something the pinned " +
          "simulator can be asked to send.",
      },
    ],
  },

  RenewChargingStationCertificate: {
    establishes: (condition) => condition,
    reach: [{ run: null, planned: CSMS_INITIATED }],
  },

  Reserved: {
    establishes: (condition) => ({ ...condition, state: "Reserved" }),
    reach: [
      {
        run: null,
        planned:
          "no case in the 147 the selection rule picks declares this state, " +
          "so it has no consumer to be written for.",
      },
    ],
  },

  StopAuthorized: {
    requires: {
      on: (condition) => condition.state !== "EnergyTransferStarted",
      invoke: () => ({
        state: "EnergyTransferStarted",
        connectorId: 1,
        idToken: "CE712001",
      }),
    },
    establishes: (condition) => ({ ...condition, state: "StopAuthorized" }),
    reach: [{ run: null, planned: TRANSACTION_EVENT_BUILDER }],
  },

  Unavailable: {
    establishes: (condition) => ({ ...condition, state: "Unavailable" }),
    reach: [{ run: null, planned: CSMS_INITIATED }],
  },
};

/** Whether a state has a reach this build can execute at all -- derived from
 *  the definitions rather than tabulated, so "planned" cannot disagree with
 *  what the code does. `OCA-201-SLICE.txt` cites this distinction by name. */
export function isPlanned(state: ReusableState201): boolean {
  return STATE_DEFINITIONS[state].reach.every((segment) => segment.run === null);
}

// ---------------------------------------------------------------------------
// Planning.
// ---------------------------------------------------------------------------

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

export type PlanRefusal =
  | { kind: "planned"; state: ReusableState201; reason: string }
  | { kind: "no-segment"; state: ReusableState201 }
  | { kind: "depth"; state: ReusableState201 };

export interface StatePlan {
  steps: readonly PlannedStep[];
  refusals: readonly PlanRefusal[];
  ends: Condition;
}

/** A plan the runner may execute. Exported so no caller rebuilds the
 *  disjunction -- `tck/standing.ts`'s `endsTheBuild` rule. */
export function isRunnable(plan: StatePlan): boolean {
  return plan.refusals.length === 0;
}

/**
 * The deepest the five edges can chain (EVDisconnected -> EVConnectedPostSession
 * -> StopAuthorized -> EnergyTransferStarted -> Authorized) is five, so this is
 * generous. It is a BACKSTOP and not the rule: `tests/state-plan-201.ts` walks
 * the declared edges and fails the build on a cycle, so a run cannot reach it.
 */
const MAX_EDGE_DEPTH = 16;

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
export function planStates(
  declared: readonly StateInvocation[],
  from: Condition = INITIAL_CONDITION,
): StatePlan {
  const steps: PlannedStep[] = [];
  const refusals: PlanRefusal[] = [];
  let condition = from;
  for (const invocation of declared) {
    condition = planOne(invocation, condition, steps, refusals, 0);
  }
  return { steps, refusals, ends: condition };
}

function planOne(
  invocation: StateInvocation,
  from: Condition,
  steps: PlannedStep[],
  refusals: PlanRefusal[],
  depth: number,
): Condition {
  const state = invocation.state;
  if (depth > MAX_EDGE_DEPTH) {
    refusals.push({ kind: "depth", state });
    return from;
  }
  // The cast is the one place the per-state generic has to be re-joined to the
  // union: `STATE_DEFINITIONS[state]` and `invocation` are correlated by the
  // discriminant, and TypeScript does not track that correlation through an
  // index signature. Every call site above is checked; this is the seam.
  const definition = STATE_DEFINITIONS[state] as StateDefinition<ReusableState201>;
  const typed = invocation as InvocationOf<ReusableState201>;

  let condition = from;
  if (definition.requires && definition.requires.on(condition)) {
    condition = planOne(definition.requires.invoke(typed), condition, steps, refusals, depth + 1);
  }

  const segment = definition.reach.findIndex(
    (candidate) => candidate.when === undefined || candidate.when(condition),
  );
  if (segment === -1) {
    refusals.push({ kind: "no-segment", state });
    return condition;
  }
  const chosen = definition.reach[segment]!;
  if (chosen.run === null) {
    refusals.push({
      kind: "planned",
      state,
      reason: chosen.planned ?? "no reason recorded",
    });
  }

  steps.push({ state, invocation, segment, from: condition });
  return definition.establishes(condition, typed);
}

// ---------------------------------------------------------------------------
// Execution, and what a scenario reads afterwards.
// ---------------------------------------------------------------------------

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
export class FixtureLog {
  constructor(private readonly records: readonly FixtureOutcome[] = []) {}

  established(state: ReusableState201): boolean {
    return this.records.some((record) => record.state === state && record.established);
  }

  reasonFor(state: ReusableState201): string | undefined {
    return this.records.find((record) => record.state === state)?.reason;
  }

  get outcomes(): readonly FixtureOutcome[] {
    return this.records;
  }
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
export async function establishStates(
  plan: StatePlan,
  ctx: StateContext,
  /** Called with the STEP rather than with a sentence, so the two callers can
   *  render it differently: the runner writes prose to stderr, and
   *  tools/extract-drive-trace.ts writes the committed artifact's STATE line.
   *  A message-shaped callback would have made the artifact depend on the
   *  runner's wording. */
  onStep?: (step: PlannedStep) => void,
): Promise<FixtureLog> {
  const outcomes: FixtureOutcome[] = [];
  let abandoned: string | undefined;
  for (const step of plan.steps) {
    if (abandoned !== undefined) {
      outcomes.push({
        state: step.state,
        established: false,
        reason: `a preceding fixture did not hold: ${abandoned}`,
      });
      continue;
    }
    const definition = STATE_DEFINITIONS[step.state] as StateDefinition<ReusableState201>;
    const run = definition.reach[step.segment]?.run;
    if (!run) {
      // Unreachable: planStates refuses a planned segment and the guard fails
      // the build on a scenario whose plan carries a refusal. Recorded rather
      // than thrown so a caller that skipped isRunnable() degrades instead of
      // crashing.
      abandoned = `${step.state} has no reach in this build`;
      outcomes.push({ state: step.state, established: false, reason: abandoned });
      continue;
    }
    onStep?.(step);
    try {
      await run(ctx, step.invocation as InvocationOf<ReusableState201>);
      outcomes.push({ state: step.state, established: true });
    } catch (err) {
      if (err instanceof UnsupportedOperationError) throw err;
      abandoned = err instanceof Error ? err.message : String(err);
      outcomes.push({ state: step.state, established: false, reason: abandoned });
    }
  }
  return new FixtureLog(outcomes);
}

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
export function assertStateEstablished(
  rec: AssertRecorder,
  fixtures: FixtureLog,
  state: ReusableState201,
  description: string,
): void {
  if (fixtures.established(state)) {
    rec.pass(description);
    return;
  }
  const reason = fixtures.reasonFor(state) ?? "no fixture ran for this state";
  rec.skip(description, `${UNEXERCISED_PREFIX} ${state} was not established: ${reason}`);
}
