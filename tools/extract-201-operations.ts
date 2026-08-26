/**
 * extract-201-operations.ts -- which CSMS-initiated operation each OCPP 2.0.1
 * certification case obliges the CSMS to send, read out of Part 6.
 *
 *   bun tools/extract-201-operations.ts <path to Part 6 PDF>
 *   bun tools/extract-201-operations.ts <path> --diff   # against the committed table
 *   bun tools/extract-201-operations.ts --tranches      # no PDF: the committed
 *                                                       # table plus the union
 *
 * Needs `pdftotext` (poppler) and a copy of the reference. NEITHER IS IN THIS
 * REPOSITORY: the PDF is cited by URL and not committed, for the reason
 * OCA-201-SELECTION.md gives, and the path is therefore a required argument
 * rather than a default this script could silently get wrong. Deliberately not
 * part of `bun run test`, which stays offline and needs nothing installed --
 * the same arrangement, and the same reason, as tools/extract-fixture-tags.sh.
 *
 * WHY A SCRIPT AND NOT A NOTE. The count it produces answers issue #87 -- how
 * wide a vocabulary the 147 selected cases ask for -- and that count moves
 * whenever the reference is revised. A prose method has to be re-read and
 * re-implemented by whoever revises it; this is one command, and the edition it
 * was last run against is recorded beside the number in OCA-201-SELECTION.md.
 *
 * WHAT IT PRINTS is `<case>\t<operation[,operation] | none>`, one line per
 * `*_CSMS` case, which is the shape of tck/specs/OCA-201-OPERATIONS.txt's rows.
 * Nothing of the reference's expression is in the output: an OCPP message name
 * is protocol vocabulary, and identifiers plus counts are the side of the line
 * OCA-201-SELECTION.md's "What may be committed here, and what may not" puts
 * this repository on. It says TC_G_03 needs ChangeAvailability; it never says
 * what TC_G_03 asks anyone to do.
 *
 * THE MEASUREMENT
 * ---------------
 * In a `*_CSMS` case the system under test is the CSMS, so a request the
 * reference attributes to the CSMS is one a driver must be able to make. Three
 * places attribute one, and all three are needed -- each alone reports cases as
 * needing nothing that need something:
 *
 *   1. `Tool validations`, whose `Message <X>Request` lines are by construction
 *      messages the SUT sent. This alone misses ~30 cases: TC_L_04 and
 *      TC_F_27 name UpdateFirmware and TriggerMessage only in their scenario.
 *   2. the test scenario, where a step reads "The CSMS sends a <X>Request" or
 *      "Manual Action: Trigger the CSMS to send a <X>Request". Matched as a
 *      PHRASE rather than per line, because `pdftotext -layout` puts the
 *      Charging Station and CSMS columns of a step table on ONE physical line
 *      -- "2. Test System responds with: 1. CSMS sends SetMonitoringBaseRequest"
 *      is one line carrying one message from each side.
 *   3. `Reusable State`s, resolved transitively. This is the one that cannot be
 *      skipped and looks skippable: TC_G_03's entire scenario is "Execute
 *      Reusable State Unavailable" with `Tool validations: N/a`, and
 *      ChangeAvailabilityRequest is named only in the state's own definition.
 *      A one-level parse reports TC_G_03 as needing no operation.
 *
 * And one place that is NOT read: the header table's Description and Purpose.
 * They are prose about the case rather than a step of it, and a case whose
 * body has been rewritten leaves them behind. Measured before excluding: no
 * case in the pool gains an operation from them, so this costs nothing today
 * and stops the day the prose and the steps disagree.
 *
 * REFUSALS, BECAUSE A SILENT ZERO LOOKS LIKE AN ANSWER. `--diff` and the
 * summary both go through the same rows, and the script exits non-zero if it
 * finds no case headers, no reusable states, or a case that resolves to a state
 * the reference does not define. Each of those renders as "this case drives
 * nothing", which is a verdict the table is allowed to carry and a parse
 * failure is not.
 *
 * THE ONE THEY DO NOT COVER is the mirror of the third: a reference SPELLING
 * this does not know produces no reference at all, so there is nothing to
 * refuse. That is what cost TC_M_20 and TC_M_21 an InstallCertificate through
 * three commits and a review. It was tried as a fourth refusal -- "the
 * `Reusable State` field said something and I understood none of it" -- and
 * measured before being kept: the field carries prose as well as values ("If
 * State is NOT Authorized then execute...", "Charging Station set to
 * Unavailable (Original status was Available)", a bare wrapped "State is"), so
 * it fired on 230 legitimate lines. Refusing prose needs the list of prose
 * forms, which is the pile the refusal was meant to replace. So it is stated
 * here instead, and `--diff` against a fresh reading is what covers it.
 *
 * TWO NORMALISATIONS, STATED RATHER THAN APPLIED SILENTLY:
 *   - `SetVariableRequest` (singular) appears twice in Edition 4 where every
 *     other mention and the schema say `SetVariablesRequest`. Folded, because
 *     a vocabulary with both in it is a vocabulary with a typo in it.
 *   - a case whose union is empty emits `none` rather than being dropped.
 *     "Measured, drives nothing" and "not measured" must not render the same,
 *     and 57 of the 147 are the first.
 *
 * Copyright 2026 Julien Herr
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Part 6's CSMS half. Page 1..607 is the charging-station role, which this
 *  suite does not test -- OCA-201-SELECTION.md's "Still out of scope". Reading
 *  the whole document instead would pick up `TC_B_20_CS`'s mirror image of
 *  every case here and attribute the station's requests to the CSMS. */
