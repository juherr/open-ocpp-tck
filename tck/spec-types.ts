/**
 * spec-types.ts -- the shape a scenario spec (port of specs/<id>.spec.sh)
 * takes in the TypeScript runner. Task 1 wires two specs directly in
 * main.ts against this shape; Task 2 grows a specs/ directory of these.
 */

import type { AssertRecorder } from "./assert";
import type { Frame } from "./ocpp";
import type { SimProcess } from "./sim";
import type {
  CsmsOperations16,
  CsmsOperations201,
  CsmsRecords,
} from "./driver";

export interface DriveContext {
  cpId: string;
  connector: number;
  sim: SimProcess;
  /** The CSMS under test, whichever driver CSMS_DRIVER selected. A spec
   *  asks for OCPP operations and never learns which CSMS carried them
   *  out -- see driver.ts's CsmsOperation16 for the vocabulary. */
  csms16: CsmsOperations16;
  /** The OCPP 2.0.1 half of the same CSMS, for a cert201- scenario. NON-
   *  OPTIONAL as a spec sees it, exactly like records.reservations: a driver
   *  that speaks only 1.6 omits it and the runner substitutes a stub that
   *  throws, so a spec never writes `?.` and never branches on which driver is
   *  loaded -- see capabilities.ts. Absence therefore reads as NOT APPLICABLE
   *  rather than as a green scenario that drove nothing. */
  csms201: CsmsOperations201;
  /** What the CSMS believes happened: transactions, reservations, charging
   *  profiles. Read-only, and a driver that cannot answer says so rather
   *  than inventing a value -- see driver.ts's CsmsRecords. */
  records: CsmsRecords;
}

export interface AssertContext<D> {
  cpId: string;
  connector: number;
  /** Every parsed OCPP-J frame from the run, uniqueId-correlatable via
   *  ocpp.ts's findCall/findResponseFor. */
  frames: readonly Frame[];
  /** Every raw stdout line from the run (structured JSON events + plain
   *  Logger lines), for checks that aren't about a specific OCPP frame
   *  (scenario lifecycle events, boot-gate-suppression absence, ...). */
  lines: readonly string[];
  rec: AssertRecorder;
  records: CsmsRecords;
  /** Whatever `drive()` returned (e.g. a baseline captured before
   *  triggering a CSMS op), threaded through for a later negative check. */
  driveState: D;
}

export interface ScenarioSpec<D = void> {
  templateId: string;
  description?: string;
  /** Connector to run the scenario template on. Default 1. */
  connector?: number;
  /** Seconds to wait after `connect` before running the scenario template
   *  (past BootNotification.conf) -- mirrors lib.sh's SPEC_BOOT_WAIT. */
  bootWaitSecs?: number;
  /** Seconds to hold the sim open after triggering the scenario, for the
   *  scenario + any drive() traffic to finish -- mirrors SPEC_HOLD_SECS. */
  holdSecs?: number;
  /** Runs concurrently with the sim's scenario execution, for scenarios
   *  that need CSMS-side operator action (steve_op equivalent). Its
   *  return value is threaded into assert() as `driveState`. Omitted
   *  entirely for CP-only scenarios that just need to be watched. */
  drive?: (ctx: DriveContext) => Promise<D>;
  /** Runs once against the full captured frame/line list + driveState. */
  assert: (ctx: AssertContext<D>) => Promise<void> | void;
}
