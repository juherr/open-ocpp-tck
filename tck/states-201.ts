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
import {
  UnsupportedOperationError,
  type CsmsOperations201,
  type CsmsRecords,
  type GetCertificateIdUse201,
} from "./driver";
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
  // --- the three with a reach ----------------------------------------------
  | { state: "Authorized"; connectorId: number; idToken: string }
  | { state: "EnergyTransferStarted"; connectorId: number; idToken: string }
  | { state: "Unavailable"; evseId: number }
  // --- the eleven planned: the reference's parameter shape -----------------
  | { state: "Booted"; model: string }
  | { state: "CertificateInstalled"; certificateType: CertificateUse201 }
  | { state: "EVConnectedPostSession" }
  | { state: "EVConnectedPreSession"; evseId: number; connectorId: number }
  | { state: "EVDisconnected" }
  | { state: "EnergyTransferSuspended"; transactionDurationSecs: number }
  // THE ONE INVOCATION THAT DOES NOT TAKE {@link CertificateUse201}, and the
  // difference is the wire's. A certificate is installed as one of four roots
  // and asked about as one of those four or as a `V2GCertificateChain`, which
  // is what TC_M_15 asks for -- so this state ranges over the request's own
  // enumeration and `CertificateInstalled` above ranges over the other.
  | { state: "GetInstalledCertificates"; certificateType: GetCertificateIdUse201 }
  | { state: "ISO15118SmartCharging"; evseId: number }
  | { state: "RenewChargingStationCertificate" }
  | { state: "Reserved"; evseId: number; idToken: string }
  | { state: "StopAuthorized"; transactionDurationSecs: number };

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
// The three states with a reach.
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
 * A transaction-carrying TransactionEvent that reports energy flowing, and the
 * uniqueId the CSMS owes an answer under. The member is matched by lookahead
 * rather than in sequence, same rule; the id is captured because
 * {@link answeredCall} is the only way to correlate the answer back.
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
  /Sent: \[2,"([^"]*)","TransactionEvent",(?=[^\]]*"chargingState":"Charging")/;

/** How long a fixture waits for a frame. Longer than the 10s TC_B_21 used
 *  inline, because three waits now run where one did and each is looking at a
 *  line an earlier one may already have consumed the run-up to. Measured
 *  against the CI corpus for the wait that is new: across 47 archived
 *  `Started`/`Charging` events the CSMS answered in 30..208ms, p50 89ms, so
 *  this is two orders of magnitude of slack. Generous on purpose -- the only
 *  runs that pay it are runs where the CSMS has already stopped answering.
 *  Not `holdSecs`: fixtures run BEFORE drive(), and the hold is the window a
 *  scenario's own traffic gets. */
const REACH_TIMEOUT_MS = 15_000;

/**
 * The CSMS's answer to one CALL, correlated by the uniqueId that CALL carried.
 *
 * The uniqueId is the only thing an OCPP-J CALLRESULT carries that ties it to a
 * request -- which is the same fact `reachUnavailable` below gives as its
 * reason for NOT waiting on one. The difference is that here the id is in hand,
 * so the wait is available.
 *
 * A CALLRESULT AND NOT AN ANSWER OF ANY KIND, and that is not this fixture
 * judging what the CSMS said. `[4,…]` is the CSMS declining to record the
 * transaction, so a run that got one has not reached the condition and timing
 * out is the honest report. Whether the CSMS's silence or its error is a
 * finding is the case's question, and `assertAllAnswered` reads the frames to
 * answer it rather than this wait.
 */
