// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * csms-server.ts -- the `csms-server` daemon is a thin, deterministic HTTP
 * adapter over a `CsmsDriver` (issue #156).
 *
 * A process in any language provisions a charge point and drives an OCPP 1.6
 * operation through the daemon, so what it can rely on is what this guard
 * holds. The handler is a pure `(Request) => Promise<Response>`, so most rows
 * hand it requests directly; the first part goes through a real port and the
 * driver registry, because "the daemon starts" is a claim about that path.
 *
 * PROPERTY, in 7 parts:
 *  1. THE DAEMON STARTS ON A LOADED DRIVER. `startCsmsServer` resolves
 *     `CSMS_DRIVER` like the TCK does, describes it from its module, serves
 *     it on a port, provisions a station and routes an operation through it
 *     -- the issue's acceptance flow, with no TypeScript on the client side --
 *     and `stop` closes the driver's parts -- as does a start that fails
 *     after `create(env)`, which leaves the caller no server to stop. A
 *     module that declares nothing is served the compulsory 1.6 vocabulary
 *     and no admin surface.
 *  2. ONE REQUEST, ONE DRIVER CALL. A lifecycle request reaches the matching
 *     `chargePoints` method once, with the decoded argument; an operation
 *     reaches `operations16.execute` once, with the `CsmsOperation16` the
 *     body describes -- dates as `Date`, an omitted member still omitted.
 *  3. THE OPERATION PATHS ARE ONE TABLE. Every 1.6 action has exactly one
 *     kebab-case path, the issue's four (`reset`, `unlock`, `remote-start`,
 *     `remote-stop`) among them, and no path names two actions.
 *  4. UNSUPPORTED IS EXPLICIT. An undeclared action, a driver without
 *     `chargePoints` (or declaring it without the surface), an undeclared
 *     security profile -- the implicit profile 0 included -- and a driver
 *     throwing `UnsupportedOperationError` all answer 501
 *     `unsupported_capability`, and all but the last never call the driver.
 *  5. ERRORS TRANSLATE DETERMINISTICALLY. Each failure class maps to one
 *     status and one code in the `{"error":{"code","message"}}` envelope --
 *     a daemon defect to `internal`, never to a CSMS code; an input refusal
 *     (400) never calls the driver, and an impossible calendar date is one;
 *     a deadline answers 504 and says the outcome is unknown, and a deadline
 *     that could expire before any driver answers is refused at start, by
 *     the library and by the CLI.
 *  6. NOTHING CSMS-SHAPED OR SECRET LEAVES. The driver's receipt is not
 *     returned; a password is not read back; a configured secret or a
 *     request's Basic Auth password inside a driver error is redacted in the
 *     response; the log line carries neither a body nor an error message,
 *     and a secret in its path is redacted.
 *  7. THE DESCRIPTION IS DECLARATIVE. `GET /v1/driver` reports identity and
 *     capabilities and nothing else, and only an admin surface that is both
 *     declared and present.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ChargePointAlreadyExistsError,
  ChargePointNotFoundError,
  CSMS_OPERATION_16_ACTIONS,
  CsmsNotDispatchedError,
  UnsupportedOperationError,
  type ChargePointDefinition,
  type ChargePointDetails,
  type ChargePointSecurityProfile,
  type ChargePointUpdate,
  type CsmsDriver,
  type CsmsOperation16,
  type CsmsOperation16Action,
} from "open-ocpp-tck/csms-driver";
import {
  createCsmsHttpHandler,
  MAX_TIMEOUT_MS,
  OPERATION_16_PATHS,
  type CsmsHttpOptions,
} from "open-ocpp-tck/csms-driver/server";
import { csmsServerCommand, startCsmsServer } from "../tck/csms-server";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------
// An in-memory driver that records every call and fails on request.
// ---------------------------------------------------------------------------

interface Recorder {
  executes: { cpId: string; op: CsmsOperation16 }[];
  admin: { method: string; args: unknown[] }[];
}