const CSMS_FIRST_PAGE = 608;

const COMMITTED = "tck/specs/OCA-201-OPERATIONS.txt";

/** Two mentions in Edition 4, against ~40 of the plural spelling. */
const NORMALISE: Record<string, string> = { SetVariable: "SetVariables" };

/**
 * The tranche table OCA-201-SELECTION.md publishes, DERIVED rather than
 * arithmetic somebody did once.
 *
 * WHY THIS MODE EXISTS. That table was published with every one of its sixteen
 * `still blocked after` cells two too high, because it was computed against a
 * three-verb union and a fourth verb landed in the same branch. Nothing caught
 * it: the numbers are a function of two files in this repository and the
 * function lived in a person. It needs no PDF for the same reason -- the
 * measurement is already committed.
 *
 * GREEDY, AND A CASE COUNTS ONLY WHEN EVERY OPERATION IT NEEDS IS PRESENT.
 * That is the whole point of the column: six cases need more than one, so
 * "rows that name X" and "cases X completes" are different numbers and the
 * smaller one is the honest one. Ties are broken by name so a re-run diffs
 * clean.
 */
function tranches(
  needs: ReadonlyMap<string, readonly string[]>,
  have: ReadonlySet<string>,
): string[] {
  const held = new Set(have);
  let blocked = [...needs].filter(([, ops]) => !ops.every((o) => held.has(o)));
  const rows = [`| # | operation | cases it completes | still blocked after |`];
  rows.push(`|---|---|---|---|`);
  for (let step = 1; blocked.length > 0; step++) {
    const candidates = [...new Set(blocked.flatMap(([, ops]) => ops))].sort();
    let best = candidates[0]!;
    let bestGain = -1;
    for (const op of candidates) {
      const gain = blocked.filter(([, ops]) =>
        ops.every((o) => held.has(o) || o === op),
      ).length;
      if (gain > bestGain) {
        best = op;
        bestGain = gain;
      }
    }
    held.add(best);
    blocked = blocked.filter(([, ops]) => !ops.every((o) => held.has(o)));
    rows.push(`| ${step} | \`${best}\` | ${bestGain} | ${blocked.length} |`);
  }
  return rows;
}

const usage = [
  "usage: bun tools/extract-201-operations.ts <part6.pdf> [--diff]",
  "",
  "  <part6.pdf>  OCPP 2.0.1 Part 6 - Test Cases. Not in this repository:",
  "               see OCA-201-SELECTION.md for why a reference is cited and",
  "               not committed.",
  `  --diff       compare the measurement with ${COMMITTED}`,
  `  --tranches   derive OCA-201-SELECTION.md's tranche table from ${COMMITTED}`,
  "               and the driver contract. Needs no PDF.",
].join("\n");

const argv = process.argv.slice(2);
const diff = argv.includes("--diff");
const wantTranches = argv.includes("--tranches");
const pdf = argv.find((a) => !a.startsWith("--"));

