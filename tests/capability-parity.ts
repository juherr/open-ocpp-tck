// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * capability-parity.ts -- a capability a driver DECLARES is one it can be
 * asked for.
 *
 * A driver states what it can do twice, in two places that are read at two
 * different times: `capabilities`, resolved offline before any container
 * starts, and the parts `create(env)` returns, which is what a scenario
 * actually calls. Nothing held the two to each other. `check-driver` cannot:
 * it never calls `create()` -- deliberately, because reading a declaration
 * must not need credentials -- and the one rule it does apply to
 * `operations201` compares the declaration to `CSMS_OPERATION_201_ACTIONS`,
 * the core's OWN list. An arm added to `CsmsOperation201` grows both sides of
 * that comparison in the same commit, so the check is a tautology and stays
 * green. Issue #71.
 *
 * PROPERTY, in 5 parts:
 *  1. AN OPTIONAL CAPABILITY IS DECLARED EXACTLY WHEN IT IS IMPLEMENTED, both
 *     directions, for every environment a bundled driver's declarations are a
 *     function of. `capabilities.operations201` against `operations201` on the
 *     parts; `reservations`, `chargingProfiles` and `deviceModel` against
 *     `records.*`. Declared-and-missing is a scenario that starts a container
 *     to discover a gap the pre-flight already knew; implemented-and-
 *     undeclared is a capability the run report denies the CSMS has.
 *  2. `operations201` PRESENT BUT EMPTY IS A FAILURE. Absent means "this
 *     driver does not speak OCPP 2.0.1"; empty means "it speaks it, and a
 *     measurement found nothing it can drive". Those are different claims and
 *     no bundled driver is honestly in the second state -- so an empty set
 *     here is a subtraction that removed everything, which is what a
 *     declaration built by filtering looks like when the filter is wrong.
 *  3. EVERY ACTION A DRIVER DECLARES MAPS TO A REQUEST. Each declared action's
 *     `SAMPLE_OPERATION_201` entry goes through the driver's own mapper, which
 *     must not answer `UnsupportedOperationError`. This is the direction that
 *     was uncheckable: the union grows sixteen more times (see the header
 *     above `CsmsOperation201`), and `assertNever` forces a `case` per arm but
 *     says nothing about whether the endpoint that case names exists.
 *  4. THAT CHECK IS NOT VACUOUS. The same mapper, on the line whose unrouted
 *     table is total, must refuse every one of them -- and at least one case
 *     here must have a non-empty table, or part 3 is a detector that has never
 *     detected. A per-action check that cannot see a refusal passes for the
 *     same reason an empty loop does.
 *  5. A 1.6-ONLY DRIVER IS VALID WITH NO `operations201` AT ALL. SteVe
 *     declares none and implements none, and the contract's own substitute --
 *     `unsupportedOperations201`, the one the runner puts in place of the
 *     missing part -- answers every sample in the vocabulary with
 *     `UnsupportedOperationError`. The opt-in shape costs a 1.6-only driver
 *     nothing, and this is where that stays true as the 2.0.1 half grows.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD, and it is the reason
 * `tests/driver-env-scope.ts` gives rather than a second one: a driver's
 * declarations follow the env they are RESOLVED with, and the CLI can only
 * ever hand them `process.env`. Both halves of part 1 have to be read for the
 * same synthetic `CsmsEnv`, which no `bash` can produce -- and the half that
 * matters most, `create(env)`, is not reachable from the CLI at all without
 * starting a sweep.
 *
 * HOW PART 3 REACHES THE MAPPER, and what that weakens. It calls
 * `toCitrineRequest201` DIRECTLY rather than `parts.operations201.execute()`.
 * The client `execute` closes over is built inside `create()` with the real
 * `fetch`, and the `FetchLike` seam
 * `tests/citrineos-transport-classification.ts` drives does not reach through
 * `create()`; the alternatives were exporting the driver's internal
 * `createOperations201` -- requests.ts's own note refuses that, a published
 * declaration is this package's API whether anything imports it or not -- or
 * patching the global `fetch`, which buys wiring coverage with a socket this
 * gate must not open, on a port a developer may well have a CitrineOS
 * listening on. So: WHAT IS WEAKENED is the wiring between `execute` and the
 * mapper. A driver that declared an action, routed it correctly, and then wired
 * `execute` to something else would pass part 3. What is NOT weakened is the
 * subject -- whether a declared action has a route -- because `api.send` never
 * raises `UnsupportedOperationError`, so the transport is not part of the
 * answer.
 *
 * WHAT IT CANNOT CHECK OFFLINE, and each of these needs a running CSMS rather
 * than a better guard:
 *  - THAT THE ROUTE EXISTS. A `case` naming a plausible module/action pair
 *    compiles, is declared, and 404s. `api-client.ts` classifies that 404 as
 *    `CsmsNotDispatchedError` on purpose -- issue #80 -- so it is not even the
 *    same class this guard looks for. `ocpp-tck driver selftest` and a sweep
 *    are what answer it.
 *  - THAT THE BODY PASSES THE REQUEST SCHEMA. CitrineOS validates against
 *    `<Action>RequestSchema` before dispatching; a well-formed
 *    `CsmsOperation201` mapped to a body missing a required member is a
 *    request this guard is happy with and the CSMS refuses.
 *  - THAT THE CALL REACHED THE WIRE. Everything past "the CSMS accepted the
 *    POST" is the scenarios' subject, asserted on the simulator's wire log.
 *
 * Offline: resolves declarations, calls `create()` -- which builds clients
 * without connecting -- and maps operations. Opens no socket, starts nothing.
 */
