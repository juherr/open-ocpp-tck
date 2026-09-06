// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * request-shape-201.ts -- what an OCPP 2.0.1 request assertion ACCEPTS, where a
 * payload that is not the one the case asked for can be read as though it were.
 *
 * THE PROPERTY, in four parts, and they are one property. Every check in
 * `tck/specs/core-201.ts` decides a conformance verdict by reading a payload
 * off the wire, and there are exactly three ways that read can be wrong while
 * the row stays GREEN -- which is the only direction worth a guard, because a
 * check that goes red for the wrong reason gets looked at and one that goes
 * green does not:
 *
 *   1. ABSENCE READ AS A VALUE. Three of these cases are about SCOPE, and
 *      scope in 2.0.1 is told apart by which members a request omits: a
 *      `ChangeAvailability` with no `evse` addresses the whole station, one
 *      with `evse.id` addresses that EVSE, one with `evse.connectorId` as well
 *      addresses that connector; a `GetChargingProfiles` with no `evseId` asks
 *      about every EVSE where `evseId: 0` asks about the station itself. So
 *      "the member is not there" is the measurement, and `payload.x ?? null`
 *      -- the spelling both helpers used -- cannot tell it from `"x": null`.
 *      Part 3 types every one of those members `integer` and `EVSEType`
 *      requires `id`, so each of the three payloads below that used to pass is
 *      a request no station may accept, reported as the correct one.
 *   2. A VALUE READ AS A KIND. `InstallCertificate` carries "A PEM encoded
 *      X.509 certificate" (Part 3), and a check that reads the armour lines
 *      accepts anything between them -- a truncated certificate, a base64 body
 *      that is not a DER `Certificate`, nothing at all.
 *   3. MEMBER ORDER READ AS STRUCTURE. TC_K_05 learns a profile identifier off
 *      the station's own report and clears it; the identifier used to be
 *      scraped with `"chargingProfile":[{"id":`, which is a fact about the
 *      pinned image's serialiser and about nothing else.
 *
 * AND THE FOURTH PART IS THE OTHER DIRECTION, which is half the rows here: a
 * request that IS what the case asked for must still pass, spelt differently.
 * A CSMS is entitled to re-wrap a PEM it was handed, so the certificate check
 * may not become byte equality against `TEST_ROOT_CERTIFICATE_PEM` -- the
 * rewrapped fixture below is a different string and the same certificate, and
 * it passes.
 *
 * WHY IT IS A GUARD AND NOT A SWEEP, `tests/get-configuration-filter.ts`'s
 * reason exactly. Every payload below is one no CSMS in this repository sends:
 * both bundled drivers build these requests from the driver contract, so the
 * malformed shapes cannot be produced by any run, live or offline, and the one
 * that could be -- a CSMS re-wrapping a PEM -- is a behaviour neither of them
 * has. Reaching the branches means handing the helper the frames.
 *
 * WHAT IT DOES NOT CHECK: that these are the scopes the cases ask for. That is
 * a reading of Part 6, it lives in the scenarios' own descriptions, and
 * `tck/specs/OCA-201-SLICE.txt` is where a case is tied to a scenario.
 *
 * Offline: builds fixture lines, runs nothing.
 */

import { X509Certificate } from "node:crypto";

import { AssertRecorder } from "../tck/assert";
import { TEST_ROOT_CERTIFICATE_PEM } from "../tck/certificate-material";
import { parseLog, parseLogLine } from "../tck/ocpp";
import {
  assertCertificateInstallRequested,
  assertChangeAvailabilityScope,
  assertChargingProfilesRequested,
  profileIdOf,
} from "../tck/specs/core-201";

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

/** A Logger frame line in the shape ocpp.ts parses (see its LOG_LINE_RE). */
const received = (frame: unknown) =>
  `[2026-09-06T00:00:00Z] [INFO] [ws] Received: ${JSON.stringify(frame)}`;
const sent = (frame: unknown) =>
  `[2026-09-06T00:00:00Z] [INFO] [ws] Sent: ${JSON.stringify(frame)}`;

/** Runs one check over one received CALL and says whether it passed. */
function verdict(run: (rec: AssertRecorder) => void): "PASS" | "FAIL" | "SKIPPED" {
  const rec = new AssertRecorder();
  run(rec);
  if (rec.results.length !== 1) {
    failures.push(`a fixture recorded ${rec.results.length} checks where it must record one`);
    return "FAIL";
  }
  return rec.results[0]!.status;
}