if (wantTranches) {
  const rows = new Map<string, readonly string[]>();
  for (const raw of readFileSync(COMMITTED, "utf8").split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const [id, ops] = line.split(/\s+/, 2);
    if (id === undefined || ops === undefined) continue;
    rows.set(id, ops === "none" ? [] : ops.split(","));
  }
  const union = new Set(
    (
      await import(new URL("../tck/driver.ts", import.meta.url).href)
    ).CSMS_OPERATION_201_ACTIONS as readonly string[],
  );
  const short = [...rows.values()].filter((ops) => !ops.every((o) => union.has(o)));
  console.log(`${short.length} of the ${rows.size} are short a verb.`);
  for (const row of tranches(rows, union)) console.log(row);
  process.exit(0);
}

if (pdf === undefined) {
  console.error(usage);
  process.exit(2);
}
if (!existsSync(pdf)) {
  console.error(`FAIL: no such file: ${pdf}`);
  console.error(usage);
  process.exit(2);
}

const rendered = spawnSync(
  "pdftotext",
  ["-layout", "-f", String(CSMS_FIRST_PAGE), pdf, "-"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (rendered.error !== undefined || rendered.status !== 0) {
  console.error("FAIL: pdftotext did not run.");
  console.error("  → install poppler (`brew install poppler`), or check the path.");
  console.error(`  ${rendered.error?.message ?? rendered.stderr}`);
  process.exit(2);
}
const lines = rendered.stdout.split("\n");

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/** `TC_B_20_CSMS: Reset Charging Station - ...` opens a case. */
const CASE_HEADER = /^(TC_[A-Z]+_\d+[A-Za-z_]*)_CSMS:/;
/** A reusable state's definition opens with its name in the header table's
 *  `State` row. Only after the "Reusable states" heading: a case's own
 *  `State is Booted` line is a reference, not a definition. */
const STATE_HEADER = /^State\s{2,}(\S+)\s*$/;
const STATE_KEY = (name: string) => `state:${name}`;

const reusableStatesAt = lines.findIndex((l) => l.trim() === "Reusable states");
if (reusableStatesAt < 0) {
  console.error("FAIL: no 'Reusable states' heading in the CSMS half.");
  console.error("  → cases that delegate to a state would each measure as");
  console.error("    driving nothing, which reads exactly like a real answer.");
  process.exit(1);
}

const blocks = new Map<string, string[]>();
const caseIds: string[] = [];
let current: string | null = null;
lines.forEach((line, i) => {
  const asCase = CASE_HEADER.exec(line);
  if (asCase !== null) {
    current = asCase[1]!;
    caseIds.push(current);
    blocks.set(current, []);
    return;
  }
  if (i > reusableStatesAt) {
    const asState = STATE_HEADER.exec(line);
    if (asState !== null) {
      current = STATE_KEY(asState[1]!);
      blocks.set(current, []);
      return;
    }
  }
  if (current !== null) blocks.get(current)!.push(line);
});

const stateNames = new Set(
  [...blocks.keys()].flatMap((k) => (k.startsWith("state:") ? [k.slice(6)] : [])),
);

/** Each state name as a whole-word matcher, compiled once. Escaped because the
 *  names come out of `STATE_HEADER`'s `(\S+)` and nothing promises a future
 *  edition will not put a `.` or a `(` in one. */
const stateWords = [...stateNames].map(
  (name) =>
    [name, new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)] as const,
);

if (caseIds.length === 0 || stateNames.size === 0) {
  console.error(
    `FAIL: parsed ${caseIds.length} case(s) and ${stateNames.size} reusable state(s).`,
  );
  console.error("  → the layout this reads did not survive the render. Nothing");
  console.error("    below would be wrong so much as empty.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const REQUEST = /\b([A-Z][A-Za-z0-9]*)Request\b/g;
/** "The CSMS sends a XRequest", and the two other moods the steps use. */
const CSMS_SENDS =
  /(?:[Tt]he\s+)?CSMS\s+(?:sends|will send|shall send)\s+(?:a|an|one or more)?\s*([A-Z][A-Za-z0-9]*)Request/g;
/** "Manual Action: Trigger the CSMS to send a XRequest", "Instruct CSMS to
 *  send XRequest" -- an operator asking for it is the CSMS making it. */
const CSMS_ASKED_TO_SEND =
  /(?:[Tt]rigger|[Rr]equest|[Ii]nstruct)\s+(?:the\s+)?CSMS\s+to\s+(?:send\s+)?(?:a|an)?\s*([A-Z][A-Za-z0-9]*)Request/g;
/** TC_K_53 step 2 is "The CSMS does NOT send a SetChargingProfileRequest" --
 *  an assertion that it stays silent. Reading it as a send would make the one
 *  case in the pool that forbids an operation the case that requires it. */
const CSMS_STAYS_SILENT = /CSMS\s+does\s+NOT\s+send/;
/** Lowercase in one of the 147 (`TC_K_53`), title case in the rest. */
const EXECUTE_STATE = /execute\s+reusable\s+state\s+(\w+)/gi;

type Section = "header" | "before" | "reference" | "scenario" | "validations" | "after";

interface Scanned {
  operations: Set<string>;
  references: Set<string>;
}


function matchAll(re: RegExp, line: string): string[] {
  re.lastIndex = 0;
  return [...line.matchAll(re)].map((m) => m[1]!);
}

function scan(key: string): Scanned {
  const operations = new Set<string>();
  const references = new Set<string>();
  let section: Section = "header";

  for (const line of blocks.get(key) ?? []) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Before (Preparations)")) section = "before";
    else if (trimmed.startsWith("Reusable State")) section = "reference";
    else if (/^(Configuration State|Memory State):/.test(trimmed)) section = "before";
    // `Main (Part 1) (Test scenario)` twice in Edition 4. Anchored on both ends
    // rather than on the prefix: missing it leaves a whole scenario classified
    // as the field block above it and scanned by the wrong rules.
    else if (/^Main .*\(Test scenario\)/.test(trimmed)) section = "scenario";
    else if (trimmed.startsWith("Tool validations")) section = "validations";
    else if (trimmed.startsWith("Post scenario validations")) section = "after";
    else if (section === "reference") {
      // The `Reusable State(s):` field's value. TWO SPELLINGS, and the second
      // was found by review rather than by reading: `State is <Name>`, and the
      // bare `<Name> with certificateType ...` TC_M_21 uses. Missing the
      // second cost that case its InstallCertificate.
      //
      // `State is` with an UNKNOWN name is a refusal -- that is a state
      // renamed by a new edition, and resolving it to nothing would make every
      // case referring to it measure as driving nothing. A bare first word
      // that is not a known state is NOT a refusal: this field also carries
      // `N/a`, prose conditions and wrapped continuations.
      const explicit = /^State is\s+(\w+)/i.exec(trimmed);
      if (explicit !== null) references.add(explicit[1]!);
      else {
        const bare = /^([A-Za-z][A-Za-z0-9]*)\b/.exec(trimmed);
        if (bare !== null && stateNames.has(bare[1]!)) references.add(bare[1]!);
      }
    } else if (section === "before" || section === "scenario") {
      for (const name of matchAll(EXECUTE_STATE, line)) references.add(name);
      if (section === "scenario") {
        // A numbered step that IS a state name, with no verb in front of it --
        // TC_M_20's "1. CertificateInstalled with certificateType ...". Scoped
        // to the scenario because in `before` the whole-word scan below is a
        // strict superset of it: measured, this fires exactly once in the whole
        // CSMS half and it is TC_M_20's step.
        const step = /^\d+\.\s+([A-Za-z][A-Za-z0-9]*)\b/.exec(trimmed);
        if (step !== null && stateNames.has(step[1]!)) references.add(step[1]!);
      } else {
        // And in the Configuration / Memory State fields, a state named in
        // prose: "If configured <Security profile> is 2, then
        // RenewChargingStationCertificate". A whole-word scan is loose enough to
        // worry about -- `Authorized`, `Reserved` and `Booted` are state names
        // AND ordinary words -- so it is bounded to those two short fields and
        // measured: across Edition 4's CSMS half it matches three times and all
        // three are real (TC_A_19, TC_G_04, TC_G_08).
        for (const [name, word] of stateWords) {
          if (word.test(trimmed)) references.add(name);
        }
      }
      if (!CSMS_STAYS_SILENT.test(line)) {
        for (const op of matchAll(CSMS_SENDS, line)) operations.add(op);
        for (const op of matchAll(CSMS_ASKED_TO_SEND, line)) operations.add(op);
      }
    } else if (section === "validations") {
      // A validation line IDENTIFIES a message the SUT sent, and in a `_CSMS`
      // case the SUT is the CSMS. Four spellings carry that identification --
      // `Message:`, `Message`, a parenthesised `(Message: X)`, and a bare
      // `<X>Request with:` under a `* Step N:` -- plus the two sender phrases,
      // which appear here as `1. CSMS sends <X>Request with:`.
      //
      // NOT every `<X>Request` token in the section, which was the obvious
      // rule and is wrong: TC_E_53's validations say "CSMS accepts the message
      // TransactionEventRequest", prose about a request the STATION sent.
      if (/^\(?Message:?\s/.test(trimmed) || /^[A-Z][A-Za-z0-9]*Request\b/.test(trimmed)) {
        for (const op of matchAll(REQUEST, trimmed)) operations.add(op);
      }
      if (!CSMS_STAYS_SILENT.test(line)) {
        for (const op of matchAll(CSMS_SENDS, line)) operations.add(op);
        for (const op of matchAll(CSMS_ASKED_TO_SEND, line)) operations.add(op);
      }
    }
  }
  return { operations, references };
}

const scanned = new Map<string, Scanned>();
for (const key of blocks.keys()) scanned.set(key, scan(key));

const undefinedStates = new Set<string>();

/** A state may execute another (`EnergyTransferStarted` runs `Authorized`), so
 *  this recurses, and `seen` is what stops a reference cycle in a future
 *  edition from being a hang rather than a diff. */
function resolve(key: string, seen = new Set<string>()): Set<string> {
  if (seen.has(key)) return new Set();
  seen.add(key);
  const here = scanned.get(key);
  if (here === undefined) {
    undefinedStates.add(key);
    return new Set();
  }
  const out = new Set(here.operations);
  for (const name of here.references) {
    for (const op of resolve(STATE_KEY(name), seen)) out.add(op);
  }
  return out;
}

const measured = new Map<string, string[]>();
for (const id of caseIds) {
  const ops = [...resolve(id)].map((op) => NORMALISE[op] ?? op);
  measured.set(id, [...new Set(ops)].sort());
}

if (undefinedStates.size > 0) {
  console.error("FAIL: a case refers to a reusable state the reference does not define:");
  for (const key of [...undefinedStates].sort()) console.error(`  ${key}`);
  console.error("  → resolving it to nothing is indistinguishable from the case");
  console.error("    genuinely driving nothing.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One place, because the distinction it draws is the load-bearing one: an
 *  empty union renders as `none` and never as an empty column. */
const render = (ops: readonly string[]) =>
  ops.length === 0 ? "none" : ops.join(",");

if (!diff) {
  for (const id of caseIds) console.log(`${id}\t${render(measured.get(id)!)}`);
  process.exit(0);
}

if (!existsSync(COMMITTED)) {
  console.error(`FAIL: ${COMMITTED} is missing.`);
  process.exit(1);
}

const committed = new Map<string, string>();
for (const raw of readFileSync(COMMITTED, "utf8").split("\n")) {
  const line = raw.replace(/\r$/, "").trim();
  if (line === "" || line.startsWith("#")) continue;
  const [id, ops] = line.split(/\s+/, 2);
  if (id !== undefined && ops !== undefined) committed.set(id, ops);
}

let disagreements = 0;
for (const [id, ops] of committed) {
  const here = measured.get(id);
  if (here === undefined) {
    console.log(`${id}\tcommitted=${ops}\tPart 6 has no such CSMS case`);
    disagreements++;
    continue;
  }
  if (render(here) !== ops) {
    console.log(`${id}\tcommitted=${ops}\tmeasured=${render(here)}`);
    disagreements++;
  }
}
console.log(
  disagreements === 0
    ? `${COMMITTED}: ${committed.size} row(s), all reproduced from the reference.`
    : `${COMMITTED}: ${disagreements} row(s) disagree with the reference.`,
);
process.exit(disagreements === 0 ? 0 : 1);
