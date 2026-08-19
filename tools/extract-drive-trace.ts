/**
 * extract-drive-trace.ts -- renders WHAT EACH SCENARIO DOES TO THE CSMS into a
 * stable, diffable text form.
 *
 * Why this exists
 * ---------------
 * extract-assert-inventory.ts pins what a scenario MEASURES. Pinning only that
 * half is the trap: a drive() that silently drops a step makes every assertion
 * fail honestly (loud, obvious), but a drive() that issues an operation twice,
 * retargets one, or loses a wait gate produces GREEN FOR THE WRONG REASON.
 * This file pins the other half.
 *
 * It works by EXECUTING each spec's drive() against a recording stub -- no
 * network, no docker, no CSMS. Static analysis would not do: several specs
 * build their operation list through helpers and awaits.
 *
 * WHICH SCENARIOS IT COVERS is derived from `tck/specs/index`, not listed --
 * see GROUP_ORDER for what the list it replaced got wrong. A SEPARATE GUARD
 * asserting "every spec group appears in the artifact" was considered here and
 * is not written: index.ts is also where tck/main.ts:108 gets its registry, so
 * a group this file cannot see is a group the runner cannot run, and the guard
 * would compare the derivation against itself.
 *
 * What is recorded, and why it is recorded THAT way
 * ------------------------------------------------
 * The whole point of this artifact is to survive the very refactor it guards.
 * That refactor replaces
 *
 *     steve.op("v1.6/Reset", { chargePointSelectList: …, resetType: "HARD" })
 * with
 *     csms.execute(cpId, { action: "Reset", type: "Hard" })
 *
 * so a trace that recorded method names, field names, or raw values would be
 * regenerated wholesale by the refactor and would guard nothing during it.
 *
 * Recorded instead is the NORMALISED operation: the OCPP action, plus its
 * argument VALUES (not keys), lowercased and sorted. Values survive the
 * rewrite where keys do not -- `resetType: "HARD"` and `type: "Hard"` both
 * normalise to `hard`, while `resetType` and `type` share nothing. Sorting by
 * value also makes the trace insensitive to argument order.
 *
 * Dropped from the value list, each for a stated reason:
 *  - the empty string: pre-refactor it is the in-band "absent" marker
 *    (`chargingProfilePk: ""`), post-refactor the field is simply absent. They
 *    must compare equal or every optional-field call site would show a diff.
 *  - anything that looks like a date or timestamp: `reservationExpirySoon()`
 *    and `retrieveDatetimeSoon()` are runtime-relative by design, so their
 *    values change every run. Rendered `<ts>`.
 *  - the charge-point selector: `cpSelect(cpId)` pre-refactor, the `cpId`
 *    parameter post-refactor. Same fact, two encodings.
 *
 * Observations (the CsmsRecords / SteveTx surface) are recorded under
 * canonical ids from OBSERVATION_ALIASES below, for the same reason: those
 * methods get renamed off SteVe's MariaDB schema, and a trace keyed on
 * `latestTxPk` would move when `latestTransaction` replaces it.
 *
 * Known limits, stated plainly:
 *  - Argument VALUES are pinned, argument KEYS are not. An operation issued
 *    with the right values under a wrong field name passes here (tsc and the
 *    driver conformance suite are what catch that).
 *  - Nothing proves the sequence is CORRECT, only that it is UNCHANGED.
 *  - The stub answers every observation with a fixed placeholder, so a
 *    scenario whose control flow depends on a REAL answer traces only the
 *    branch the placeholder selects.
 */
import * as specs from "../tck/specs/index";

interface SpecLike {
  templateId: string;
  connector?: number;
  drive?: (ctx: Record<string, unknown>) => Promise<unknown>;
}

function isSpecArray(value: unknown): value is SpecLike[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { templateId?: unknown }).templateId === "string",
    )
  );
}

