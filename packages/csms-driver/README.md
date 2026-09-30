# CSMS driver library

`open-ocpp-tck/csms-driver` contains the reusable OCPP operation contracts,
dispatch errors, capability declarations, typed session and connector read
interfaces, and the bundled SteVe and CitrineOS operation factories. OCPP 1.6
and OCPP 2.0.1 remain separate contracts.

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

The existing `open-ocpp-tck/driver` import remains available for driver modules
that implement the TCK lifecycle contract.
