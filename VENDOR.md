# Vendor manifest

Upstream: <https://github.com/shiv3/ocpp-cp-simulator> (Apache-2.0).
Pinned commit: **`604054adb0d7d7129a26a5f1ad2d5fdc290d1ca1`** (`main`, authored
2026-07-31 11:59:04 +0900). Imported 2026-07-31.

Upstream ships **no `NOTICE` file** at that commit (verified 2026-07-31:
`ls /tmp/ocpp-upstream/NOTICE` → absent, only `LICENSE`). Apache-2.0 §4(d) —
"reproduce the attribution notices contained within such NOTICE file" —
therefore imposes nothing here. Re-check this on every re-import: the refresh
procedure below does it.

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
| `local-upstreamable` | `—` | `—` | `—` | `—` |
| `local-private` | `—` | `—` | `—` | `—` |

`local-*` rows pin **nothing**, deliberately. Pinning a file under active
development turns re-pinning into a reflex, and a reflex re-pin is exactly how
a spec digest gets bumped without anyone reading the diff. The integrity check
must stay a rare, loud signal.

`local-upstreamable` vs `local-private` is the contribution boundary made
machine-readable: `local-upstreamable` files are ours but destined for the
upstream PR, `local-private` files never leave the repository they sit in.
Every row here is currently one of the first two: a driver for a private CSMS
lives in its own repository and depends on this one as a package, which is the
strongest available demonstration that the core names no CSMS.