import {
  CSMS_OPERATION_201_ACTIONS,
  SAMPLE_OPERATION_201,
  UnsupportedOperationError,
  driverCapabilities,
  type CsmsCapabilities,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
  type CsmsOperation201,
} from "../tck/driver";
import { unsupportedOperations201 } from "../tck/capabilities";
import { csmsDriver as citrineos } from "../drivers/citrineos/index";
import { toCitrineRequest201 } from "../drivers/citrineos/requests";
import {
  resolveVariant,
  unroutedActions201,
} from "../drivers/citrineos/variant";
import { csmsDriver as steve } from "../drivers/steve/index";

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

/** Any charge point id: nothing below reaches a CSMS, and a mapper that
 *  branched on the id would be a different bug than this file's. */
const CP_ID = "CERTCP1";

// ---------------------------------------------------------------------------
// The cases: one bundled driver, one environment its declarations answer for
// ---------------------------------------------------------------------------

interface DriverCase {
  readonly label: string;
  readonly module: CsmsDriverModule;
  readonly env: CsmsEnv;
  /**
   * The driver's own 2.0.1 mapper, bound to this case's environment, or
   * undefined for a driver that has none.
   *
   * A FUNCTION PER CASE rather than one lookup, because the mapper is
   * driver-specific in a way parts 1, 2 and 5 are not: those read the contract
   * and hold for any driver, this one has to name a module. A third-party
   * driver runs parts 1, 2 and 5 against its own module for free and owes
   * itself this one line.
   */
  readonly map201?: (op: CsmsOperation201) => unknown;
  /** The 2.0.1 actions this case's line does not route, mapped to why -- part
   *  4's input, and the driver's own table rather than a list restated here. */
  readonly unrouted201: ReadonlySet<string>;
}

const V1_ENV: CsmsEnv = { CITRINE_VARIANT: "v1" };
const V2_ENV: CsmsEnv = { CITRINE_VARIANT: "v2" };

const CASES: readonly DriverCase[] = [
  // One environment, because SteVe's declarations are constants: `scope` and
  // `capabilities` are plain values on the module, so there is no second
  // resolution to disagree with the first.
  { label: "steve", module: steve, env: {}, unrouted201: new Set() },
  // BOTH lines, for the reason tests/driver-env-scope.ts states about its own
  // pair: a driver that regressed to resolving the variant once, at import,
  // answers the same thing for both, so whichever the ambient CITRINE_VARIANT
  // matches, the other case is the one that fails.
  {
    label: "citrineos (CITRINE_VARIANT=v1)",
    module: citrineos,
    env: V1_ENV,
    map201: (op) => toCitrineRequest201(op, resolveVariant(V1_ENV)),
    unrouted201: new Set(unroutedActions201(resolveVariant(V1_ENV)).keys()),
  },
  {
    label: "citrineos (CITRINE_VARIANT=v2)",
    module: citrineos,
    env: V2_ENV,
    map201: (op) => toCitrineRequest201(op, resolveVariant(V2_ENV)),
    unrouted201: new Set(unroutedActions201(resolveVariant(V2_ENV)).keys()),
  },
];

