/**
 * specs/core.ts -- typed port of the "Core" group's bash specs
 * (scripts/steve-verify/specs/cert16-{tc001,tc003,tc004,tc005,tc013,tc014,
 * tc017,tc018,tc019(x2),tc021,tc024,tc031,tc061,tc064}-*.spec.sh), mirroring
 * run-all.sh's CORE array exactly (15 scenarios). Each spec asserts AT
 * LEAST what its bash predecessor asserted; CALLRESULT status checks are
 * upgraded to uniqueId-paired correlation (assertResponseStatus /
 * assertIdTagInfoStatus) instead of the bash version's log-window grep.
 */
import { type AssertRecorder } from "../assert";
import { type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
/**
 * TC_019_1's actual obligation: a GetConfiguration reached the charge point
 * asking for NO filter. OCPP 1.6 makes `key` 0..N optional and defines its
 * ABSENCE as "return every key", so `{}` and `{"key":[]}` are the same request
 * and a CSMS may send either. Checking the wire text for one of them failed a
 * conformant CSMS on its serialisation while the rest of the scenario passed
 * (issue #31) -- so this reads the parsed frame, which is also what keeps
 * TC_019_1 distinguishable from TC_019_2's `{"key":["HeartbeatInterval"]}`.
 *
 * Any received GetConfiguration satisfying it is enough, matching the any-line
 * semantics of the assertLineMatches this replaced: a CSMS that also makes
 * filtered requests is not failed for them.
 *
 * A malformed payload is not one of those witnesses. An OCPP-J CALL carries a
 * JSON OBJECT, and reading `key` off anything else -- `null`, an array, a
 * scalar -- yields undefined, which is the same shape an omitted member has.
 * Without the check below, `[2,"id","GetConfiguration",null]` would report a
 * conformance PASS: a green check for a request that is not a GetConfiguration
 * at all, which is the failure this whole helper exists to stop happening in
 * the other direction.
 *
 * Exported ONLY so tests/get-configuration-filter.ts can reach it -- neither
 * spelling is reproducible from a bundled driver, so the guard has to hand the
 * helper its frames. Not part of the driver-author surface: tck/index.ts
 * deliberately re-exports no specs.
 *
 * NOT GENERALISED into an assert.ts primitive, and here is the survey so the
 * question is not re-opened blind. Every `Sent:` regex in specs/ matches our
 * own simulator's JSON.stringify output and cannot vary. Of the `Received:`
 * ones -- the only CSMS-serialised half -- most pin nothing past the action
 * name, and exactly one other was at genuine risk: TC_021, which pinned member
 * ORDER. It is fixed below, by composing assertReceived with assertEq rather
 * than by a second helper, because what it needs is a value comparison the DSL
 * already has. Two instances, two shapes, no third caller: a generic
 * "assert a received payload satisfies a predicate" would be speculative here,
 * and it would put message-specific knowledge in a DSL that is message-agnostic
 * by construction. This helper stays in specs/ for the same reason -- "`key`
 * absent means return everything" is GetConfiguration semantics, not assertion
 * machinery.
 *
 * THAT SURVEY'S PREMISE MOVED, and the conclusion only half survived -- issue
 * #44. "Every `Sent:` regex matches our own simulator and cannot vary" is
 * false: it matches a PINNED DIGEST, and six of those regexes pinned member
 * order, so bumping the digest could turn them red for a reason no CSMS
 * caused. Two of the six even carried a comment saying they matched their
 * members "independently rather than assuming an order", which `.*` between
 * two members is not. All six are converted, so the caller count is no longer
 * two.
 *
 * What survives is WHERE the knowledge lives, and it survives whole. assert.ts
 * gained exactly one shape that carries no message knowledge --
 * `assertCallPayload`, a flat scalar subset of a CALL payload, which serves
 * three of the six. The other three are about what a `configurationKey` list
 * or a `chargingSchedule` looks like, so they stayed in this directory:
 * `assertConfigurationKeyListed` below, and
 * `assertCompositeSchedulePeriodLimit` in specs/remotetrigger-smartcharging.ts.
 * A primitive that knew what a `configurationKey` list is would still be the
 * wrong thing to build -- and the version of it that knew nothing, taking a
 * predicate, was written and reverted for a second reason recorded beside
 * `assertIdTagInfoStatus` in assert.ts.
 */
export declare function assertGetConfigurationUnfiltered(rec: AssertRecorder, frames: readonly Frame[], description: string): void;
/**
 * The CALLRESULT answering the received GetConfiguration returns a
 * `configurationKey` list -- and, when `key` is a string rather than null,
 * one carrying that key.
 *
 * Replaces `/Sent: \[3,.*"configurationKey":\[{"key"/` and its
 * `:"HeartbeatInterval"` variant. Both were wrong twice over, and only the
 * first way is issue #44's: `\[{"key"` requires `key` to be the FIRST member
 * the charge point serialised in the FIRST entry, which no part of OCPP 1.6
 * says and nothing here declares. The second is that a text match over the
 * run's lines identifies the response as "some sent CALLRESULT mentioning
 * configurationKey" -- any CALLRESULT, to any request. Correlating from the
 * GetConfiguration that provoked it is what the check always meant.
 *
 * `key: null` is "a non-empty list", which is TC_019_1's obligation: it asked
 * for every key, so what matters is that a list came back at all. A literal
 * rather than an omitted argument so that ASSERT-INVENTORY.txt renders it --
 * a non-literal argument renders as `·`, and the difference between the two
 * scenarios' checks would then be invisible in the artifact that exists to
 * show it.
 *
 * An entry without a string `key` is not a configurationKey entry: OCPP 1.6
 * makes `key` required in `KeyValue`, and accepting anything else would let a
 * malformed response satisfy a conformance check.
 *
 * ANY received GetConfiguration whose answer satisfies it is enough, and that
 * is not a detail. The regexes this replaced matched any LINE, and the check
 * standing beside it in TC_019_1 -- assertGetConfigurationUnfiltered above --
 * accepts any request. Correlating from only the FIRST GetConfiguration would
 * make the two neighbours talk about different requests the moment a CSMS
 * sends one of its own, and would narrow what the scenario measures in the
 * failing direction, silently. Converting a regex must not do that.
 *
 * SPELLED OUT rather than handed to a predicate-taking helper in assert.ts --
 * see the rejected-refactor note beside `assertIdTagInfoStatus` there. In
 * short: an argument the extractor cannot render is an argument
 * ASSERT-INVENTORY.txt cannot pin, and what this helper accepts is exactly
 * what that artifact exists to show.
 */
export declare function assertConfigurationKeyListed(rec: AssertRecorder, frames: readonly Frame[], key: string | null, description: string): void;
export declare const tc001ColdBootSpec: ScenarioSpec<void>;
export declare const tc003ChargingPluginFirstSpec: ScenarioSpec<void>;
export declare const tc004ChargingIdFirstSpec: ScenarioSpec<void>;
export declare const tc005EvSideDisconnectSpec: ScenarioSpec<void>;
export declare const tc013HardResetSpec: ScenarioSpec<void>;
export declare const tc014SoftResetSpec: ScenarioSpec<void>;
export declare const tc017UnlockOccupiedSpec: ScenarioSpec<void>;
export declare const tc018UnlockFailureSpec: ScenarioSpec<void>;
export declare const tc019GetConfigurationAllSpec: ScenarioSpec<void>;
export declare const tc019GetConfigurationKeySpec: ScenarioSpec<void>;
export declare const tc021ChangeConfigurationSpec: ScenarioSpec<void>;
export declare const tc024LockFailureSpec: ScenarioSpec<void>;
export declare const tc031UnlockUnknownConnectorSpec: ScenarioSpec<void>;
export declare const tc061ClearCacheSpec: ScenarioSpec<void>;
export declare const tc064DataTransferSpec: ScenarioSpec<void>;
export declare const CORE_SPECS: ScenarioSpec<any>[];
