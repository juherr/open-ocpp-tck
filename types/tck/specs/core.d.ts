/**
 * specs/core.ts -- typed port of the "Core" group's bash specs
 * (scripts/steve-verify/specs/cert16-{tc001,tc003,tc004,tc005,tc013,tc014,
 * tc017,tc018,tc019(x2),tc021,tc024,tc031,tc061,tc064}-*.spec.sh), mirroring
 * run-all.sh's CORE array exactly (15 scenarios). Each spec asserts AT
 * LEAST what its bash predecessor asserted; CALLRESULT status checks are
 * upgraded to uniqueId-paired correlation (assertResponseStatus /
 * assertIdTagInfoStatus) instead of the bash version's log-window grep.
 */
import type { ScenarioSpec } from "../spec-types";
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
