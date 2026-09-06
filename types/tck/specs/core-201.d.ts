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
 * each one still reads reasonably. Four scenarios declare a state today --
 * TC_B_21, TC_G_03, TC_G_04 and TC_K_60, whose `TxProfile` has no transaction
 * to name without one -- and their `states:` field is what the
 * mechanism reads. TC_G_03 is the one whose state IS the case: Part 6 gives it
 * no tool validation of its own, so it has no drive() at all and the fixture's
 * traffic is what its assertions read.
 *
 * WHAT STILL DUPLICATES, deliberately: `ocppVersion` plus
 * `runsSimTemplate: false` on every scenario, the three Reset scenarios'
 * shared drive-then-check shape with one member changed, the six
 * ChangeAvailability ones' with two, and the seven charging-profile ones'
 * literal profiles. Those are not
 * fixtures. Factoring either into a shared constant renders it `·` in
 * `ASSERT-INVENTORY.txt` and stops it being pinned, which is the trade TC_B_22
 * spells out for its two literals and which applies to every declaration in
 * this file.
 */
import { type AssertRecorder } from "../assert";
import { type Frame } from "../ocpp";
import type { ScenarioSpec } from "../spec-types";
/**
 * The CSMS put a `ChangeAvailability` on the wire in one of the three scopes
 * 2.0.1 gives it, and asked for the availability the scenario asked for.
 *
 * THREE SCOPES, TOLD APART BY ABSENCE. The request carries `operationalStatus`
 * and an optional `evse` object; `evse` absent means the whole charging
 * station, `evse` with `id` alone means that EVSE, and `evse` with
 * `connectorId` as well means that connector. Nothing else distinguishes them
 * -- so a check that read `operationalStatus` alone would pass identically on
 * all three, and two pairs of the six scenarios below would be measuring one
 * request each while claiming two cases.
 *
 * HERE AND NOT IN assert.ts, for `assertVariableRequested`'s reason:
 * `assertCallPayload` compares members with `Object.is`, so every value it can
 * check is a scalar, and `evse` is an object whose SHAPE is the subject.
 * Widening that helper to walk nested structures would hand every OCPP 1.6
 * scenario a matcher none of them asked for, and "a ChangeAvailability request
 * addresses a scope by which members of `evse` are present" is message
 * knowledge, which assert.ts is built not to hold.
 *
 * NULL MEANS "MUST BE ABSENT" rather than "do not care", which is the half
 * that makes the helper worth having. `evseId: null` fails a request that
 * carries an `evse`, and `connectorId: null` fails one that narrowed to a
 * connector the scenario did not ask about. A "do not care" spelling was
 * considered and rejected: every call below knows exactly which scope it wants,
 * and the one thing a CSMS can do wrong here is send a different one.
 *
 * ABSENT IS READ AS ABSENT AND NOT AS `null`, which is the sharp edge and is
 * where this helper was wrong. Reading the members as `members.id ?? null`
 * collapses three different requests onto the one the scenario asked for:
 * `{"evse":{}}`, `{"evse":{"id":null}}` and `{"evse":{"id":1,
 * "connectorId":null}}` each rendered as the scope the case wanted and passed.
 * All three are refused by OCPP 2.0.1 Part 3's `ChangeAvailabilityRequest`
 * schema -- `EVSEType` requires `id`, both members are typed `integer`, and
 * the type carries `additionalProperties: false` -- so what the helper reported
 * as the correct request was one no station may accept. Presence is therefore
 * read with `hasOwnProperty` and the value only afterwards, which is also what
 * makes the paragraph above true rather than nearly true: `evseId: null` now
 * fails `{"evse":{}}`, which is a request that carries an `evse`.
 *
 * `occurrence` because two of the six scenarios put a second request on the
 * wire before the one under test -- a fixture in one case, an inline setup in
 * the other -- and matching ANY request would let the setup satisfy the check
 * the case is about.
 */
export declare function assertChangeAvailabilityScope(rec: AssertRecorder, frames: readonly Frame[], occurrence: number, operationalStatus: string, 
/** The `evse.id` the request must carry, or null for one that must omit
 *  `evse` altogether and so address the whole charging station. */
evseId: number | null, 
/** The `evse.connectorId` it must carry, or null for one that must omit it. */
connectorId: number | null, description: string): void;
/**
 * A criterion member's value, as a scenario writes it. Arrays because two of
 * `ChargingProfileCriterionType`'s four members are arrays on the wire.
 */
