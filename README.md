# open-ocpp-tck

An OCPP 1.6 conformance TCK you point at **your** CSMS.

It brings a real charge point (the [`ocpp-cp-simulator`][sim] CLI, in a
digest-pinned container), drives it through 47 certification scenarios, parses
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

[sim]: https://github.com/shiv3/ocpp-cp-simulator
[octt]: https://openchargealliance.org/certificationocpp/certification-ocpp-1-6/

```
       your CSMS  <--- REST/UI/SQL ---  your driver  ---.
           ^                                            |  CsmsOperations
           |                                            |  CsmsRecords
        OCPP-J                                          v
           |                                     +--------------+
    ocpp-cp-simulator  <--- JSON Lines stdin ----|   ocpp-tck   |
      (docker, pinned)  ---- stdout wire log --->|   47 specs   |
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
| [`drivers/steve`](drivers/steve) | HTML manager UI + WebAPI + MariaDB | *Has the harness lost a capability?* SteVe is the CSMS the scenarios were originally written against, so a scope row that had to be demoted would mean the core dropped something. | All 47 `DRIVABLE` |
| [`drivers/citrineos`](drivers/citrineos/README.md) | JSON REST API + GraphQL | *Is the contract actually CSMS-neutral?* [CitrineOS](https://github.com/citrineos/citrineos-core) (LF Energy / S44) had no part in writing the scenarios and has a smaller OCPP 1.6 surface. | 39 `PASS`, 7 `NOT APPLICABLE`, 1 `FAIL` |

An abstraction with one implementation is neutral by assertion, so the second
driver is what turns that into a measurement — and the result is the useful
part: 38 scenarios pass unmodified against a CSMS that had no part in writing
them, 7 report a capability it does not have for OCPP 1.6, and 2 stay red
because they found something. That two drivers this different need no change to
a single scenario is the claim the pair exists to support.

## Quick start, against SteVe

Either bundled driver will do; SteVe is shown here because its environment is a
single container pair.
[`drivers/citrineos/README.md`](drivers/citrineos/README.md) is the equivalent
walkthrough for the other one.

```sh
bun add open-ocpp-tck            # or: bun add github:juherr/open-ocpp-tck#v0.1.0

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

A **full** sweep is two commands, not one: `run-all` covers 44 scenarios and the
`authorize` group (TC_023) sits outside `all`, so "no failures, 44 scenarios"
is not the whole suite — and TC_023 is what proves the fixtures took. Working in
a clone, `bun run e2e` runs both, and `bun run e2e:smoke` runs the handful that
exercise provisioning when a full sweep is too slow to iterate on.

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
      operations: { async execute(cpId, op) { /* switch (op.action) */ } },
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
| `ocpp-tck run <template-id>` | docker + CSMS | One scenario |
| `ocpp-tck run-all [--group N] [--parallel]` | docker + CSMS | A sweep, plus `results/summary.md` |
| `ocpp-tck check-driver [--driver SPEC]` | nothing | Offline conformance of a driver against this core |
| `ocpp-tck list-scenarios [--json]` | nothing | The 47 registered scenarios |
| `ocpp-tck print-sim-image` | nothing | The pinned simulator image digest |
| `ocpp-tck driver selftest [--with-writes]` | CSMS | Every `CsmsRecords` method once, in seconds: does this driver answer the contract? `--with-writes` adds the `prepareStation` hook |
| `ocpp-tck driver <verb>` | driver-defined | A bootstrap verb your driver contributes |

Working in a clone, `bun run verify` runs everything CI checks before it starts
a container — typecheck, declarations, both driver scopes and the three guards
— in one command with one exit code. It runs every step even after one fails,
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
starts.

## Verdicts

`PASS` / `FAIL` / `ERROR`, plus two that exist because "the CSMS is fine and
the check could not be evaluated" is a real outcome:

- **`NOT APPLICABLE`** — your scope table marks the scenario undrivable, or
  your driver threw `UnsupportedOperationError`. No container is started in the
  first case. Exit code 0.
- **`PARTIAL`** — zero failures, but at least one check degraded to `SKIPPED`
  because a driver answered with `unverifiable("<why>")` instead of inventing a
  value. Exit code 0.

Only `FAIL` and `ERROR` exit non-zero.

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
bun run check:steve-driver       # offline
bun run check:citrineos-driver    # offline
bun test                          # vendor integrity, genericity, spec invariants
bash tests/types-current.sh       # committed declarations match the sources
bash tools/vendor-diff.sh         # network: how far upstream has moved
```

`tests/spec-invariants.sh` regenerates `tck/specs/ASSERT-INVENTORY.txt` and
`DRIVE-TRACE.txt` and diffs them against the committed copies. They exist so
that a change to what a scenario *measures* shows up as a readable diff in a
pull request — a digest would say only that something moved.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
