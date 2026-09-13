# Vendor manifest

Upstream: <https://github.com/shiv3/ocpp-cp-simulator> (Apache-2.0).
Pinned commit: **`604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1`** (`main`, authored
2026-07-31 11:59:04 +0900). Imported 2026-07-31.

Upstream ships **no `NOTICE` file** at that commit (verified 2026-07-31:
`ls /tmp/ocpp-upstream/NOTICE` → absent, only `LICENSE`). Apache-2.0 §4(d) —
"reproduce the attribution notices contained within such NOTICE file" —
therefore imposes nothing here. Re-check this on every re-import: the refresh
procedure below does it.

## Upstream decision: the runner layer is forked, not vendored

Upstream agreed in [shiv3/ocpp-cp-simulator#271](https://github.com/shiv3/ocpp-cp-simulator/issues/271)
that the certification runner — `scripts/steve-verify/runner/` and the
assertion helpers it re-exports — belongs here, and that upstream keeps the
generic charge-point machinery (scenario engine, `inboundPolicy`, quirks,
assertions and reports, the `cert16-*` templates) and will retire its own copy
of the runner. From that point the files this repository had been *patching*
are files it *owns*: they are maintained here, they no longer track upstream,
and a change to one of them is an ordinary edit rather than a re-pin.

What that changes in this manifest:

- Every `upstream-patched` row became `upstream-forked`. The row still names
  the upstream path and the digest upstream shipped at the fork point — that
  is the provenance Apache-2.0 §4(b) rests on — but carries no local digest
  and no patch, because there is no upstream original left to diff against.
- `patches/` is gone. Its two jobs were a verifiable §4(b) record and a
  mechanically applicable upstream pull request; the second no longer exists,
  and the first is now the `Derived from … @ <commit>` header on the file's
  first lines, which `tests/vendor-integrity.sh` checks per row.
- `upstream-verbatim` rows are unchanged. `tck/ocpp.ts` and `tck/util.ts`
  are copies of modules upstream keeps, and stay pinned and re-importable
  until upstream exports them from its package.

### Fork commit: `604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1`

**Frozen, and deliberately a separate fact from `Pinned commit` above.** The
pin is where the `upstream-verbatim` rows were last imported from, and it
moves whenever they are re-imported. The fork commit is where this repository
stopped tracking upstream for the forked files, and it never moves — a file
does not become forked at a later commit because an unrelated file was
re-imported. `tests/vendor-integrity.sh` validates every forked file's
`Derived from … @ <commit>` header against **this** line, so a future re-pin
changes one and leaves the other alone instead of putting the two rules in
conflict.

Today the two happen to name the same commit, which is exactly why they are
written out separately: a single line serving both purposes would look
correct until the first re-import and could not be told apart afterwards.

## File inventory

Every file under this subtree has exactly one row. The schema separates two
facts that a single digest column cannot tell apart:

- **`upstream sha256`** — what upstream shipped. Changes only on re-import.
- **`local sha256`** — what we ship. Changes on every deliberate edit.
- **`patch`** — the difference between them, *mechanically verifiable*:
  `tests/vendor-integrity.sh` reverse-applies it to the local file
  and checks the result hashes to the upstream digest. A patch that rots, gets
  truncated by a whitespace hook, or describes a different edit than the one
  shipped, fails the build instead of quietly satisfying Apache-2.0 §4(b) on
  paper only.

| origin | upstream path | upstream sha | local sha | patch |
|---|---|---|---|---|
| `upstream-verbatim` | required | required, **==** local | required | forbidden |
| `upstream-patched` | required | required, **!=** local | required | required, must reverse-apply |
| `upstream-forked` | required | required (the fork point) | `—` | `—` |
| `local-native` | `—` | `—` | `—` | `—` |
| `local-private` | `—` | `—` | `—` | `—` |

`upstream-forked` rows pin the **past**, not the present: the upstream digest
is what upstream shipped at the fork commit, frozen so the fork point stays a
checkable fact, and the file itself is edited freely. **Where it is checked
matters.** A patched row's digest is verifiable offline, because reversing its
patch has to reproduce it; a forked row has no patch, so
`tests/vendor-integrity.sh` can only confirm the digest is shaped like one.
Correlating it with the fork commit needs the upstream bytes, so
`tools/vendor-diff.sh` does it — it fetches that commit and re-hashes every
forked row's original. Run it when the provenance itself is in question; the
offline guard stays deterministic and network-free. What the guard holds
them to is attribution, in three parts: the file's first three lines must
carry `Derived from shiv3/ocpp-cp-simulator <upstream path> @ <fork commit>`
**and a `Modified:` clause** — Apache-2.0 §4(b) asks for the change to be
stated, and with `patches/` gone that sentence is the only place it is — the
notice must survive into `types/**/*.d.ts`, and `NOTICE` must list the file.
Nothing else about a forked file is pinned.

`local-*` rows pin **nothing**, deliberately. Pinning a file under active
development turns re-pinning into a reflex, and a reflex re-pin is exactly how
a spec digest gets bumped without anyone reading the diff. The integrity check
must stay a rare, loud signal.

`local-native` vs `local-private` is the distribution boundary made
machine-readable: `local-native` files are this repository's own — written
here, maintained here, published in this package — and `local-private` files
never leave the repository they sit in. Every row here is currently
`local-native`: a driver for a private CSMS lives in its own repository and
depends on this one as a package, which is the strongest available
demonstration that the core names no CSMS.

The origin was called `local-upstreamable` while the runner was a patch set
against `shiv3/ocpp-cp-simulator` and these files were queued for an upstream
pull request. With the runner layer ceded to this repository
([shiv3/ocpp-cp-simulator#271](https://github.com/shiv3/ocpp-cp-simulator/issues/271))
there is no such queue: the driver contract, the scope and standing tables and
the drivers are native here, and the name now says so.

| path | origin | upstream path @ `604054a…` | upstream sha256 | local sha256 | patch |
|---|---|---|---|---|---|
| `tck/spec-types.ts` | `upstream-forked` | `scripts/steve-verify/runner/spec-types.ts` | `db4b29ab5ee0c623c950a52a999ef4e4c0a916dab0b6cfebe8fa8eabc5da0d26` | `—` | `—` |
| `tck/util.ts` | `upstream-verbatim` | `scripts/steve-verify/runner/util.ts` | `ba62ed29c79e04533e0725739c9c0d514caadb7bff8146e46688c867432eee9e` | `ba62ed29c79e04533e0725739c9c0d514caadb7bff8146e46688c867432eee9e` | `—` |
| `tck/ocpp.ts` | `upstream-verbatim` | `src/cp/application/verification/ocpp.ts` | `a3f99c1b77b30d0ab0b22556b65aca05332d68f4b4b8d566a500d2036065368f` | `a3f99c1b77b30d0ab0b22556b65aca05332d68f4b4b8d566a500d2036065368f` | `—` |
| `tsconfig.json` | `upstream-verbatim` | `scripts/steve-verify/runner/tsconfig.json` | `b632b69c836000d80209c183b57d43ac917e3a1d50f042af65112bdf234d1931` | `b632b69c836000d80209c183b57d43ac917e3a1d50f042af65112bdf234d1931` | `—` |
| `tck/specs/core.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/core.ts` | `ef26b803ffee2d2fa5d809ebb2e066475ed33cb7fd527aeb43d5b416566f0125` | `—` | `—` |
| `tck/specs/authorize.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/authorize.ts` | `aaf1c5f2b4888df41cd1f0b8637b47eedc376ff2d61d29841d3668d26b66e7da` | `—` | `—` |
| `tck/specs/authlist-reservation.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/authlist-reservation.ts` | `3ee302032025a889053d108d0813cc644819e58879b6cd554d56f85b804d0cd6` | `—` | `—` |
| `tck/specs/remotetrigger-smartcharging.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/remotetrigger-smartcharging.ts` | `f0d2b720c8b6343d08e2506f4d6e4fcbf68069bb586e5bfea841ca9e37fdbca2` | `—` | `—` |
| `tck/specs/firmware.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/firmware.ts` | `e1bc6c288fe5c56e2cceae6f4ea650e901d852637ecdec914fc7ccdbdd5d1fe8` | `—` | `—` |
| `tck/specs/index.ts` | `upstream-forked` | `scripts/steve-verify/runner/specs/index.ts` | `be8595765f4d66965bfd58498622c26a696962fabae8a2700f080ae5cd55d832` | `—` | `—` |
| `tck/assert.ts` | `upstream-forked` | `src/cp/application/verification/assert.ts` | `2431f5f6c0df997d4d821d9af55689c1f0f2df199de1e9e4ed6f3fbaad4fc89e` | `—` | `—` |
| `tck/sim.ts` | `upstream-forked` | `scripts/steve-verify/runner/sim.ts` | `2bf2f78afe3434e7139cd62c3ff6d70f02defd39dd700611e7c5f7614260cd35` | `—` | `—` |
| `tck/main.ts` | `upstream-forked` | `scripts/steve-verify/runner/main.ts` | `a757b0d35d29c7627336c0e858ad7d2f305a33c0acad819b5296f3847382f4e2` | `—` | `—` |
| `tck/driver.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/index.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/driver-registry.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/capabilities.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/scope.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/expected.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/standing.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/shard.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/certificate-material.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/readiness.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/op-warn.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/time.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/trace.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/unverifiable.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/wait.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/states-201.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/template-once.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `bin/ocpp-tck.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/core-201.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/ASSERT-INVENTORY.txt` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/DRIVE-TRACE.txt` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/OCA-OBLIGATIONS.txt` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/OCA-201-SLICE.txt` | `local-native` | `—` | `—` | `—` | `—` |
| `tck/specs/OCA-201-OPERATIONS.txt` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/index.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/forms.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/records.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/api-client.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/ui-client.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/scope.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/steve/provision.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/index.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/config.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/api-client.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/graphql-client.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/http.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/requests.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/profiles.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/redelivery-loops.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/records.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/scope.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/expected.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/variant.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/provision.ts` | `local-native` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/device-model.ts` | `local-native` | `—` | `—` | `—` | `—` |

Deliberately **not** imported from upstream: `steve-api.ts` (SteVe 3.13.0 REST
client, 763 lines), `capability-probe.ts` (probes a live SteVe container),
`__tests__/` (upstream's own bun tests — this repo writes its own),
`01-setup-steve.sh` / `02-provision.sh` / `99-teardown.sh` / `lib.sh` /
`README.md` (SteVe environment bootstrap).

The bootstrap scripts have a replacement rather than a port:
`drivers/steve/compose.yaml` plus `drivers/steve/provision.ts`, reachable as
`ocpp-tck driver provision|verify|teardown`. It is not a translation of
upstream's shell — it seeds through SteVe's WebAPI where that works, and the
image builds the `.war` at build time, so there is no equivalent of
`01-setup-steve.sh`'s compile step to port at all.

### Provenance note — upstream's re-export shims

Upstream `scripts/steve-verify/runner/assert.ts` and
`scripts/steve-verify/runner/ocpp.ts` are 6- and 10-line files whose entire
body is `export * from "../../../src/cp/application/verification/<module>"`.
Copying those shims verbatim would import nothing. The **implementations** in
`src/cp/application/verification/` are what is vendored here, under the
`runner/` filenames the specs import — which is why those two rows cite a
`src/…` upstream path while every other row cites `scripts/steve-verify/…`.

## Editing a vendored file

An `upstream-forked` file is edited like any local file: keep its first-line
`Derived from …` header, and the guard is satisfied. Nothing to re-pin.

Changing an `upstream-patched` file — there are none today, the origin stays
defined for a file that is patched again — means its patch and its local
digest must change with it, in that order — and the one way to get it wrong is to record
the digest and then touch the file again. One command does both:

```sh
tools/repin-vendored.sh <path>          # e.g. tck/ocpp.ts, once it is patched
```

`<path>` has to be a row the script can act on: `upstream-verbatim` or
`upstream-patched`. It **refuses an `upstream-forked` path by name** — those
are maintained here and pin nothing — so `tools/repin-vendored.sh tck/main.ts`
is not a working example any more, and the only two paths it accepts today are
`tck/ocpp.ts` and `tck/util.ts`.

It reconstructs the upstream bytes by reverse-applying HEAD's patch to HEAD's
copy of the file, refuses unless that reconstruction matches the `upstream
sha256` frozen below, then writes the new patch and rewrites that row's local
digest. It ends by running the guard, so a re-pin that did not hold says so.

The same command handles the other direction, `upstream-verbatim` →
`upstream-patched`. There the upstream bytes are HEAD's copy of the file, since
that is what verbatim means, and the script writes the patch, flips the row's
origin and fills its patch cell. It leaves exactly one thing: `NOTICE` lists
every modified file with *what* was modified, and that sentence is editorial.
The guard cross-checks that list against these rows and fails until it is
there.

## Refresh procedure

Moving the PIN, which is the other direction: upstream changed, and every row
has to follow.

```sh
git clone --filter=blob:none https://github.com/shiv3/ocpp-cp-simulator /tmp/ocpp-upstream
cd /tmp/ocpp-upstream && git checkout <new-sha>

# 1. Apache-2.0 §4(d): does upstream now ship a NOTICE file?
#    If it appears, its attribution notices must be reproduced in our NOTICE
#    under a clearly delimited "Upstream NOTICE" section.
test -f NOTICE && echo "ACTION REQUIRED: reproduce upstream NOTICE"

# 2. Re-copy every `upstream-verbatim` file, re-apply every patch, then update
#    BOTH digest columns of every upstream-verbatim / upstream-patched row.
#    `upstream-forked` rows are NOT refreshed: their upstream digest and the
#    `Fork commit` heading above are the fork point, which does not move. Only
#    `Pinned commit` follows a re-import.
shasum -a 256 /tmp/ocpp-upstream/<upstream path>          # → upstream sha256
shasum -a 256 <path>                   # → local sha256

# 3. Regenerate every patch (none today) so it still reconstructs the new
#    upstream bytes. patches/ does not exist while no row is patched, and the
#    redirect will not create its parent:
mkdir -p "$(dirname "patches/<path>.patch")"
diff -u /tmp/ocpp-upstream/<upstream path> <path> > patches/<path>.patch

# 4. The guard proves steps 2 and 3 were done consistently:
bash tests/vendor-integrity.sh
```

`bash tools/vendor-diff.sh` does the network-side comparison against upstream
`main`. It must **never** be added to the offline test suite, which stays
deterministic and network-free.

## Simulator container image

| field | value |
|---|---|
| image | `ghcr.io/shiv3/ocpp-cp-simulator` |
| tag resolved | `0.7.12` |
| digest | `sha256:b94ee6c78e3976943a268ce68e6095564db1f048d049ea020cb204b2d826504b` |
| digest kind | multi-arch OCI image index (selects the `linux/amd64` or `linux/arm64` manifest automatically) |
| resolved on | 2026-09-12, with `docker buildx imagetools inspect ghcr.io/shiv3/ocpp-cp-simulator:0.7.12` |
| declared in | `tck/sim.ts` (`DEFAULT_SIM_IMAGE`), overridable with `SIM_IMAGE` |

Verified on that digest:

- `docker run --rm <image> --help` prints the CLI usage (exit 0), so the
  image really does ship the CLI — no repo bind-mount is needed.
- `--basic-auth-user` / `--basic-auth-pass` (outgoing CP → CSMS WebSocket)
  exist in that usage output.
- The image's **default entrypoint cannot be used** for this harness: it
  appends `--http-host 0.0.0.0 --unsafe-remote --web-console $HTTP_PORT`,
  which switches the CLI into daemon/web-console mode (auto-connects, emits
  `[server] …` lines, no JSON Lines event stream on stdout). `sim.ts`
  therefore passes `--entrypoint bun` and runs `src/cli/main.ts` from the
  image's own embedded sources. Upstream's `docker/entrypoint.sh` is where
  that bundle is composed; it was re-read at `v0.7.12` and the `[server] …`
  lines observed again on this digest.

### Moving this pin

The pin has moved three times, all on 2026-09-12: `0.7.5` (resolved
2026-07-31) to `0.7.9`; to `0.7.10` once upstream shipped the
`TransactionEvent` parameters (its #350); to `0.7.12` once a tag with an
image existed again. What was read before each move is the checklist for the
next one. Two of the facts below are about the source pin rather than the
image, and they are here because a simulator release is the moment someone
asks whether the source pin should follow it:

- **A release page is not a registry.** `v0.7.11`'s image build failed
  upstream -- the `ui` stage did not copy a tsconfig the root one references
  (its #353) -- so the registry never had a `0.7.11` tag, and `:latest` was a
  `0.0.0` development build. Resolve the digest before reading the notes; a
  tag that resolves to nothing is a pin nobody can pull. `0.7.12` is `0.7.11`
  plus that Dockerfile fix, and `0.7.11` over `0.7.10` is a behaviour-neutral
  move of the charging-curve interpolator plus a fleet benchmark, k6 export
  and docs.
- **The `upstream-verbatim` rows did not need a re-import.** `tck/ocpp.ts`,
  `tck/util.ts` and `tsconfig.json` hash at `v0.7.10`, `v0.7.11` and
  `v0.7.12` to the digests in the inventory above, byte for byte, so
  `Pinned commit` stayed where it was. The
  image and the source pin name different commits by design -- the image is
  what a sweep runs, the source pin is where three files were copied from --
  and the first bump is the one that establishes that they may differ.
- **The wire the runner reads did not change.** Read from upstream's diff
  between the pinned source commit and the tag, then confirmed on the digest:
  the JSON Lines commands `sim.ts` and the specs send (`connect`,
  `start_transaction`, `stop_transaction`, `authorize`, `heartbeat`,
  `send_meter_value`, and the scenario commands `tck/template-once.ts`
  sequences) and the `scenario_started` event are intact and the additions are
  new commands and OPTIONAL members only -- `0.7.10` gives
  `start_transaction` a `triggerReason` and a `chargingState`,
  `stop_transaction` a `reason` and a `triggerReason`, `send_meter_value` a
  `context`, and adds `transaction_event`, which is what the OCPP 2.0.1 cases
  behind issue #114 were waiting for and what the next tranche of
  `cert201-` scenarios drives; the auto-start walker still skips
  `enabled === false` and `run_scenario` still does not consult it, so the
  sequence in `tck/template-once.ts` holds; the CLI flags `buildDockerArgs`
  emits are in `--help` unchanged, with the same six `--ocpp-version` values
  `SIM_OCPP_VERSIONS` spells; the Logger's `Sent:`/`Received:` line format
  `tck/ocpp.ts` parses has no diff; the trace record `tck/trace.ts` reads is
  still schema v1.1; and the `cert16-*` / `cert201-*` scenario templates
  under `src/utils/scenarios/` have no diff.
- **The one change that needed a runner edit, and it was not in the diff
  read -- the sweep found it.** From 0.7.6 (upstream #253) a loaded
  `triggerOn: "connect"` scenario re-arms on every reconnect, so a completed
  template runs again when the station comes back: TC_013 re-authorised and
  opened a second transaction after its `Reset(Hard)`, and its DB check read
  the newest transaction, still open, as `stop_reason ''`. The runner no
  longer sends `run_scenario_template`; `tck/template-once.ts` loads the
  instance disabled before `connect` and starts it with an explicit
  `run_scenario`, which is upstream's documented run-once shape. The lesson
  for the next move is the method: the diff of the commands the runner sends
  was read and was clean, and the rule that broke lives in the scenario
  engine those commands drive -- read `docs/concepts/scenario-format.md`'s
  behaviour notes too, and run the reconnecting scenarios before the sweep.
- **What else changed, and why none of it needs a runner edit.** A station
  now logs a warn line when a CSMS-initiated `RemoteStartTransaction` was
  handled by its default path before the scenario's trigger node armed (the
  opt-in that closes that race is on the daemon's `run_scenario` RPC, not in
  JSON mode); a refused WebSocket handshake is replayed once as a plain GET
  and its status logged; `MeterValues` samples on the default path are
  bounded by the active charging schedule, and the charging-curve EV model
  behind them is opt-in (`chargingCurve` is absent from `defaultEVSettings`)
  -- no scenario here asserts a sample's value. Upstream's boot-gate
  key-order fix (its #262) was already in `tck/main.ts`.
- **Still no `NOTICE` file upstream** at `v0.7.12`.

## CSMS container images

Not vendored code — the environment `drivers/steve/compose.yaml` brings up so
that the SteVe driver can be exercised. Pinned by digest for the same
reason as the simulator: these tags are republished in place, and a
conformance run that cannot name the bytes it tested proves nothing.

| field | value |
|---|---|
| image | `ghcr.io/juherr/steve` |
| tag resolved | `steve-3.14.1` |
| digest | `sha256:c3fbfcc3f220dc63c13c4accbab7a90757984c1902af2c9e4233bedcc3675400` |
| image | `mariadb` |
| tag resolved | `11.8` |
| digest | `sha256:d9f7eb2637296652f24b484afd5d246f759f49f5babcadc6a9e344c9acb75fbf` |
| resolved on | SteVe 2026-09-12, MariaDB 2026-08-11, from the registry manifest `Docker-Content-Digest` |
| declared in | `drivers/steve/compose.yaml` |

### Validation history

Which SteVe releases the driver has actually been run against, and
what happened. A row is added only for a **full** run — `run-all --parallel
--retry-failed-isolated` plus the separate `--group authorize` sweep — never
for a version that was merely booted.

The point of keeping the superseded rows is that the current pin's green run
says nothing about range. Two independent versions passing unchanged is the
evidence that the driver targets SteVe rather than one build of it, and it is
what makes a rollback a known quantity instead of a guess.

Keep this table at five columns. `tests/vendor-integrity.sh` selects the file
inventory structurally, by row width — any six-column table in this file is
read as a vendored-file row and fails the build.

| SteVe | digest | validated | `all` (44) | `authorize` (3) |
|---|---|---|---|---|
| `steve-3.14.1` — **current pin** | `sha256:c3fbfcc3…` | 2026-09-12 | 47 OCPP 1.6 scenarios in one `run-all` (`authorize` folded in): 40 PASS, 5 PARTIAL, 0 FAIL; 2 parallel-only flakes (`tc003`, `tc004`) PASS on isolated retry — 42 PASS counting it. The 5 PARTIAL are the same five SKIPPED checks the 3.14.0 pin reports the same day on CI (`tc001`, `tc010`, `tc011`, `tc054`, `tc059`), so the verdict set is unchanged | in the sweep: 3 PASS |
| `steve-3.14.0` | `sha256:aa56949a…` | 2026-08-11 | 44 PASS, 0 PARTIAL, 0 N/A; 1 parallel-only flake (`tc013-hard-reset`) PASS on isolated retry | 3 PASS |
| `steve-3.13.0` | `sha256:a1e6647d…` | 2026-08-11 | 44 PASS, 0 PARTIAL, 0 N/A; 1 parallel-only flake (`tc014-soft-reset`) PASS on isolated retry | 3 PASS |

None of the three versions needed a single line of driver or provisioner
change — that is the column that would have mattered most, and it is uniform,
so it is stated here rather than repeated per row. The 3.14.1 row's PARTIALs
are not a regression against the 3.14.0 row's zero: the suite grew SKIPPED
checks between the two dates, and the same five rows are PARTIAL on 3.14.0 in
that day's CI run.

3.14.1 is a security release (steve-community/steve#2102, `StopTransaction`
now validates its `idTag`, GHSA-67fq-r6rm-rqpm) on Java 25; the provisioner's
four bullets below were re-measured against it before the pin moved — the
three missing controllers still answer 403, `ocppTags` and `transactions`
answer 200 with their filters, a past `expiryDate` is still refused 400, and
`web_user.api_password` still gates the WebAPI — and `driver selftest`
answered all 12 record calls.

Every flake in the table was parallel-lane interference, not CSMS behaviour:
each passed on the isolated sequential retry, and they were different
scenarios on every run. That is the pattern `--retry-failed-isolated` exists
for.

Moving this pin is not a version bump — every statement below is what the
provisioner is built on, so each was re-measured against the running container
before each move (3.14.0 on 2026-08-11, 3.14.1 on 2026-09-12). All of them
still hold, and held identically on 3.13.0:

- SteVe's WebAPI exposes `ocppTags`, `operations` and `transactions` — and
  nothing else. Probed on this digest: `chargePoints`, `reservations` and
  `chargingProfiles` all answer **403**, because no such controller exists.
  That is why provisioning uses three channels and not one, and why the SQL
  channel is exactly the list of endpoints SteVe does not have. This is the
  bullet most likely to change: [steve-community/steve#2069][sc2069] proposes
  charging-profile CRUD, and would let the UI channel fold into REST.
- `GET /api/v1/transactions` serves the observations the scenarios assert on:
  the `Transaction` DTO carries `id`, `ocppIdTag`, `startTimestamp`,
  `stopTimestamp`, `stopReason` and `stopEventActor`, and
  `TransactionQueryFormForApi` filters by `chargeBoxId`, `ocppIdTag`,
  `transactionPk` and `type=ACTIVE` with **no** default date window (its
  constructor sets `periodType = ALL`). All four filters were exercised against
  a real transaction on this digest. `PATCH /transactions/{pk}/stop` closes a
  transaction **without touching the wire** — `TransactionService#stop` writes
  the stop row with `eventActor = manual` and returns early if it is already
  stopped — which is what the stale-transaction hook needs, since the charge
  point that opened it is gone. An earlier revision of `records.ts` claimed the
  API exposed no `stop_reason` and read everything from MariaDB; that claim was
  wrong on 3.13.0 and 3.14.0 alike.
- `POST /api/v1/ocppTags` with a past `expiryDate` is rejected **400**:
  `OcppTagForm.expiryDate` carries `@Future`. The manager UI binds the same
  form object, so it refuses it too — hence the one SQL write in
  `provision.ts`. That write dates `CERT023-EXP` from MariaDB's own clock at
  provisioning time, not from a fabricated historical date, which is what
  [steve-community/steve#2100][sc2100] settled on: a `PATCH
  /ocppTags/{pk}/expire` endpoint expiring with `now()`. If it lands, the SQL
  write folds into REST and the fixture keeps the same meaning.
- API access is off until `web_user.api_password` (bcrypt, distinct from the
  UI password) is set, and SteVe reads that column once at startup. There is
  still no environment variable for it, so `provision` writes it and restarts
  the container — once; it probes first and skips when already on.
  [steve-community/steve#2075][sc2075] (manager and API account CRUD) and
  [#2059][sc2059] (a Web UI for those accounts) are what would end it.

Every remaining database access in `drivers/steve/` is one of these four gaps,
and nothing else — which is the property to preserve when editing that driver:

| what needs the database | upstream ticket |
|---|---|
| write a past `expiry_date` | [#2100][sc2100] |
| turn the WebAPI on (`web_user.api_password`) | [#2075][sc2075], [#2059][sc2059] |
| read reservation status; teardown's reservation guard | [#2074][sc2074] |
| create, verify and remove charging profiles | [#2069][sc2069] |

All four sit under the [#1000 "Meta - API Endpoint"][sc1000] umbrella. The
CitrineOS driver has no such table because it has no such tickets: issues are
disabled on `citrineos/citrineos-core`, and its missing Authorization CRUD is
unreported rather than pending.
- The `chargingProfiles/add` form binds the same field names, including the
  indexed `schedulePeriods[N].powerLimit`.
- Unknown idTags are **not** auto-inserted on Authorize, which is what makes
  `CERT023-INV` stay absent across runs and TC_023.1 repeatable.

To move the pin: re-measure the bullets above against the new container, run
both sweeps, then update the pin table **and add a validation-history row**.
Add the row from an actual run — a row nobody ran is worse than no row, because
it converts an untested version into apparent evidence.

`drivers/steve/` names no SteVe version, on purpose: a driver targets a CSMS,
not a release of one, and a version written into the driver is a claim nothing
re-checks. This table is the single place a bump is a reviewable edit — so it
is also the place that has to carry the re-measurement above.

The one driver claim that is version-sensitive without being version-stamped is
the manager-UI-over-REST rationale in `drivers/steve/index.ts`. It is pinned by
a scenario rather than by a version number: TC_052 is the reason it exists, and
TC_052 passes on this digest. If TC_052 ever regresses, read that header first.

[sc2069]: https://github.com/steve-community/steve/issues/2069
[sc2074]: https://github.com/steve-community/steve/issues/2074
[sc2075]: https://github.com/steve-community/steve/issues/2075
[sc2100]: https://github.com/steve-community/steve/issues/2100
[sc1000]: https://github.com/steve-community/steve/issues/1000
[sc2059]: https://github.com/steve-community/steve/issues/2059

### CitrineOS

The second driver's environment, pinned on the same terms. Same two-column
shape as the table above, for the same structural reason: a six-column table
anywhere in this file is read as a vendored-file row.

| field | value |
|---|---|
| image | `ghcr.io/citrineos/citrineos-server` |
| tag resolved | `v2.0.0-beta3` |
| digest | `sha256:ddd8e98791b4f75523cf6a2aa3fd7cc35bd15bfb019d1461200e2c2e65462fd5` |
| image | `postgis/postgis` |
| tag resolved | `16-3.5` |
| digest | `sha256:4e07b425403ba55c20b541884db2e80c686dd6476bf9265046ac9c163895605d` |
| image | `rabbitmq` |
| tag resolved | `3-management` |
| digest | `sha256:e582c0bc7766f3342496d8485efb5a1df782b5ce3886ad017e2eaae442311f69` |
| image | `hasura/graphql-engine` |
| tag resolved | `v2.40.3` |
| digest | `sha256:679fb764590e848e59ab6b82b3e906cc46f87d776f869f49132ca728660df244` |
| resolved on | CitrineOS 2026-09-05, the rest 2026-08-11, from the registry manifest `Docker-Content-Digest` |
| declared in | `drivers/citrineos/compose.yaml` |

A **prerelease**, which is the one thing here that needs defending. The OCPP
1.6 `getLocalListVersion` and `sendLocalList` message endpoints exist only from
the v2 line, and six scenarios need them. Pinning by digest is what makes
depending on a moving tag safe — the alternative is `v1.9.1`, whose cost is
spelled out in `drivers/citrineos/README.md`.

WHY beta3 RATHER THAN beta1, and it is why a pin moved rather than a tidy-up:
citrineos-core#830 replaced a trigger that ran entirely `BEFORE INSERT`, whose
CALL branch back-filled `requestMessageId = NEW.id` on a row that did not exist
yet. Postgres checks the foreign key at the end of that UPDATE, so every CALL
arriving after its own response killed the dispatcher — and this suite measured
it: 53 events across 43 of 92 archived CitrineOS artifacts, every one at
`ocpp_correlate_message()` line 44, SteVe zero. The migration that fixes it is
absent at beta1 and byte-identical at beta2, beta3 and `main`. Issue #97 is
what it cost: a swallowed response reported as an unanswered request, which is
a conformance finding against a CSMS that answered.

The statements the driver is built on, each read from citrineos-core at
`v2.0.0-beta3` and cross-checked at `v1.9.1` and `main`. Re-check them before
moving the pin — several are the difference between a driver and a fiction.
They were re-read when the pin moved, on evidence rather than on the version
number: all four `modules/*/src/module/1.6/MessageApi.ts` blobs are
byte-identical between beta1 and beta3, so the endpoint counts below carried
over unchanged:

- **No `@AsMessageEndpoint` binds `ReserveNow` or `CancelReservation` to
  `OCPPVersion.OCPP1_6`.** Confirmed against the running container, whose
  `/docs/json` advertises 18 `/ocpp/1.6/` paths with neither among them. Seven
  scenarios are `NOT_APPLICABLE` because of this one fact.
- `AuthorizeRequestOcpp16Handler` reaches its status mapper **only** through
  the `status === 'Accepted'` branch, and consults `cacheExpiryDateTime` inside
  it. So `CERT023-EXP` is provisioned `Accepted`-with-a-past-expiry, and a
  stored `Blocked` answers `Invalid`.
- The container registers `authorizers: asValue([])` with no setting that
  changes it, which is what makes `Blocked` unreachable.
- More than one `Authorizations` row for an idToken makes that handler answer
  `Invalid` outright — the invariant `provision` upserts for and `verify`
  counts.
- **The data API this driver reads and seeds through is Hasura, not REST.**
  Probed on this digest: `/data/*` carries 22 routes, none of them touching
  `Authorizations`, and the one transaction route requires the `transactionId`
  it should help find (400 without it) while returning `authorizationId`
  rather than the idTag. `sendLocalList` answers `"Authorization not found for
  idTag '…' (create the Authorization before adding it to a local auth list)"`
  — an instruction with no REST route behind it. GraphQL is what CitrineOS's
  own shipped `packages/ocpi-base`, operator UI and e2e fixtures use, and its
  compose starts `graphql-engine` ungated while gating the UI and OCPI server
  behind `profiles:`. The `v2.40.3` pin above is the plain image, NOT upstream's
  `.cli-migrations-v3` one: nothing of their metadata is vendored here, and
  `driver provision` tracks the tables through the metadata API instead.
- **Four foreign keys reference `Authorizations`** and none cascades:
  `Transactions.authorizationId`, `LocalListAuthorizations.authorizationId`,
  `LocalListAuthorizations.groupAuthorizationId`, and the self-reference
  `Authorizations.groupAuthorizationId`. `teardown` derives its guards from
  `pg_constraint` rather than listing them, so a fifth does not silently break
  it.
- `createTransactionByStartTransaction` requires a `Connectors` row matching
  the OCPP connectorId and **throws** without one;
  `processOcpp16StatusNotification` auto-commissions it for ad-hoc 1.6 stations.
- `LocalAuthListService` refuses a `listVersion` not strictly greater than the
  station's stored one, before anything reaches the wire — hence the local-list
  reset in `prepareStation`.
- The shipped `docker` app-env selects `LocalBypassAuthProvider`, so the
  message API takes no credentials at all.
- **No 1.6 request handler for `FirmwareStatusNotification`**: every one is
  answered with a `NotSupported` CALLERROR, which is the only CALLERROR the
  CSMS emits anywhere in the suite. OCA `TC_044_{1,2,3}_CSMS` require a
  `FirmwareStatusNotification.conf` instead, so this is a non-conformance —
  and one the scenarios do not detect, because they assert only on what the
  charge point sent. Recorded in `drivers/citrineos/README.md`.

#### Validation history

Same rule as SteVe's table above: a row is added only for a full run, and the
table stays at five columns so the structural file-inventory selector does not
pick it up. Two runs are recorded rather than one, the second from `down -v` —
the claim being checked is that the verdict SET is reproducible, and a single
run cannot distinguish a stable result from a lucky one.

Numbers are the **parallel pass**, before `--retry-failed-isolated`, because
that is what the sweep prints; the retry column says which of those failures
were lane artifacts.

THE beta3 ROW IS ONE RUN, NOT TWO, and the rule above asks for two. It is
recorded because the check it was taken for is unambiguous and because the
run is a CI artifact anyone can re-download, not because one run settles
reproducibility. The second run is still owed.

What it was taken for: `grep -c 'OCPPMessages_requestMessageId_fkey'` over
`csms-citrineos.log` returns **0**, against 53 across the archived beta1
artifacts — and the log carries the corrective migration
`20260806120000-fix-ocpp-message-correlation-trigger` and one `AFTER INSERT`,
so the zero is the fix having run rather than the trigger having gone missing.
The flake count moved with it: two lane flakes at beta1, **zero** here, which
is what removing a crash class predicts and is the part a verdict count alone
would not show.

THE COLUMN HEADERS ARE OLDER THAN THE SUITE. `authorize`'s three scenarios are
inside `run-all` now, so the beta3 row's sweep is 54 scenarios in one pass and
the separate `--group authorize` sweep the rule names is redundant for it. The
headers are left as they are until a row needs them to mean something else:
renaming a column rewrites the two rows above it, which were measured under
the arrangement the headers describe.

AND THE SUITE IS NOW OLDER THAN THE ROWS. The registry holds 80 scenarios; the
beta3 row's 54 is what was on the wire the day it was taken, and twenty-six
`cert201-` rows registered since have never been swept against any CSMS —
their scope rows are `CONDITIONAL` and say what each one has to answer. A row
here records a measurement, so it is not restated to cover scenarios that run
did not include; the next row taken is where the larger number appears.

| CitrineOS | digest | validated | `all` (44), parallel pass | `authorize` (3) |
|---|---|---|---|---|
| `v2.0.0-beta3` — **current pin**, `CITRINE_VARIANT=v2` | `sha256:ddd8e987…` | 2026-09-05 | 38 PASS, 5 PARTIAL, 7 N/A, 4 EXPECTED FAIL — **0 flakes**, all four confirmed isolated; the 54-scenario sweep, `authorize` included | in the sweep: 2 PASS, 1 EXPECTED FAIL (`tc023-3`) |
| `v2.0.0-beta1` — superseded pin, `CITRINE_VARIANT=v2` | `sha256:58800f45…` | 2026-08-11 | 34 PASS, 7 N/A, 3 FAIL — two lane flakes PASS on isolated retry, `tc044-2` confirmed | 2 PASS, 1 FAIL (`tc023-3`) |
| `v1.9.1` — `CITRINE_VARIANT=v1` | `sha256:4f879151…` | 2026-08-11 | 16 PASS, 13 N/A, 15 FAIL — **all 15 confirmed on isolated retry, no flakes** | 2 PASS, 1 FAIL (`tc023-3`) |
| `v2.0.0-beta1` — same pin, GraphQL transport | `sha256:58800f45…` | 2026-08-12 | 37 PASS, 7 N/A, **0 FAIL, and no flakes** — the parallel pass needed no isolated retry at all | 2 PASS, 1 FAIL (`tc023-3`) |

One row, two runs: the second was taken from `down -v` and **agreed exactly in
shape** — 34/7/3 in the parallel pass, two of the three failures reclassified as
lane artifacts by the isolated retry, the same confirmed failure. Only the
identity of the lane flakes differed (`tc056`+`tc044-1`, then `tc013`+`tc044-1`),
which is the same pattern the SteVe table shows across its two versions and the
reason `--retry-failed-isolated` is not optional in CI. Counting the isolated
retry as the verdict, that was **38 PASS, 7 NOT APPLICABLE, 2 FAIL across all 47
OCPP 1.6 scenarios**.

The third row is the same pin read through the GraphQL data API, after
`tck/specs/firmware.ts` stopped asking for a retrieveDate the driver's rounding
could push past the observation window. Both of the 2026-08-11 failures other
than `tc023-3` were that margin, so the verdict is now **39 PASS, 7 NOT
APPLICABLE, 1 FAIL** — and, for the first time, a parallel pass with nothing
for the isolated retry to reclassify.

**The `v1.9.1` row is a report, not a recommendation.** 18 PASS, 13 NOT
APPLICABLE and 16 FAIL across all 47 OCPP 1.6 scenarios — against 39 / 7 / 1 on v2 — and the gap
is one upstream defect, not a driver limitation.

Fourteen of the fifteen `all`-group failures carry an identical wire signature:
`{"idTagInfo":{"status":"Invalid"},"transactionId":0}` in answer to every
`StartTransaction`, with `Connectors: 0` and `Transactions: 0` in the database
after the whole sweep. That is **citrineos/citrineos#160** — the Connector model
requires non-null `evseId` / `evseTypeConnectorId`, so a 1.6 `StatusNotification`
from an ad-hoc station cannot create a connector row, and nothing that needs a
transaction can start. The issue was closed 2026-05-19, *after* v1.9.1 shipped
on 2026-04-29; the fix is in the v2 line only. Nothing was reported upstream for
this: it is already fixed where it matters.

The fifteenth, `tc045-1`, fails on an incomplete `DiagnosticsStatusNotification`
train and is **not** attributed to #160 — same shape as `tc044-2` on v2, and
unexplained on both.

The thirteen NOT APPLICABLE are the seven reservation scenarios plus the six
local-auth-list ones, whose 1.6 endpoints v1.9.1 does not route (16 advertised
`/ocpp/1.6/` paths against v2's 18).

`tc023-3` fails identically on both lines, which is the useful control: it is a
property of the `Authorize` handler, not of either release.

**So the pin stays on v2**, and v1 support exists to make that statement
measured rather than asserted.

`tc044-1` flaked in the parallel pass of *both* runs, and `tc044-2` failed its
isolated retry in both while passing a third standalone run. Neither is
surprising: they are the two thinnest timing margins in the suite (a +90 s
`retrieveDate` against a 115 s and a 110 s hold respectively), so the firmware
status train has 25 s and 20 s to complete.

The two failures are findings, not driver defects, and both are argued in
`drivers/citrineos/scope.ts` and `drivers/citrineos/README.md`. `tc023-3` is the
one worth reporting upstream: CitrineOS answers
`{"idTagInfo":{"status":"Invalid"}}` where OCPP 1.6 requires `Blocked`.
Reproduced 3 runs out of 3.

Worth recording because it is the claim the second driver exists to test:
**every other group passed unmodified** — core, remote-trigger, smart charging,
local auth list and firmware — against a CSMS that had no part in writing the
scenarios, and no scenario needed editing to accommodate it.