/**
 * Declared ORDER, not declared MEMBERSHIP.
 *
 * The list this replaces named the five groups AND their arrays, so a sixth
 * spec group was invisible: its scenarios never reached the artifact,
 * tests/spec-invariants.sh diffed a short file against an equally short one,
 * and the drive sequences this whole file exists to pin were quietly not being
 * pinned. Membership now comes from `tck/specs/index`, which is where
 * tck/main.ts:108 gets it too -- so the extractor cannot be the one place that
 * disagrees with the runner about which scenarios exist.
 *
 * The reason for keeping an order list is NOT the one the old comment gave --
 * "so the artifact never reorders on its own" does not discriminate, since a
 * sorted read does not reorder on its own either, and the twin
 * (extract-assert-inventory.ts) keeps no such list. The real reason is narrower
 * and is about the reader: dropping it re-sorts DRIVE-TRACE.txt into export
 * order in one commit, and a full-file diff in an artifact whose entire
 * contract is "a diff means a scenario changed" costs a review the very signal
 * the artifact is for. That is a one-time cost, which is what makes it worth
 * five lines and not more.
 *
 * A group missing from this list sorts after it, in export order, so it is
 * pinned from the run it first appears in. An entry here matching no exported
 * group is an ERROR -- the rule tests/gate-parity.sh applies to its own
 * allowlist -- because an ordering for something that no longer exists is a
 * statement nobody is checking.
 *
 * Deriving the order from tck/main.ts's own GROUPS registry would be the ideal
 * single list, and is rejected here so it is not re-proposed blind: that file
 * is `upstream-patched` and is a CLI whose module body runs on import, so an
 * extractor importing it buys a re-pin and a side effect to pay for five words.
 */
const GROUP_ORDER: readonly string[] = [
  "core",
  "authlist-reservation",
  "remotetrigger-smartcharging",
  "firmware",
  "authorize",
];

/** `AUTHLIST_RESERVATION_SPECS` -> `authlist-reservation`, the name main.ts's
 *  registry gives the same array. Derived rather than tabulated: a table is
 *  the thing that went stale. An export renamed out of the `_SPECS` shape
 *  still yields a group -- under a different name, which is a visible line in
 *  the artifact's diff rather than a group that vanished. */
function groupNameOf(exportName: string): string {
  return exportName.replace(/_SPECS$/, "").toLowerCase().replace(/_/g, "-");
}

/** Every spec group the runner can run, in GROUP_ORDER first and export order
 *  after -- `Array#sort` is stable, so the tail keeps the order it was found
 *  in. Selected by SHAPE rather than by name, so the `_SPECS` convention is
 *  only ever used to label a group, never to decide whether it is one. */
function discoverGroups(): Array<[string, SpecLike[]]> {
  // An exported ARRAY that is not an array of specs is REFUSED, not filtered
  // out. index.ts is a barrel of spec groups and nothing else, so an array
  // there is a group; one whose members lost their templateId is a group that
  // was RESHAPED, and skipping it would keep its scenarios out of the artifact
  // with the diff staying empty -- this file's original bug, arriving by
  // another door. Non-arrays are not candidates and are simply not groups.
  const reshaped = Object.entries(specs).filter(
    ([, value]) => Array.isArray(value) && !isSpecArray(value),
  );
  if (reshaped.length > 0) {
    throw new Error(
      `tck/specs/index exports ${reshaped.map(([name]) => name).join(", ")} as ` +
        `an array whose members do not all carry a string templateId. Teach ` +
        `this extractor the new shape; skipping it would leave those scenarios ` +
        `unpinned with nothing to show for it.`,
    );
  }

  const found = Object.entries(specs)
    .filter(([, value]) => isSpecArray(value))
    .map(([name, value]) => [groupNameOf(name), value] as [string, SpecLike[]]);

  const names = new Set(found.map(([name]) => name));
  const unknown = GROUP_ORDER.filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `GROUP_ORDER names ${unknown.join(", ")}, which tck/specs/index does not ` +
        `export as an array of specs. Delete the entry, or fix the export: an ` +
        `ordering for a group that does not exist is a rule nothing checks.`,
    );
  }

  const rank = (name: string): number => {
    const at = GROUP_ORDER.indexOf(name);
    return at === -1 ? GROUP_ORDER.length : at;
  };
  return found.sort((a, b) => rank(a[0]) - rank(b[0]));
}

const CP_ID = "CERTCP1";

/**
 * Canonical observation ids. Both the SteVe-shaped names (today) and the
 * CSMS-neutral names (after the refactor) map to the same id, which is what
 * lets this artifact stay still while the contract is renamed underneath it.
 */
