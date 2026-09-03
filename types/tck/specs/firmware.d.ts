/**
 * Derived from shiv3/ocpp-cp-simulator scripts/steve-verify/runner/specs/firmware.ts @ 604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1 (Apache-2.0). Modified: CSMS operations are expressed as typed OCPP through the driver contract.
 *
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
