# The Codetics ev-server-lite driver

[ev-server-lite](https://github.com/codetics-software/ev-server-lite) is a
Kotlin / Spring Boot charging-station management server by Codetics. Its
`ev-server/` module speaks **OCPP 1.6J only** and exposes a REST admin API,
which is everything this driver uses: operations go through one generic
command endpoint, records come from the transaction list, and fixtures are
seeded through the station and token endpoints. Nothing reads its database.

There is no published image. `compose.yaml` builds one from the upstream
repository at a pinned commit — `VENDOR.md`'s "Source-built CSMS" section
records which.

## Licence

The upstream repository is published under the **Codetics Attribution License
1.0**, not an OSI licence. Its terms count *cloning the repository* as
acceptance of the licence, and require attribution to Codetics.

This repository redistributes none of that code: `compose.yaml` hands the
docker daemon a git build context, so running it clones and builds the server
on the machine that runs it, and **doing so accepts that licence**. Read it at
the pinned commit before the first `docker compose up --build`. No image built
from it is published by this project.

## Quick start

```sh
docker compose -f drivers/codetics-ev-server-lite/compose.yaml up -d --build --wait

export CSMS_DRIVER=./drivers/codetics-ev-server-lite/index.ts
export OCPP_CP_IDS=CERTCP1,CERTCP2,CERTCP3

bun bin/ocpp-tck.ts driver provision   # stations on profile 0, the CERT… tags
bun bin/ocpp-tck.ts driver verify
bun bin/ocpp-tck.ts driver selftest
bun bin/ocpp-tck.ts run-all --group core

# the whole OCPP 1.6 suite, three lanes, as the coverage below was measured
bun bin/ocpp-tck.ts run-all --version 1.6 --parallel --retry-failed-isolated
```

Started under another compose project name (`docker compose -p <name> …`),
the network is `<name>_evsl-internal`: set `EVSL_NETWORK` to match, or the
simulator cannot reach the server.

The first build compiles the server with Maven and takes several minutes. The
`local` profile keeps everything in an in-memory H2 database, so **a restart
is a fresh server**: run `driver provision` again after one.

Three limits are hard-coded in the server and counted in that database, so only
a restart resets them:

- **ten logins per fifteen minutes** for the admin account. The driver logs in
  once per process and never retries a signin the server refused (401, 403 or
  429), but every `ocpp-tck` invocation is a process: provision, verify,
  selftest and each sweep spend one each.
- **sixty WebSocket handshakes per fifteen minutes per station**, per client
  address. A full sweep over three stations reconnects each one many times;
  restart the container before a second sweep.
- **a thousand WebSocket handshakes per fifteen minutes per client address**,
  all stations together (`OcppWebSocketConfiguration.kt`, checked before the
  per-station one).

## In CI

The `e2e` job in `.github/workflows/ci.yml` runs this driver as one of its
lanes, in two shards like the others. Each shard builds the image with
`docker/bake-action` off this `compose.yaml`, so the pinned commit is written
here only; the layers, the Maven compile included, come from the GitHub
Actions cache under the `codetics-ev-server-lite` scope once one run has
written them. Each shard then boots its own server, so it starts with fresh
rate-limit counters and spends three logins: `provision`, `verify` and the
sweep. Unlike the local measurement below, CI runs `run-all` without
`--version 1.6`, so the OCPP 2.0.1 scenarios appear in its summary as not
applicable.

## Environment

| variable | default | meaning |
|---|---|---|
| `EVSL_URL` | `http://localhost:8380` | admin API base, as the host sees it |
| `EVSL_WS_URL` | `ws://ev-server-lite:8080/ocpp/<tenant>/` | OCPP endpoint as the simulator sees it; the charge point id is appended |
| `EVSL_TENANT` | `codetics` | tenant slug, compose's `BOOTSTRAP_TENANT` |
| `EVSL_EMAIL` | `tck@example.com` | compose's `BOOTSTRAP_EMAIL` |
| `EVSL_PASSWORD` | `open-ocpp-tck-admin-password` | compose's `BOOTSTRAP_PASSWORD` (16–128 characters) |
| `EVSL_NETWORK` | `evsl_evsl-internal` | docker network the simulator joins |
| `EVSL_STATIONS` | `CERTCP1,CERTCP2,CERTCP3` | stations `provision` registers and `verify` checks |
| `EVSL_DISPATCH_TIMEOUT_MS` | `15000` | how long an operation may stay queued before it is reported as never dispatched |
| `EVSL_PORT` | `8380` | compose only: the host port the API is published on |

## How the contract maps

- **Operations.** `POST /api/v1/stations/{id}/commands {action, payload}` for
  all eighteen 1.6 actions; the payload is the OCPP request body, built by
  `requests.ts`. `execute()` then polls `GET /api/v1/commands` until the
  command leaves `QUEUED`, and reports a command that stays queued, times out
  or fails to reach the socket as never dispatched.
- **Records.** `GET /api/v1/transactions`, whose `id` is the OCPP
  transactionId. No reservation records (the server has no reservation
  entity), no device model (1.6 only).
- **Charging profiles.** The server has no profile registry, so the two
  profiles the scenarios name live in `profiles.ts` and travel inline.
- **Prepare hook.** Registers the station on profile 0 if it is not, then
  soft-stops any transaction a previous run left open — a database-only close,
  nothing on the wire.

## Scope

`ocpp-tck check-driver` reports 45 `DRIVABLE`, 0 `CONDITIONAL` and 2
`NOT_APPLICABLE` OCPP 1.6 scenarios; every OCPP 2.0.1 one is not applicable
through `protocols`. `scope.ts` names the endpoint behind each row.

The two rows that were `CONDITIONAL` before the first live sweep are
`DRIVABLE` since, each on what that sweep measured:

- `cert16-tc043-5-send-local-list-differential` asked whether the server keeps
  the member order of a `SendLocalList` it stores as JSON and re-serialises.
  It does: the station received
  `{"listVersion":2,"localAuthorizationList":[{"idTag":"CERT-TAG-2"}],"updateType":"Differential"}`.
- `cert16-tc019-get-configuration-all` asked whether the server's own
  first-boot `GetConfiguration` satisfies or shadows the driven one. On a
  station that had already booted, the trace holds exactly one received
  `GetConfiguration`, the driven one, so the row is drivable; the caveat below
  says when the scenario stops measuring the driver.

The two `NOT_APPLICABLE` rows are capabilities the admin API lacks, not
failures of a run:

- `cert16-tc019-get-configuration-key` — the command endpoint's payload
  validator checks a member called `key` on every action as a string of 1 to 50
  characters (`ocpp/OcppValidation.kt:173-180`, applied at `:230-237`), and
  `GetConfiguration.req`'s `key` is an array, so any key list is refused before
  it is queued (`ocpp/OcppCommandQueue.kt:73-77` validates on enqueue and turns
  the fault into an invalid request). Read from the source at the pinned
  commit; the sweep never asks.
- `cert16-tc051-cancel-reservation` — no reservation entity, and
  `GET /api/v1/commands` serves no request payload, so the reservation id the
  scenario must read back and cancel is unreadable.

## Coverage

Measured 2026-11-10 at the pinned commit, `run-all --version 1.6 --parallel
--retry-failed-isolated` over `CERTCP1,CERTCP2,CERTCP3`, twice, with a
container restart and a fresh `driver provision` between the two runs. Both
sweeps gave the same verdict for every scenario, exited 0 and had nothing to
retry; each took about 12½ minutes.

| group | scenarios | `DRIVABLE` | `NOT_APPLICABLE` | PASS | PARTIAL | FAIL |
|---|---|---|---|---|---|---|
| core | 15 | 14 | 1 | 13 | 1 | 0 |
| authorize | 3 | 3 | 0 | 3 | 0 | 0 |
| authlist-reservation | 13 | 12 | 1 | 12 | 0 | 0 |
| remotetrigger-smartcharging | 12 | 12 | 0 | 8 | 4 | 0 |
| firmware | 4 | 4 | 0 | 4 | 0 | 0 |
| **OCPP 1.6** | **47** | **45** | **2** | **40** | **5** | **0** |

The five PARTIAL rows are `tc001` (no `Heartbeat` inside the hold), `tc010`,
`tc011` and `tc059` (no `Authorize` before a remote start), and `tc054` (no
`MeterValues`, `FirmwareStatusNotification` or `DiagnosticsStatusNotification`
sent). Each SKIPPED check reads "scenario does not exercise this": the station
never sent the message the generic every-CALL-answered check looks for. They
are the same five rows, with the same SKIPPED checks, that SteVe reports
(`VENDOR.md`'s SteVe validation table), so they describe the scenarios and the
simulator rather than this CSMS. `tc054` has since been made to trigger all
five messages its case lists, and run on its own against this server it is
PASS, 15 checks, none skipped; the sweep counts above predate that change.

By tag, over the 47 OCPP 1.6 scenarios (a scenario carries one tag or more,
so the rows do not add up to 47): every scenario tagged `authorization` (4),
`availability` (1), `data-transfer` (1), `firmware` (4), `local-auth-list`
(6), `remote-control` (9), `remote-trigger` (2), `smart-charging` (5) and
`transaction` (20) is `DRIVABLE`; `provisioning` is 5 of 6 and `reservation` 6
of 7. `check-driver --json`'s `scopeByTag` counts the OCPP 2.0.1 rows too,
which `protocols` makes `NOT_APPLICABLE`.

## Caveats

- **The first boot of a station brings its own `GetConfiguration`.** On a
  station's first `BootNotification` since it was registered, the server
  queues an every-key `GetConfiguration`
  (`services/stations/StationConfigurationService.kt:83-92`, keyed on
  `lastBoot == null` in `ocpp/OcppService.kt:127`). The station receives it a
  moment after the boot — a one-scenario run on a station registered for it
  showed it, in a scenario that drives nothing. `TC_019_1` accepts *any*
  received every-key request, so on a freshly provisioned station it no longer
  checks the payload the driver sent — a driven request that wrongly carried a
  key filter would still pass — and its response checks may read the station's
  answer to the server's request instead. A driven request that is never
  dispatched still turns the row red: `execute()` throws
  `CsmsNotDispatchedError` and the runner awaits `drive()`. In both sweeps the
  scenario ran third on its station, so the one request it saw was the driven
  one. Restart and provision make every station fresh again; a run that puts
  `cert16-tc019-get-configuration-all` first on a lane measures less than it
  claims.

## Deviations

None measured. Neither sweep produced a FAIL or an ERROR, so `expected.ts` is
empty: no scenario the server drives is known to be answered wrongly. The
gaps this CSMS does have are the two `NOT_APPLICABLE` rows above — things the
admin API cannot express, which no run can turn red.