type CriterionValue = string | number | readonly string[] | readonly number[];
/**
 * The CSMS asked for profiles at `evseId` under exactly `criterion`.
 *
 * THE MEMBER SET IS THE MEASUREMENT, and that is why this compares it in BOTH
 * directions rather than checking the members the scenario named. Five of the
 * seven cases below differ in nothing but which members of the criterion are
 * present: "narrow to a stack level" and "narrow to a purpose and a stack
 * level" are the same request plus one member. A helper that only checked the
 * members it was given would let TC_K_36's traffic satisfy TC_K_33 -- the
 * failure `tests/get-configuration-filter.ts` records one protocol over, where
 * a scenario measured a spelling because nothing distinguished it from its
 * neighbour.
 *
 * `evseId` NULL MEANS "MUST BE ABSENT", by `assertChangeAvailabilityScope`'s
 * rule and for a sharper reason here: Part 3 spells the three readings out in
 * the member's own description -- 0 is the charging station itself, a positive
 * value is that EVSE, and OMITTED means every installed profile is reported --
 * so a CSMS that resolved an omitted member to 0 has sent TC_K_29's request
 * where TC_K_32 asked for every EVSE's. Presence is read with `hasOwnProperty`
 * and the value only afterwards, for the reason that rule's own header gives:
 * `payload.evseId ?? null` passed a wire `"evseId": null` as the omitted case,
 * and `null` is not an `integer`, so what was reported as TC_K_32's request was
 * one the schema refuses.
 *
 * ARRAYS COMPARED AS JSON, order included. The wire order is what the scenario
 * sent, `chargingLimitSource` is where two cases differ by contents rather than
 * by shape, and a set comparison would make `["CSO"]` and the four-value list
 * interchangeable.
 */
export declare function assertChargingProfilesRequested(rec: AssertRecorder, frames: readonly Frame[], requestId: number, 
/** The `evseId` the request must carry, or null for one that must omit it
 *  and so ask about every EVSE. */
evseId: number | null, criterion: Readonly<Record<string, CriterionValue>>, description: string): void;
/**
 * The identifier of the first profile in a `ReportChargingProfiles` payload, or
 * {@link PROFILE_ID_UNREPORTED} when the payload does not carry one.
 *
 * TOTAL, AND THAT IS THE POINT. Its one caller is inside a `drive()` that
 * tools/extract-drive-trace.ts walks against a stub simulator, so it is handed
 * the placeholder that walk answers every wait with -- see the comment there
 * for why a throw would silently shorten the committed artifact. Every shape
 * that is not "an array of objects whose first element has a numeric `id`"
 * therefore returns the sentinel rather than raising, and the assertion that
 * reads the same report off the frames is what turns it into a red row.
 */
export declare function profileIdOf(payload: unknown): number;
/**
 * The CSMS asked the station to install a certificate of `expectedType`.
 *
 * THE CERTIFICATE IS CHECKED FOR BEING ONE, not for being ours. Part 6 asks for
 * "a certificate" and nothing more, and a CSMS is entitled to re-encode, re-wrap
 * or re-order what it was handed -- so byte equality against
 * {@link TEST_ROOT_CERTIFICATE_PEM} is deliberately NOT the test, and a CSMS
 * that carried an equivalent certificate through in a different spelling
 * passes. What would be a finding is a member that is empty, absent, or not a
 * certificate.
 *
 * "NOT A CERTIFICATE" IS DECIDED BY A PARSER AND NOT BY THE ARMOUR LINES, which
 * is where this check was weaker than the sentence above it. Armour around
 * arbitrary bytes -- a truncated PEM, a base64 body that is not a DER
 * `Certificate`, the empty string between two `-----` lines -- satisfied
 * "carries PEM armour" and was reported as a certificate. Part 3 types the
 * member as "A PEM encoded X.509 certificate" of at most 5500 characters, so
 * the parse is the protocol's own claim about the member rather than an
 * invention of this file's, and `node:crypto`'s `X509Certificate` is the parser
 * `tests/certificate-material.ts` already holds the suite's own material to.
 *
 * THE ARMOUR CHECK IS KEPT IN FRONT OF IT for the reason a two-stage check
 * usually earns its keep: the two failures have different causes and the wrong
 * message sends a reader to the wrong place. No armour at all is a CSMS that
 * put something else in the member -- a fingerprint, an identifier, a
 * base64-of-DER with the lines stripped; armour that will not parse is a CSMS
 * that mangled a certificate it was handed.
 */
export declare function assertCertificateInstallRequested(rec: AssertRecorder, frames: readonly Frame[], occurrence: number, expectedType: string, description: string): void;
/**
 * The scenarios, in case order -- the forty-nine of `OCA-201-SLICE.txt`'s 147
 * that are implemented. The other 98 are declined there rather than here,
 * with the reason in the row: one place per fact, and the guard reads that one.
 */
export declare const CORE_201_SPECS: ScenarioSpec<any>[];
export {};
