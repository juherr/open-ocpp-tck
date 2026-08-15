# Writing a CSMS driver

A driver is the only thing standing between these 47 scenarios and your CSMS.
It answers two questions and nothing else:

- **`CsmsOperations.execute(cpId, op)`** — "make the CSMS send this OCPP
  operation to this charge point."
- **`CsmsRecords`** — "what does the CSMS believe happened?"

Everything else — starting the simulator, parsing OCPP-J, asserting, verdicts,
reporting — is the core's job. Your driver never learns which scenario is
driving it, and the core never learns which CSMS it is testing.

## Setup

```sh
mkdir acme-ocpp-tck && cd acme-ocpp-tck
bun init -y
bun add github:juherr/open-ocpp-tck#v0.1.0
bun add -d @types/bun typescript
```

`tsconfig.json`:

```json
{
  "extends": "open-ocpp-tck/tsconfig",
  "compilerOptions": { "types": ["bun"] },
  "include": ["*.ts", "src/**/*.ts"]
}
```

## The module

```ts
import {
  assertNever,
  UnsupportedOperationError,
  type CsmsDriverModule,
  type CsmsOperation,
} from "open-ocpp-tck/driver";
import { unverifiable } from "open-ocpp-tck/unverifiable";
import { waitForCondition } from "open-ocpp-tck/wait";
import type { ScopeTable } from "open-ocpp-tck/scope";

const SCOPE: ScopeTable = {
  "cert16-tc013-hard-reset": {
    status: "DRIVABLE",
    reason: "POST /charge-points/{id}/reset",
  },
  // one row per registered scenario -- `ocpp-tck check-driver` lists the gaps
};

export const csmsDriver: CsmsDriverModule = {
  id: "acme",
  displayName: "Acme CSMS",
  scope: SCOPE,
  envHelp: "ACME_BASE_URL, ACME_TOKEN",

  create(env) {
    const token = env.ACME_TOKEN;
    if (!token) throw new Error("ACME_TOKEN is not set");

    return {
      operations: {
        async execute(cpId: string, op: CsmsOperation): Promise<string> {
          switch (op.action) {
            case "Reset":
              return post(`/cp/${cpId}/reset`, { type: op.type });
            case "ClearCache":
              return post(`/cp/${cpId}/clear-cache`, {});
            // ... 16 more. Omitting one is a COMPILE error, not a surprise
            //     mid-campaign against somebody's acceptance environment.
            default:
              return assertNever(op, "acme.execute");
          }
        },
      },

      records: {
        latestTransaction: (cpId) => findLatestSession(cpId),
        waitForActiveTransaction: (cpId, idTag, timeoutSecs) =>
          waitForCondition(() => findOpenSession(cpId, idTag), {
            timeoutMs: (timeoutSecs ?? 60) * 1000,
          }),
        transactionIdTag: (tx) => sessionField(tx, "idTag"),
        transactionStopTimestamp: (tx) => sessionField(tx, "stoppedAt"),
        transactionStopReason: async () =>
          unverifiable("the Acme API exposes no OCPP stop reason"),
        transactionCountForIdTag: async () =>
          unverifiable("no per-idTag session counter in the Acme API"),
        // reservations / chargingProfiles omitted -> the runner substitutes
        // stubs that throw UnsupportedOperationError -> NOT APPLICABLE.
      },

      simTransport: async () => ({ wsUrl: env.ACME_WS_URL }),
    };
  },
};
```

Run it:

```sh
export CSMS_DRIVER="$PWD/index.ts"
bunx tsc --noEmit
bunx ocpp-tck check-driver      # offline
bunx ocpp-tck run-all --group core
```

## Three things a driver may not do

**1. Throw for an OCPP-level outcome.** `execute()` resolves as soon as the
CSMS has *accepted or dispatched* the operation. A `Rejected` CALLRESULT, a
CALLERROR, or no response at all are normal returns — every scenario asserts on
the simulator's captured wire log, never on what `execute()` returned. Throw
only for a genuine transport or request failure.

**2. Invent an observation.** Every `CsmsRecords` method returns a **string**,
the count included, and that is deliberate. If your CSMS cannot answer, return
`unverifiable("<why>")`: the assertion helpers recognise the sentinel and
record the check as `SKIPPED`, yielding `PARTIAL` instead of a false `FAIL`.

Never return `""` for "I cannot know" — `""` is the legitimate "not set", so it
turns a `SKIPPED` into a `FAIL`. And never use the sentinel for a value that is
fed back into an operation field: a sentinel string reaching a request body
asks the CSMS to act on the word "unverifiable". Throw
`UnsupportedOperationError` there instead.

**3. Branch on a scenario id.** A driver that wants per-scenario behaviour is
describing a capability gap. Declare it in the scope table.

## The scope table

`ocpp-tck` consults it **before starting any container**, so a scenario your
CSMS cannot drive costs nothing and is reported with its reason.
`UnsupportedOperationError` is the second line of defence: when it fires, the
runner records `NOT APPLICABLE` *and* warns that your table is out of date.

- Every `reason` cites the precise limitation — an endpoint that does not
  exist, a DTO member that is absent. If you cannot name the limitation, the
  row is `CONDITIONAL`, not `NOT_APPLICABLE`.
- `CONDITIONAL` means "expressible, but whether the CSMS emits the OCPP message
  we need is unknown until a real run". State the question the first live run
  must answer.
- **Never** demote a row to `NOT_APPLICABLE` to make a red scenario go away.
  That converts a finding about your CSMS into a silence about the harness, and
  the two are indistinguishable afterwards.

