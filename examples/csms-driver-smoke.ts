// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import {
  createCitrineOsCsmsDriver,
  type FetchLike,
} from "open-ocpp-tck/csms-driver";

const requests: { url: string; body: string }[] = [];
const fetch: FetchLike = async (input, init) => {
  requests.push({ url: String(input), body: String(init?.body ?? "") });
  return new Response(JSON.stringify([{ success: true, payload: { status: "Accepted" } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const driver = createCitrineOsCsmsDriver({
  config: {
    variant: "v2",
    apiUrl: "http://localhost:8080",
    tenantId: 1,
  },
  refs: { ocppTransactionId: async () => 1 },
  fetch,
});

const receipt = await driver.operations201?.execute("station-1", {
  action: "Reset",
  type: "Immediate",
});

if (!receipt || requests.length !== 1) {
  throw new Error("The standalone CSMS driver did not dispatch its operation.");
}
if (!requests[0].url.includes("/ocpp/2.0.1/configuration/reset?")) {
  throw new Error(`Unexpected OCPP route: ${requests[0].url}`);
}
if (requests[0].body !== JSON.stringify({ type: "Immediate" })) {
  throw new Error(`Unexpected OCPP request: ${requests[0].body}`);
}

console.log("Standalone CSMS driver example passed.");