const OBSERVATION_ALIASES: Readonly<Record<string, string>> = {
  latestTxPk: "latest-transaction",
  latestTransaction: "latest-transaction",
  waitActiveTxPk: "wait-active-transaction",
  waitForActiveTransaction: "wait-active-transaction",
  closeStaleTx: "close-stale-transaction",
  txIdTag: "transaction-id-tag",
  transactionIdTag: "transaction-id-tag",
  txStopTimestamp: "transaction-stop-timestamp",
  transactionStopTimestamp: "transaction-stop-timestamp",
  txStopReason: "transaction-stop-reason",
  transactionStopReason: "transaction-stop-reason",
  txCountForTag: "transaction-count-for-id-tag",
  transactionCountForIdTag: "transaction-count-for-id-tag",
  latestReservationPk: "reservation-latest",
  reservationStatus: "reservation-status",
  chargingProfilePkByDescription: "charging-profile-by-description",
  refByDescription: "charging-profile-by-description",
};

/** Stable placeholders. Identical before and after the refactor on purpose:
 *  a handle that changed spelling would show up as a value diff in every
 *  operation that consumes one. */
const PLACEHOLDER: Readonly<Record<string, string>> = {
  "latest-transaction": "TXPK",
  "wait-active-transaction": "TXPK",
  "transaction-id-tag": "CERT-TAG-1",
  "transaction-stop-timestamp": "2026-01-01T00:00:00Z",
  "transaction-stop-reason": "Local",
  "transaction-count-for-id-tag": "1",
  "reservation-latest": "RESPK",
  "reservation-status": "ACCEPTED",
  "charging-profile-by-description": "PROFILEPK",
};

const CP_SELECT_TOKEN = `V_16_JSON;${CP_ID};-`;
const DATEISH = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

let trace: string[] = [];
const record = (line: string): void => {
  trace.push(`  ${line}`);
};

/** Normalises one operation argument value. Returns null to drop it. */
function normaliseValue(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (raw instanceof Date) return "<ts>";
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).toLowerCase();
  }
  if (typeof raw !== "string") return JSON.stringify(raw).toLowerCase();
  if (raw === "") return null; // in-band "absent" pre-refactor, absent after
  if (raw === CP_ID || raw === CP_SELECT_TOKEN) return null; // the selector
  if (DATEISH.test(raw)) return "<ts>";
  return raw.toLowerCase();
}

function recordOperation(action: string, values: unknown[]): void {
  const normalised = values
    .map(normaliseValue)
    .filter((v): v is string => v !== null)
    .sort();
  const suffix = normalised.length > 0 ? ` [${normalised.join(", ")}]` : "";
  record(`OP ${action}${suffix}`);
}

/** Flattens an operation payload to its leaf values, keys discarded. */
function leafValues(payload: unknown): unknown[] {
  if (payload === null || typeof payload !== "object") return [payload];
  if (Array.isArray(payload)) return payload.flatMap(leafValues);
  if (payload instanceof Date) return [payload];
  return Object.entries(payload as Record<string, unknown>)
    // `action` is the discriminant, already printed as the operation name.
    .filter(([key]) => key !== "action")
    .flatMap(([, value]) => leafValues(value));
}

const operationsStub = {
  // --- legacy shape (today) -------------------------------------------------
  cpSelect(_cpId: string): string {
    return CP_SELECT_TOKEN;
  },
  async op(opPath: string, fields: Record<string, string>): Promise<string> {
    const action = opPath.split("/").pop() ?? opPath;
    recordOperation(action, Object.values(fields));
    return "<receipt>";
  },
  // --- neutral shape (after the refactor) -----------------------------------
  async execute(_cpId: string, operation: { action: string }): Promise<string> {
    recordOperation(operation.action, leafValues(operation));
    return "<receipt>";
  },
};

/**
 * The same, for DriveContext's OCPP 2.0.1 half.
 *
 * A SEPARATE STUB rather than reusing the one above, and the reason is the
 * reason the two vocabularies are two unions: `Reset` is an action name in
 * both. Sharing the stub would record a 2.0.1 Reset as `OP Reset`, which is
 * what a 1.6 Reset records -- so this artifact, whose whole job is to make a
 * retargeted step visible, would be blind to a scenario switching protocols.
 *
 * `SpecLike.drive` takes a `Record<string, unknown>` so that a spec can be
 * traced through either the legacy or the neutral field names, which means
 * tsc CANNOT check this context against DriveContext. A member the runner
 * supplies and this file forgets is therefore a crash at --regenerate time,
 * not a compile error: `csms201` was exactly that until it was added here.
 */
