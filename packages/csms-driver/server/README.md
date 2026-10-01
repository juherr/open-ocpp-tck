# csms-server: the CSMS driver over HTTP

`ocpp-tck csms-server` serves a CSMS driver over HTTP/JSON, so an application
in any language can provision a charge point and send an OCPP 1.6 remote
operation through the CSMS without importing TypeScript. The API is the same
whichever CSMS is behind it: SteVe's form fields and CitrineOS's routes stay
inside their drivers.

The daemon is a thin adapter. Each request decodes its body, checks what the
driver declares, makes at most one driver call and translates the outcome. It
keeps no state between requests and runs no workflow: sequencing calls is the
client's job.

## Running it

The daemon loads its driver exactly as the TCK runner does: `CSMS_DRIVER`
names the module, and the driver reads its configuration and credentials from
the same environment variables (`ocpp-tck --help` lists them for the selected
driver).

```sh
CSMS_DRIVER=./drivers/steve/index.ts \
STEVE_URL=http://localhost:8180/steve/manager STEVE_PASS=... \
  bunx ocpp-tck csms-server --port 8787
```

| flag | default | |
|---|---|---|
| `--host` | `127.0.0.1` | The daemon has no authentication of its own, so it only listens on loopback unless you choose otherwise. |
| `--port` | `8787` | `0` picks a free port; the chosen URL is printed. |
| `--timeout-ms` | `60000` | How long one driver call may take before the daemon answers `504 timeout`. From 1 to 2147483647: a deadline that expires before any driver can answer would report every dispatched operation as `timeout`, so it is refused rather than clamped. |

The daemon stops on SIGINT or SIGTERM. It logs one line per request to stderr
(method, path, status, error code) and never logs a body.

Credentials are never returned: `GET /v1/driver` reports declarations only,
and the read-back of a charge point has no password. Error messages and log
lines are redacted, but only of values the daemon knows:

- the value of any environment variable whose name has `PASS`, `PASSWD`,
  `PASSWORD`, `SECRET`, `TOKEN`, `KEY` or `CREDENTIAL(S)` as an
  underscore-separated word (`STEVE_PASS`, `SIM_WS_BASIC_PASS`), if it is at
  least four characters long;
- the Basic Auth password carried by the request itself.

A driver's built-in default credential, which is not in the environment, is
not known to the daemon. Neither is a password the CSMS echoes back escaped or
truncated.

## The API

All routes are under `/v1`. Bodies are JSON. Decoding is strict: a missing or
mistyped member is refused, and so is any member the model does not have.

| route | driver call |
|---|---|
| `GET /v1/driver` | none: what the driver declares |
| `POST /v1/charge-points` | `chargePoints.create` |
| `GET /v1/charge-points/{id}` | `chargePoints.get` |
| `PATCH /v1/charge-points/{id}` | `chargePoints.update` |
| `DELETE /v1/charge-points/{id}` | `chargePoints.delete` |
| `POST /v1/charge-points/{id}/operations/{operation}` | `operations16.execute` |

`{id}` is the station's OCPP identity, percent-encoded like any other path
segment.

### What the driver supports

```http
GET /v1/driver
```

For example, for a driver that declares two operations and charge-point
administration:

```json
{
  "id": "example",
  "displayName": "Example CSMS",
  "protocols": ["OCPP-1.6J"],
  "operations16": [
    { "operation": "reset", "action": "Reset" },
    { "operation": "remote-start", "action": "RemoteStartTransaction" }
  ],
  "chargePoints": { "securityProfiles": [0, 1, 2] }
}
```

`operations16` lists only the operations this driver declares. `chargePoints`
is `null` unless the driver both declares charge-point administration and
provides it. `protocols` is
`null` when the driver does not say.

### Provisioning a charge point

The model is the library's [charge-point administration](../README.md#charge-point-administration)
surface, and the JSON members carry the same names.

```http
POST /v1/charge-points
content-type: application/json

{
  "id": "CP-1",
  "registration": "Accepted",
  "security": { "profile": 1, "basicAuthPassword": "s3cret" },
  "description": "Bay 1"
}
```

```http
HTTP/1.1 201 Created
location: /v1/charge-points/CP-1

{ "id": "CP-1" }
```

- `registration` is `Accepted`, `Pending` or `Rejected`. If omitted, it is
  `Accepted`.
- `security.profile` is 0 to 3. Profiles 1 and 2 require a non-empty
  `basicAuthPassword`; profiles 0 and 3 refuse one. If `security` is omitted,
  the profile is 0. A profile the driver does not list in
  `securityProfiles`, including that implicit 0, answers
  `501 unsupported_capability`.
- `create` is not an upsert. If the id already exists, it answers
  `409 conflict` and changes nothing.

```http
GET /v1/charge-points/CP-1
```

```json
{ "id": "CP-1", "registration": "Accepted", "security": { "profile": 1 }, "description": "Bay 1" }
```

An unknown id answers `404 not_found`. The password is never read back.

```http
PATCH /v1/charge-points/CP-1
content-type: application/json

{ "registration": "Rejected", "description": null }
```

`PATCH` answers `204` and changes only the members it names. A `security`
block replaces the whole block, so moving to profile 0 or 3 discards the
stored password. `"description": null` clears the description. An unknown id
answers `404 not_found` and creates nothing.