interface FakeOptions {
  operations?: readonly CsmsOperation16Action[];
  /** Implements `chargePoints`. Default true. */
  admin?: boolean;
  /** Declares `capabilities.chargePoints`. Default: whatever `admin` is. */
  declareAdmin?: boolean;
  profiles?: readonly ChargePointSecurityProfile[];
  /** Thrown (or, for "hang", never settled) by every driver call. */
  fail?: Error | "hang";
  stored?: ChargePointDetails;
}

function fakeDriver(options: FakeOptions = {}): { driver: CsmsDriver; seen: Recorder } {
  const seen: Recorder = { executes: [], admin: [] };
  const outcome = async <T>(value: T): Promise<T> => {
    if (options.fail === "hang") return new Promise<T>(() => {});
    if (options.fail) throw options.fail;
    return value;
  };
  const admin = options.admin ?? true;
  const declareAdmin = options.declareAdmin ?? admin;
  const driver: CsmsDriver = {
    capabilities: {
      operations16: new Set(options.operations ?? CSMS_OPERATION_16_ACTIONS),
      ...(declareAdmin
        ? { chargePoints: { securityProfiles: new Set<ChargePointSecurityProfile>(options.profiles ?? [0, 1]) } }
        : {}),
    },
    operations16: {
      async execute(cpId, op) {
        seen.executes.push({ cpId, op });
        return outcome("/manager/operations/tasks/42");
      },
    },
    ...(admin
      ? {
          chargePoints: {
            async create(definition: ChargePointDefinition) {
              seen.admin.push({ method: "create", args: [definition] });
              return outcome(undefined);
            },
            async get(cpId: string) {
              seen.admin.push({ method: "get", args: [cpId] });
              const stored = options.stored;
              return outcome(stored && stored.id === cpId ? stored : null);
            },
            async update(cpId: string, patch: ChargePointUpdate) {
              seen.admin.push({ method: "update", args: [cpId, patch] });
              return outcome(undefined);
            },
            async delete(cpId: string) {
              seen.admin.push({ method: "delete", args: [cpId] });
              return outcome(undefined);
            },
          },
        }
      : {}),
  };
  return { driver, seen };
}

interface Exchange {
  status: number;
  headers: Headers;
  body: any;
  text: string;
  log: string[];
  seen: Recorder;
}

async function exchange(
  method: string,
  path: string,
  body?: unknown,
  fake: FakeOptions = {},
  options: Partial<CsmsHttpOptions> = {},
): Promise<Exchange> {
  const { driver, seen } = fakeDriver(fake);
  const log: string[] = [];
  const handler = createCsmsHttpHandler(driver, {
    about: { id: "memory", displayName: "In-memory CSMS", protocols: ["OCPP-1.6J"] },
    log: (line) => log.push(line),
    ...options,
  });
  const init: RequestInit = { method };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await handler(new Request(`http://daemon${path}`, init));
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.status, headers: res.headers, body: parsed, text, log, seen };
}