const operations201Stub = {
  async execute(_cpId: string, operation: { action: string }): Promise<string> {
    recordOperation(`201:${operation.action}`, leafValues(operation));
    return "<receipt>";
  },
};

function observationStub(): Record<string, unknown> {
  const stub: Record<string, unknown> = {};
  for (const [method, id] of Object.entries(OBSERVATION_ALIASES)) {
    stub[method] = async (): Promise<string> => {
      record(`OBS ${id}`);
      return PLACEHOLDER[id] ?? "";
    };
  }
  // The optional capability sub-interfaces the refactor introduces. Present
  // eagerly so a converted spec traces identically to its legacy form.
  stub.reservations = {
    latest: async (): Promise<string> => {
      record("OBS reservation-latest");
      return PLACEHOLDER["reservation-latest"];
    },
    status: async (): Promise<string> => {
      record("OBS reservation-status");
      return PLACEHOLDER["reservation-status"];
    },
  };
  stub.chargingProfiles = {
    refByDescription: async (): Promise<string> => {
      record("OBS charging-profile-by-description");
      return PLACEHOLDER["charging-profile-by-description"];
    },
  };
  return stub;
}

const simStub = {
  async waitForLine(pattern: RegExp, timeoutMs: number): Promise<string> {
    record(`SIM wait-for-line ${pattern.source} ${timeoutMs}`);
    return "<line>";
  },
  send(payload: unknown): void {
    record(`SIM send ${JSON.stringify(payload)}`);
  },
};

/**
 * TC_052 builds its own SteVe manager-UI client and drives it over fetch,
 * bypassing the ambient driver. Stubbing fetch keeps that visible in the trace
 * instead of vanishing into the spec's own try/catch -- which is what makes
 * the ONE deliberate diff of the refactor (that call becoming an ordinary
 * driver operation) reviewable rather than invisible.
 */
const CSRF_BODY = '<input name="_csrf" value="stub-csrf" />';
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : String(input);
  const method = init?.method ?? "GET";
  const path = new URL(url, "http://stub.invalid").pathname;
  record(`HTTP ${method} ${path}`);
  return new Response(CSRF_BODY, {
    status: method === "POST" ? 302 : 200,
    headers: {
      location: "/stub/redirect",
      "set-cookie": "JSESSIONID=stub; Path=/",
    },
  });
}) as typeof fetch;

// Collapse every timer to the next tick. 47 scenarios of literal `sleep(2000)`
// plus waitForCondition poll loops would otherwise cost ~95s of wall clock for
// an artifact that must be regenerable in a pre-commit-length window. The
// callback still runs asynchronously, so ordering semantics are preserved --
// unlike replacing setTimeout with a synchronous call.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...rest: unknown[]) =>
  realSetTimeout(fn, 0, ...rest)) as typeof globalThis.setTimeout;

const out: string[] = [];
out.push("# DRIVE-TRACE -- what each scenario does to the CSMS.");
out.push("# Generated by tools/extract-drive-trace.ts. Do not hand-edit.");
out.push("# Operations are normalised: OCPP action + argument VALUES (keys");
out.push("# discarded, lowercased, sorted), so a pure driver-syntax change is");
out.push("# invisible here while a dropped or retargeted step is not.");

for (const [groupName, groupSpecs] of discoverGroups()) {
  out.push("");
  out.push(`GROUP ${groupName}`);
  for (const spec of groupSpecs) {
    out.push(`  SPEC ${spec.templateId}`);
    if (!spec.drive) {
      out.push("    <no drive>");
      continue;
    }

    trace = [];
    const records = observationStub();
    let result: unknown;
    try {
      result = await spec.drive({
        cpId: CP_ID,
        connector: spec.connector ?? 1,
        sim: simStub,
        // Both the legacy field names and the neutral ones, so a spec traces
        // identically before and after it is converted.
        steve: operationsStub,
        csms: operationsStub,
        csms201: operations201Stub,
        db: records,
        records,
      });
    } catch (err) {
      trace.push(`  THREW ${err instanceof Error ? err.name : "unknown"}`);
    }
    for (const line of trace) out.push(`  ${line}`);

    const keys =
      result !== null && typeof result === "object"
        ? Object.keys(result as object).sort().join(",")
        : "";
    out.push(`    -> driveState keys=[${keys}]`);
  }
}

process.stdout.write(out.join("\n") + "\n");
