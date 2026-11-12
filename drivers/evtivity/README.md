# The EVtivity driver

[EVtivity](https://github.com/EVtivity/evtivity-csms) is an independent
TypeScript charging-station management system (Fastify, PostgreSQL, Redis).
It serves OCPP 1.6J and 2.x; this driver drives **OCPP 1.6J only**. Everything
goes through its REST API: each 1.6 operation has its own synchronous route,
`POST /v1/ocpp/commands/v16/{Action}`, which answers with the station's
response; records come from the session routes; fixtures are seeded through
the station, driver and token routes. Nothing reads its database.

`compose.yaml` runs the published images of release `0.1.51`, pinned by their
multi-arch index digests.

## Licence

EVtivity is published under the **Business Source License 1.1**
([`LICENSE.md` at v0.1.51](https://github.com/EVtivity/evtivity-csms/blob/v0.1.51/LICENSE.md)),
which is source-available rather than open source. Its base grant covers
copying, modifying and non-production use, which a conformance sweep is;
production use is limited to the conditions of its Additional Use Grant, and
each version changes to Apache-2.0 four years after its first release.

This repository redistributes none of EVtivity's code: `compose.yaml` makes the
docker daemon pull the images EVtivity publishes on GHCR, and nothing is
vendored or rebuilt.

## Quick start

```sh
docker compose -f drivers/evtivity/compose.yaml up -d --wait

export CSMS_DRIVER=./drivers/evtivity/index.ts
export OCPP_CP_IDS=CERTCP1,CERTCP2,CERTCP3

bun bin/ocpp-tck.ts driver provision   # stations, the fixture driver, the CERT… tags
bun bin/ocpp-tck.ts driver verify      # also checks the seeded settings below
bun bin/ocpp-tck.ts driver selftest
bun bin/ocpp-tck.ts run-all --version 1.6 --parallel --retry-failed-isolated
```

Started under another compose project name (`docker compose -p <name> …`, or
`TCK_SUFFIX`), the network is `<name>_evtivity-internal`: set
`EVTIVITY_NETWORK` to match, or the simulator cannot reach the server. The API
is published on `127.0.0.1:8480` (`EVTIVITY_PORT` moves it); the OCPP server is
not published at all.

## Environment

| variable | default | |
|---|---|---|
| `EVTIVITY_API_URL` | `http://localhost:8480` | REST API base |
| `EVTIVITY_WS_URL` | `ws://ocpp:7103/` | OCPP endpoint, the cp id appended |
| `EVTIVITY_EMAIL` / `EVTIVITY_PASSWORD` | `admin@evtivity.local` / `admin123` | the administrator the seed creates |
| `EVTIVITY_NETWORK` | `evtivity_evtivity-internal` | network the simulator joins |
| `EVTIVITY_STATIONS` | `CERTCP1,CERTCP2,CERTCP3` | stations `provision` registers |

The driver logs in once per process for its commands and once for its reads
(two clients, see below), and renews each token before its one-hour expiry.
It does not retry a login refused 401 or 403 for fifteen minutes: every
refused password counts toward the account's sign-in backoff.

## Settings

Four settings differ from EVtivity's defaults, and all four are seeded by
`compose.yaml` (`seed` service, `--apply-config` with `seed.config.json`)
before the `ocpp` service starts. That order matters: `ocpp` caches settings
for 60 s, and a sweep starts inside that window, so a `PUT` at provision time
would not be in force for its first scenarios. `driver verify` reads all four
back.

| setting | value | why |
|---|---|---|
| `ocpp.registrationPolicy` | `open` | a registered station is accepted at its first boot, no approval step |
| `ocpp.offlineCommandTtlHours` | `0` | a command for an offline station is queued and replayed at its next connect — into whichever scenario runs next on that cp id. At 0 it expires at once. |
| `stationMessage.enabled` | `false` | stops the `DataTransfer` PricingDisplay sent after every boot |
| `ocpp.clockAlignedInterval` | `0` | stops a clock-aligned `MeterValues` every quarter hour, and one of the boot `ChangeConfiguration`s |

`ocpp.meterValueInterval` is left at its default on purpose: at `10` the boot
push below would carry TC_021's own value and could stand in for its request.

## How the contract maps

| contract | EVtivity |
|---|---|
| `operations16.execute` | `POST /v1/ocpp/commands/v16/{Action}` with `{stationId, …payload}` |
| `records` transactions | `/v1/stations/{sta}/sessions`, `/v1/sessions?search=` (exact match on the transaction id), `/v1/sessions/{ses}` |
| `records` count per idTag | `/v1/tokens?search=` (exact match), then `/v1/tokens/{dtk}/sessions` for that station |
| `records.chargingProfiles` | this driver's catalogue, `profiles.ts` |
| `records.reservations` | absent — see Scope |
| `prepareStation` | registers the station or unblocks it, and ends a session an interrupted run left active (`POST /v1/sessions/{ses}/end`); one it cannot end because the station is still connected (409 `STATION_ONLINE`) is left with a warning naming it |

The operations are the EVtivity driver of
[`@ovarilo/csms-drivers`](https://github.com/ovarilo/csms-drivers): `index.ts`
adapts `createEvtivityCsmsDriver`, hands it this driver's charging-profile
catalogue for the refs it resolves, and returns its `operations16` and
`commands`. What a command answer means (a 202 queued, a 502 CALLERROR
against a failed send, the 504 variants, a version mismatch) is that
library's to decide, and its own tests hold it.

What stays here is the REST client `records`, the prepare hook and the
provisioning commands use, `api-client.ts`, because the library does not
export its own. Its login rules are the library's: one login per process
and password, renewed on a stale token, a refused password, a 403 or a
`mustResetPassword` kept for fifteen minutes. But the two clients keep
**two login caches**, so a process logs in twice, and a wrong
`EVTIVITY_PASSWORD` is refused twice — it spends the account's sign-in
backoff twice as fast as one client would. `tests/evtivity-adapter.ts` holds
this client's rules and the prepare hook's warning offline.

## Scope

`check-driver` reports 47 `DRIVABLE` and 2 `NOT_APPLICABLE` OCPP 1.6
scenarios:

- **TC_051** (cancel reservation): a raw `v16/ReserveNow` creates no
  reservation record — EVtivity's projection only confirms a hold made through
  `POST /v1/reservations` — so the id to cancel cannot be read back. That
  managed route records a hold, but refuses a connector that is not Available
  before sending anything, which would turn TC_048.1-3 into non-dispatches,
  and can carry the scenario's idTag only as the token of a driver with a
  default payment method, which provision does not create.
- **TC_053** (reserved connector, parent idTag): EVtivity's 1.6
  `Authorize.conf` never carries a `parentIdTag`, and a token has no parent or
  group field.

## Coverage

Measured 2026-11-12 against the pinned images, `bun run e2e` (`run-all
--parallel --retry-failed-isolated`, unsharded) over `CERTCP1,CERTCP2,CERTCP3`,
on a freshly booted stack after `driver provision` and one `cert16-tc021` run on
`CERTCP1` half a minute earlier. The sweep exited 0, had
nothing to retry, and took about 10 minutes; the CSMS answered no command `202`
(nothing was queued for an offline station).

| group | scenarios | `DRIVABLE` | `NOT_APPLICABLE` | PASS | PARTIAL | FAIL |
|---|---|---|---|---|---|---|
| core | 16 | 16 | 0 | 15 | 1 | 0 |
| authorize | 3 | 3 | 0 | 3 | 0 | 0 |
| authlist-reservation | 14 | 12 | 2 | 12 | 0 | 0 |
| remotetrigger-smartcharging | 12 | 12 | 0 | 9 | 3 | 0 |
| firmware | 4 | 4 | 0 | 4 | 0 | 0 |
| **OCPP 1.6** | **49** | **47** | **2** | **43** | **4** | **0** |

The four PARTIAL rows are `tc001` (no `Heartbeat` inside the hold: the boot
answer's interval is 900 s), and `tc010`, `tc011` and `tc059` (no `Authorize`
before a remote start). Each SKIPPED check is the generic every-CALL-answered
check for a message the station never sent. They are four of the five rows
that SteVe and ev-server-lite were measured PARTIAL on (`VENDOR.md`'s validation tables), with the same SKIPPED
checks; the fifth, `tc054`, has since been made to trigger every message its
case lists, and is PASS here. They describe the scenarios and the simulator
rather than this CSMS.

## Deviations

Behaviour of the CSMS a reader of a red row needs to know. None of them is an
expected failure: each acts once per station rather than once per scenario, so
it would make a row red or green depending on the run order.

- **First-boot configuration push.** After a station's first
  `BootNotification` (and then at most once per ten minutes per station, per
  `ocpp` process), EVtivity sends `ChangeConfiguration`s of its own:
  `MeterValueSampleInterval=60`, `MeterValuesSampledData`,
  `StopTxnSampledData` and `ClockAlignedDataInterval=0` with the settings
  above. No setting removes them. They change the station's behaviour too:
  with a 60 s sample interval it sends periodic `MeterValues` during a
  transaction. `cert16-tc021` selects its own request by key and value, so the
  push cannot stand for it. In the measured sweep it reached the first
  scenario on `CERTCP2` and `CERTCP3` (`tc003`, `tc004`); `CERTCP1` had had
  its push in a `tc021` run just before, and got the next one ten minutes
  later, in `tc045-1`. The `MeterValues` of `tc003` and `tc004` then carried
  `Current.Import` besides the energy and power the simulator sends by
  default, at the same 5 s cadence. None of the three changed verdict, and
  `tc001` — first on lane 1 in CI, so the push lands there — run on its own
  with the push stays PARTIAL with the same SKIPPED check.
- **A transaction needs a driver.** A token with no driver account gets its
  transaction stopped by the CSMS 31 ms after `StartTransaction.conf`, with a
  `RemoteStopTransaction` of its own, although `Authorize.conf` said
  `Accepted`. `driver provision` binds every valid tag to one fixture driver;
  `driver verify` reports a tag that is not.
- **Offline queue.** A command for an offline station is answered `202` and
  queued; the driver reports it as not dispatched. Without
  `ocpp.offlineCommandTtlHours=0` it would replay at that cp id's next
  connect.
- **Teardown does not delete.** `DELETE /v1/stations/{id}` blocks a station
  and `DELETE /v1/drivers/{id}` deactivates a driver; `driver provision`
  undoes both. Tags are deleted.