function isEnvelope(body: unknown, code: string): boolean {
  if (typeof body !== "object" || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const keys = Object.keys(body).join(",");
  const inner = Object.keys(error).sort().join(",");
  return keys === "error" && inner === "code,message" &&
    (error as { code: unknown }).code === code &&
    typeof (error as { message: unknown }).message === "string";
}

async function expectError(
  label: string,
  status: number,
  code: string,
  run: () => Promise<Exchange>,
  driverCalled = true,
): Promise<Exchange> {
  const ex = await run();
  check(ex.status === status, `${label}: answered ${ex.status}, expected ${status} (${ex.text})`);
  check(isEnvelope(ex.body, code), `${label}: body is not the ${code} envelope: ${ex.text}`);
  check(
    (ex.headers.get("content-type") ?? "").startsWith("application/json"),
    `${label}: an error is not served as JSON`,
  );
  if (!driverCalled) {
    check(
      ex.seen.executes.length === 0 && ex.seen.admin.length === 0,
      `${label}: the driver was called (${JSON.stringify(ex.seen)})`,
    );
  }
  return ex;
}

const RESET = "/v1/charge-points/CP-1/operations/reset";

// ---------------------------------------------------------------------------
// Part 3 -- the path table.
// ---------------------------------------------------------------------------

{
  const paths = CSMS_OPERATION_16_ACTIONS.map((action) => OPERATION_16_PATHS[action]);
  check(
    paths.every((path) => typeof path === "string" && /^[a-z]+(-[a-z]+)*$/.test(path)),
    `every 1.6 action has a kebab-case path: ${JSON.stringify(paths)}`,
  );
  check(new Set(paths).size === paths.length, `no path names two actions: ${JSON.stringify(paths)}`);
  check(
    Object.keys(OPERATION_16_PATHS).length === CSMS_OPERATION_16_ACTIONS.length,
    "the path table names nothing but 1.6 actions",
  );
  const issue: Record<string, CsmsOperation16Action> = {
    reset: "Reset",
    unlock: "UnlockConnector",
    "remote-start": "RemoteStartTransaction",
    "remote-stop": "RemoteStopTransaction",
  };
  for (const [path, action] of Object.entries(issue)) {
    check(OPERATION_16_PATHS[action] === path, `${action} is served at the issue's path '${path}'`);
  }
}

// ---------------------------------------------------------------------------
// Part 2 -- one request, one driver call.
// ---------------------------------------------------------------------------

{
  const ex = await exchange("POST", RESET, { type: "Hard" });
  check(ex.status === 202, `reset answers 202, got ${ex.status} (${ex.text})`);
  check(
    JSON.stringify(ex.seen.executes) === JSON.stringify([{ cpId: "CP-1", op: { action: "Reset", type: "Hard" } }]),
    `reset reaches execute once with the decoded operation: ${JSON.stringify(ex.seen.executes)}`,
  );
  check(
    JSON.stringify(ex.body) ===
      JSON.stringify({ chargePointId: "CP-1", operation: "reset", action: "Reset", status: "dispatched" }),
    `reset answers the dispatch, not the driver's receipt: ${ex.text}`,
  );
  check(!ex.text.includes("/manager/"), "the driver's receipt is not returned");
}

{
  const expiry = "2030-01-02T03:04:05.000Z";
  const ex = await exchange("POST", "/v1/charge-points/CP-1/operations/reserve-now", {
    connectorId: 1,
    idTag: "TAG",
    expiryDate: expiry,
  });
  const op = ex.seen.executes[0]?.op;
  check(ex.status === 202, `reserve-now answers 202, got ${ex.status} (${ex.text})`);
  check(
    op?.action === "ReserveNow" && op.expiryDate instanceof Date && op.expiryDate.toISOString() === expiry,
    `reserve-now hands the driver a Date: ${JSON.stringify(op)}`,
  );
  check(op !== undefined && !("parentIdTag" in op) && !("reservation" in op), "an omitted member stays omitted");
}

{
  const ex = await exchange("POST", "/v1/charge-points/CP-1/operations/get-configuration");
  const op = ex.seen.executes[0]?.op;
  check(ex.status === 202, `an operation without members accepts an empty body, got ${ex.status} (${ex.text})`);
  check(op?.action === "GetConfiguration" && !("keys" in op), `absent keys stay absent: ${JSON.stringify(op)}`);
}

{
  const ex = await exchange("POST", "/v1/charge-points/CP%2F1%201/operations/reset", { type: "Soft" });
  check(ex.seen.executes[0]?.cpId === "CP/1 1", `the charge point id is URL-decoded: ${JSON.stringify(ex.seen.executes)}`);
}

{
  const ex = await exchange("POST", "/v1/charge-points/CP-1/operations/send-local-list", {
    listVersion: 3,
    updateType: "Full",
    localAuthorizationList: [{ idTag: "A", status: "Accepted", expiryDate: "2030-01-01T00:00:00Z" }, { idTag: "B" }],
  });
  const op = ex.seen.executes[0]?.op;
  check(
    op?.action === "SendLocalList" &&
      op.localAuthorizationList?.length === 2 &&
      op.localAuthorizationList[0]?.expiryDate instanceof Date &&
      !("status" in (op.localAuthorizationList[1] ?? {})),
    `send-local-list decodes its entries: ${JSON.stringify(op)}`,
  );
}

const DEFINITION = {
  id: "CP-9",
  registration: "Pending",
  security: { profile: 1, basicAuthPassword: "request-pw-123" },
  description: "bay 9",
};

{
  const ex = await exchange("POST", "/v1/charge-points", DEFINITION);
  check(ex.status === 201, `create answers 201, got ${ex.status} (${ex.text})`);
  check(ex.headers.get("location") === "/v1/charge-points/CP-9", `create answers its Location: ${ex.headers.get("location")}`);
  check(
    JSON.stringify(ex.seen.admin) === JSON.stringify([{ method: "create", args: [DEFINITION] }]),
    `create reaches the driver once with the definition: ${JSON.stringify(ex.seen.admin)}`,
  );
  check(!ex.text.includes("request-pw-123"), "create does not echo the password");
  check(!ex.log.join("\n").includes("request-pw-123"), "the log carries no request body");
}

{
  const stored: ChargePointDetails = { id: "CP-9", registration: "Accepted", security: { profile: 1 }, description: "bay 9" };
  const leaky = { ...stored, security: { profile: 1, basicAuthPassword: "leaked-pw" } } as unknown as ChargePointDetails;
  const ex = await exchange("GET", "/v1/charge-points/CP-9", undefined, { stored: leaky });
  check(ex.status === 200, `get answers 200, got ${ex.status} (${ex.text})`);
  check(JSON.stringify(ex.body) === JSON.stringify(stored), `get answers the details: ${ex.text}`);
  check(!ex.text.includes("leaked-pw"), "get never reads a password back, even from a driver that returns one");
  check(
    JSON.stringify(ex.seen.admin) === JSON.stringify([{ method: "get", args: ["CP-9"] }]),
    `get reaches the driver once: ${JSON.stringify(ex.seen.admin)}`,
  );
}

await expectError("get of a missing id", 404, "not_found", () => exchange("GET", "/v1/charge-points/CP-0"));

{
  const ex = await exchange("PATCH", "/v1/charge-points/CP-9", { description: null, registration: "Rejected" });
  check(ex.status === 204, `update answers 204, got ${ex.status} (${ex.text})`);
  check(
    Bun.deepEquals(ex.seen.admin, [{ method: "update", args: ["CP-9", { description: null, registration: "Rejected" }] }], true),
    `update reaches the driver once with the patch: ${JSON.stringify(ex.seen.admin)}`,
  );
}

{
  const ex = await exchange("DELETE", "/v1/charge-points/CP-9");
  check(ex.status === 204, `delete answers 204, got ${ex.status} (${ex.text})`);
  check(
    JSON.stringify(ex.seen.admin) === JSON.stringify([{ method: "delete", args: ["CP-9"] }]),
    `delete reaches the driver once: ${JSON.stringify(ex.seen.admin)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 4 -- unsupported is explicit.
// ---------------------------------------------------------------------------

await expectError("an undeclared action", 501, "unsupported_capability",
  () => exchange("POST", RESET, { type: "Hard" }, { operations: ["ClearCache"] }), false);
await expectError("create on a driver without chargePoints", 501, "unsupported_capability",
  () => exchange("POST", "/v1/charge-points", DEFINITION, { admin: false }), false);
await expectError("get on a driver without chargePoints", 501, "unsupported_capability",
  () => exchange("GET", "/v1/charge-points/CP-9", undefined, { admin: false }), false);
await expectError("an undeclared security profile", 501, "unsupported_capability",
  () => exchange("POST", "/v1/charge-points", { id: "CP-9", security: { profile: 2, basicAuthPassword: "pw-pw-pw" } }), false);
await expectError("a create relying on an undeclared implicit profile 0", 501, "unsupported_capability",
  () => exchange("POST", "/v1/charge-points", { id: "CP-9" }, { profiles: [1] }), false);
await expectError("a driver declaring chargePoints without the surface", 501, "unsupported_capability",
  () => exchange("POST", "/v1/charge-points", DEFINITION, { admin: false, declareAdmin: true }), false);
await expectError("a driver refusing the operation", 501, "unsupported_capability",
  () => exchange("POST", RESET, { type: "Hard" }, { fail: new UnsupportedOperationError("Reset", "not here") }));

// ---------------------------------------------------------------------------
// Part 5 -- errors translate deterministically.
// ---------------------------------------------------------------------------

await expectError("a request that never became a CALL", 502, "transport_failure",
  () => exchange("POST", RESET, { type: "Hard" }, { fail: new CsmsNotDispatchedError("Reset", "signin answered 401") }));
await expectError("a CSMS that answered and refused", 502, "csms_rejected",
  () => exchange("POST", RESET, { type: "Hard" }, { fail: new Error("form came back with validation errors") }));
await expectError("create of an existing id", 409, "conflict",
  () => exchange("POST", "/v1/charge-points", DEFINITION, { fail: new ChargePointAlreadyExistsError("CP-9") }));
await expectError("update of a missing id", 404, "not_found",
  () => exchange("PATCH", "/v1/charge-points/CP-9", { description: "x" }, { fail: new ChargePointNotFoundError("CP-9") }));
{
  const ex = await expectError("a driver past the deadline", 504, "timeout",
    () => exchange("POST", RESET, { type: "Hard" }, { fail: "hang" }, { timeoutMs: 30 }));
  check(/unknown/i.test(ex.body?.error?.message ?? ""), `a timeout says the outcome is unknown: ${ex.text}`);
}

{
  const broken = { id: "CP-9", registration: "Accepted" } as unknown as ChargePointDetails;
  await expectError("a defect in the daemon's own encoding", 500, "internal",
    () => exchange("GET", "/v1/charge-points/CP-9", undefined, { stored: broken }));
}

for (const timeoutMs of [0, -1, 1.5, MAX_TIMEOUT_MS + 1]) {
  let refused = false;
  try {
    createCsmsHttpHandler(fakeDriver().driver, { about: { id: "x", displayName: "x" }, timeoutMs });
  } catch (error) {
    refused = error instanceof RangeError;
  }
  check(refused, `a deadline of ${timeoutMs} ms is refused at start`);
}
for (const argv of [["--timeout-ms", "0"], ["--timeout-ms", "3000000000"], ["--port", "70000"], ["--port", ""]]) {
  // Refused while parsing, before any driver is loaded -- the env names none.
  const code = await csmsServerCommand(argv, {});
  check(code === 1, `csms-server ${argv.join(" ")} is refused, exit ${code}`);
}

const INPUT_REFUSALS: [string, string, string, unknown][] = [
  ["malformed JSON", "POST", RESET, "{not json"],
  ["a body that is not an object", "POST", RESET, [1]],
  ["a value outside the enumeration", "POST", RESET, { type: "Medium" }],
  ["a missing member", "POST", RESET, {}],
  ["an unknown member", "POST", RESET, { type: "Hard", action: "Reset" }],
  ["a string where an integer goes", "POST", "/v1/charge-points/CP-1/operations/unlock", { connectorId: "1" }],
  ["a fraction where an integer goes", "POST", "/v1/charge-points/CP-1/operations/unlock", { connectorId: 1.5 }],
  ["a date that is not a date", "POST", "/v1/charge-points/CP-1/operations/reserve-now",
    { connectorId: 1, idTag: "T", expiryDate: "tomorrow" }],
  ["a day the month does not have", "POST", "/v1/charge-points/CP-1/operations/reserve-now",
    { connectorId: 1, idTag: "T", expiryDate: "2030-02-31T10:00:00Z" }],
  ["hour 24", "POST", "/v1/charge-points/CP-1/operations/reserve-now",
    { connectorId: 1, idTag: "T", expiryDate: "2030-01-01T24:00:00Z" }],
  ["an offset beyond 23 hours", "POST", "/v1/charge-points/CP-1/operations/reserve-now",
    { connectorId: 1, idTag: "T", expiryDate: "2030-01-01T10:00:00+25:00" }],
  ["a list that is not a list", "POST", "/v1/charge-points/CP-1/operations/get-configuration", { keys: "HeartbeatInterval" }],
  ["profile 1 without a password", "POST", "/v1/charge-points", { id: "CP-9", security: { profile: 1 } }],
  ["profile 0 with a password", "POST", "/v1/charge-points", { id: "CP-9", security: { profile: 0, basicAuthPassword: "pw" } }],
  ["profile 4", "POST", "/v1/charge-points", { id: "CP-9", security: { profile: 4 } }],
  ["a registration OCPP does not define", "POST", "/v1/charge-points", { id: "CP-9", registration: "Maybe" }],
  ["a CSMS form field name", "POST", "/v1/charge-points", { id: "CP-9", chargeBoxId: "CP-9" }],
  ["a definition without an id", "POST", "/v1/charge-points", { registration: "Accepted" }],
  ["an update naming the id", "PATCH", "/v1/charge-points/CP-9", { id: "CP-8" }],
];
for (const [label, method, path, body] of INPUT_REFUSALS) {
  await expectError(label, 400, "invalid_input", () => exchange(method, path, body), false);
}

await expectError("an operation path no action has", 404, "not_found",
  () => exchange("POST", "/v1/charge-points/CP-1/operations/remote-start-transaction", {}), false);
await expectError("an unversioned path", 404, "not_found", () => exchange("GET", "/driver"), false);
{
  const ex = await expectError("a method the route does not serve", 405, "method_not_allowed",
    () => exchange("GET", RESET), false);
  check(ex.headers.get("allow") === "POST", `405 names the allowed method: ${ex.headers.get("allow")}`);
}
// A method the route never serves is wrong whatever the driver, so it is
// answered before the capability is.
await expectError("a wrong method on a driver without chargePoints", 405, "method_not_allowed",
  () => exchange("POST", "/v1/charge-points/CP-9", {}, { admin: false }), false);

// ---------------------------------------------------------------------------
// Part 6 -- secrets in driver errors.
// ---------------------------------------------------------------------------

{
  const ex = await exchange("POST", RESET, { type: "Hard" },
    { fail: new Error("login refused for password env-secret-42") }, { secrets: ["env-secret-42"] });
  check(ex.status === 502, `the redaction row reached the driver error, got ${ex.status}`);
  check(!ex.text.includes("env-secret-42"), `a configured secret is redacted from the response: ${ex.text}`);
  check(!ex.log.join("\n").includes("refused"), `the log line carries no error message: ${ex.log}`);
}
{
  const ex = await exchange("POST", "/v1/charge-points/env-secret-42/operations/reset", { type: "Hard" },
    {}, { secrets: ["env-secret-42"] });
  check(ex.log.length === 1 && !ex.log[0]!.includes("env-secret-42"), `a secret in the logged path is redacted: ${ex.log}`);
}
{
  const ex = await exchange("POST", "/v1/charge-points", DEFINITION,
    { fail: new Error("CSMS refused authPassword=request-pw-123") });
  check(!ex.text.includes("request-pw-123"), `the request's own password is redacted from the response: ${ex.text}`);
}

// ---------------------------------------------------------------------------
// Part 7 -- the description.
// ---------------------------------------------------------------------------

{
  const ex = await exchange("GET", "/v1/driver", undefined, { operations: ["Reset", "RemoteStartTransaction"] });
  check(ex.status === 200, `GET /v1/driver answers 200, got ${ex.status}`);
  check(
    JSON.stringify(ex.body) ===
      JSON.stringify({
        id: "memory",
        displayName: "In-memory CSMS",
        protocols: ["OCPP-1.6J"],
        operations16: [
          { operation: "reset", action: "Reset" },
          { operation: "remote-start", action: "RemoteStartTransaction" },
        ],
        chargePoints: { securityProfiles: [0, 1] },
      }),
    `GET /v1/driver describes identity and capabilities only: ${ex.text}`,
  );
  const bare = await exchange("GET", "/v1/driver", undefined, { admin: false });
  check(bare.body?.chargePoints === null, `no admin surface reads as null: ${bare.text}`);
  const hollow = await exchange("GET", "/v1/driver", undefined, { admin: false, declareAdmin: true });
  check(hollow.body?.chargePoints === null, `a declaration without the surface reads as null: ${hollow.text}`);
}

// ---------------------------------------------------------------------------
// Part 1 -- the daemon, through the registry and a real port.
// ---------------------------------------------------------------------------

{
  const fixturePath = resolve(import.meta.dir, "fixtures/fake-csms-driver.ts");
  const fixture = (await import(pathToFileURL(fixturePath).href)) as typeof import("./fixtures/fake-csms-driver");
  const log: string[] = [];
  const server = await startCsmsServer({
    env: { CSMS_DRIVER: fixturePath, FAKE_CSMS_PASS: "pw-from-env-77" },
    host: "127.0.0.1",
    port: 0,
    log: (line) => log.push(line),
  });
  try {
    const about = await fetch(`${server.url}/v1/driver`);
    const aboutBody = await about.json();
    check(
      about.status === 200 &&
        JSON.stringify(aboutBody) ===
          JSON.stringify({
            id: "fake",
            displayName: "Fake CSMS",
            protocols: ["OCPP-1.6J"],
            operations16: [
              { operation: "reset", action: "Reset" },
              { operation: "change-configuration", action: "ChangeConfiguration" },
            ],
            chargePoints: { securityProfiles: [0] },
          }),
      `the daemon describes the loaded driver from its module: ${JSON.stringify(aboutBody)}`,
    );

    const created = await fetch(`${server.url}/v1/charge-points`, {
      method: "POST",
      body: JSON.stringify({ id: "CP-1", registration: "Pending" }),
    });
    const readBack = await fetch(`${server.url}/v1/charge-points/CP-1`);
    const readBackBody = await readBack.json();
    check(created.status === 201, `the daemon provisions through the loaded driver, got ${created.status}`);
    check(
      readBack.status === 200 &&
        JSON.stringify(readBackBody) === JSON.stringify({ id: "CP-1", registration: "Pending", security: { profile: 0 } }),
      `the provisioned station reads back through the daemon: ${JSON.stringify(readBackBody)}`,
    );

    const reset = await fetch(`${server.url}${RESET}`, { method: "POST", body: JSON.stringify({ type: "Soft" }) });
    check(reset.status === 202, `the daemon dispatches through the loaded driver, got ${reset.status}`);
    check(
      JSON.stringify(fixture.calls) === JSON.stringify([{ cpId: "CP-1", op: { action: "Reset", type: "Soft" } }]),
      `the loaded driver saw one Reset: ${JSON.stringify(fixture.calls)}`,
    );

    const refused = await fetch(`${server.url}/v1/charge-points/CP-1/operations/change-configuration`, {
      method: "POST",
      body: JSON.stringify({ key: "HeartbeatInterval", value: "30" }),
    });
    const refusedText = await refused.text();
    check(refused.status === 502, `the loaded driver's refusal is translated, got ${refused.status}`);
    check(!refusedText.includes("pw-from-env-77"), `a credential from the environment is redacted: ${refusedText}`);
    // A second daemon on the same port cannot listen, and must not leak the
    // parts its create(env) opened.
    let secondRefused = false;
    try {
      const second = await startCsmsServer({
        env: { CSMS_DRIVER: fixturePath },
        host: "127.0.0.1",
        port: Number(new URL(server.url).port),
      });
      await second.stop();
    } catch {
      secondRefused = true;
    }
    check(secondRefused, "a daemon on a port already taken does not start");
    check(
      JSON.stringify(fixture.closed) === JSON.stringify(["closed"]),
      `a start that fails closes the parts it created: ${JSON.stringify(fixture.closed)}`,
    );
    check(log.length === 5, `the daemon logs one line per request: ${JSON.stringify(log)}`);
  } finally {
    await server.stop();
  }
  check(JSON.stringify(fixture.closed) === JSON.stringify(["closed", "closed"]), "stop closes the driver's parts");
}

{
  const server = await startCsmsServer({
    env: { CSMS_DRIVER: resolve(import.meta.dir, "fixtures/undeclared-csms-driver.ts") },
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const about = (await (await fetch(`${server.url}/v1/driver`)).json()) as {
      operations16: { action: string }[];
      chargePoints: unknown;
    };
    check(
      JSON.stringify(about.operations16.map((entry) => entry.action)) === JSON.stringify(CSMS_OPERATION_16_ACTIONS) &&
        about.chargePoints === null,
      `a module that declares nothing is served the 1.6 vocabulary and no admin: ${JSON.stringify(about)}`,
    );
  } finally {
    await server.stop();
  }
}

if (failures.length > 0) {
  console.error("FAIL: csms-server does not hold:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("csms-server: daemon, routing, capabilities, error envelope and redaction hold.");
