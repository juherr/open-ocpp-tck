# CSMS driver library

`open-ocpp-tck/csms-driver` contains the reusable OCPP operation contracts,
dispatch errors, capability declarations, typed session and connector read
interfaces, and the bundled SteVe and CitrineOS operation factories. OCPP 1.6
and OCPP 2.0.1 remain separate contracts.

Generic capabilities describe only the operations the returned factory can
dispatch. TCK-only observation flags for reservations, charging profiles, and
device-model records stay in the TCK adapter contract.

The factories do not create a TCK scenario or simulator. They accept CSMS
configuration, a transport, and any lookups needed to translate opaque CSMS
handles. Read APIs can be supplied where a deployment exposes them. The TCK
adapters in `drivers/` add scope declarations, expected failures, fixture
lifecycle, simulator transport, and assertion-oriented `CsmsRecords`.

For a complete executable consumer example, see
[`examples/csms-driver-smoke.ts`](../../examples/csms-driver-smoke.ts). It
creates the CitrineOS factory with a fake HTTP transport and sends an OCPP 2.0.1
Reset without loading the TCK runner.

```ts
import {
  createCitrineOsCsmsDriver,
  type FetchLike,
} from "open-ocpp-tck/csms-driver";

const fetch: FetchLike = async () => new Response(
  JSON.stringify([{ success: true, payload: { status: "Accepted" } }]),
  { status: 200 },
);

const driver = createCitrineOsCsmsDriver({
  config: {
    variant: "v2",
    apiUrl: "http://localhost:8080",
    tenantId: 1,
  },
  refs: { ocppTransactionId: async () => 1 },
  fetch,
});

await driver.operations201?.execute("station-1", {
  action: "Reset",
  type: "Immediate",
});
```

## Charge-point administration

Registering a station with the CSMS before it connects is administrative
provisioning, not an OCPP message, so it is a surface of its own:
`driver.chargePoints`. It is optional. A consumer detects it from the
capabilities alone, without knowing which CSMS is behind the driver:

```ts
const profiles = driver.capabilities.chargePoints?.securityProfiles;
if (driver.chargePoints && profiles?.has(1)) {
  const existing = await driver.chargePoints.get("CP-1");
  const security = { profile: 1, basicAuthPassword: "secret" } as const;
  if (existing === null) {
    await driver.chargePoints.create({ id: "CP-1", registration: "Accepted", security });
  } else {
    await driver.chargePoints.update("CP-1", { registration: "Accepted", security });
  }
}
```

The model names what OCPP defines (the station identity, its registration
status, security profiles 0 to 3 and the HTTP Basic password profiles 1 and 2
carry) and an optional description; CSMS form fields stay inside each driver.
Every driver answers the edge cases alike:

| call     | missing id                        | existing id                           |
|----------|-----------------------------------|---------------------------------------|
| `create` | creates                           | throws `ChargePointAlreadyExistsError` |
| `get`    | `null`                            | its details, never the password       |
| `update` | throws `ChargePointNotFoundError` | changes only the members it names     |
| `delete` | resolves                          | deletes                               |

An omitted registration means `Accepted` and omitted security means profile 0,
which a driver that does not declare profile 0 refuses like any other.
An update's `security` replaces the whole block, so moving a station to
profile 0 or 3 discards its stored password; `description: null` clears the
description.
A profile outside `capabilities.chargePoints.securityProfiles` is refused with
`UnsupportedOperationError`. `create` is deliberately not an upsert: the
password cannot be read back, so whether an existing station matches a
definition is undecidable, and the `get`-then-`create`-or-`update` idiom above
is how a caller provisions idempotently.

The SteVe driver implements the surface, on every security profile, through
the manager UI: SteVe has no REST endpoint for charge points
([steve-community/steve#2068](https://github.com/steve-community/steve/issues/2068)).
Three things follow from that UI. A refusal (a password outside SteVe's 16 to
20 characters, say) is a plain `Error` carrying the page's error text. SteVe
cannot clear a stored password, so a move to profile 0 or 3 replaces it with
a random one nobody holds. And a security change on a station that is
connected is pushed to it as `ChangeConfiguration`; if the station refuses,
`update` throws although the record has changed. The CitrineOS driver does not
implement the surface yet.

## Over HTTP

`ocpp-tck csms-server` serves a driver over HTTP/JSON for applications in any
language, and `open-ocpp-tck/csms-driver/server` exports the handler behind it.
See [`server/README.md`](server/README.md).

The existing `open-ocpp-tck/driver` import remains available for driver modules
that implement the TCK lifecycle contract.
