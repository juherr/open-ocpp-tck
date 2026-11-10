// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * Public-factory composition: a SteVe OCPP 1.6 operation must be encoded and
 * posted through its authenticated manager-UI flow, and a CitrineOS OCPP 1.6
 * operation must reach the matching route with its station and tenant. A SteVe
 * ReserveNow carrying a parentIdTag is posted only when it is the parent
 * SteVe will send anyway, and refused as unsupported otherwise -- except for
 * a reserved tag SteVe does not store, which the driver's wired lookup fails
 * on as a missing fixture rather than as an unsupported request. The group
 * fixtures that lookup reads are rebuilt children-first, so a drifted parent
 * is never deleted while a child still names it. The fakes
 * observe the public factory result without starting a CSMS or TCK run.
 */

import {
  createCitrineOsCsmsDriver,
  createSteveCsmsDriver,
  UnsupportedOperationError,
} from "open-ocpp-tck/csms-driver";
import type { FetchLike } from "open-ocpp-tck/csms-driver";
import {
  ocppTagParentLookup,
  provisionUsableTags,
  type OcppTagOverview,
} from "../drivers/steve/provision";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * A fake SteVe manager UI: signin, then the `action` operation form, whose
 * POST is recorded and redirected to task `taskId`. Anything else is a 500.
 */
function steveFetch(
  action: string,
  taskId: number,
): { fetch: FetchLike; posts: { url: string; body: string }[] } {
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
    if (url.endsWith(`/operations/v1.6/${action}`) && method === "GET") {
      return new Response('<input name="_csrf" value="operation-token">');
    }
    if (url.endsWith(`/operations/v1.6/${action}`) && method === "POST") {
      posts.push({ url, body: String(init?.body ?? "") });
      return redirect(`/manager/operations/tasks/${taskId}`);
    }
    return new Response("unexpected request", { status: 500 });
  };
  return { fetch, posts };
}

