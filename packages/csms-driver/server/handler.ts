// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The daemon's HTTP surface over one `CsmsDriver`, as a plain
 * `(Request) => Promise<Response>` -- what `Bun.serve` takes, and what a test
 * can call without a port.
 *
 * A THIN ADAPTER, and the line is worth holding: each request decodes its
 * body, checks the declared capability, makes at most one driver call, and
 * translates the outcome. No retries, no sequencing, no state between
 * requests -- a workflow belongs to the client, and the TCK is the one
 * workflow engine this repository has.
 *
 *   GET    /v1/driver                                   what the driver declares
 *   POST   /v1/charge-points                            chargePoints.create
 *   GET    /v1/charge-points/{id}                       chargePoints.get
 *   PATCH  /v1/charge-points/{id}                       chargePoints.update
 *   DELETE /v1/charge-points/{id}                       chargePoints.delete
 *   POST   /v1/charge-points/{id}/operations/{path}     operations16.execute
 *
 * NO AUTHENTICATION, SO NO BROWSER. The daemon listens on loopback, and a page
 * the operator has open can reach loopback: a cross-origin "simple" request --
 * POST, `text/plain`, no preflight -- is delivered, and its response being
 * opaque does not undo a Reset. Local Network Access prompts are not in every
 * browser, so the refusal is ours, made before routing: a request carrying an
 * `Origin` (sent by a browser on every cross-origin POST, form posts and
 * `no-cors` included) is refused, and a POST or PATCH must be
 * `application/json`, which no simple request can be. DELETE needs no such
 * rule: a browser preflights it, and the daemon answers no preflight.
 */
import { ChargePointNotFoundError, type ChargePointSecurity } from "../charge-points";
import { CSMS_OPERATION_16_ACTIONS } from "../contracts";
import type { CsmsDriver } from "../models";
import { decodeChargePointDefinition, decodeChargePointUpdate, encodeChargePointDetails } from "./charge-points";
import { InvalidInputError } from "./decode";
import { classify, CsmsHttpError, CsmsTimeoutError, redact } from "./errors";
import { decodeOperation16, OPERATION_16_PATHS, operation16ForPath } from "./operations16";

/** Who the driver is. Passed in rather than read off the driver, which does not carry it. */
export interface CsmsHttpAbout {
  readonly id: string;
  readonly displayName: string;
  /** Absent means the driver did not say. */
  readonly protocols?: readonly string[];
}

export interface CsmsHttpOptions {
  readonly about: CsmsHttpAbout;
  /** How long one driver call may take before the daemon answers 504. Default 60 s. */
  readonly timeoutMs?: number;
  /** Values redacted from every message the daemon returns or logs: the
   *  driver's credentials. A request's own Basic Auth password is added per request. */
  readonly secrets?: readonly string[];
  /** One line per request: method, path, status and error code. Never a body. */
  readonly log?: (line: string) => void;
}

export type CsmsHttpHandler = (request: Request) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 60_000;

/** The largest delay `setTimeout` honours. Beyond it the timer fires at once,
 *  and every dispatched operation would be answered `timeout`. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function methodNotAllowed(allowed: string): never {
  throw new CsmsHttpError(405, "method_not_allowed", `this route serves ${allowed} only`, { allow: allowed });
}

function notFound(what: string): never {
  throw new CsmsHttpError(404, "not_found", what);
}

/** The browser rule in the header above. Checked before routing, so it holds
 *  for every route, body-less operations included, and never reaches a driver. */
function refuseBrowserRequests(request: Request): void {
  if (request.headers.has("origin")) {
    throw new CsmsHttpError(
      403,
      "forbidden_origin",
      "requests from a browser page are refused: this daemon has no authentication",
    );
  }
  if (request.method === "POST" || request.method === "PATCH") {
    const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new CsmsHttpError(415, "unsupported_media_type", "a POST or PATCH must be Content-Type: application/json");
    }
  }
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidInputError("body is not valid JSON");
  }
}

/** The declaration binds before the driver is asked: a profile it does not
 *  accept is refused here, whatever the driver would have done. */
function checkProfile(profile: number | undefined, declared: ReadonlySet<number>): void {
  if (profile !== undefined && !declared.has(profile)) {
    throw new CsmsHttpError(
      501,
      "unsupported_capability",
      `security profile ${profile} is not one this driver accepts (${[...declared].join(", ")})`,
    );
  }
}

function rememberPassword(security: ChargePointSecurity | undefined, secrets: string[]): void {
  if (security && "basicAuthPassword" in security) secrets.push(security.basicAuthPassword);
}

