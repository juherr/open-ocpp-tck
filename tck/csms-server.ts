// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * csms-server.ts -- `ocpp-tck csms-server`: serves the driver `CSMS_DRIVER`
 * names over HTTP, so a process in any language can drive a CSMS through it.
 *
 * The driver is loaded exactly as the runner loads it -- the same registry,
 * the same `create(env)`, the same environment -- so a deployment the TCK can
 * test is one the daemon can serve, with no second configuration. What this
 * module adds is only the bridge from the TCK's driver module to the
 * library's `CsmsDriver`; routing, decoding and error translation are
 * `packages/csms-driver/server`, which knows nothing about the TCK.
 */
import { createCsmsHttpHandler, MAX_TIMEOUT_MS } from "../packages/csms-driver/server";
import {
  CSMS_OPERATION_16_ACTIONS,
  driverCapabilities,
  driverProtocols,
  type CsmsCapabilities,
  type CsmsDriver,
  type CsmsDriverModule,
  type CsmsDriverParts,
  type CsmsEnv,
} from "./driver";
import { loadDriverModule } from "./driver-registry";

export interface CsmsServerOptions {
  readonly env: CsmsEnv;
  /** Default 127.0.0.1: the daemon drives a CSMS and has no authentication
   *  of its own, so reaching it from elsewhere is a choice made explicitly. */
  readonly host?: string;
  /** Default 8787; 0 picks a free port. */
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

export interface CsmsServer {
  readonly url: string;
  stop(): Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

/** Environment variable names whose values are credentials. Matched on a
 *  whole `_`-separated word of the name, so a driver adding `FOO_PASS` is
 *  covered without listing it here, and `TOKENIZERS_PARALLELISM` is not. */
const SECRET_NAME = /(^|_)(PASS|PASSWD|PASSWORD|SECRET|TOKEN|KEY|CREDENTIALS?)(_|$)/i;

/** Values shorter than this are not redacted: a `FOO_KEY=1` would otherwise
 *  turn every `1` in every message -- status codes included -- into noise. */
const MIN_SECRET_LENGTH = 4;

function secretsOf(env: CsmsEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value !== undefined && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value as string);
}

export async function startCsmsServer(options: CsmsServerOptions): Promise<CsmsServer> {
  const { env } = options;
  const module = await loadDriverModule(env);
  const parts = await module.create(env);
  try {
    return serve(module, parts, options);
  } catch (error) {
    // Nothing else will close what create() opened: the caller never got a
    // server to stop.
    await parts.close?.();
    throw error;
  }
}

/**
 * Every surface of the library's `CsmsDriver` besides its declaration. Keyed
 * by the type, so a surface added to `CsmsDriver` stops this file compiling
 * until the daemon carries it -- rather than being dropped from it in silence,
 * which an optional member otherwise would be.
 */
const SURFACES = {
  operations16: true,
  operations201: true,
  sessions: true,
  connectors: true,
  chargePoints: true,
} as const satisfies Record<Exclude<keyof CsmsDriver, "capabilities">, true>;

/**
 * The `CsmsDriver` a TCK driver module amounts to: its declaration resolved
 * for `env`, and the surfaces `create(env)` returned. Copied member by member,
 * not spread: `{...parts}` drops every method of a driver built as a class
 * instance (see `withCapabilityStubs` in main.ts).
 *
 * A module that declares nothing still has the compulsory 1.6 vocabulary; its
 * own switch refuses what it cannot express, and the daemon reports that
 * refusal as `unsupported_capability` all the same.
 */
function libraryDriver(module: CsmsDriverModule, parts: CsmsDriverParts, env: CsmsEnv): CsmsDriver {
  const capabilities: CsmsCapabilities = driverCapabilities(module, env) ?? {
    operations16: new Set(CSMS_OPERATION_16_ACTIONS),
  };
  const surfaces = (Object.keys(SURFACES) as (keyof typeof SURFACES)[])
    .filter((key) => parts[key] !== undefined)
    .map((key) => [key, parts[key]]);
  return { ...Object.fromEntries(surfaces), capabilities } as CsmsDriver;
}

function serve(module: CsmsDriverModule, parts: CsmsDriverParts, options: CsmsServerOptions): CsmsServer {
  const { env } = options;
  const handler = createCsmsHttpHandler(libraryDriver(module, parts, env), {
    about: { id: module.id, displayName: module.displayName, protocols: driverProtocols(module, env) },
    timeoutMs: options.timeoutMs,
    secrets: secretsOf(env),
    log: options.log,
  });
  const server = Bun.serve({
    hostname: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    fetch: handler,
  });
  return {
    url: `http://${server.hostname}:${server.port}`,
    async stop() {
      // In-flight requests finish first: cutting one would hand its client a
      // reset for an operation that may already be on its way to a station.
      await server.stop();
      await parts.close?.();
    },
  };
}

function parseFlag(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${flag} expects a value`);
  return value;
}

function parseInteger(raw: string, flag: string, min: number, max: number): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flag} expects an integer from ${min} to ${max}, got "${raw}"`);
  }
  return n;
}

/** `ocpp-tck csms-server [--host H] [--port N] [--timeout-ms N]`. Serves until SIGINT or SIGTERM. */
export async function csmsServerCommand(argv: string[], env: CsmsEnv): Promise<number> {
  let host: string | undefined;
  let port: number | undefined;
  let timeoutMs: number | undefined;
  try {
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i]!;
      if (flag === "--host") host = parseFlag(argv, i++, flag);
      else if (flag === "--port") port = parseInteger(parseFlag(argv, i++, flag), flag, 0, 65_535);
      else if (flag === "--timeout-ms") timeoutMs = parseInteger(parseFlag(argv, i++, flag), flag, 1, MAX_TIMEOUT_MS);
      else throw new Error(`Unknown csms-server option: ${flag}`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const log = (line: string) => process.stderr.write(`csms-server: ${line}\n`);
  const server = await startCsmsServer({ env, log, host, port, timeoutMs });
  process.stderr.write(`csms-server: listening on ${server.url}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await server.stop();
  process.stderr.write("csms-server: stopped\n");
  return 0;
}