| path | origin | upstream path @ `604054a…` | upstream sha256 | local sha256 | patch |
|---|---|---|---|---|---|
| `tck/spec-types.ts` | `upstream-patched` | `scripts/steve-verify/runner/spec-types.ts` | `db4b29ab5ee0c623c950a52a999ef4e4c0a916dab0b6cfebe8fa8eabc5da0d26` | `40159b798f2919b463c6dde79efd6b550f035d57f64899bcf37f9e9e2c767202` | `patches/tck/spec-types.ts.patch` |
| `tck/util.ts` | `upstream-verbatim` | `scripts/steve-verify/runner/util.ts` | `ba62ed29c79e04533e0725739c9c0d514caadb7bff8146e46688c867432eee9e` | `ba62ed29c79e04533e0725739c9c0d514caadb7bff8146e46688c867432eee9e` | `—` |
| `tck/ocpp.ts` | `upstream-verbatim` | `src/cp/application/verification/ocpp.ts` | `a3f99c1b77b30d0ab0b22556b65aca05332d68f4b4b8d566a500d2036065368f` | `a3f99c1b77b30d0ab0b22556b65aca05332d68f4b4b8d566a500d2036065368f` | `—` |
| `tsconfig.json` | `upstream-verbatim` | `scripts/steve-verify/runner/tsconfig.json` | `b632b69c836000d80209c183b57d43ac917e3a1d50f042af65112bdf234d1931` | `b632b69c836000d80209c183b57d43ac917e3a1d50f042af65112bdf234d1931` | `—` |
| `tck/specs/core.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/core.ts` | `ef26b803ffee2d2fa5d809ebb2e066475ed33cb7fd527aeb43d5b416566f0125` | `077a8a8ac3dcb64e75f870a13cdf26f120353425af4fe18c403c9b3e4ed29a96` | `patches/tck/specs/core.ts.patch` |
| `tck/specs/authorize.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/authorize.ts` | `aaf1c5f2b4888df41cd1f0b8637b47eedc376ff2d61d29841d3668d26b66e7da` | `a627d704d62ccc5e47c60974859a12975827a4727da57cd3fd01a1bc96b57062` | `patches/tck/specs/authorize.ts.patch` |
| `tck/specs/authlist-reservation.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/authlist-reservation.ts` | `3ee302032025a889053d108d0813cc644819e58879b6cd554d56f85b804d0cd6` | `1c6726e0522ccce2cea16fb490e4351852d28986b778f5940258bf4337c2f7d8` | `patches/tck/specs/authlist-reservation.ts.patch` |
| `tck/specs/remotetrigger-smartcharging.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/remotetrigger-smartcharging.ts` | `f0d2b720c8b6343d08e2506f4d6e4fcbf68069bb586e5bfea841ca9e37fdbca2` | `26ccd319a566955f384d0d93e423033a6538ba471ff0ff0219542a8904b30bad` | `patches/tck/specs/remotetrigger-smartcharging.ts.patch` |
| `tck/specs/firmware.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/firmware.ts` | `e1bc6c288fe5c56e2cceae6f4ea650e901d852637ecdec914fc7ccdbdd5d1fe8` | `c3bb42861902f0b7f70ca6e2dcd02d5d96af29238f2e2081f018e64fe10a2927` | `patches/tck/specs/firmware.ts.patch` |
| `tck/specs/index.ts` | `upstream-verbatim` | `scripts/steve-verify/runner/specs/index.ts` | `be8595765f4d66965bfd58498622c26a696962fabae8a2700f080ae5cd55d832` | `be8595765f4d66965bfd58498622c26a696962fabae8a2700f080ae5cd55d832` | `—` |
| `tck/assert.ts` | `upstream-patched` | `src/cp/application/verification/assert.ts` | `2431f5f6c0df997d4d821d9af55689c1f0f2df199de1e9e4ed6f3fbaad4fc89e` | `76d0f293db4f6ecc5768affea0ca76d2841c147fa3687dbea1f9e950bfbd9298` | `patches/tck/assert.ts.patch` |
| `tck/sim.ts` | `upstream-patched` | `scripts/steve-verify/runner/sim.ts` | `2bf2f78afe3434e7139cd62c3ff6d70f02defd39dd700611e7c5f7614260cd35` | `45f897f273ea73227bb9b30766127eb9ecae0a319ab9048cbc30428fafff7f32` | `patches/tck/sim.ts.patch` |
| `tck/main.ts` | `upstream-patched` | `scripts/steve-verify/runner/main.ts` | `a757b0d35d29c7627336c0e858ad7d2f305a33c0acad819b5296f3847382f4e2` | `0fe75846f18f2fd03eb904acfff7bb6f72e6eafbab4b64f353092745db737585` | `patches/tck/main.ts.patch` |
| `tck/driver.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/index.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/driver-registry.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/capabilities.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/scope.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/time.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/unverifiable.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/wait.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `bin/ocpp-tck.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/specs/ASSERT-INVENTORY.txt` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `tck/specs/DRIVE-TRACE.txt` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/index.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/forms.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/records.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/ui-client.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/scope.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |

Deliberately **not** imported from upstream: `steve-api.ts` (SteVe 3.13.0 REST
client, 763 lines), `capability-probe.ts` (probes a live SteVe container),
`__tests__/` (upstream's own bun tests — this repo writes its own),
`01-setup-steve.sh` / `02-provision.sh` / `99-teardown.sh` / `lib.sh` /
`README.md` (SteVe environment bootstrap).

### Provenance note — upstream's re-export shims

Upstream `scripts/steve-verify/runner/assert.ts` and
`scripts/steve-verify/runner/ocpp.ts` are 6- and 10-line files whose entire
body is `export * from "../../../src/cp/application/verification/<module>"`.
Copying those shims verbatim would import nothing. The **implementations** in
`src/cp/application/verification/` are what is vendored here, under the
`runner/` filenames the specs import — which is why those two rows cite a
`src/…` upstream path while every other row cites `scripts/steve-verify/…`.

## Refresh procedure

```sh
git clone --filter=blob:none https://github.com/shiv3/ocpp-cp-simulator /tmp/ocpp-upstream
cd /tmp/ocpp-upstream && git checkout <new-sha>

# 1. Apache-2.0 §4(d): does upstream now ship a NOTICE file?
#    If it appears, its attribution notices must be reproduced in our NOTICE
#    under a clearly delimited "Upstream NOTICE" section.
test -f NOTICE && echo "ACTION REQUIRED: reproduce upstream NOTICE"

# 2. Re-copy every `upstream-verbatim` file, re-apply every patch, then update
#    BOTH digest columns of every upstream-* row:
shasum -a 256 /tmp/ocpp-upstream/<upstream path>          # → upstream sha256
shasum -a 256 <path>                   # → local sha256

# 3. Regenerate every patch so it still reconstructs the new upstream bytes:
diff -u /tmp/ocpp-upstream/<upstream path> scripts/ocpp-verify/<path> \
  > patches/<name>.patch

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
| tag resolved | `0.7.5` |
| digest | `sha256:ac35788f136c27db9371051b446af2b49270f1fc007d2172556fb761c7b01026` |
| digest kind | multi-arch OCI image index (selects the `linux/amd64` or `linux/arm64` manifest automatically) |
| resolved on | 2026-07-31, with `docker buildx imagetools inspect ghcr.io/shiv3/ocpp-cp-simulator:0.7.5` |
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
  image's own embedded sources. See `P0-FINDINGS.md` §9.
