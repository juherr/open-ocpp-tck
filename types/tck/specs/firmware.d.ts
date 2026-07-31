/**
 * specs/firmware.ts -- typed port of the "Firmware" bash specs
 * (scripts/steve-verify/specs/cert16-{tc044-1,tc044-2,tc044-3,tc045-1}-*.spec.sh),
 * mirroring run-all.sh's FIRMWARE array exactly (4 scenarios). Each spec
 * asserts AT LEAST what its bash predecessor asserted.
 */
import type { ScenarioSpec } from "../spec-types";
export declare const tc0441FirmwareUpdateSpec: ScenarioSpec<void>;
export declare const tc0442FirmwareDownloadFailedSpec: ScenarioSpec<void>;
export declare const tc0443FirmwareInstallFailedSpec: ScenarioSpec<void>;
export declare const tc0451GetDiagnosticsSpec: ScenarioSpec<void>;
export declare const FIRMWARE_SPECS: ScenarioSpec<void>[];