// ---------------------------------------------------------------------------
// Part 1: the optional capabilities, one row per omissible half of a driver
// ---------------------------------------------------------------------------

interface OptionalCapability {
  /** The field on {@link CsmsCapabilities}. */
  readonly field: string;
  readonly declared: (capabilities: CsmsCapabilities) => boolean;
  readonly implemented: (parts: CsmsDriverParts) => boolean;
  /** Where the implementing half lives, for the failure message: a reader who
   *  has to go and find out which of two objects is wrong has been told half
   *  of what the guard knows. */
  readonly part: string;
}

const OPTIONAL: readonly OptionalCapability[] = [
  {
    field: "operations201",
    declared: (capabilities) => capabilities.operations201 !== undefined,
    implemented: (parts) => parts.operations201 !== undefined,
    part: "operations201 on the parts create() returns",
  },
  {
    field: "reservations",
    declared: (capabilities) => capabilities.reservations,
    implemented: (parts) => parts.records.reservations !== undefined,
    part: "records.reservations",
  },
  {
    field: "chargingProfiles",
    declared: (capabilities) => capabilities.chargingProfiles,
    implemented: (parts) => parts.records.chargingProfiles !== undefined,
    part: "records.chargingProfiles",
  },
  {
    field: "deviceModel",
    declared: (capabilities) => capabilities.deviceModel,
    implemented: (parts) => parts.records.deviceModel !== undefined,
    part: "records.deviceModel",
  },
];

let declaredActions = 0;
let refusalsSeen = 0;

for (const testCase of CASES) {
  const capabilities = driverCapabilities(testCase.module, testCase.env);
  if (capabilities === undefined) {
    failures.push(
      `${testCase.label}: declares no capabilities at all. Both bundled ` +
        "drivers do, and a guard that reads nothing for one of them reports " +
        "nothing about it.",
    );
    continue;
  }
  const parts = await testCase.module.create(testCase.env);

  for (const capability of OPTIONAL) {
    const declared = capability.declared(capabilities);
    const implemented = capability.implemented(parts);
    check(
      declared === implemented,
      `${testCase.label}: capabilities.${capability.field} says ` +
        `${declared} while ${capability.part} is ` +
        `${implemented ? "present" : "absent"}. ` +
        (declared
          ? "A declared capability nothing implements is a gap the " +
            "pre-flight could have reported and a container found instead."
          : "An implemented capability nothing declares is a capability the " +
            "run report denies this CSMS has."),
    );
  }

  // Part 2.
  if (capabilities.operations201 !== undefined) {
    check(
      capabilities.operations201.size > 0,
      `${testCase.label}: capabilities.operations201 is present and EMPTY. ` +
        "Absent is how a driver says it does not speak OCPP 2.0.1; empty " +
        "claims it speaks it and can drive none of the vocabulary, which no " +
        "bundled driver is honestly in -- so this is a subtraction that took " +
        "everything.",
    );
  }

  // Part 3.
  for (const action of capabilities.operations201 ?? []) {
    if (testCase.map201 === undefined) {
      failures.push(
        `${testCase.label}: declares the OCPP 2.0.1 action ${action} and this ` +
          "guard has no mapper for it, so nothing checked whether the driver " +
          "can express it. Add a map201 to its case above.",
      );
      continue;
    }
    declaredActions += 1;
    try {
      testCase.map201(SAMPLE_OPERATION_201[action]);
    } catch (err) {
      if (err instanceof UnsupportedOperationError) {
        failures.push(
          `${testCase.label}: declares the OCPP 2.0.1 action ${action} and ` +
            `its own mapper refuses it -- "${err.reason}". The declaration ` +
            "and the route come from one table precisely so they cannot say " +
            "different things; this is them saying different things.",
        );
      } else {
        failures.push(
          `${testCase.label}: mapping the ${action} sample threw ` +
            `${err instanceof Error ? err.message : String(err)}. The sample ` +
            "is a well-formed operation of that action, so a driver that " +
            "declares the action must be able to build a request from it.",
        );
      }
    }
  }

  // Part 4: the same mapper, on what this line does NOT route.
  for (const action of CSMS_OPERATION_201_ACTIONS) {
    if (testCase.map201 === undefined) continue;
    if (!testCase.unrouted201.has(action)) continue;
    let refused = false;
    try {
      testCase.map201(SAMPLE_OPERATION_201[action]);
    } catch (err) {
      refused = err instanceof UnsupportedOperationError;
    }
    check(
      refused,
      `${testCase.label}: ${action} is in this line's unrouted table and the ` +
        "mapper built a request for it anyway. The table is what part 3 " +
        "trusts to be visible, so a mapper that ignores it makes part 3 a " +
        "check that cannot fail.",
    );
    if (refused) refusalsSeen += 1;
  }
}

