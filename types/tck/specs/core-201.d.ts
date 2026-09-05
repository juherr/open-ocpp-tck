/**
 * specs/core-201.ts -- the OCPP 2.0.1 scenarios, and the first in this suite
 * that were not ported from anything.
 *
 * WHICH CASES MAY BE HERE IS NOT THIS FILE'S DECISION. `OCA-201-SELECTION.md`
 * states the rule -- role CSMS, status `M`, on every certification profile --
 * and `OCA-201-SLICE.txt` is the resulting list, one row per case, guarded by
 * tests/oca-201-slice.sh in both directions. Adding a scenario here for a case
 * that is not in that file fails the build, which is the point: "a small
 * representative set" was a judgement each reviewer made differently.
 *
 * WRITTEN, NOT COPIED. OCPP 2.0.1 Parts 5 and 6 are CC BY-ND 4.0, and `ND` is
 * a limit on modification: their prose, tables and step text brought into ours
 * would be the Licensed Material "arranged" or "otherwise modified", which is
 * the Adapted Material §2(a)(1)(B) withholds. So none of it is here and none of
 * it can be. Case identifiers are not that -- they are facts about the
 * specification, and OCA-201-SELECTION.md's licensing section is where that is
 * argued. Every assertion below says what we decided to measure, in our words,
 * exactly as the OCPP 1.6 scenarios do.
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
 * `connect`, and the rest are driven entirely from the CSMS side. A template
 * would be a thing to maintain upstream before a single case could be measured
 * here.
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
 * THE SETUP IS NO LONGER INLINE, and what replaced it is `tck/states-201.ts`.
 * OCPP 2.0.1 Part 6 defines 14 `Reusable State` fixtures for the CSMS role --
 * 13 was this paragraph's first count, corrected when the reference was re-read
 * for the operation measurement -- and a case declares the ones it takes as its
 * precondition. Issue #63 said to write that setup inline and note where it
 * duplicated rather than build a mechanism from five scenarios' evidence; the
 * evidence arrived when the selection rule turned out to pick 147 cases, at
 * which point a handful of copies becomes a class of copies that drift while
 * each one still reads reasonably. TC_B_21 is the one scenario here that
 * declares a state today, and its `states:` field is what the mechanism reads.
 *
 * WHAT STILL DUPLICATES, deliberately: `ocppVersion` plus
 * `runsSimTemplate: false` on every scenario, and the three Reset scenarios'
 * shared drive-then-check shape with one member changed. Those are not
 * fixtures. Factoring either into a shared constant renders it `·` in
 * `ASSERT-INVENTORY.txt` and stops it being pinned, which is the trade TC_B_22
 * spells out for its two literals and which applies to every declaration in
 * this file.
 */
import type { ScenarioSpec } from "../spec-types";
/**
 * The scenarios, in case order -- the seven of `OCA-201-SLICE.txt`'s 147 that
 * are implemented. The other 140 are declined there rather than here, with
 * the reason in the row: one place per fact, and the guard reads that one.
 */
export declare const CORE_201_SPECS: ScenarioSpec<any>[];