function row(
  what: string,
  want: "PASS" | "FAIL",
  run: (rec: AssertRecorder) => void,
  why: string,
): void {
  const got = verdict(run);
  check(got === want, `${what} is ${got}, where it must be ${want}. ${why}`);
}

// ---------------------------------------------------------------------------
// 1. ChangeAvailability -- the three scopes, told apart by absence.
// ---------------------------------------------------------------------------

const availability = (payload: unknown) =>
  parseLog(received([2, "ca", "ChangeAvailability", payload]));

const scope = (
  payload: unknown,
  evseId: number | null,
  connectorId: number | null,
) => (rec: AssertRecorder) =>
  assertChangeAvailabilityScope(
    rec,
    availability(payload),
    0,
    "Inoperative",
    evseId,
    connectorId,
    "the scope under test",
  );

row(
  "a station-wide request measured as station-wide",
  "PASS",
  scope({ operationalStatus: "Inoperative" }, null, null),
  "an omitted `evse` IS the station-wide request, and nothing else here means " +
    "anything if this row is wrong.",
);

row(
  "an EVSE-scoped request measured as EVSE-scoped",
  "PASS",
  scope({ operationalStatus: "Inoperative", evse: { id: 1 } }, 1, null),
  "`evse.id` alone addresses that EVSE.",
);

row(
  "a connector-scoped request measured as connector-scoped",
  "PASS",
  scope({ operationalStatus: "Inoperative", evse: { id: 1, connectorId: 1 } }, 1, 1),
  "`connectorId` beside `id` narrows to one connector.",
);

row(
  "an empty `evse` measured as the station-wide request",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: {} }, null, null),
  "`{\"evse\":{}}` is not the station-wide request -- it carries an `evse`, " +
    "and Part 3's EVSEType requires `id`, so it is a request no station may " +
    "accept. `members.id ?? null` read it as the absent scope and passed it.",
);

row(
  "a null `evse.id` measured as the station-wide request",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: { id: null } }, null, null),
  "`id` is typed `integer`, so `null` is not a value it may carry, and the " +
    "member IS present. Coalescing it into the absent case reported an " +
    "invalid request as the correct one.",
);

row(
  "a null `evse.connectorId` measured as the EVSE-scoped request",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: { id: 1, connectorId: null } }, 1, null),
  "the same conflation one level down: the EVSE-scoped case asks for a " +
    "request that OMITS `connectorId`, and this one carries it.",
);

row(
  "an EVSE-scoped request measured as connector-scoped",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: { id: 1 } }, 1, 1),
  "a missing `connectorId` where the case asks for one is a different scope, " +
    "and this is the direction the old reading also got right -- it is here " +
    "so a fix for the rows above cannot pay for itself by forgiving this one.",
);

row(
  "a connector-scoped request measured as EVSE-scoped",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: { id: 1, connectorId: 1 } }, 1, null),
  "the case asks for a request that names no connector.",
);

row(
  "an absent `evse` measured as EVSE-scoped",
  "FAIL",
  scope({ operationalStatus: "Inoperative" }, 1, null),
  "the station-wide request is not EVSE 1's.",
);

row(
  "the wrong EVSE",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: { id: 2 } }, 1, null),
  "the scope check is about which EVSE as much as about which members.",
);

row(
  "the wrong operationalStatus",
  "FAIL",
  scope({ operationalStatus: "Operative", evse: { id: 1 } }, 1, null),
  "the two halves of this check are the scope and the availability asked for, " +
    "and only one of them is what the rows above are about.",
);

row(
  "a null `evse`",
  "FAIL",
  scope({ operationalStatus: "Inoperative", evse: null }, null, null),
  "`evse: null` is present and is not an EVSEType, so it is refused by name " +
    "rather than read as the absent scope.",
);

// ---------------------------------------------------------------------------
// 2. GetChargingProfiles -- `evseId` omitted is not `evseId: null`, and is not 0.
// ---------------------------------------------------------------------------

const query = (payload: Record<string, unknown>) =>
  parseLog(received([2, "gp", "GetChargingProfiles", { requestId: 7305, ...payload }]));

const profilesQuery = (payload: Record<string, unknown>, evseId: number | null) =>
  (rec: AssertRecorder) =>
    assertChargingProfilesRequested(
      rec,
      query(payload),
      7305,
      evseId,
      { stackLevel: 5 },
      "the query under test",
    );