// Part 4's other half: the control has to exist. Every unrouted table being
// empty is the state in which part 3 has never been shown to detect anything,
// and it is reachable by deleting one line in variant.ts.
check(
  refusalsSeen > 0,
  "no case here has a non-empty unrouted 2.0.1 table, so nothing demonstrated " +
    "that the per-action check can see a refusal at all. Part 3 is then a " +
    "loop over requests that all succeed, which is what it would also be if " +
    "the mapper had stopped refusing anything.",
);
check(
  declaredActions > 0,
  "no bundled driver declares an OCPP 2.0.1 action, so the per-action check " +
    "ran over nothing.",
);

// ---------------------------------------------------------------------------
// Part 5: the 1.6-only path
// ---------------------------------------------------------------------------

const steveCapabilities = driverCapabilities(steve, {});
const steveParts = await steve.create({});

check(
  steveCapabilities?.operations201 === undefined,
  "the 1.6-only bundled driver now DECLARES an OCPP 2.0.1 vocabulary. The " +
    "opt-in shape exists so a driver whose CSMS speaks one protocol compiles " +
    "and runs untouched as the other one grows.",
);
check(
  steveParts.operations201 === undefined,
  "the 1.6-only bundled driver now returns an operations201 part. Absent is " +
    "what makes the runner substitute its stub and the scenario land NOT " +
    "APPLICABLE.",
);

// The substitution the runner performs, performed here: what a 1.6-only
// driver's omission actually costs a `cert201-` scenario. `??` and not a
// literal stub, so this is the contract's own answer rather than one modelled
// on it.
const substituted =
  steveParts.operations201 ??
  unsupportedOperations201("this driver declares no OCPP 2.0.1 operations");

for (const action of CSMS_OPERATION_201_ACTIONS) {
  let caught: unknown;
  try {
    await substituted.execute(CP_ID, SAMPLE_OPERATION_201[action]);
  } catch (err) {
    caught = err;
  }
  check(
    caught instanceof UnsupportedOperationError,
    `the substitute for an absent operations201 answered ${action} with ` +
      `${caught === undefined ? "no error at all" : String(caught)} rather ` +
      "than UnsupportedOperationError. The runner recognises that class by " +
      "identity, so anything else turns a NOT APPLICABLE verdict into an ERROR.",
  );
}

if (failures.length > 0) {
  process.stderr.write(
    "FAIL: a driver's declared capabilities and the parts it returns do not " +
      "agree.\n",
  );
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `Capability parity holds across ${CASES.length} driver environment(s): ` +
    `${OPTIONAL.length} optional capabilities declared exactly where they are ` +
    `implemented, ${declaredActions} declared OCPP 2.0.1 action(s) mapped to a ` +
    `request, ${refusalsSeen} unrouted one(s) refused, and the 1.6-only driver ` +
    `still valid with none of the ${CSMS_OPERATION_201_ACTIONS.length}.\n`,
);
