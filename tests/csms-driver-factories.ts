// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * Public-factory composition: a SteVe OCPP 1.6 operation must be encoded and
 * posted through its authenticated manager-UI flow, and a CitrineOS OCPP 1.6
 * operation must reach the matching route with its station and tenant. The
 * fakes observe the public factory result without starting a CSMS or TCK run.
 */

import {
  createCitrineOsCsmsDriver,
  createSteveCsmsDriver,
} from "open-ocpp-tck/csms-driver";
import type { FetchLike } from "open-ocpp-tck/csms-driver";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

async function verifySteveFactory(): Promise<void> {
  const posts: { url: string; body: string }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/signin") && method === "GET") {
      return new Response('<input name="_csrf" value="login-token">');
    }
    if (url.endsWith("/signin") && method === "POST") {
      return redirect("/manager/home");
    }
    if (url.endsWith("/operations/v1.6/Reset") && method === "GET") {
      return new Response('<input name="_csrf" value="operation-token">');
    }
    if (url.endsWith("/operations/v1.6/Reset") && method === "POST") {
      posts.push({ url, body: String(init?.body ?? "") });
      return redirect("/manager/operations/tasks/42");
    }
    return new Response("unexpected request", { status: 500 });
  };

  const driver = createSteveCsmsDriver({
    config: { baseUrl: "http://steve/manager", username: "operator", password: "secret" },
    fetch,
  });
  const receipt = await driver.operations16.execute("CP-1", { action: "Reset", type: "Hard" });
  const form = new URLSearchParams(posts[0]?.body);

  check(driver.capabilities.operations16.has("Reset"), "SteVe capability declaration includes its wired operation");
  check(driver.operations201 === undefined, "SteVe factory does not claim an OCPP 2.0.1 operation surface");
  check(receipt === "/manager/operations/tasks/42", "SteVe factory returns its task redirect");
  check(posts.length === 1, "SteVe factory posts one OCPP operation");
  check(posts[0]?.url.endsWith("/operations/v1.6/Reset"), "SteVe factory selects the Reset form");
  check(form.get("chargePointSelectList") === "V_16_JSON;CP-1;-", "SteVe factory targets the requested station");
  check(form.get("resetType") === "HARD", "SteVe factory maps the OCPP operation to the UI form");
}

async function verifyCitrine16Factory(): Promise<void> {
  let requestUrl = "";
  let requestBody = "";
  const fetch: FetchLike = async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? "");
    return Response.json([{ success: true, payload: "Accepted" }]);
  };

  const driver = createCitrineOsCsmsDriver({
    config: { variant: "v2", apiUrl: "http://citrine/api", tenantId: 7 },
    refs: { ocppTransactionId: async () => 1 },
    fetch,
  });
  const receipt = await driver.operations16.execute("CP-2", { action: "Reset", type: "Hard" });

  check(driver.capabilities.operations16.has("Reset"), "CitrineOS capability declaration includes its wired operation");
  check(driver.capabilities.operations201?.has("Reset") === true, "CitrineOS declares its wired OCPP 2.0.1 operation surface");
  check(driver.operations201 !== undefined, "CitrineOS factory returns its OCPP 2.0.1 operations");
  check(requestUrl.includes("/ocpp/1.6/configuration/reset?"), "CitrineOS factory sends a 1.6 Reset route");
  check(requestUrl.includes("identifier=CP-2") && requestUrl.includes("tenantId=7"), "CitrineOS factory targets the station and tenant");
  check(requestBody === '{"type":"Hard"}', "CitrineOS factory serializes the 1.6 request body");
  check(receipt.includes('"success":true'), "CitrineOS factory returns the confirmation receipt");
}

await verifySteveFactory();
await verifyCitrine16Factory();

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("CSMS factories: SteVe UI wiring and CitrineOS 1.6 dispatch hold.");
}