Put it on the **module**, not inside `create()`. `check-driver` and the
preflight read it without calling `create()`, which is what lets them run with
no credentials — including in your CI, which has none.

### When the table depends on which server you point at

A CSMS with two incompatible release lines does not have one table, and neither
`scope` nor `capabilities` has to be a constant: both accept a function of the
environment, resolved with the same `CsmsEnv` that later reaches `create()`.

```ts
scope: (env) => (env.ACME_LINE === "legacy" ? LEGACY_SCOPE : SCOPE),
```

Do not resolve the setting twice — once from `process.env` at module load for
the table, once from the argument inside `create()`. They agree only as long as
the caller happens to pass `process.env`, and when they stop agreeing the
result is a scope table describing one server while every request targets the
other. `drivers/citrineos/` does this for `CITRINE_VARIANT`.

The function is still read with no credentials and no server: it may read a
*declaration* — which release, which profile — and must not contact the CSMS to
answer. If you read those fields yourself rather than through the runner, use
`driverScope(module, env)` / `driverCapabilities(module, env)` from
`open-ocpp-tck/driver` instead of narrowing the union by hand.

## Expected failures

The scope table says what your CSMS **cannot drive**. This says what it drives
and **gets wrong**. Keeping them apart is the point: a known-red scenario keeps
its `DRIVABLE` row, still starts a container and still prints `FAIL` — what it
stops doing is ending the build.

```ts
expectedFailures: {
  "cert16-tc023-3-authorize-blocked": {
    reason: "…the mechanism, cited, the way a scope row's is…",
    finding: "…an upstream issue, or the row of your README's gap table…",
  },
},
```

Same placement and same resolution rules as `scope`: on the module, read with
no credentials, and free to be a function of the environment
(`driverExpectedFailures(module, env)` if you read it yourself).

**A declared scenario that passes fails the sweep**, as `UNEXPECTED PASS`, and
that half is not an inconvenience — it is what the mechanism is for. Without it
the list only ever grows, and an entry outlives the defect it documents. When
one fires, delete the entry or re-word it to say what is still true.

**An entry excuses an answer, never a crash.** A declared scenario that `ERROR`s
— container never started, bounded wait gave up, driver threw — still fails the
sweep, reported as `DECLARED, BUT ERRORED`. It never got an answer out of the
CSMS, so it cannot be the finding your `reason` describes, and a job that went
green on it would be blind to exactly the kind of breakage it exists to catch.
Your entry is probably still good; the crash is the new thing.

Three rules, and they are the difference between a reviewed list and a mute:

- `reason` names the mechanism. "Known red" is the observation being explained,
  not the explanation.
- `finding` says where to go and read about it. `check-driver` rejects an empty
  one, because a known-red nobody can look up is a claim nobody can review.
- **Never add an entry to quiet a flake.** There is no "expected flaky" status,
  deliberately: a scenario that sometimes passes has a timing bug, and it will
  be reported as an `UNEXPECTED PASS` the first time it does. Fix the scenario.

`check-driver` also rejects an id that is stale, or that your scope table calls
`NOT_APPLICABLE` — a scenario that never starts can neither fail as declared nor
ever pass and delete the entry.

### Two worked examples

Two drivers ship here, and they are worth reading together because they solve
the same problem through completely different surfaces — which is the strongest
evidence that the contract is not shaped around either of them.

`drivers/steve/` drives operations through an HTML manager UI and reads state
from MariaDB. `drivers/citrineos/` posts JSON to a generated REST API and reads
from Postgres, and additionally supports two incompatible releases of its CSMS
behind one `CITRINE_VARIANT` setting.

For the mechanics of the contract — the operation switch, the record queries,
the bootstrap verbs — either one works as a model. For **what to do when your
CSMS cannot do something**, read `drivers/citrineos/`: it is the one with gaps,
so it is the one that shows a scope table with `NOT_APPLICABLE` rows each citing
the endpoint that does not exist, an `expectedFailures` list with a row that
stays `DRIVABLE` and red on purpose, a `records` object that omits
`reservations` outright rather than faking it, and a
[README](drivers/citrineos/README.md) whose gap table names a source fact per
row.

## Contributing back

Pull requests welcome for the core, either bundled driver, and new scenarios.
Two rules the test suite enforces rather than merely documents:

- **`tests/generic-core.sh`** — nothing under `tck/` may name a CSMS, no driver
  may name another driver's, and the core may not import a driver. Doc comments
  may *discuss* a CSMS-shaped design they replaced; identifiers, string literals
  and imports may not. A new driver's directory is picked up from `drivers/*`
  on its own, but it has to be declared in that guard — `known_drivers`, plus a
  `csms_names` row for the names it owns: the CSMS, its schema, whatever else
  identifies it. The guard says so until both are there, and it forbids those
  names in the core and in every other driver from then on.
- **`tests/vendor-integrity.sh`** — files vendored from
  `shiv3/ocpp-cp-simulator` are digest-pinned in `VENDOR.md`, and each patch is
  reverse-applied to check it still reconstructs the pinned upstream bytes.
  If you touch one, regenerate its patch and re-pin both digests; the procedure
  is in `VENDOR.md`.

Changing what a scenario *measures* also moves `tck/specs/ASSERT-INVENTORY.txt`
or `DRIVE-TRACE.txt`. That is intended: the diff is the review. Regenerate with
`bash tests/spec-invariants.sh --regenerate` and explain the change in the pull
request.

If you edit anything under `tck/` or `drivers/steve/`, run
`bun run build:types` and commit the result — `tests/types-current.sh` fails
otherwise.
