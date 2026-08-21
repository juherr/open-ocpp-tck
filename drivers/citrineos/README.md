# The CitrineOS driver

[CitrineOS](https://github.com/citrineos/citrineos-core) (LF Energy / S44) is
the second CSMS this harness drives, and the first one the 47 OCPP 1.6
scenarios were **not** written against. That is the point of it: an abstraction with a single
implementation is CSMS-neutral by assertion, and this driver is how the
assertion gets tested.

It reports the answer rather than flattering it.

**Measured 2026-08-12 against the pinned image: 39 `PASS`, 7 `NOT APPLICABLE`,
1 `FAIL` out of the 47 OCPP 1.6 scenarios.** The 5 OCPP 2.0.1 ones came later
and were measured 2026-08-19: **4 `PASS`, 1 unable to establish its
precondition** — see [OCPP 2.0.1](#ocpp-201) below.

That run needed no isolated retry at all, which had never happened before —
but read it as one run rather than as a property. The parallel pass is
sensitive to what else the host is doing: on a workstation carrying an
unrelated build, later runs of the same commit produced nine lane artifacts,
every one of them green on the isolated retry. `--retry-failed-isolated` is
what makes the verdict independent of that, and it is why CI does not treat a
parallel FAIL as final.

The seven `NOT APPLICABLE` are one missing capability — CitrineOS routes no
OCPP 1.6 reservation endpoints. The single failure is a deterministic finding
against CitrineOS: TC_023.3, `Blocked` answered as `Invalid`. It is not demoted
in the scope table: `tck/scope.ts` forbids demoting a row to `NOT_APPLICABLE`
to make a red scenario go away, and a TCK whose second driver reports 100%
green is a TCK that has stopped measuring. It is below.

It is **declared**, in [`expected.ts`](expected.ts), which is why the CI job
that runs this driver is blocking rather than `continue-on-error`. The
scenario still runs and still prints `FAIL`; the sweep reports it as
`EXPECTED FAIL` and exits 0, so a *new* red still fails the build. The day
upstream fixes the `Blocked` mapping, that row comes back `UNEXPECTED PASS`
and fails the build until the entry is deleted — which is how the list shrinks
instead of rotting.

The count was 38 / 7 / 2 on 2026-08-11. The second failure was TC_044.2, and it
was **ours**: the scenario asked for a retrieveDate +90s against a 110s hold,
leaving ~20s for the status train. That is fixed in `tck/specs/firmware.ts`, so
what remains is the CitrineOS finding alone.

A second CitrineOS defect **is** counted here now, and it used to be invisible:
OCPP 1.6 `FirmwareStatusNotification` is answered with a `NotSupported`
CALLERROR where OCA TC_044 puts a `.conf` on the Central System
([citrineos/citrineos#216][i216]). The assertions used to read only what the
CHARGE POINT sent, so three scenarios stayed green over ten CALLERRORs — a gap
in the scenarios, not evidence about CitrineOS. Issue #11 closed it, and the
three TC_044 rows are red: in each, every pre-existing check still passes and
the one failure is the CALLERROR.

Five scenarios are `PARTIAL`, and they are not a CitrineOS result: an OCA
obligation exists that no scenario here exercises, which is the same on every
driver. See [`OCA-COVERAGE.md`](../../OCA-COVERAGE.md).

The interesting result is the other 31. The core, remote-trigger,
smart-charging and local-auth-list groups all pass unmodified against a CSMS
that had no part in writing them — which is the strongest evidence available
that the scenarios test OCPP rather than SteVe.

## Quick start

```sh
docker compose -f drivers/citrineos/compose.yaml up -d --wait

export CSMS_DRIVER=./drivers/citrineos/index.ts
export OCPP_CP_IDS=CERTCP1,CERTCP2,CERTCP3

bun bin/ocpp-tck.ts check-driver          # offline: no CSMS, no docker
bun bin/ocpp-tck.ts driver provision      # seed the idTags TC_023 needs
bun bin/ocpp-tck.ts driver verify         # read-only: are they there?
bun bin/ocpp-tck.ts driver selftest       # seconds: every record query, once

bun run e2e                               # the whole suite: 52 scenarios

docker compose -f drivers/citrineos/compose.yaml down -v
```

`bun run e2e` and not `run-all`, for the retry pass: `--retry-failed-isolated`
re-runs a parallel lane's failures sequentially, which is the mode the runner
calls reliable. Both cover the same 52 scenarios — the `authorize` group used
to sit outside `all`, so a bare `run-all` reported 44/47 as "no failures" and
skipped exactly the three scenarios that prove `driver provision` seeded
anything. `bun run e2e:smoke` is the short loop while iterating.

`CITRINE_API_URL` defaults to `localhost` because the driver runs on your host,
while the simulator container reaches the same CitrineOS as `ws://citrine:8081/`
from inside the compose network. That asymmetry is why the two are separate
settings — the same one SteVe's driver has, for the same reason.

**No HTTP API credentials are required.** CitrineOS's shipped `docker` app-env selects
`LocalBypassAuthProvider`, which accepts every HTTP request and synthesises an
admin principal; it logs a warning saying so on startup. That is a property of
this development environment, not of CitrineOS in production, and swapping in
the OIDC provider would be a change to [`api-client.ts`](api-client.ts) rather
than a setting.

## Running two workspaces at once

Several checkouts of this repository share one docker daemon, and the stack is
a singleton on three counts the daemon holds globally: the compose project name
(hence the network and volumes), four `container_name:` values, and the
published ports. Nothing warns you — a second `up` adopts the first one's
containers, and `down -v` destroys a database somebody else is mid-sweep
against.

`TCK_SUFFIX` moves all three at once:

```sh
export TCK_SUFFIX=-b CITRINE_API_PORT=18080 CITRINE_GRAPHQL_PORT=18090
docker compose -f drivers/citrineos/compose.yaml up -d --wait

export CSMS_DRIVER=./drivers/citrineos/index.ts
export CITRINE_API_URL=http://localhost:18080
export CITRINE_GRAPHQL_URL=http://localhost:18090
export CITRINE_NETWORK=citrineos-b_citrineos-internal
export OCPP_CP_IDS=BCP1,BCP2,BCP3
```

**`OCPP_CP_IDS` matters as much as the ports**, and it is the part that is not
obvious: the runner names each simulator container `simts-<cp-id>-<scenario>`,
which is daemon-global, so two sweeps sharing `CERTCP1` collide on
`docker run --name` *even against separate CSMS instances*. The runner refuses
to start when it finds a simulator container driving one of your charge points
that it did not start, and says so — without that, the symptom is a scenario
reading the other run's transaction row and reporting it as a CSMS finding.

`CITRINE_WS_URL` needs no override: the simulator resolves `citrine` inside the
project network by *service* name, and only the container names move.

## The pinned version

[`compose.yaml`](compose.yaml) pins **`v2.0.0-beta1`** by digest:

```
ghcr.io/citrineos/citrineos-server:v2.0.0-beta1@sha256:58800f45acd82c976e2f55dd9aab85baee61507938bb2cb0d0f81fc70853c6ef
```

A prerelease rather than the `v1.9.1` stable, and deliberately: the OCPP 1.6
`getLocalListVersion` and `sendLocalList` message endpoints exist only from the
v2 line, and six scenarios need them. Pinning by digest is what makes a
prerelease safe to depend on — `:latest` currently resolves to the same bytes,
and will not for long.

Re-resolve a digest with:

```sh
T=$(curl -sS "https://ghcr.io/token?scope=repository:citrineos/citrineos-server:pull&service=ghcr.io" \
     | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sSI -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  https://ghcr.io/v2/citrineos/citrineos-server/manifests/v2.0.0-beta1 \
  | grep -i docker-content-digest
```

### The v1.9.1 variant

Both CitrineOS lines are supported. **v2 is the default**; v1.9.1 is one
override file and one environment variable:

```sh
docker compose -f drivers/citrineos/compose.yaml \
               -f drivers/citrineos/compose.v1.yaml up -d --wait
export CITRINE_VARIANT=v1
bun bin/ocpp-tck.ts driver provision && bun run e2e
```

```
ghcr.io/citrineos/citrineos-server:v1.9.1@sha256:4f8791510686af47d5a5cbb55bf69eea7435734836e858d8cc983c0a4edaa884
```

Two differences, both read off the running images rather than inferred:

1. **16 `/ocpp/1.6/` routes instead of 18** — no `evdriver/sendLocalList`, no
   `evdriver/getLocalListVersion`. Six local-auth-list scenarios become
   `NOT APPLICABLE`, so v1 reports **34 `DRIVABLE` / 13 `NOT_APPLICABLE`**
   where v2 reports 40 / 7.
2. **The OCPP connection column is `stationId`**, where v2 names it
   `ocppConnectionName` — on `Transactions`, `LocalListVersions` and
   `SendLocalLists`. `Authorizations` is untouched, which is why `provision`
   was already version-agnostic; only the record reads needed it.

**Measured, 2026-08-11: 18 `PASS`, 13 `NOT APPLICABLE`, 16 `FAIL` out of the 47
OCPP 1.6 scenarios**,
against 39 / 7 / 1 on v2 — and the gap is one upstream defect rather than a
driver limitation. That v1 row has **not** been re-measured since the
retrieveDate fix or the move to the GraphQL transport, so read it as the
2026-08-11 snapshot it is; the v2 figure beside it is current. Fourteen of the fifteen `all`-group failures answer every
`StartTransaction` with `{"idTagInfo":{"status":"Invalid"},"transactionId":0}`,
and the database holds `Connectors: 0` after the whole sweep: that is
[citrineos/citrineos#160][i160], closed 2026-05-19 — *after* v1.9.1 shipped on
2026-04-29 — and fixed on the v2 line only. All fifteen were confirmed on the
isolated retry; there were no flakes. Nothing was reported upstream, because it
is already fixed where it matters.

**None of those sixteen is declared in [`expected.ts`](expected.ts)**, and the
omission is about evidence rather than about CitrineOS: no CI job runs this
line, so nothing would ever report one of those entries as an `UNEXPECTED PASS`
and delete it. A list no run can shrink is the rot the mechanism exists to
replace — it would read as sixteen reviewed findings while being one stale
snapshot. On v1 every failure stays a failure; whoever puts the line back under
a sweep gets the honest list from the run.

`tc023-3` fails identically on both lines, which is the useful control: it is a
property of the `Authorize` handler, not of either release.

**Use v2.** v1 support exists so that recommendation is measured rather than
asserted.

[i160]: https://github.com/citrineos/citrineos/issues/160

`CITRINE_VARIANT` is **declared, not detected**, because the scope table and
the capability set must be readable with no server and no credentials — that is
what makes `check-driver` and the pre-flight offline. [`variant.ts`](variant.ts)
carries the reasoning; `driver verify` then compares the declaration against
the running schema and refuses to go further on a mismatch:

```
schema mismatch: CITRINE_VARIANT=v1 expects Transactions."stationId",
but the server has ocppConnectionName. Set CITRINE_VARIANT=v2 for this server.
```

The trap that makes detection tempting and wrong: `stationId` exists on
`Transactions` in **both** lines — `character varying` holding the OCPP name on
v1.9.1, an `integer` foreign key on v2. Its presence proves nothing;
`ocppConnectionName`'s presence is the discriminator.

## Environment

Every default resolves to a name in `compose.yaml`; a stock stack needs none of
them.

| Variable | Default | Meaning |
|---|---|---|
| `CITRINE_VARIANT` | `v2` | Which CitrineOS line the target runs. `v1` for the v1.9.1 stable. Checked against the running schema by `driver verify`. |
| `CITRINE_API_URL` | `http://localhost:8080` | Message-API base. |
| `CITRINE_WS_URL` | `ws://citrine:8081/` | OCPP endpoint; the charge point id is appended as the last path segment. |
| `CITRINE_TENANT_ID` | `1` | Carried by every API call and every query. |
| `CITRINE_GRAPHQL_URL` | `http://localhost:8090` | The `graphql-engine` sidecar: records and fixtures both go through it. |
| `CITRINE_HASURA_SECRET` | *(unset)* | `x-hasura-admin-secret`, when the target sets one. Upstream's compose and ours do not, so the header is omitted rather than sent blank. |
| `CITRINE_NETWORK` | `citrineos_citrineos-internal` | Docker network the simulator joins. |

An explicit `SIM_*` value still beats all of these — an operator's override is
the last word.

## How the contract maps

Operations go to the message API, which generates its routes from the OCPP
schemas: `POST /ocpp/<version>/<module>/<action>?identifier=<cpId>&tenantId=1`,
and the request body *is* the OCPP payload. The module prefix is not derivable
from the action, which is the only reason a table is needed:

| Contract operation | Endpoint |
|---|---|
| `Reset` | `configuration/reset` |
| `ChangeAvailability` | `configuration/changeAvailability` |
| `GetConfiguration` | `configuration/getConfiguration` |
| `ChangeConfiguration` | `configuration/changeConfiguration` |
| `TriggerMessage` | `configuration/triggerMessage` |
| `UpdateFirmware` | `configuration/updateFirmware` |
| `UnlockConnector` | `evdriver/unlockConnector` |
| `ClearCache` | `evdriver/clearCache` |
| `RemoteStartTransaction` | `evdriver/remoteStartTransaction` |
| `RemoteStopTransaction` | `evdriver/remoteStopTransaction` |
| `GetLocalListVersion` | `evdriver/getLocalListVersion` |
| `SendLocalList` | `evdriver/sendLocalList` |
| `GetDiagnostics` | `reporting/getDiagnostics` |
| `SetChargingProfile` | `smartcharging/setChargingProfile` |
| `GetCompositeSchedule` | `smartcharging/getCompositeSchedule` |
| `ClearChargingProfile` | `smartcharging/clearChargingProfile` |
| `ReserveNow`, `CancelReservation` | **none** — see the gaps below |

Observations and fixtures go through the **GraphQL data API** (Hasura), because
CitrineOS's REST data endpoints expose none of what the scenarios assert on:
there is no "latest transaction for this station" (the one transaction route
requires the `transactionId` you are trying to find), no idTag on a
transaction, no stop reason, no count, and no Authorization CRUD at all. Every
`@AsDataEndpoint` in the repository was read to establish that, and every route
was probed on the pinned image.

Using GraphQL is CitrineOS's own answer rather than a workaround:
`packages/ocpi-base` — a shipped server-side package — creates Authorizations
with `insert_Authorizations_one`, the operator UI uses the same mutations, their
e2e suite seeds fixtures through a `GraphQLClient`, and their compose starts
`graphql-engine` ungated while gating the UI and the OCPI server behind
`profiles:`. The server even *demands* it: `sendLocalList` answers `"Authorization
not found for idTag '…' (create the Authorization before adding it to a local
auth list)"`, and no REST route can create one.

What it does **not** buy is insulation from the schema: Hasura derives field
names from column names, so the v1.9.1 → v2 column rename breaks these queries
exactly as it broke the SQL. What it buys is that **this driver never shells
into a container** — both halves are HTTP, so it can be pointed at a CitrineOS
nobody on this host owns.

`ocpp-tck driver provision` tracks the tables and the three relationships the
queries need through Hasura's metadata API, so nothing of CitrineOS's own
metadata is vendored here. That bootstrap is the counterpart of the SteVe
driver writing an API password and restarting the container.

One thing this driver does *better* than the SteVe one: `SendLocalList` is
lossless here. SteVe's manager UI carries tag names only, so per-entry `status`,
`expiryDate` and `parentIdTag` are silently dropped; CitrineOS's JSON endpoint
carries all three to the wire.

## OCPP 2.0.1

The version is a path segment, so the 2.0.1 half of the contract is the same
three moves through the same client — `/ocpp/2.0.1/…` instead of
`/ocpp/1.6/…`:

| Contract operation | Endpoint |
|---|---|
| `Reset` | `configuration/reset` |
| `GetVariables` | `monitoring/getVariables` |
| `SetVariables` | `monitoring/setVariables` |

Declared for the **v2 line only**. Nobody has pointed a 2.0.1 station at
v1.9.1 here, and a driver declaring a surface on the strength of a version
number is the thing `variant.ts` exists to refuse — so with `CITRINE_VARIANT=v1`
this driver declares no `operations201` at all and every `cert201-` scenario is
`NOT_APPLICABLE`.

One CitrineOS serves both protocols on one websocket endpoint, dispatching per
connection on the negotiated subprotocol
([the evidence](https://github.com/juherr/open-ocpp-tck/issues/57#issuecomment-5315202272)),
so nothing about the transport, the compose file or the station roster changes
for a 2.0.1 scenario.

**Measured 2026-08-19, on the first sweep that ran them: four `PASS`.** They
were written `CONDITIONAL` — each row stating the question the first live run
had to answer, because `DRIVABLE` would have asserted a measurement nobody had
taken — and the run answered it: CitrineOS v2.0.0-beta1 *does* dispatch a 2.0.1
`Reset` to a station it accepted through `allowUnknownChargingStations` whose
device model is not provisioned, and an `evseId` the station does not have
survives the schema and reaches the wire.

**`cert201-tcb21-reset-scheduled` is the fifth, and it needed a fixture the
other four did not.** The case needs a transaction running before the reset —
that is what makes `Scheduled` distinguishable from `Accepted` — and until
[issue #75](https://github.com/juherr/open-ocpp-tck/issues/75) one could not be
started here. The simulator sends its `Authorize` idToken with `type` set to
`ISO14443` — a literal in the pinned image rather than a setting — and CitrineOS
validates the idToken *value* against that type's format (8 or 14 hexadecimal
characters) before any lookup: every `CERT…` fixture was rejected on its shape
alone, answered with a `CALLERROR`,
and the local start was refused. The station stayed idle, `OnIdle` was answered
`Accepted`, and that answer was correct — so the scenario reported its
precondition **unexercised** rather than filing a `Reset` non-conformance.

`driver provision` now seeds `CE712001`, hexadecimal *and* stored with
`idTokenType = ISO14443`. Both halves are load-bearing, and for different
reasons: the shape gets it past the format check, and the type gets it found at
all — CitrineOS's 2.0.1 `Authorize` handler matches on `(idToken, idTokenType)`
where its 1.6 handler matches on the idToken alone. A hexadecimal tag stored
`Central` would pass validation and still answer `Unknown`. `driver verify`
checks the stored type for that reason.

**Measured 2026-08-20 with that fixture in place: `PASS`, five checks, none
skipped** — the transaction started, the reset came back `Scheduled` rather than
`Accepted`, and CitrineOS answered the `TransactionEvent` that makes the
deferral meaningful. That last one had never been asked of it before: this is
the only 2.0.1 transaction traffic the suite sends.

The scenario keeps its `SKIPPED` path: a third-party CSMS may still fail to
start a transaction for its own reasons, and the honest verdict there remains
"the suite did not ask".

All seven selected cases are implemented. `TC_B_06` and `TC_B_09` were the last
two, and they arrived by a correction worth keeping here rather than only in
the commit that made it: both were declined for a year on the ground that
reading or writing a variable needs a device model `driver provision` does not
seed. That reason was about the wrong side of the wire. `GetVariables` is
CSMS-initiated, so the device model that *answers* it is the station's — the
pinned simulator resolves the pair through a component/variable map of its own
— and CitrineOS reads its own here only for `bytesPerMessage` and
`itemsPerMessage`, which fall back when it is empty. Both drive green against a
station whose device model was never provisioned.

The device-model gap itself is real and unrelated to those two: a 2.0.1
`StatusNotification` still never reaches the device model. That is its own
issue, and the four `StatusNotificationService` warnings are what measures it.

## Gaps

Each row names the source fact that causes it, per the rule in `tck/scope.ts`:
a `reason` that cannot name the limitation is `CONDITIONAL`, not
`NOT_APPLICABLE`.

| Gap | Effect | Source |
|---|---|---|
| **No OCPP 1.6 reservation endpoints.** No `@AsMessageEndpoint` binds `ReserveNow` or `CancelReservation` to `OCPPVersion.OCPP1_6`. The 1.6 schemas exist, the `Reservations` table exists, `evdriver.responses` lists both actions — nothing routes them, and no 1.6 response handler exists either. | 7 scenarios `NOT APPLICABLE`; the driver omits `records.reservations` entirely. | Verified at `v1.9.1`, `v2.0.0-beta1` and `main`. |
| **Local auth list is v2-only.** `EVDriverOcpp16Api` gained `sendLocalList` / `getLocalListVersion` in the v2 line. | 6 scenarios, drivable only on the pinned prerelease. | `packages/core/src/modules/EVDriver/src/module/1.6/MessageApi.ts` |
| **No charging-profile registry.** `ChargingProfiles` has no `description` or `name` column, and nothing to look one up by. | `refByDescription` resolves from this driver's own catalogue instead. Not a scenario cost: OCPP 1.6 carries the profile inline. | `packages/core/src/dal/layers/drizzle/schema/ChargingProfile.ts`, and [`profiles.ts`](profiles.ts) |
| **`Blocked` is unreachable from the 1.6 `Authorize` path.** The handler reaches its status mapper only through the `status === Accepted` branch, so a stored `Blocked` falls through to the default `Invalid`. The only route to a real `Blocked` is an `IAuthorizer`, and the container registers `authorizers: asValue([])` with no setting that changes it. | **TC_023.3 fails**, deterministically: CitrineOS answers `{"idTagInfo":{"status":"Invalid"}}` where the scenario requires `Blocked`. Observed 3 runs out of 3. `scope.ts` keeps the row DRIVABLE and `expected.ts` declares the red, so the sweep reports it as `EXPECTED FAIL` and the job stays blocking — and `UNEXPECTED PASS` the day it is fixed. | `AuthorizeRequestOcpp16Handler.ts`, `apps/ocpp-server/src/container.ts` |
| **No REST for `Authorizations`.** `EVDriverDataApi` exposes exactly one route, a read-only local-list-version GET. | `driver provision` writes fixtures through GraphQL. | [`provision.ts`](provision.ts) |
| **Four foreign keys reference `Authorizations`, none cascading**: `Transactions.authorizationId`, `LocalListAuthorizations.authorizationId`, `LocalListAuthorizations.groupAuthorizationId`, and the self-reference `Authorizations.groupAuthorizationId`. | `teardown` derives its guards from the foreign keys Hasura reports instead of listing them, so a fifth on a future CitrineOS is picked up rather than aborting the whole delete. Guarding only the first was measured to leave *every* fixture in place, because psql ran the script in one implicit transaction. | Read from the foreign keys Hasura derives; see `references()` in [`provision.ts`](provision.ts). |
| **No 1.6 request handler for `FirmwareStatusNotification`.** Every one the charge point sends is answered with `[4,…,"NotSupported","No handler found for action: FirmwareStatusNotification at module configuration"]` — 10 across the three TC_044 logs, and the only CALLERROR the CSMS emits anywhere in the suite. | **A non-conformance, and the suite now detects it.** OCA `TC_044_{1,2,3}_CSMS` put steps 4 and 6 on the Central System — *"The Central responds with a FirmwareStatusNotification.conf"* — and a CALLERROR is not that conf. **TC_044.1/.2/.3 fail**, each on that check alone. Until issue #11 they passed, because they asserted only the statuses the charge point *sent*. | `packages/core/src/handlers/requests/1.6/` — `DiagnosticsStatusNotification` has one, `FirmwareStatusNotification` does not. No ticket upstream. |
| **An unhandled promise rejection kills the process.** `WebhookDispatcher.dispatchMessageReceived` persists every message; a `SequelizeForeignKeyConstraintError` on `OCPPMessages_requestMessageId_fkey` escapes as an uncaught rejection and Node exits. | Compose's `restart: unless-stopped` restarts it, so from the charge point's side it is a 1006 followed by a reconnect and a reboot — which is what `scope.ts` recorded as unexplained on TC_044.2. Observed 21 restarts across one 26h session and 2 more inside a single sequential sweep; scenarios caught mid-restart fail for reasons that have nothing to do with what they assert. **Run sequentially and re-run any isolated failure before believing it.** | Stack in the container log: `router.js onMessage` → `webhook.dispatcher.js:103` → `Base.js:57`. Whether the CALLERROR above is the trigger is *not* established — the violated key is `requestMessageId`. |
| **No 1.6 response handler for `UnlockConnector` or `UpdateFirmware`.** The Calls are routed and sent; the CallResults are answered with the same `NotSupported` CALLERROR. | Harmless — the six affected scenarios all pass. | `packages/core/src/handlers/responses/1.6/` |
| **`GetConfiguration` is batched server-side.** The endpoint splits a request into batches of the station's stored `GetConfigurationMaxKeys`. | *Not* a problem in practice: an unprovisioned station has no such value, so the request stays one `GetConfiguration` on the wire and both TC_019 scenarios pass. Listed because provisioning that key would change it. | `Configuration/src/module/1.6/MessageApi.ts` |
| **`SendLocalList` requires a strictly increasing `listVersion`,** and refuses otherwise *before* anything reaches the wire. Four scenarios send version 1. | `prepareStation` clears the station's stored list version each run, so a refusal cannot masquerade as a charge point ignoring the request. | `LocalAuthListService.ts`, and [`records.ts`](records.ts) |

### Checked against the OCA reference

The findings above were re-read against the Open Charge Alliance's OCPP 1.6
certification material ([certification page][octt]): the *Test Procedure & Test
Plans* (v2.4.1) and the *OCPP Compliancy Testing Tool — Test Case Document*.
The CSMS is the system under test here, so the **`_CSMS`** variant of each test
case is the one that applies.

[octt]: https://openchargealliance.org/certificationocpp/certification-ocpp-1-6/

Three things that changed as a result:

1. **TC_023.3 is confirmed, and it is mandatory.** `TC_023_3_CSMS` states the
   prerequisite as *"The Central System has an idTag in memory with status
   'Blocked'"* — exactly what `provision` writes — and its tool validation as
   *"(Message: Authorize.conf) idTagInfo.status is Blocked"*. The test plan
   marks TC_023_1/2/3 **M** for the Central System. So this is a failure
   against a mandatory case, not a driver setup artifact.

2. **The seven `NOT_APPLICABLE` reservation rows match the reference's own
   gating.** The test plan carries `R-0 — Support for Reservations — Yes / No`
   as a declared capability and heads the block *"Optional feature: Reservation
   of a Connector"*, with the cases marked *C — "Only applicable if
   Reservations are supported"*. Reporting them not-applicable for a CSMS that
   routes no 1.6 reservation endpoint is what the reference intends, not a
   convenience.

3. **The firmware rows are green for a reason the reference does not accept.**
   `TC_044_{1,2,3}_CSMS` require the Central System to answer each
   `FirmwareStatusNotification.req` with a `.conf`; CitrineOS answers a
   `NotSupported` CALLERROR. Our scenarios assert only on the statuses the
   charge point sent, so they do not see it. **That is a gap in the scenarios,
   and closing it would change what they measure** — `ASSERT-INVENTORY.txt`
   would move — so it is recorded here rather than fixed in passing.

**Upstream tickets.** `citrineos-core` has GitHub issues disabled; the tracker
is the umbrella repo [`citrineos/citrineos`][tracker].
[#169][i169] *"Complete OCPP 1.6J Support — Reservations, LocalList,
SmartCharging, Diagnostics"* is the ticket for the reservation gap. It is
**closed**, answered with *"the intention is to fully implement OCPP 1.6J, but
… it is lower in priority"* — and the rest of its list (local list, smart
charging, diagnostics, clear cache) did ship, while reservations did not: they
are still unrouted at `v2.0.0-beta1`. There is **no** ticket for the `Blocked`
mapping or for the missing `FirmwareStatusNotification` handler.

[tracker]: https://github.com/citrineos/citrineos/issues
[i169]: https://github.com/citrineos/citrineos/issues/169

### Flakes, and what they are not

The two TC_044 scenarios with a `retrieveDate` of +90 s are the thinnest timing
margins in the suite: the charge point waits for that instant before it starts,
leaving 25 s (TC_044.1, 115 s hold) and 20 s (TC_044.2, 110 s hold) for the
whole firmware status train.

- **`cert16-tc044-1-firmware-update`** flaked in the parallel pass of both
  recorded runs and passed the isolated retry both times. Ordinary lane
  contention; `--retry-failed-isolated` is exactly the mechanism for it.
- **`cert16-tc044-2-firmware-download-failed`** passed 1 run in 3, including
  failing its isolated retry twice. On the failures the socket dropped
  (`code=1006`) shortly after CitrineOS's `NotSupported` CALLERROR, costing a
  reconnect and a `BootNotification` that lose the charge point's firmware
  state.

**Which side closes that socket is not established.** The obvious suspicion is
the CALLERROR, and it is wrong: TC_044.1 and TC_044.3 take four of them each
and never disconnect. It is recorded as an open question rather than as a
CitrineOS defect, because the evidence does not support the second reading.

### Smaller traps, handled

None is listed as a gap, because they cost nothing once known:

- **More than one `Authorizations` row for an idToken breaks both handlers, in
  different ways.** 1.6 answers `Invalid` outright; 2.0.1's
  `readOnlyOneByQuery` throws. The unique index is on `(idToken, idTokenType,
  tenantId)` and Postgres treats NULLs as distinct, so `ON CONFLICT` would not
  protect the invariant that matters. `provision` upserts on `(idToken,
  tenantId)` and `verify` counts rows per tag.
- **The two `Authorize` handlers disagree about the type, and only one of them
  reads it.** 1.6 looks a tag up by `idToken` alone; 2.0.1 matches the pair
  `(idToken, idTokenType)`. A row of the wrong type is therefore not "wrong"
  in any visible column — it is simply not found, and answers the same
  `Unknown` a missing row does. `provision` writes the type on update as well
  as on insert, so a drifted row is repaired rather than merely tolerated, and
  `verify` reads it back.
- **A tag stored as `status = 'Expired'` answers `Invalid`, not `Expired`.**
  The expiry is consulted only inside the `Accepted` branch, so `CERT023-EXP`
  is provisioned as `Accepted` with a past `cacheExpiryDateTime`.

[i216]: https://github.com/citrineos/citrineos/issues/216
