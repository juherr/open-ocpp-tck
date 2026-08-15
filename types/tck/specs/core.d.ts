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
 */
export declare function assertGetConfigurationUnfiltered(rec: AssertRecorder, frames: readonly Frame[], description: string): void;
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
