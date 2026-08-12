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
| `tck/specs/firmware.ts` | `upstream-patched` | `scripts/steve-verify/runner/specs/firmware.ts` | `e1bc6c288fe5c56e2cceae6f4ea650e901d852637ecdec914fc7ccdbdd5d1fe8` | `e80494f65f4b2cf958742f297607af0612ce34193ca8fde3fa2ada99d55958f7` | `patches/tck/specs/firmware.ts.patch` |
| `tck/specs/index.ts` | `upstream-verbatim` | `scripts/steve-verify/runner/specs/index.ts` | `be8595765f4d66965bfd58498622c26a696962fabae8a2700f080ae5cd55d832` | `be8595765f4d66965bfd58498622c26a696962fabae8a2700f080ae5cd55d832` | `—` |
| `tck/assert.ts` | `upstream-patched` | `src/cp/application/verification/assert.ts` | `2431f5f6c0df997d4d821d9af55689c1f0f2df199de1e9e4ed6f3fbaad4fc89e` | `76d0f293db4f6ecc5768affea0ca76d2841c147fa3687dbea1f9e950bfbd9298` | `patches/tck/assert.ts.patch` |
| `tck/sim.ts` | `upstream-patched` | `scripts/steve-verify/runner/sim.ts` | `2bf2f78afe3434e7139cd62c3ff6d70f02defd39dd700611e7c5f7614260cd35` | `45f897f273ea73227bb9b30766127eb9ecae0a319ab9048cbc30428fafff7f32` | `patches/tck/sim.ts.patch` |
| `tck/main.ts` | `upstream-patched` | `scripts/steve-verify/runner/main.ts` | `a757b0d35d29c7627336c0e858ad7d2f305a33c0acad819b5296f3847382f4e2` | `c527fd437a6366404bf0c329c8f481e7e0254e66695c9d4bdf965e45f8d2f06b` | `patches/tck/main.ts.patch` |
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
| `drivers/steve/api-client.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/ui-client.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/scope.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/steve/provision.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/index.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/config.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/api-client.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/graphql-client.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/requests.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/profiles.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/records.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/scope.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/variant.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |
| `drivers/citrineos/provision.ts` | `local-upstreamable` | `—` | `—` | `—` | `—` |

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

## CSMS container images

Not vendored code — the environment `drivers/steve/compose.yaml` brings up so
that the SteVe driver can be exercised. Pinned by digest for the same
reason as the simulator: these tags are republished in place, and a
conformance run that cannot name the bytes it tested proves nothing.

| field | value |
|---|---|
| image | `ghcr.io/juherr/steve` |
| tag resolved | `steve-3.14.0` |
| digest | `sha256:aa56949a639328a11461a3e448d40549b521f232ee0fdeef22389ddff3c9901f` |
| image | `mariadb` |
| tag resolved | `11.8` |
| digest | `sha256:d9f7eb2637296652f24b484afd5d246f759f49f5babcadc6a9e344c9acb75fbf` |
| resolved on | 2026-08-11, from the registry manifest `Docker-Content-Digest` |
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
| `steve-3.14.0` — **current pin** | `sha256:aa56949a…` | 2026-08-11 | 44 PASS, 0 PARTIAL, 0 N/A; 1 parallel-only flake (`tc013-hard-reset`) PASS on isolated retry | 3 PASS |
| `steve-3.13.0` | `sha256:a1e6647d…` | 2026-08-11 | 44 PASS, 0 PARTIAL, 0 N/A; 1 parallel-only flake (`tc014-soft-reset`) PASS on isolated retry | 3 PASS |

Neither version needed a single line of driver or provisioner change — that is
the column that would have mattered most, and it is uniform, so it is stated
here rather than repeated per row.

Both flakes were parallel-lane interference, not CSMS behaviour: each passed on
the isolated sequential retry, and they were different scenarios on the two
runs. That is the pattern `--retry-failed-isolated` exists for.

Moving this pin is not a version bump — every statement below is what the
provisioner is built on, so each was re-measured against the running 3.14.0
container before the pin moved. All of them still hold, and held identically on
3.13.0:

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
| tag resolved | `v2.0.0-beta1` |
| digest | `sha256:58800f45acd82c976e2f55dd9aab85baee61507938bb2cb0d0f81fc70853c6ef` |
| image | `postgis/postgis` |
| tag resolved | `16-3.5` |
| digest | `sha256:4e07b425403ba55c20b541884db2e80c686dd6476bf9265046ac9c163895605d` |
| image | `rabbitmq` |
| tag resolved | `3-management` |
| digest | `sha256:e582c0bc7766f3342496d8485efb5a1df782b5ce3886ad017e2eaae442311f69` |
| image | `hasura/graphql-engine` |
| tag resolved | `v2.40.3` |
| digest | `sha256:679fb764590e848e59ab6b82b3e906cc46f87d776f869f49132ca728660df244` |
| resolved on | 2026-08-11, from the registry manifest `Docker-Content-Digest` |
| declared in | `drivers/citrineos/compose.yaml` |

A **prerelease**, which is the one thing here that needs defending. The OCPP
1.6 `getLocalListVersion` and `sendLocalList` message endpoints exist only from
the v2 line, and six scenarios need them; `v2.0.0-beta1` currently resolves to
the same bytes as `:latest` and will not for long. Pinning by digest is what
makes depending on a moving tag safe — the alternative is `v1.9.1`, whose cost
is spelled out in `drivers/citrineos/README.md`.

The statements the driver is built on, each read from citrineos-core at
`v2.0.0-beta1` and cross-checked at `v1.9.1` and `main`. Re-check them before
moving the pin — several are the difference between a driver and a fiction:

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

| CitrineOS | digest | validated | `all` (44), parallel pass | `authorize` (3) |
|---|---|---|---|---|
| `v2.0.0-beta1` — **current pin**, `CITRINE_VARIANT=v2` | `sha256:58800f45…` | 2026-08-11 | 34 PASS, 7 N/A, 3 FAIL — two lane flakes PASS on isolated retry, `tc044-2` confirmed | 2 PASS, 1 FAIL (`tc023-3`) |
| `v1.9.1` — `CITRINE_VARIANT=v1` | `sha256:4f879151…` | 2026-08-11 | 16 PASS, 13 N/A, 15 FAIL — **all 15 confirmed on isolated retry, no flakes** | 2 PASS, 1 FAIL (`tc023-3`) |

One row, two runs: the second was taken from `down -v` and **agreed exactly in
shape** — 34/7/3 in the parallel pass, two of the three failures reclassified as
lane artifacts by the isolated retry, the same confirmed failure. Only the
identity of the lane flakes differed (`tc056`+`tc044-1`, then `tc013`+`tc044-1`),
which is the same pattern the SteVe table shows across its two versions and the
reason `--retry-failed-isolated` is not optional in CI. Counting the isolated
retry as the verdict, that is **38 PASS, 7 NOT APPLICABLE, 2 FAIL across all
47**.

**The `v1.9.1` row is a report, not a recommendation.** 18 PASS, 13 NOT
APPLICABLE and 16 FAIL across all 47 — against 38 / 7 / 2 on v2 — and the gap
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
