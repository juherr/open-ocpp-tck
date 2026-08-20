# open-ocpp-tck

An OCPP conformance TCK you point at **your** CSMS: 47 OCPP 1.6 certification
scenarios, and the first 5 of OCPP 2.0.1.

It brings a real charge point (the [`ocpp-cp-simulator`][sim] CLI, in a
digest-pinned container), drives it through 52 certification scenarios, parses
the OCPP-J frames both directions, and asserts on the captured wire log. What
it does *not* bring is any knowledge of your CSMS: telling it "reset this
charge point" is a **driver**, and a driver is one file you write.

The scenarios trace to the Open Charge Alliance's OCPP 1.6 certification
material — the [OCPP 1.6 certification page][octt], and in particular its
*Test Procedure & Test Plans* and *OCPP Compliancy Testing Tool — Test Case
Document*. Scenario `cert16-tcNNN-…` corresponds to OCA test case `TC_NNN`,
and because the CSMS is the system under test here, the **`_CSMS` variant** is
the one that applies: it is the Central System that must answer. This is not a
certification tool and passing it is not certification — but the reference is
where a disagreement about what a scenario *should* assert gets settled.

The `cert16-` prefix is a protocol version, not decoration. Its counterpart is
`cert201-`, and those scenarios trace the same way to OCPP 2.0.1's Parts 5 and
6 — `cert201-tcb01-…` to `TC_B_01`. Which 2.0.1 cases may be here at all is a
written rule, [`OCA-201-SELECTION.md`](OCA-201-SELECTION.md) — role CSMS,
status mandatory, on every certification profile, which is 205 cases — and the
resulting list is [`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt),
where 7 of them are written down so far and 5 are implemented. A `cert201-`
scenario needs a driver that speaks the protocol; one that does not says so per
scenario in its scope table, and nothing else about it changes.

[sim]: https://github.com/shiv3/ocpp-cp-simulator
[octt]: https://openchargealliance.org/certificationocpp/certification-ocpp-1-6/

```
       your CSMS  <--- REST/UI/SQL ---  your driver  ---.
           ^                                            |  CsmsOperations16
           |                                            |  CsmsRecords
        OCPP-J                                          v
           |                                     +--------------+
    ocpp-cp-simulator  <--- JSON Lines stdin ----|   ocpp-tck   |
      (docker, pinned)  ---- stdout wire log --->|   52 specs   |
                                                 +--------------+
```

The split matters: the scenarios assert on **what went over the wire**, never
on what your driver returned. A driver that lies produces a red scenario, not a
green one.

## Requirements

- [bun](https://bun.sh) ≥ 1.3.14 — the runner uses `Bun.spawn`/`Bun.write`;
  Node cannot run it, and `bin/ocpp-tck.ts` says so rather than failing later.
- docker — one simulator container per scenario.

## Bundled drivers

Two ship here, on equal footing. They reach their CSMS through completely
different surfaces, and each answers a question the other cannot:

| Driver | Transport | What it answers | Result |
|---|---|---|---|
| [`drivers/steve`](drivers/steve/README.md) | HTML manager UI + WebAPI + MariaDB | *Has the harness lost a capability?* SteVe is the CSMS the scenarios were originally written against, so a scope row that had to be demoted would mean the core dropped something. | 47 `DRIVABLE`, and the 5 OCPP 2.0.1 scenarios `NOT_APPLICABLE` |
| [`drivers/citrineos`](drivers/citrineos/README.md) | JSON REST API + GraphQL | *Is the contract actually CSMS-neutral?* [CitrineOS](https://github.com/citrineos/citrineos-core) (LF Energy / S44) had no part in writing the scenarios and has a smaller OCPP 1.6 surface. | 31 `PASS`, 5 `PARTIAL`, 4 `FAIL`, 7 `NOT APPLICABLE` over the OCPP 1.6 scenarios; of the 5 OCPP 2.0.1 ones, 4 `PASS` and 1 cannot establish its precondition against this CSMS |

An abstraction with one implementation is neutral by assertion, so the second
driver is what turns that into a measurement — and the result is the useful
part: 31 scenarios pass unmodified against a CSMS that had no part in writing
them, 7 report a capability it does not have for OCPP 1.6, 5 are PARTIAL
because an OCA obligation exists that no scenario here exercises, and 4 stay
red because they found something. That two drivers this different need no
change to a single scenario is the claim the pair exists to support.

All 4 red ones are declared expected failures, so that sweep still exits 0 —
and would stop doing so the day one of them passes.

The 5 `PARTIAL` are worth reading rather than skipping. They are not a
CitrineOS result at all: they are the same on every driver, because the gap is
in our scenarios — see [`OCA-COVERAGE.md`](OCA-COVERAGE.md). Orange means the
suite did not ask, which is a different fact from red's "the CSMS answered
wrongly", and keeping them apart is what stops either from being noise.

## Quick start, against SteVe

Either bundled driver will do; SteVe is shown here because its environment is a
single container pair.
[`drivers/citrineos/README.md`](drivers/citrineos/README.md) is the equivalent
walkthrough for the other one.

```sh
bun add github:juherr/open-ocpp-tck#v0.3.0

export CSMS_DRIVER=open-ocpp-tck/drivers/steve
export STEVE_URL=http://localhost:8180/steve/manager
export OCPP_CP_IDS=CERTCP1,CERTCP2,CERTCP3

bunx ocpp-tck check-driver       # offline: no CSMS, no docker, no credentials

# A SteVe to point at, and the fixtures the scenarios assume.
docker compose -f node_modules/open-ocpp-tck/drivers/steve/compose.yaml up -d --wait
bunx ocpp-tck driver provision
bunx ocpp-tck driver selftest    # seconds: can the driver answer the contract?

bunx ocpp-tck run-all --group core
```

`run-all` is the whole suite: all 52 scenarios, one command. It did not use to
be — the `authorize` group (TC_023) sat outside `all`, so "no failures, 44
scenarios" read like a clean sweep while skipping exactly the three scenarios
that prove the fixtures took. Working in a clone, `bun run e2e` is that sweep
with a retry pass, and `bun run e2e:smoke` runs the handful that exercise
provisioning when a full sweep is too slow to iterate on.

`compose.yaml` pins [`ghcr.io/juherr/steve`][image] by digest — the `.war` is
built into the image and the schema migrates itself on boot, so there is
nothing to compile. `driver provision` then seeds what no scenario creates for
itself: the idTags TC_023 needs in three different states, and the two charging
profiles TC_056 and TC_066 assert on. It is idempotent, and
`ocpp-tck driver verify` answers the same question read-only.

`STEVE_URL` is `localhost` because the driver runs on your host, while the
simulator container reaches the same SteVe as `ws://steve:8180/...` from inside
the compose network. That asymmetry is why the two are separate settings.

[image]: https://github.com/juherr/steve-ocpp-csms-image

## Writing a driver for your CSMS

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

```ts
import { type CsmsDriverModule, assertNever } from "open-ocpp-tck/driver";

export const csmsDriver: CsmsDriverModule = {
  id: "acme",
  displayName: "Acme CSMS",
  scope: SCOPE,                        // what your CSMS can and cannot drive
  create(env) {
    return {
      operations16: { async execute(cpId, op) { /* switch (op.action) */ } },
      records: { /* what your CSMS believes happened */ },
    };
  },
};
```

```sh
CSMS_DRIVER=./index.ts bunx ocpp-tck check-driver
```

Nothing in this repository names your CSMS, and nothing needs to: `CSMS_DRIVER`
is a module specifier — a relative path, an absolute one, or a package name.
Adding a driver is purely additive, so it never conflicts with an upstream
re-sync, and your driver can live in a completely different repository.

## Commands

| Command | Needs | What it does |
|---|---|---|
| `ocpp-tck run <template-id>` | docker + CSMS | One scenario, plus its `results/<template-id>.log` and `.jsonl` wire trace |
| `ocpp-tck run-all [--group N] [--parallel]` | docker + CSMS | A sweep, plus `results/summary.md` |
| `ocpp-tck check-driver [--driver SPEC]` | nothing | Offline conformance of a driver against this core |
| `ocpp-tck list-scenarios [--json]` | nothing | The 52 registered scenarios |
| `ocpp-tck print-sim-image` | nothing | The pinned simulator image digest |
| `ocpp-tck driver selftest [--with-writes]` | CSMS | Every `CsmsRecords` method once, in seconds: does this driver answer the contract? `--with-writes` adds the `prepareStation` hook |
| `ocpp-tck driver <verb>` | driver-defined | A bootstrap verb your driver contributes |

Working in a clone, `bun run verify` runs everything CI checks before it starts
a container — typecheck, declarations, every driver scope check and every
offline guard — in one command with one exit code. It runs every step even after one fails,
because a rename usually breaks several at once. Shellcheck joins that list
only where it is installed, and is skipped with a notice where it is not; CI
always has it and always enforces it.

Both bundled drivers contribute the same three: `provision` (seed the fixtures,
idempotent), `verify` (read-only — are they there?), `teardown` (remove them).
A driver that needs no bootstrap contributes none, and the runner never calls
them during a scenario.

`check-driver` reads the driver **module** and never calls `create()`, so it
works with no credentials — which is the same property that lets a scenario
your CSMS cannot drive be reported `NOT APPLICABLE` before any container
starts. `scope` and `capabilities` may be functions of the environment, for a
CSMS whose supported release lines do not have the same table; they are
resolved with the same environment `create()` is given, so the table and the
requests always describe the same server.

## Verdicts

`PASS` / `FAIL` / `ERROR`, plus two that exist because "the CSMS is fine and
the check could not be evaluated" is a real outcome:

- **`NOT APPLICABLE`** — your scope table marks the scenario undrivable, or
  your driver threw `UnsupportedOperationError`. No container is started in the
  first case. Exit code 0.
- **`PARTIAL`** — zero failures, but at least one check degraded to `SKIPPED`,
  for one of two reasons the check's detail tells apart: a driver answered with
  `unverifiable("<why>")` instead of inventing a value, or the scenario does not
  exercise an obligation the OCA case puts on the CSMS (see
  [`OCA-COVERAGE.md`](OCA-COVERAGE.md)). The first varies per driver; the second
  is the same for every driver, because the gap is in our scenarios. Exit code 0.

`FAIL` and `ERROR` exit non-zero. A driver may declare a scenario
expected-failing, which excuses its `FAIL` — never its `ERROR`, and never a
declared scenario that stops failing. See below.

## Expected failures

A CSMS you know gets one scenario wrong should not cost you the signal from the
other 46. Declare it, and the sweep keeps running it, keeps printing `FAIL`,
and stops failing the build for it:

```ts
export const csmsDriver: CsmsDriverModule = {
  expectedFailures: {
    "cert16-tc023-3-authorize-blocked": {
      reason: "…the mechanism, cited…",
      finding: "…where the finding is written down…",
    },
  },
};
```

The scope row stays `DRIVABLE`. Demoting it to `NOT_APPLICABLE` instead would
convert a finding about your CSMS into a silence about the harness, and
`check-driver` rejects an id that is declared both ways.

**A declared scenario that passes fails the sweep**, reported as
`UNEXPECTED PASS`. That is the half that matters: it is how an entry gets
deleted the day upstream fixes the defect, instead of outliving it. There is
deliberately no "expected flaky" — a scenario that sometimes passes has a
timing bug, and the bug is the thing to fix.

**A declared scenario that `ERROR`s also fails the sweep**, as
`DECLARED, BUT ERRORED`. An entry excuses what a CSMS *answers*; an `ERROR` is
the scenario never getting an answer, and a green build there would be blind to
the kind of breakage the mechanism exists to catch.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `CSMS_DRIVER` | — | Module specifier of the driver. Required. |
| `OCPP_CP_IDS` | `CERTCP1` | Charge-point roster. Parallel lane count derives from it. |
| `OCPP_STATIONS` | — | `ocpp_id=station_id[,…]` when your CSMS addresses stations by an internal id. |
| `OCPP_TCK_RESULTS_DIR` | `./results` | Where logs and `summary.md` go. |
| `OCPP_TCK_DRIVERS_DIR` | `./drivers` | Only used to list candidates in an error message. |
| `SIM_WS_URL` | driver-supplied | CSMS OCPP endpoint. |
| `SIM_IMAGE` | pinned digest | Simulator image override. |
| `SIM_NETWORK`, `SIM_WS_APPEND_CP_ID`, `SIM_WS_BASIC_USER`, `SIM_WS_BASIC_PASS` | driver-supplied | Transport. |
| `SIM_OCPP_VERSION` | `OCPP-1.6J` | Protocol the charge point speaks, spelled as the simulator's CLI spells it. An unaccepted value is refused before a container starts. |
| `SIM_TRACE` | on | `0` switches off the JSONL wire trace written beside each scenario's log — for a docker that refuses the bind mount it needs. The trace is what the assertions read; without one they read the log, which the runner parses itself, and the verdicts are the same. |

An explicit `SIM_*` value always beats the driver's default: an operator
chasing a handshake problem must not have their override silently replaced.

## TypeScript

Supported `moduleResolution`: **`bundler`** (extend `open-ocpp-tck/tsconfig`
and you get it). `node16`/`nodenext` reject the extensionless relative imports
in the shipped declarations; `node` (node10) ignores `exports` entirely and
cannot resolve this package at all. Both are stated here rather than papered
over with a shim that would need keeping in sync.

## Provenance

`tck/` is partly vendored from [`shiv3/ocpp-cp-simulator`][sim] (Apache-2.0) at
a pinned commit. [`VENDOR.md`](VENDOR.md) records, per file, the upstream
digest, the local digest, and a patch — and `tests/vendor-integrity.sh`
*reverse-applies* each patch to check it still reconstructs the pinned upstream
bytes. Apache-2.0 §4(b) is therefore satisfied by a verified artifact rather
than by a claim in a file. See [`NOTICE`](NOTICE).

Files marked `local-upstreamable` in `VENDOR.md` are ours and intended for an
upstream pull request, which is why this repository is Apache-2.0 throughout
even where the code is new.

## Tests

```sh
bun install
bun run typecheck                 # tsc --noEmit
bun run check:driver:steve        # offline
bun run check:driver:citrineos    # offline
bun run check:driver:citrineos-v1 # offline, the other line the same driver declares
bun run test                      # vendor integrity, genericity, spec invariants, driver env
bash tests/types-current.sh       # committed declarations match the sources
bash tools/vendor-diff.sh         # network: how far upstream has moved
```

`tests/spec-invariants.sh` regenerates `tck/specs/ASSERT-INVENTORY.txt` and
`DRIVE-TRACE.txt` and diffs them against the committed copies. They exist so
that a change to what a scenario *measures* shows up as a readable diff in a
pull request — a digest would say only that something moved.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