`DELETE /v1/charge-points/CP-1` answers `204`, including for an id that does
not exist.

To provision idempotently, call `GET` first, then `POST` if the station is
absent or `PATCH` if it exists.

### Sending an OCPP 1.6 operation

```http
POST /v1/charge-points/CP-1/operations/reset
content-type: application/json

{ "type": "Hard" }
```

```http
HTTP/1.1 202 Accepted

{ "chargePointId": "CP-1", "operation": "reset", "action": "Reset", "status": "dispatched" }
```

`202` means the CSMS accepted or dispatched the request. It does not mean the
charge point has answered: the charge point's response is not returned, and
the station side is where to observe it. The body is the operation's
`CsmsOperation16` arm without `action`, because the path names the action.
Dates are RFC 3339 strings with an offset (`2030-01-02T03:04:05Z`). A date
that does not exist, such as `2030-02-31` or hour 24, is refused instead of
being rolled over to another day. A leap second is refused too, because the
driver contract carries a JavaScript `Date`.
Transaction, reservation and charging-profile references are the driver's
opaque string handles. An operation without members accepts an empty body.

| path | `CsmsOperation16` action | body |
|---|---|---|
| `reset` | `Reset` | `type`: `Hard` \| `Soft` |
| `unlock` | `UnlockConnector` | `connectorId` |
| `clear-cache` | `ClearCache` | none |
| `change-availability` | `ChangeAvailability` | `connectorId`, `type`: `Operative` \| `Inoperative` |
| `get-configuration` | `GetConfiguration` | `keys?`: string[] (omitted means every key) |
| `change-configuration` | `ChangeConfiguration` | `key`, `value` |
| `remote-start` | `RemoteStartTransaction` | `idTag`, `connectorId?`, `chargingProfile?` |
| `remote-stop` | `RemoteStopTransaction` | `transaction` |
| `trigger-message` | `TriggerMessage` | `requestedMessage`, `connectorId?` |
| `set-charging-profile` | `SetChargingProfile` | `connectorId`, `chargingProfile`, `transaction?` |
| `get-composite-schedule` | `GetCompositeSchedule` | `connectorId`, `duration`, `chargingRateUnit?` |
| `clear-charging-profile` | `ClearChargingProfile` | `chargingProfile?`, `connectorId?`, `purpose?`, `stackLevel?` |
| `update-firmware` | `UpdateFirmware` | `location`, `retrieveDate`, `retries?`, `retryInterval?` |
| `get-diagnostics` | `GetDiagnostics` | `location`, `startTime?`, `stopTime?`, `retries?`, `retryInterval?` |
| `get-local-list-version` | `GetLocalListVersion` | none |
| `send-local-list` | `SendLocalList` | `listVersion`, `updateType`, `localAuthorizationList?` |
| `reserve-now` | `ReserveNow` | `connectorId`, `idTag`, `expiryDate`, `parentIdTag?`, `reservation?` |
| `cancel-reservation` | `CancelReservation` | `reservation` |

The member types and enumerations are those of `CsmsOperation16` in
[`contracts.ts`](../contracts.ts).

## Errors

Every error has the same body. Branch on `code`; `message` is for humans and
may change.

```json
{ "error": { "code": "unsupported_capability", "message": "this driver does not declare ReserveNow" } }
```

| status | `code` | meaning |
|---|---|---|
| 400 | `invalid_input` | The body is not valid JSON, or does not match the model. The driver was not called. |
| 404 | `not_found` | No such route or operation path, or no such charge point. |
| 405 | `method_not_allowed` | The route exists but does not serve this method. The `allow` header names the methods it does serve. |
| 409 | `conflict` | `create` of an id that already exists. Nothing was changed. |
| 501 | `unsupported_capability` | The driver does not declare the operation, has no charge-point administration, does not accept the security profile, or refused the request as something it cannot express. |
| 502 | `transport_failure` | The request never reached the CSMS as an operation: the connection failed, the CSMS refused the driver's credentials, or it refused the request before dispatching it. The driver contract has no separate class for an authentication failure, so this code covers it. |
| 502 | `csms_rejected` | The CSMS answered, but did not do what was asked, for example a form that came back with validation errors. |
| 504 | `timeout` | The driver call did not finish within `--timeout-ms`. **The outcome is unknown**: the request may still have been dispatched. |
| 500 | `internal` | A defect in the daemon itself. |

## Limits

- OCPP 1.6 operations only. The OCPP 2.0.1 vocabulary (`operations201`) is
  not served yet; it would get its own path prefix, so adding it changes
  nothing above.
- The daemon does not read sessions or connector state.

## Embedding the handler

The HTTP surface is also a library: `open-ocpp-tck/csms-driver/server` exports
`createCsmsHttpHandler(driver, options)`, a `(Request) => Promise<Response>`
over any `CsmsDriver`, which you can hand to `Bun.serve` without the TCK:

```ts
import { createSteveCsmsDriver } from "open-ocpp-tck/csms-driver";
import { createCsmsHttpHandler } from "open-ocpp-tck/csms-driver/server";

const driver = createSteveCsmsDriver({ config: { baseUrl, username, password } });
Bun.serve({
  hostname: "127.0.0.1",
  port: 8787,
  fetch: createCsmsHttpHandler(driver, {
    about: { id: "steve", displayName: "SteVe" },
    secrets: [password],
  }),
});
```