row(
  "a query about every EVSE measured as such",
  "PASS",
  profilesQuery({ chargingProfile: { stackLevel: 5 } }, null),
  "Part 3: an omitted `evseId` means every installed profile is reported.",
);

row(
  "a query about one EVSE measured as such",
  "PASS",
  profilesQuery({ evseId: 1, chargingProfile: { stackLevel: 5 } }, 1),
  "a positive `evseId` narrows to that EVSE.",
);

row(
  "a null `evseId` measured as an omitted one",
  "FAIL",
  profilesQuery({ evseId: null, chargingProfile: { stackLevel: 5 } }, null),
  "`evseId` is typed `integer`; `null` is present and is not one. " +
    "`payload.evseId ?? null` read it as omitted and passed it.",
);

row(
  "`evseId: 0` measured as an omitted one",
  "FAIL",
  profilesQuery({ evseId: 0, chargingProfile: { stackLevel: 5 } }, null),
  "Part 3 gives 0 its own meaning -- the charging station itself -- so a CSMS " +
    "that resolved an omitted member to 0 has sent a different case's request. " +
    "This row is what stops a presence check being written as a truthiness one.",
);

row(
  "an omitted `evseId` measured as EVSE 1's",
  "FAIL",
  profilesQuery({ chargingProfile: { stackLevel: 5 } }, 1),
  "the other direction of the same distinction.",
);

row(
  "a criterion the case did not ask to narrow on",
  "FAIL",
  profilesQuery(
    { evseId: 1, chargingProfile: { stackLevel: 5, chargingProfilePurpose: "TxProfile" } },
    1,
  ),
  "the member set is the measurement -- five of these cases differ in nothing " +
    "else -- and this row is here so a change to the `evseId` half cannot " +
    "quietly drop the criterion half.",
);

// ---------------------------------------------------------------------------
// 3. InstallCertificate -- a certificate, not a string between two armour lines.
// ---------------------------------------------------------------------------

/** The suite's own certificate, re-wrapped at 76 characters: a DIFFERENT
 *  string carrying the SAME certificate, which is what a CSMS is entitled to
 *  hand back and what stops this check becoming byte equality. */