function answeredCall(uniqueId: string): RegExp {
  return new RegExp(`Received: \\[3,"${uniqueId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
}

/** What the uniqueId reads as when the line the first wait returned is not a
 *  frame. Live this cannot happen -- the pattern captured the id off the line
 *  it matched -- but `tools/extract-drive-trace.ts` answers every wait with a
 *  placeholder, and a reach that threw there would drop this wait, every state
 *  after it and their STATE lines from a committed artifact WITHOUT failing
 *  anything. So the second wait is issued either way, and what DRIVE-TRACE.txt
 *  pins is a pattern shaped like the live one. */
const UNIQUE_ID_UNPARSED = "<uniqueId>";

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

/**
 * Waits and not sends: the command `reachAuthorized` issued is what carries the
 * station into charging, and the pinned image emits the whole sequence off it.
 * What is left for this state is to observe its post condition.
 *
 * TWO WAITS, AND THE SECOND ONE IS THE CSMS'S. The station's `TransactionEvent`
 * is the condition Part 6 writes; it is NOT enough for a case that then names
 * the transaction to the CSMS, because the id is minted by the station and the
 * CSMS only has a row for it once it has processed the event. TC_K_60 measured
 * that gap for real: it read the id off the CALL and sent a `TxProfile` naming
 * it 160ms later, the CSMS answered "Transaction … not found on station", and
 * the scenario ERRORed -- twice, the isolated retry included, so not lane
 * contention. Waiting for the CALLRESULT to that exact event closes it.
 *
 * WIDENING THE STATE AND NOT THE CASE, which is the decision worth arguing.
 * Part 6's post condition for `EnergyTransferStarted` is about the STATION, so
 * this is our model rather than a transcription of the reference's, and the
 * file header is explicit that the reach sequence is the part that is ours to
 * write while the post condition is what a fixture may promise. What this adds
 * to the promise is the half a CSMS-side case cannot do without: `transactionId`
 * is the ONE condition in this graph that exists as a row on the CSMS and gets
 * named back to it by an operation, and a fixture that hands drive() a CSMS
 * which cannot yet be asked about the transaction it just established has not
 * finished establishing it. Nothing else in the fourteen has that shape, which
 * is why the same treatment is not applied to `reachAuthorized` above.
 *
 * TRIED AND REJECTED, here because here is where it gets re-proposed: put the
 * wait in TC_K_60's `drive()` instead, since TC_K_60 is the only scenario that
 * names a transaction today. Three things against it. The scenario would have
 * to re-derive the correlation -- capture the uniqueId, build the pattern,
 * bound the wait -- which is this function's work done a second time by the one
 * caller least able to check it. It would have to invent its own degradation:
 * `establishStates` already turns a reach that times out into an unestablished
 * state and `assertStateEstablished` already turns that into SKIPPED with
 * `UNEXERCISED_PREFIX`, where a scenario-local wait needs its own try/catch and
 * its own skip -- and TC_K_60's existing skip says "the station opened no
 * transaction", which would then be printed for a run where the station opened
 * one and the CSMS was slow. And it leaves the next case to rediscover it: the
 * selection rule picks 147, `EnergyTransferSuspended` and `StopAuthorized` both
 * sit downstream of this state, and the cost of being wrong is an ERROR, which
 * reads as the harness breaking rather than as a race.
 *
 * MEASURED AGAINST THE CORPUS, the rule `SENT_TRANSACTION_EVENT_CHARGING` set
 * for a strengthened wait. 62 archived `Started`/`Charging` events; 47 answered
 * (30..208ms) and 15 not. All 15 are `cert201-tcb21-reset-scheduled` runs in
 * which the CSMS had stalled outright -- the `Authorize` before the event is
 * unanswered too, and no `Reset` ever reaches the wire. Those 15 are FAIL today
 * and stay FAIL: the `Reset.req received` checks and `assertAllAnswered` are
 * what fail, and neither is gated on the fixture. What moves is "a transaction
 * was running when the reset was asked for", from PASS to SKIPPED, which is the
 * more accurate of the two about a CSMS that never learnt of the transaction.
 */
const reachEnergyTransferCharging: NonNullable<
  ReachSegment<"EnergyTransferStarted">["run"]
> = async (ctx) => {
  const sent = await ctx.sim.waitForLine(SENT_TRANSACTION_EVENT_CHARGING, REACH_TIMEOUT_MS);
  const uniqueId = SENT_TRANSACTION_EVENT_CHARGING.exec(sent)?.[1] ?? UNIQUE_ID_UNPARSED;
  await ctx.sim.waitForLine(answeredCall(uniqueId), REACH_TIMEOUT_MS);
};

/**
 * The station reporting a connector it will no longer serve.
 *
 * THE POST CONDITION AND NOT THE ANSWER, which is the choice worth stating.
 * The `ChangeAvailabilityResponse` arrives first and says `Accepted`, and
 * waiting on it would be waiting on the CSMS's dispatch rather than on the
 * station's condition -- a station that answered Accepted and then did nothing
 * would satisfy it. A CALLRESULT also carries no action name in OCPP-J, so
 * there is nothing to match it by that is not a uniqueId this function does
 * not have. The `StatusNotification` is what the condition IS, and it is the
 * frame the scenarios then go on to measure the CSMS's answer to.
 *
 * Matched by lookahead for `SENT_AUTHORIZE`'s reason: nothing here pins member
 * order.
 */
const SENT_STATUS_UNAVAILABLE =
  /Sent: \[2,"[^"]*","StatusNotification",(?=[^\]]*"connectorStatus":"Unavailable")/;

/**
 * The first fixture whose reach is a CSMS operation rather than a station
 * command, which is what {@link CSMS_INITIATED} said was still owed.
 *
 * ONE SEGMENT, unguarded: unlike `EnergyTransferStarted` this state's reference
 * definition branches on nothing, and a request that finds the EVSE already
 * inoperative is answered and re-reported rather than refused -- so the same
 * sequence establishes the condition from anywhere.
 *
 * `evse` CARRIES `id` AND NOT `connectorId`, and that is the reference's own
 * parameter shape rather than a simplification: this state takes an EVSE. A
 * scenario that needs the connector-scoped or the station-wide request writes
 * it inline, which is what two of the six ChangeAvailability scenarios do --
 * widening this invocation to carry the other two modes would make our
 * declaration say something about Part 6 that Part 6 does not.
 *
 * A DRIVER THAT CANNOT DISPATCH IT throws `UnsupportedOperationError`, which
 * `establishStates` deliberately does not catch: the runner turns it into NOT
 * APPLICABLE, and a fixture asking for an operation the driver has not
 * declared means the same thing as a scenario doing so.
 */
const reachUnavailable: NonNullable<ReachSegment<"Unavailable">["run"]> = async (
  ctx,
  invocation,
) => {
  await ctx.csms201.execute(ctx.cpId, {
    action: "ChangeAvailability",
    operationalStatus: "Inoperative",
    evse: { id: invocation.evseId },
  });
  await ctx.sim.waitForLine(SENT_STATUS_UNAVAILABLE, REACH_TIMEOUT_MS);
};

/**
 * The request this state IS, arriving at the station.
 *
 * A `Received` LINE AND NOT THE STATION'S ANSWER, which is the opposite of
 * `SENT_STATUS_UNAVAILABLE`'s choice one state up and right for the opposite
 * reason. That state's post condition is a thing the station goes on to REPORT,
 * so waiting on the report is waiting on the condition; this state's post
 * condition is that a list was retrieved, and the only frame carrying it is a
 * CALLRESULT -- which in OCPP-J names no action, so there is nothing to match
 * it by that is not a uniqueId this function does not have. What the wait is
 * for is therefore narrower and honest: the request reached the station before
 * the scenario's window opened. The answer to it is what the scenarios then
 * measure, off the same frames.
 */
const RECEIVED_GET_INSTALLED_CERTIFICATE_IDS =
  /Received: \[2,"[^"]*","GetInstalledCertificateIds"/;

/**
 * The second fixture whose reach is a CSMS operation, and the first whose
 * declared post condition this deployment does NOT in fact establish.
 *
 * WHAT THE REFERENCE SCRIPTS AND WHAT THE PINNED STATION GIVES ARE DIFFERENT
 * ANSWERS, and the gap is written here rather than in the four scenarios that
 * would otherwise each restate it. Part 6 has the station answer `Accepted`
 * with the hash data of every certificate of the type asked for; the pinned
 * simulator answers `NotFound` from a canned handler that reads no request
 * member and holds no truststore. So nothing is retrieved, and this fixture's
 * post condition -- "a list was retrieved" -- is not established in the sense
 * the reference means.
 *
 * IT IS STILL THE RIGHT FIXTURE, because of what the state establishes in the
 * MODEL: nothing. `establishes` returns the condition untouched, no other state
 * depends on this one, and no scenario in the selected slice takes it as a
 * precondition -- the four that name it ARE it. So the falsehood has no reader:
 * there is no later step that would run on the strength of a list this station
 * never sent. What the fixture does establish is the only half a CSMS campaign
 * can measure at all, since the response is the OCTT's own script rather than
 * anything the system under test decides: that the CSMS sent the request, and
 * sent it with the member the case names.
 *
 * A REACH THAT ASSERTED THE ANSWER WOULD BE THE WRONG SHAPE TWICE. It would put
 * a verdict in a fixture, which this file's header refuses, and it would make
 * every one of those four cases orange against a station whose answer the case
 * does not measure.
 */
const reachGetInstalledCertificates: NonNullable<
  ReachSegment<"GetInstalledCertificates">["run"]
> = async (ctx, invocation) => {
  await ctx.csms201.execute(ctx.cpId, {
    action: "GetInstalledCertificateIds",
    certificateType: [invocation.certificateType],
  });
  await ctx.sim.waitForLine(RECEIVED_GET_INSTALLED_CERTIFICATE_IDS, REACH_TIMEOUT_MS);
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
      // opened is what carries the station into charging. Waits and not sends:
      // the pinned image emits the whole sequence off one command, and the
      // second wait is the CSMS answering -- see the reach for why that half is
      // here rather than in the one case that needs it.
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

const UNAVAILABLE: StateDefinition<"Unavailable"> = {
  establishes: (condition) => ({ ...condition, state: "Unavailable" }),
  reach: [{ run: reachUnavailable }],
};

// ---------------------------------------------------------------------------
// The eleven with none. Each carries the reference's parameter shape, its edge
// and its post condition -- all facts, all type-checked -- and a reason in
// place of a reach.
// ---------------------------------------------------------------------------

/** The blocker five of the fourteen share, in one place so five copies cannot
 *  drift into five slightly different claims. */
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
    // NO `State` VALUE, for `CertificateInstalled`'s reason: the post condition
    // is about a list having been retrieved, not about a transition. One
    // consequence is worth naming, because it is what makes the four cases that
    // name this state four cases rather than one: the condition never records
    // it, so `planStates` never treats it as already held and every scenario
    // declaring it sends its own request.
    establishes: (condition) => condition,
    reach: [{ run: reachGetInstalledCertificates }],
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

  Unavailable: UNAVAILABLE,
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
