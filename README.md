# open-ocpp-tck

An OCPP 1.6 conformance TCK you point at **your** CSMS.

It brings a real charge point (the [`ocpp-cp-simulator`][sim] CLI, in a
digest-pinned container), drives it through 47 certification scenarios, parses
the OCPP-J frames both directions, and asserts on the captured wire log. What
it does *not* bring is any knowledge of your CSMS: telling it "reset this
charge point" is a **driver**, and a driver is one file you write.

[sim]: https://github.com/shiv3/ocpp-cp-simulator

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

## Quick start, against the reference driver

SteVe is the CSMS these scenarios were originally written against, so its
driver ships here as the reference implementation.

```sh
bun add open-ocpp-tck            # or: bun add github:juherr/open-ocpp-tck#v0.1.0

export CSMS_DRIVER=open-ocpp-tck/drivers/steve
export STEVE_URL=http://steve:8180/steve/manager
export STEVE_WS_URL=ws://steve:8180/steve/websocket/CentralSystemService
export OCPP_CP_IDS=CERTCP1,CERTCP2,CERTCP3

bunx ocpp-tck check-driver       # offline: no CSMS, no docker, no credentials
bunx ocpp-tck run-all --group core
```

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
| `ocpp-tck driver <verb>` | driver-defined | A bootstrap verb your driver contributes |

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
bun run check:reference-driver    # offline
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
