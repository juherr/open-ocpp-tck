/**
 * specs/core-201.ts -- the OCPP 2.0.1 slice, and the first scenarios in this
 * suite that were not ported from anything.
 *
 * WHICH CASES MAY BE HERE IS NOT THIS FILE'S DECISION. `OCA-201-SELECTION.md`
 * states the rule -- profile Core, role CSMS, status `M` -- and
 * `OCA-201-SLICE.txt` is the resulting list, one row per case, guarded by
 * tests/oca-201-slice.sh in both directions. Adding a scenario here for a case
 * that is not in that file fails the build, which is the point: "a small
 * representative set" was a judgement each reviewer made differently.
 *
 * WRITTEN, NOT COPIED. OCPP 2.0.1 Parts 5 and 6 are CC BY-ND 4.0 and this
 * repository is Apache-2.0, so their prose, tables and step text are not here
 * and cannot be. Case identifiers are citations and are all that is quoted.
 * Every assertion below says what we decided to measure, in our words, exactly
 * as the OCPP 1.6 scenarios do.
 *
 * WHICH OUTCOME IS WHICH CASE IS OUR READING. `ResetStatusEnumType` has three
 * values and the Reset block has three mandatory CSMS cases, so the three are
 * mapped onto Accepted / Scheduled / Rejected in that order -- and the OCA 1.6
 * suite's habit of pairing an accepted case with a rejected one (TC_026,
 * TC_028, TC_055 are all in this tree) is the reason for reading them as
 * outcomes rather than as use cases. It is an inference, it is the one thing
 * here that a reader of Part 6 can falsify in a minute, and correcting it
 * moves three templateIds and three rows of `OCA-201-SLICE.txt` and nothing
 * else.
 *
 * NO SIMULATOR TEMPLATE, which is what `runsSimTemplate: false` says on every
 * scenario below. The pinned image ships 60 templates and not one of them is
 * `cert201-`, so the wait for `scenario_started` could only ever time out --
 * and none of these needs one anyway: two are what a charge point does on
 * `connect`, and three are driven entirely from the CSMS side. A template would be a thing to maintain upstream before
 * a single case could be measured here.
 *
 * A FAILING CSMS OPERATION IS NOT SWALLOWED HERE, which is where these differ
 * from the 1.6 scenarios: those wrap `execute` in a try/catch that warns and
 * carries on, so a CSMS that refused to dispatch is reported as a missing
 * frame. Two reasons not to inherit it. That catch also swallows
 * `UnsupportedOperationError`, which is the runner's second line of defence --
 * a driver whose scope table missed a scenario should land NOT APPLICABLE, and
 * for a protocol most drivers do not speak that backstop is the common case
 * rather than the exotic one. And a CSMS that answers "not dispatched" has said
 * something specific, which reaches the log intact as an ERROR and is exactly
 * the question these scenarios' scope rows are open on; as a FAIL it becomes
 * "no Received CALL found", which is true and says nothing.
 *
 * THE SETUP IS INLINE, AND IT DUPLICATES. `ocppVersion` plus
 * `runsSimTemplate: false` is five copies of the same two lines, and the three
 * Reset scenarios repeat the same drive-then-check shape with one member
 * changed. That is deliberate: OCPP 2.0.1 Part 6 defines 13 `Reusable State`
 * fixtures and this suite has timers and one-shot provisioning, which are not
 * the same thing -- issue #63 says to write the setup inline and note where it
 * duplicates rather than build the mechanism from one slice's evidence. This
 * paragraph is that note.
 */
import type { ScenarioSpec } from "../spec-types";
/**
 * The slice, in case order. Two of the seven cases `OCA-201-SLICE.txt` lists
 * are absent, with the reason in that file rather than here -- one place per
 * fact, and the guard reads that one.
 */
export declare const CORE_201_SPECS: ScenarioSpec<any>[];
