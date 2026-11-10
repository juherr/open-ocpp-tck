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
```

The first build compiles the server with Maven and takes several minutes. The
`local` profile keeps everything in an in-memory H2 database, so **a restart
is a fresh server**: run `driver provision` again after one.

Two limits are hard-coded in the server and counted in that database, so only
a restart resets them:

- **ten logins per fifteen minutes** for the admin account. The driver logs in
  once per process and never retries a login the server refused, but every
  `ocpp-tck` invocation is a process: provision, verify, selftest and each
  sweep spend one each.
- **sixty WebSocket handshakes per fifteen minutes per station.** A full sweep
  over three stations reconnects each one many times; restart the container
  before a second sweep.

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

`ocpp-tck check-driver` reports 43 `DRIVABLE`, 2 `CONDITIONAL` and 2
`NOT_APPLICABLE` OCPP 1.6 scenarios; every OCPP 2.0.1 one is not applicable
through `protocols`. `scope.ts` names the endpoint behind each row and the
question each `CONDITIONAL` row leaves for the first live run.

## Coverage

To be filled from the first live sweep.

## Deviations

To be filled from the first live sweep: one row per scenario the CSMS drives
and gets wrong, with the trace evidence, mirrored by an entry in
`expected.ts`.