const REWRAPPED = (() => {
  const body = TEST_ROOT_CERTIFICATE_PEM.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const lines = body.match(/.{1,76}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
})();

check(
  REWRAPPED !== TEST_ROOT_CERTIFICATE_PEM,
  "the re-wrapped certificate is byte-identical to the fixture, so the row " +
    "below proves nothing about identity not being required. Re-wrap it at a " +
    "width the fixture does not use.",
);
check(
  new X509Certificate(REWRAPPED).serialNumber ===
    new X509Certificate(TEST_ROOT_CERTIFICATE_PEM).serialNumber,
  "the re-wrapped certificate is not the same certificate, so the row below " +
    "would be measuring a second certificate rather than a second spelling.",
);

const install = (payload: unknown) =>
  parseLog(received([2, "ic", "InstallCertificate", payload]));

const installed = (payload: unknown, type = "CSMSRootCertificate") =>
  (rec: AssertRecorder) =>
    assertCertificateInstallRequested(rec, install(payload), 0, type, "the install under test");

row(
  "the suite's own certificate",
  "PASS",
  installed({ certificateType: "CSMSRootCertificate", certificate: TEST_ROOT_CERTIFICATE_PEM }),
  "the request the fixture drives has to pass, or every certificate scenario " +
    "is red for a defect in this check.",
);

row(
  "the same certificate re-wrapped",
  "PASS",
  installed({ certificateType: "CSMSRootCertificate", certificate: REWRAPPED }),
  "Part 6 asks for `a certificate` and a CSMS may re-encode what it was " +
    "handed, so this check may not become byte equality against the fixture.",
);

row(
  "PEM armour around something that is not base64",
  "FAIL",
  installed({
    certificateType: "CSMSRootCertificate",
    certificate: "-----BEGIN CERTIFICATE-----\nthis is not a certificate\n-----END CERTIFICATE-----\n",
  }),
  "the armour lines were the whole test, so this passed and the row read " +
    "`InstallCertificate.req ... carries a certificate`.",
);

row(
  "a truncated certificate",
  "FAIL",
  installed({
    certificateType: "CSMSRootCertificate",
    certificate: `${TEST_ROOT_CERTIFICATE_PEM.slice(0, 200)}\n-----END CERTIFICATE-----\n`,
  }),
  "valid base64 that is not a complete DER `Certificate` -- the shape a CSMS " +
    "that truncated the member would send, and the one an armour check is " +
    "least able to see.",
);

row(
  "empty armour",
  "FAIL",
  installed({
    certificateType: "CSMSRootCertificate",
    certificate: "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n",
  }),
  "a CSMS that carried the member through empty.",
);

row(
  "an empty string",
  "FAIL",
  installed({ certificateType: "CSMSRootCertificate", certificate: "" }),
  "no armour at all, which is the failure the armour check was already right " +
    "about and must stay right about.",
);

row(
  "an absent certificate member",
  "FAIL",
  installed({ certificateType: "CSMSRootCertificate" }),
  "`certificate` is required by Part 3.",
);

row(
  "a certificate member that is not a string",
  "FAIL",
  installed({ certificateType: "CSMSRootCertificate", certificate: { pem: "x" } }),
  "a non-string must be refused before it reaches the parser.",
);

row(
  "the wrong certificateType",
  "FAIL",
  installed({
    certificateType: "V2GRootCertificate",
    certificate: TEST_ROOT_CERTIFICATE_PEM,
  }),
  "the type is the whole of what separates the four install cases from one " +
    "another, so a change to the certificate half may not cost the type half.",
);

// ---------------------------------------------------------------------------
// 4. TC_K_05's report -- the identifier is read from structure, not from order.
// ---------------------------------------------------------------------------

/** What drive() does with the line its wait returned, composed the same way. */
function idFromLine(line: string): number {
  const frame = parseLogLine(line);
  return frame?.kind === "call" ? profileIdOf(frame.payload) : -1;
}

const report = (profile: unknown) =>
  sent([
    2,
    "rp",
    "ReportChargingProfiles",
    { requestId: 7305, chargingLimitSource: "CSO", evseId: 1, chargingProfile: [profile] },
  ]);

check(
  idFromLine(report({ id: 9305, stackLevel: 5 })) === 9305,
  "the profile identifier is not read off a report whose profile spells `id` " +
    "first, which is the shape the pinned image sends and the only one the " +
    `regex this replaced could read. Got ${idFromLine(report({ id: 9305, stackLevel: 5 }))}`,
);

check(
  idFromLine(report({ stackLevel: 5, chargingProfileKind: "Absolute", id: 9305 })) === 9305,
  "the profile identifier is not read off a report whose profile spells `id` " +
    "LAST. JSON member order carries no meaning and Part 3 constrains none, " +
    "so a station that serialised the same profile the other way round would " +
    "have TC_K_05 clear its sentinel while the identifier it was reading sat " +
    `right there. Got ${idFromLine(report({ stackLevel: 5, chargingProfileKind: "Absolute", id: 9305 }))}`,
);

check(
  idFromLine(sent([2, "rp", "ReportChargingProfiles", { requestId: 7305, chargingProfile: [] }])) ===
    -1,
  "a report carrying no profile yields something other than the sentinel, so " +
    "TC_K_05 would clear a profile identifier it never learned.",
);

check(
  profileIdOf({ requestId: 7305 }) === -1 &&
    profileIdOf(null) === -1 &&
    profileIdOf("Sent: <line>") === -1 &&
    profileIdOf({ chargingProfile: [{ stackLevel: 5 }] }) === -1 &&
    profileIdOf({ chargingProfile: [{ id: "9305" }] }) === -1,
  "the reader is not total. Its caller is a drive() that " +
    "tools/extract-drive-trace.ts walks against a stub simulator, so it is " +
    "handed the placeholder that walk answers every wait with -- a throw there " +
    "would end the walk before the request the case is ABOUT was recorded, and " +
    "shorten a committed artifact without failing anything.",
);

check(
  idFromLine("[2026-09-06T00:00:00Z] [INFO] [ws] not a frame at all") === -1,
  "a line that is not a frame yields something other than the sentinel.",
);

if (failures.length > 0) {
  process.stderr.write(
    "FAIL: an OCPP 2.0.1 request assertion accepts a payload that is not the " +
      "one its case asks for.\n",
  );
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  "2.0.1 request shapes hold: scope told apart by absence and not by `?? null`, " +
    "a certificate parsed rather than recognised by its armour, and a reported " +
    "profile identifier read from structure rather than from member order.\n",
);