export function createCsmsHttpHandler(driver: CsmsDriver, options: CsmsHttpOptions): CsmsHttpHandler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Refused rather than clamped: a deadline that expires before the driver
  // answers turns every request it DID dispatch into "outcome unknown", and a
  // client that retries on 504 then sends each operation twice.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}, got ${timeoutMs}`);
  }
  const log = options.log ?? (() => {});
  const capabilities = driver.capabilities;
  // Both halves: a declaration without the surface is a capability nobody can
  // use, and reporting it would only move the 501 to the next request.
  const admin =
    driver.chargePoints && capabilities.chargePoints
      ? { chargePoints: driver.chargePoints, declared: capabilities.chargePoints.securityProfiles }
      : undefined;
  const description = {
    id: options.about.id,
    displayName: options.about.displayName,
    protocols: options.about.protocols ?? null,
    operations16: CSMS_OPERATION_16_ACTIONS.filter((action) => capabilities.operations16.has(action)).map(
      (action) => ({ operation: OPERATION_16_PATHS[action], action }),
    ),
    chargePoints: admin ? { securityProfiles: [...admin.declared].sort((a, b) => a - b) } : null,
  };

  return async (request) => {
    const url = new URL(request.url);
    const secrets = [...(options.secrets ?? [])];
    let response: Response;
    let code = "";
    try {
      refuseBrowserRequests(request);
      response = await route(request, url, secrets);
    } catch (err) {
      const failure = classify(err, false);
      code = ` ${failure.code}`;
      response = json(
        failure.status,
        { error: { code: failure.code, message: redact(failure.message, secrets) } },
        failure.headers,
      );
    }
    log(redact(`${request.method} ${url.pathname} -> ${response.status}${code}`, secrets));
    return response;
  };

  /** One driver call under the deadline. A failure leaves here already
   *  classified, so a plain `Error` is read as the CSMS's and nothing else's. */
  async function call<T>(run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CsmsTimeoutError(timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([run(), deadline]);
    } catch (err) {
      const failure = classify(err, true);
      throw new CsmsHttpError(failure.status, failure.code, failure.message, failure.headers);
    } finally {
      clearTimeout(timer);
    }
  }

  function requireAdmin(): NonNullable<typeof admin> {
    if (!admin) {
      throw new CsmsHttpError(501, "unsupported_capability", "this driver has no charge-point administration");
    }
    return admin;
  }

  async function route(request: Request, url: URL, secrets: string[]): Promise<Response> {
    let segments: string[];
    try {
      segments = url.pathname.split("/").slice(1).map(decodeURIComponent);
    } catch {
      throw new InvalidInputError("the path is not valid percent-encoding");
    }
    const noRoute = (): never => notFound(`no route ${url.pathname}`);
    const method = request.method;
    const [version, collection, cpId, sub, operationPath, ...rest] = segments;
    if (version !== "v1" || rest.length > 0) noRoute();

    if (collection === "driver" && cpId === undefined) {
      if (method !== "GET") methodNotAllowed("GET");
      return json(200, description);
    }
    if (collection !== "charge-points") noRoute();

    if (cpId === undefined) {
      if (method !== "POST") methodNotAllowed("POST");
      const { chargePoints, declared } = requireAdmin();
      const definition = decodeChargePointDefinition(await readBody(request));
      rememberPassword(definition.security, secrets);
      // An omitted security is profile 0, and profile 0 is a profile too.
      checkProfile(definition.security?.profile ?? 0, declared);
      await call(() => chargePoints.create(definition));
      const location = `/v1/charge-points/${encodeURIComponent(definition.id)}`;
      return json(201, { id: definition.id }, { location });
    }
    if (cpId === "") noRoute();

    if (sub === undefined) {
      // 405 before 501: a method this route never serves is wrong whatever the driver.
      if (method !== "GET" && method !== "PATCH" && method !== "DELETE") methodNotAllowed("GET, PATCH, DELETE");
      const { chargePoints, declared } = requireAdmin();
      if (method === "GET") {
        const details = await call(() => chargePoints.get(cpId));
        if (!details) throw new ChargePointNotFoundError(cpId);
        return json(200, encodeChargePointDetails(details));
      }
      if (method === "PATCH") {
        const update = decodeChargePointUpdate(await readBody(request));
        rememberPassword(update.security, secrets);
        checkProfile(update.security?.profile, declared);
        await call(() => chargePoints.update(cpId, update));
        return new Response(null, { status: 204 });
      }
      await call(() => chargePoints.delete(cpId));
      return new Response(null, { status: 204 });
    }

    if (sub !== "operations" || operationPath === undefined) noRoute();
    const action = operation16ForPath(operationPath);
    if (!action) notFound(`no OCPP 1.6 operation is served at '${operationPath}'`);
    if (method !== "POST") methodNotAllowed("POST");
    if (!capabilities.operations16.has(action)) {
      throw new CsmsHttpError(501, "unsupported_capability", `this driver does not declare ${action}`);
    }
    const operation = decodeOperation16(action, await readBody(request));
    // The receipt stays here: it is a CSMS's own artefact -- a task URL, a
    // response body -- and the contract reserves it for logs.
    await call(() => driver.operations16.execute(cpId, operation));
    return json(202, { chargePointId: cpId, operation: operationPath, action, status: "dispatched" });
  }
}
