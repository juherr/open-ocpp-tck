# The CitrineOS driver

[CitrineOS](https://github.com/citrineos/citrineos-core) (LF Energy / S44) is
the second CSMS this harness drives, and the first one the 47 OCPP 1.6
scenarios were **not** written against. That is the point of it: an abstraction with a single
implementation is CSMS-neutral by assertion, and this driver is how the
assertion gets tested.

It reports the answer rather than flattering it.

**Measured 2026-08-12 against the pinned image: 39 `PASS`, 7 `NOT APPLICABLE`,
1 `FAIL` out of the 47 OCPP 1.6 scenarios.** The 7 OCPP 2.0.1 ones came later
and in three measurements: four `PASS` on 2026-08-19, `TC_B_21` on 2026-08-20
once its fixture existed, and `TC_B_06` / `TC_B_09` on 2026-08-21. **All 7
`PASS`**; twenty-six more were registered afterwards and have not been swept —
see [OCPP 2.0.1](#ocpp-201) below.

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
bun bin/ocpp-tck.ts driver provision      # idTags + the 2.0.1 device model
bun bin/ocpp-tck.ts driver verify         # read-only: are they there?
bun bin/ocpp-tck.ts driver selftest       # seconds: every record query, once

bun run e2e                               # the whole suite: 83 scenarios

docker compose -f drivers/citrineos/compose.yaml down -v
```

`bun run e2e` and not `run-all`, for the retry pass: `--retry-failed-isolated`
re-runs a parallel lane's failures sequentially, which is the mode the runner
calls reliable. Both cover the same 83 scenarios — the `authorize` group used
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

[`compose.yaml`](compose.yaml) pins **`v2.0.0-beta3`** by digest:

```text
ghcr.io/citrineos/citrineos-server:v2.0.0-beta3@sha256:ddd8e98791b4f75523cf6a2aa3fd7cc35bd15bfb019d1461200e2c2e65462fd5
```

A prerelease rather than the `v1.9.1` stable, and deliberately: the OCPP 1.6
`getLocalListVersion` and `sendLocalList` message endpoints exist only from the
v2 line, and six scenarios need them. Pinning by digest is what makes a
prerelease safe to depend on — `:latest` currently resolves to the same bytes,
and will not for long.

**`beta3` rather than the `beta1` this pinned until now**, because beta1 has a
defect this suite spent a milestone measuring. The message-correlation trigger
`beta1` installs runs entirely `BEFORE INSERT`; its CALL branch back-fills
`"requestMessageId" = NEW.id` on a row Postgres has not inserted yet, so
`OCPPMessages_requestMessageId_fkey` fires and the violation escapes the
dispatcher as an unhandled rejection. What a sweep sees is a response that was
never delivered, reported as an unanswered request — 53 of them across 43 of
the 92 archived CitrineOS artefacts, every one at `ocpp_correlate_message()`
line 44, which is that `UPDATE`.

[citrineos-core#830][pr830] splits the trigger — the CALL side moves to
`AFTER INSERT` where `NEW.id` is a real row, the response side stays
`BEFORE INSERT` because it must mutate `NEW` for `RETURNING`. It merged
2026-08-06 and `v2.0.0-beta2` was cut the same evening; the migration
(`apps/ocpp-server/migrations/20260806120000-fix-ocpp-message-correlation-trigger.ts`)
is absent at `beta1` and present at `beta2`, `beta3` and `main`. `beta3` is the
newest tag, so that is what this pins.

The crash *mechanism* is not fixed by that bump — only its most frequent
trigger. See the gap table row "A failed message-audit insert still kills the
process".

[pr830]: https://github.com/citrineos/citrineos-core/pull/830

Re-resolve a digest with:

```sh
T=$(curl -sS "https://ghcr.io/token?scope=repository:citrineos/citrineos-server:pull&service=ghcr.io" \
     | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sSI -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  https://ghcr.io/v2/citrineos/citrineos-server/manifests/v2.0.0-beta3 \
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

Three differences, all read off the running images rather than inferred:

1. **16 `/ocpp/1.6/` routes instead of 18** — no `evdriver/sendLocalList`, no
   `evdriver/getLocalListVersion`. Six local-auth-list scenarios become
   `NOT APPLICABLE`, so v1 reports **34 `DRIVABLE` / 13 `NOT_APPLICABLE`**
   where v2 reports 40 / 7.
2. **The OCPP connection column is `stationId`**, where v2 names it
   `ocppConnectionName` — on `Transactions`, `LocalListVersions` and
   `SendLocalLists`, and on `Evses`, `Connectors` and `VariableAttributes` too:
   v1.9.1 never got the rename migration, and its `Connector.stationId` is a
   *string* holding the OCPP name. `Authorizations` is untouched, which is why
   the **tag** half of `provision` is version-agnostic.

3. **The 2.0.1 device model is not provisioned here**, and that follows from
   the two facts above rather than from caution. Every write in it spells
   `ocppConnectionName`, which this schema does not expose; and this driver
   declares no OCPP 2.0.1 surface for the line, so every `cert201-` scenario is
   already `NOT APPLICABLE` and there is nothing for the fixture to enable.
   `provision`, `verify`, `teardown` and the prepare hook all say so and do
   nothing. Set `CITRINE_VARIANT=v2` for a v2 server.

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
| `GetChargingProfiles` | `smartcharging/getChargingProfiles` |
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

The version is a path segment, so the 2.0.1 half of the contract goes through
the same client — `/ocpp/2.0.1/…` instead of `/ocpp/1.6/…`. The routing is
`route201()` in `requests.ts`, and this table is a second spelling of its
`switch` kept for readers rather than for the code:

| Contract operation | Endpoint |
|---|---|
| `Reset` | `configuration/reset` |
| `GetVariables` | `monitoring/getVariables` |
| `SetVariables` | `monitoring/setVariables` |
| `TriggerMessage` | `configuration/triggerMessage` |
| `ChangeAvailability` | `configuration/changeAvailability` |
| `SetChargingProfile` | `smartcharging/setChargingProfile` |
| `GetCompositeSchedule` | `smartcharging/getCompositeSchedule` |
| `GetChargingProfiles` | `smartcharging/getChargingProfiles` |

The module is CitrineOS's rather than the specification's, read off the
`@AsMessageEndpoint` decorators in the pinned image; `toCitrineRequest201`'s
doc comment is where that is argued.

`changeAvailability` validates against `ChangeAvailabilityRequestSchema`, whose
2.0.1 spelling is `operationalStatus` (required) plus an optional `evse` object
of `{ id, connectorId? }` — **no flat `evseId`**. The driver passes that object
through rather than unpacking it, because which of its two members are present
is the whole difference between addressing the station, an EVSE and a
connector.

**The two SmartCharging routes validate before they dispatch, and a refusal
never reaches the wire.** `setChargingProfile` checks the profile against a
dozen of *Part 2*'s K01 rules before `sendCall` — among them a `validFrom` in
the future, a `ChargingStationMaxProfile` at anything but `evseId` 0, a first
`chargingSchedulePeriod` whose `startPeriod` is not 0, a `Recurring` or
`Absolute` schedule with no `startSchedule`, a `TxProfile` naming a transaction
this station does not have, and a second profile at a stack level and purpose an
active one already holds unless the newcomer's `validTo` is strictly later.
`getCompositeSchedule` checks that a non-zero `evseId` resolves to an EVSE row
with a **null** `connectorId`. A rule that fails answers HTTP 200 with
`success: false` and puts nothing on the websocket, so the symptom in a run is
an empty frame log rather than a rejected request — which is why the device
model this driver provisions carries an EVSE row per addressed `evseId`, and why
the `cert201-tck*` scenarios compute their validity windows from the clock.

**`getChargingProfiles` is the third, and it refuses a criterion that narrows
nothing.** Its K09.FR.03 check wants `chargingProfileId` alone, or at least one
of `chargingProfilePurpose`, `stackLevel` and `chargingLimitSource` beside it —
and the test is truthiness, so an empty criterion is refused and so is a
`stackLevel` of 0, both the same silent HTTP 200 as above. An empty criterion is
legal on the wire and unreachable through this CSMS, which is why the scenarios
that scope by EVSE alone ask for all four limit sources: four values is the
whole enumeration, so it narrows nothing while satisfying the gate.

**And it sends one of these itself.** Every accepted `SetChargingProfile` makes
this CSMS deactivate the station's CSO profiles and send a
`GetChargingProfiles` with a generated `requestId`, no `evseId` and a one-value
`["CSO"]` criterion — so a scenario driving this operation sees TWO requests of
it on the wire and only one is its own. The `cert201-tck2*` / `cert201-tck3*`
scenarios select theirs by `requestId` rather than by position, because which of
the two arrives first is a race. It also stamps `CSO` on every profile it
persists, which is why those scenarios ask for that source and no other.

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

All seven cases this driver implements are green. `TC_B_06` and `TC_B_09` were
the last two, and they arrived by a correction worth keeping here rather than
only in the commit that made it: both were declined for a year on the ground
that reading or writing a variable needs a device model `driver provision` does
not seed. That reason was about the wrong side of the wire. `GetVariables` is
CSMS-initiated, so the device model that *answers* it is the station's — the
pinned simulator resolves the pair through a component/variable map of its own
— and CitrineOS reads its own here only for `bytesPerMessage` and
`itemsPerMessage`, which fall back when it is empty. Both drive green against a
station whose device model was never provisioned.

**Nineteen more cases are registered and NOT YET MEASURED**, which is why their
rows are `CONDITIONAL` rather than `DRIVABLE` and why the sentence above says
"seven" rather than "twenty-six". They arrived in three lots and the last is
the one to watch.

The first four — `cert201-tcc02-authorize-invalid`,
`cert201-tce10-start-authorized`, `cert201-tcf27-trigger-not-implemented` and
`cert201-tcj01-clock-aligned-meter-values` — were written against a reading of
Part 6 and the pinned simulator's own sources; nothing has run them against a
CSMS. Three of them ask this driver for nothing at all — the station side is
driven from the simulator's CLI — and the fourth reuses the `TriggerMessage`
route `TC_F_20` already exercises, so what the first sweep answers is about
CitrineOS rather than about this driver's routing.

The six `cert201-tcg0…` rows are the `ChangeAvailability` tranche, and they
are the first 2.0.1 rows where the ROUTE is also unmeasured:
`configuration/changeAvailability` was read off an `@AsMessageEndpoint`
decorator, which says the endpoint is bound and not that a request through it
reaches the wire intact. The specific unknown they share is `evse` — every
other 2.0.1 operation this driver dispatches carries scalars, and these three
addressing scopes are spelled by which members of a NESTED object are present.
`TC_B_22` established that a scalar `evseId` survives; that says nothing about
this. Each scope row states the question it has to answer.

The nine `cert201-tck…` rows are the Smart Charging tranche, and they are the
first where the CSMS is not a pass-through at all: `smartcharging/setChargingProfile`
and `smartcharging/getCompositeSchedule` check a dozen of *Part 2*'s K01 rules
before `sendCall`, and a rule that fails answers HTTP 200 with `success: false`
and puts nothing on the websocket. So the likeliest cause of a red first run is
not a reshaped request — it is no request at all, and the frame log will be
empty. The rules are listed above with the route table; the scenarios are
written against every one of them, and whether that reading is complete is what
the first sweep answers. Two of them also depend on the device model: a
`TxProfile` and a `GetCompositeSchedule` for a named EVSE both resolve an
`EvseTypes` row with a **null** `connectorId`, which is what `provision.ts`
started writing for them.

The device-model gap itself was real and unrelated to those two, and it is now
closed. A 2.0.1 `StatusNotification` used to reach nothing: CitrineOS answered
each one with an empty `StatusNotificationResponse` and logged four
`StatusNotificationService` warnings, so the failure was invisible from the
wire — which is where every other verdict in this suite comes from.

What it needs is written in [`device-model.ts`](device-model.ts) and comes in
two scopes, because the schema does:

- **tenant-scoped**, written by `driver provision` and checked by
  `driver verify` — an `EvseTypes` row per `(evseId, connectorId)` the station
  reports, a `Connector` component per pair carrying an `AvailabilityState`
  variable, and a *second* `EvseTypes` row per addressable EVSE with a **null**
  `connectorId`;
- **station-scoped**, written by `prepareStation` — the `Evses` and
  `Connectors` rows, which hang off a charging station row that does not exist
  until a station connects, and a charge point id is something only the
  per-scenario hook is handed.

The pairs are not a list written here: they come from the simulator's own
projection, a station-scope `(0, 0)` plus `(N, 1)` per connector. That first
one is the one that looks skippable and is not — half the warnings are its.

The connector-less rows are a *different* lookup rather than a duplicate of
those. The status handler resolves an EVSE type by the pair; the SmartCharging
endpoints resolve one with `findEvseByIdAndConnectorId(tenantId, evseId, null)`,
and a Sequelize `where` of `connectorId: null` is `IS NULL`, not a wildcard — so
the row a status needs does not answer a charging profile, and a
`SetChargingProfile` or `GetCompositeSchedule` addressed to that EVSE is refused
inside the CSMS with nothing on the websocket. EVSE `0` is deliberately not
seeded: both endpoints skip the lookup for the grid connection point, and the
CSMS writes that row itself the first time it files the station-scope status —
seeding it would put a fixture where residue lives.

`cert201-tcb01-cold-boot` asserts the repair rather than trusting it: for every
status the station reported, it reads the CSMS back through the contract's
`records.deviceModel`. `driver verify` covers the tenant half only, and says so
— it has no roster to check a station against.

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
| **A 2.0.1 `StatusNotification` needs a device model the CSMS will not create.** `processStatusNotification` wants an `Evse` whose `evseTypeId` matches the request's `evseId` with a `Connector` under it, and a `Connector` component joined to an `EvseType` with `id = evseId` **and** `connectorId = connectorId` carrying an `AvailabilityState` variable. Neither is created on demand — the 1.6 path in the same class auto-commissions, the 2.0.1 path does not. | Four `StatusNotificationService` warnings per run, and nothing stored, while every request is still answered. `driver provision` and `prepareStation` seed both halves; [issue #86](https://github.com/juherr/open-ocpp-tck/issues/86) carries the log either side. | `packages/core/src/modules/Transactions/src/module/StatusNotificationService.ts` |
| **`Connectors.evseTypeConnectorId` is not the foreign key it is declared as.** The column carries `@ForeignKey(() => EvseType)` and the database has **no** constraint behind it; its own comment says "the serial int starting at 1 used in OCPP 2.0.1 to refer to the connector, unique per EVSE", and every transaction path agrees — `TransactionEvent` looks a connector up by `evseTypeConnectorId: value.evse.connectorId`. | The fixture writes the OCPP connector number there. Writing an EVSE type's key instead makes that lookup miss, so the CSMS inserts its own connector and collides with the fixture on `(stationId, connectorId)` — one `CALLERROR InternalError: Failed handling message: Validation error` per transaction, which the suite sees as an unanswered `TransactionEvent`. Measured. | `packages/core/src/dal/layers/sequelize/repository/TransactionEvent.ts`, `model/Location/Connector.ts` |
| **`0` is falsy where an `evseId` may be `0`.** `findOrCreateEvseAndComponent` resolves a component's EVSE with `connectorId ? connectorId : null`, so filing the station-scope status — `(evseId 0, connectorId 0)` — creates a *second* EVSE type numbered 0 with a null connector and repoints the component at it. The next status's lookup filters on the pair and no longer matches. | The fixture cannot be provisioned once: `prepareStation` re-asserts the join before every scenario, and the device-model read addresses the component by name and instance rather than through it. Without the repair the warning is back on the second scenario. Measured, twice. | `packages/core/src/dal/layers/sequelize/repository/DeviceModel.ts` |
| **No 1.6 request handler for `FirmwareStatusNotification`.** Every one the charge point sends is answered with `[4,…,"NotSupported","No handler found for action: FirmwareStatusNotification at module configuration"]` — 10 across the three TC_044 logs, and the only CALLERROR the CSMS emits anywhere in the suite. | **A non-conformance, and the suite now detects it.** OCA `TC_044_{1,2,3}_CSMS` put steps 4 and 6 on the Central System — *"The Central responds with a FirmwareStatusNotification.conf"* — and a CALLERROR is not that conf. **TC_044.1/.2/.3 fail**, each on that check alone. Until issue #11 they passed, because they asserted only the statuses the charge point *sent*. | `packages/core/src/handlers/requests/1.6/` — `DiagnosticsStatusNotification` has one, `FirmwareStatusNotification` does not. No ticket upstream. |
| **A failed message-audit insert still kills the process.** `WebhookDispatcher.dispatchMessageReceived` and `dispatchMessageSent` both `await this._ocppMessageRepository.createOCPPMessage(…)` *outside* the `try` that wraps the rest of the method. Any rejection from that insert leaves the async method as an uncaught rejection, and nothing catches it: there is no `process.on('unhandledRejection')` anywhere in citrineos-core. | Node exits. Compose's `restart: unless-stopped` brings it back, so from the charge point's side it is a 1006 followed by a reconnect and a reboot; scenarios caught mid-restart fail for reasons that have nothing to do with what they assert. **Run sequentially and re-run any isolated failure before believing it.** The pinned image no longer supplies the frequent trigger (row below), so this is now a latent fault rather than an observed one — any *new* insert failure still crashes the server. | `packages/core/src/modules/OcppRouter/src/module/webhook.dispatcher.ts`. [citrineos-core#846][pr846] wraps both inserts and is merged on `next` only; `main`, `beta2` and `beta3` are unchanged. **Re-check that PR's port to `main` before removing this row.** |
| **[FIXED at the pinned digest] The correlation trigger violated its own foreign key.** History, kept because it is what a reader chasing a 1006 will find in the archives. The `BEFORE INSERT` trigger `v2.0.0-beta1` installed back-filled `"requestMessageId" = NEW.id` from its CALL branch, on a row that did not exist yet; `OCPPMessages_requestMessageId_fkey` fired, and the rejection escaped through the row above. | 53 events across 43 of 92 archived artefacts, all at `ocpp_correlate_message()` line 44 — the back-filling `UPDATE`. 21 restarts across one 26h session and 2 more inside a single sequential sweep. A swallowed response, reported by the suite as an unanswered request. | [citrineos-core#830][pr830] splits the trigger and ships as `apps/ocpp-server/migrations/20260806120000-fix-ocpp-message-correlation-trigger.ts`, present from `v2.0.0-beta2`. **Do not hunt this FK on the pinned image: it is gone.** |
| **A request to a station that has gone is redelivered forever.** A CSMS-initiated OCPP message whose charge point disconnects before it is delivered is re-enqueued and re-logged without bound, and never expires: the loop lasts for the rest of the run and the loops ACCUMULATE. `Reset` is the reliable trigger, because a station that resets disconnects by design; under load any request will do it. Each loop keeps doing database work, and the pool timeouts follow. | Measured across three archived sweeps: **1** loop → healthy (0 boot timeouts), **2** → healthy (1), **11** → the CSMS stopped answering entirely for the last 25 minutes, 38 `did not see BootNotification.conf`, 8 scenarios red as collateral, and the sweep still **exited 0**. This is the mechanism behind [#119](https://github.com/juherr/open-ocpp-tck/issues/119) and [#56](https://github.com/juherr/open-ocpp-tck/issues/56). Not fixable here; [`redelivery-loops.ts`](redelivery-loops.ts) counts them off the captured CSMS log and CI prints the count, so the accumulation is visible before it is fatal. | The dispatch envelope in the `citrine` container's log, one line per redelivery. No ticket upstream yet. |
| **No 1.6 response handler for `UnlockConnector` or `UpdateFirmware`.** The Calls are routed and sent; the CallResults are answered with the same `NotSupported` CALLERROR. | Harmless — the six affected scenarios all pass. | `packages/core/src/handlers/responses/1.6/` |
| **`GetConfiguration` is batched server-side.** The endpoint splits a request into batches of the station's stored `GetConfigurationMaxKeys`. | *Not* a problem in practice: an unprovisioned station has no such value, so the request stays one `GetConfiguration` on the wire and both TC_019 scenarios pass. Listed because provisioning that key would change it. | `Configuration/src/module/1.6/MessageApi.ts` |
| **`SendLocalList` requires a strictly increasing `listVersion`,** and refuses otherwise *before* anything reaches the wire. Four scenarios send version 1. | `prepareStation` clears the station's stored list version each run, so a refusal cannot masquerade as a charge point ignoring the request. | `LocalAuthListService.ts`, and [`records.ts`](records.ts) |

[pr846]: https://github.com/citrineos/citrineos-core/pull/846

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

**Which side closed that socket is now established, and it was not the charge
point.** The CSMS process died. The obvious suspicion was the CALLERROR, and it
was wrong for the reason recorded at the time — TC_044.1 and TC_044.3 take four
of them each and never disconnect; the actual cause is the correlation-trigger
foreign key in the gap table above, whose victim is whichever CALL happens to
reach the audit table after its own response. [citrineos-core#830][pr830]
states that mechanism and fixes it, and the pinned image carries the fix, so
these three lines are history for anyone running the current pin. Re-measure
before treating the timing margins above as the remaining explanation.

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