async function verifySteveFactory(): Promise<void> {
  const { fetch, posts } = steveFetch("Reset", 42);

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

/**
 * SteVe's ReserveNow form has no parentIdTag field: SteVe sends the reserved
 * tag's STORED parent (ChargePointServiceClient#reserveNow reads it from
 * ocpp_tag). So a requested parentIdTag is either the one SteVe will send, or
 * one this driver cannot express -- and dropping it silently would let a
 * scenario believe it reserved for a group it never named. Four rows: the
 * request without a parent is untouched, and a parent is posted only when the
 * injected lookup says SteVe stores exactly that one.
 */
async function verifySteveReserveNowParent(): Promise<void> {
  const config = { baseUrl: "http://steve/manager", username: "operator", password: "secret" };
  const reserve = {
    action: "ReserveNow" as const,
    connectorId: 1,
    idTag: "TAG-RES",
    expiryDate: new Date("2030-01-01T00:00:00Z"),
  };
  const lookedUp: string[] = [];
  const storedParent = async (idTag: string): Promise<string | null> => {
    lookedUp.push(idTag);
    return idTag === "TAG-RES" ? "TAG-GRP" : null;
  };

  /** Executes `reserve` with `overrides` through a fresh fake SteVe; the
   *  error it threw, if any, and the forms it posted. */
  async function reserveWith(
    ocppTagParent: ((idTag: string) => Promise<string | null>) | undefined,
    overrides: Partial<typeof reserve> & { parentIdTag?: string },
  ): Promise<{ err: unknown; posts: unknown[] }> {
    const { fetch, posts } = steveFetch("ReserveNow", 43);
    try {
      await createSteveCsmsDriver({ config, fetch, ocppTagParent }).operations16.execute("CP-1", {
        ...reserve,
        ...overrides,
      });
      return { err: undefined, posts };
    } catch (err) {
      return { err, posts };
    }
  }

  const plain = steveFetch("ReserveNow", 43);
  await createSteveCsmsDriver({ config, fetch: plain.fetch }).operations16.execute("CP-1", reserve);
  check(plain.posts.length === 1, "SteVe ReserveNow without a parentIdTag is posted as before");

  const { err: blindErr, posts: blindPosts } = await reserveWith(undefined, { parentIdTag: "TAG-GRP" });
  check(
    blindErr instanceof UnsupportedOperationError,
    "SteVe ReserveNow refuses a parentIdTag it has no way to check against the stored parent",
  );
  check(blindPosts.length === 0, "SteVe ReserveNow posts nothing when it cannot check the parentIdTag");

  const { err: matchingErr, posts: matchingPosts } = await reserveWith(storedParent, { parentIdTag: "TAG-GRP" });
  check(
    matchingErr === undefined && matchingPosts.length === 1,
    `SteVe ReserveNow posts a parentIdTag equal to the reserved tag's stored parent${matchingErr ? ` (threw: ${String(matchingErr)})` : ""}`,
  );
  check(lookedUp.join(",") === "TAG-RES", "SteVe ReserveNow looks up the parent of the RESERVED idTag");

  const { err: wrongErr, posts: wrongPosts } = await reserveWith(storedParent, { parentIdTag: "TAG-OTHER" });
  check(
    wrongErr instanceof UnsupportedOperationError,
    "SteVe ReserveNow refuses a parentIdTag other than the reserved tag's stored parent",
  );
  check(wrongPosts.length === 0, "SteVe ReserveNow posts nothing for a parentIdTag SteVe would not send");

  // The lookup the SteVe driver actually wires, over a fake WebAPI. A tag
  // stored WITHOUT a parent is a real "SteVe would send none", so the refusal
  // stays UnsupportedOperationError. A tag SteVe does not store is a missing
  // fixture: answering null for it too turned a broken environment into a
  // NOT APPLICABLE row, so it has to be an ordinary failure that says how to
  // fix it.
  const tags = [
    { idTag: "TAG-RES", parentIdTag: "TAG-GRP" },
    { idTag: "TAG-LONE", parentIdTag: null },
  ];
  const webApi = { getJson: async <T>(path: string): Promise<T> => (path === "/ocppTags" ? tags : []) as T };
  const wired = ocppTagParentLookup(webApi);

  const { err: knownErr, posts: knownPosts } = await reserveWith(wired, { parentIdTag: "TAG-GRP" });
  check(
    knownErr === undefined && knownPosts.length === 1,
    `SteVe's wired lookup posts a ReserveNow whose parentIdTag is the stored one${knownErr ? ` (threw: ${String(knownErr)})` : ""}`,
  );

  const { err: loneErr, posts: lonePosts } = await reserveWith(wired, { idTag: "TAG-LONE", parentIdTag: "TAG-GRP" });
  check(
    loneErr instanceof UnsupportedOperationError && lonePosts.length === 0,
    "SteVe's wired lookup refuses as unsupported a parentIdTag for a tag stored without a parent",
  );

  const { err: unknownErr, posts: unknownPosts } = await reserveWith(wired, { idTag: "TAG-MISSING", parentIdTag: "TAG-GRP" });
  check(
    unknownErr instanceof Error &&
      !(unknownErr instanceof UnsupportedOperationError) &&
      unknownErr.message.includes("TAG-MISSING") &&
      unknownErr.message.includes("driver provision"),
    `SteVe's wired lookup fails on a tag SteVe does not store, naming it and \`driver provision\`, rather than reading as unsupported (got: ${String(unknownErr)})`,
  );
  check(unknownPosts.length === 0, "SteVe's wired lookup posts nothing for a tag SteVe does not store");
}

/**
 * The fixtures that ReserveNow lookup reads, rebuilt in the order SteVe's
 * schema forces. `ocpp_tag.parent_id_tag` is a foreign key ON DELETE NO
 * ACTION, so rebuilding a drifted parent (blocked, or expired by an earlier
 * run) while its children still name it is a refused DELETE -- and provision
 * stops there. The fake store enforces that key both ways; what is asserted
 * is the end state, every grouped tag back under a usable parent.
 */
async function verifySteveGroupTagRebuild(): Promise<void> {
  let nextPk = 1;
  const rows = new Map<string, OcppTagOverview>();
  const put = (idTag: string, extra: Partial<OcppTagOverview> = {}): void => {
    rows.set(idTag, {
      ocppTagPk: nextPk++,
      idTag,
      expiryDate: null,
      blocked: false,
      maxActiveTransactionCount: -1,
      parentIdTag: null,
      ...extra,
    });
  };
  put("CERT053-GRP", { blocked: true, maxActiveTransactionCount: 0 });
  put("CERT053-RES", { parentIdTag: "CERT053-GRP" });
  put("CERT053-CHILD", { parentIdTag: "CERT053-GRP" });

  const store = {
    async create(body: Record<string, unknown>): Promise<void> {
      const idTag = String(body.idTag);
      const parentIdTag = (body.parentIdTag as string | undefined) ?? null;
      if (rows.has(idTag)) throw new Error(`duplicate idTag ${idTag}`);
      if (parentIdTag !== null && !rows.has(parentIdTag)) {
        throw new Error(`FK: parent ${parentIdTag} of ${idTag} does not exist`);
      }
      put(idTag, { parentIdTag });
    },
    async delete(pk: number): Promise<void> {
      const row = [...rows.values()].find((r) => r.ocppTagPk === pk);
      if (!row) throw new Error(`no ocpp_tag pk ${pk}`);
      const child = [...rows.values()].find((r) => r.parentIdTag === row.idTag);
      if (child) throw new Error(`FK: ${child.idTag} still names ${row.idTag} as its parent`);
      rows.delete(row.idTag);
    },
  };

  const err = await provisionUsableTags(store, new Map(rows), () => {}).then(
    () => undefined,
    (e: unknown) => e,
  );
  check(err === undefined, `SteVe provisioning rebuilds a drifted group parent its children name (threw: ${String(err)})`);
  const parent = rows.get("CERT053-GRP");
  check(parent !== undefined && !parent.blocked, "SteVe provisioning leaves the group parent usable");
  for (const child of ["CERT053-RES", "CERT053-CHILD"]) {
    check(rows.get(child)?.parentIdTag === "CERT053-GRP", `SteVe provisioning leaves ${child} under CERT053-GRP`);
  }
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
await verifySteveReserveNowParent();
await verifySteveGroupTagRebuild();
await verifyCitrine16Factory();

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("CSMS factories: SteVe UI wiring and CitrineOS 1.6 dispatch hold.");
}
