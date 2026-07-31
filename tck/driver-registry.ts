// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * driver-registry.ts -- how the runner finds a CSMS driver.
 *
 * `CSMS_DRIVER` is always a MODULE SPECIFIER: "./drivers/<id>/index.ts", an
 * absolute path, or a published package name.
 *
 * That is the whole point. A driver for a CSMS this harness has
 * never heard of is a directory somebody drops next to drivers/, plus one
 * environment variable. NO FILE HERE NAMES IT, so adding one is purely
 * additive and removing one is a delete: there is no registry list to edit,
 * and therefore no merge conflict when this core is re-synced from upstream.
 *
 * That property is what lets a driver for a private CSMS live in a completely
 * different repository, depending on this one as a package, with a zero-line
 * diff against the half destined for upstream.
 *
 * A driver module exports `csmsDriver: CsmsDriverModule`. A default export is
 * also accepted, so a one-file driver stays a one-file driver.
 */
import { readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CsmsDriverModule, CsmsEnv } from "./driver";

/**
 * Where to look for sibling drivers when reporting an unusable `CSMS_DRIVER`.
 *
 * Rooted at the CURRENT WORKING DIRECTORY, not at this module. Once this
 * package is installed under `node_modules/`, "next to the core" is a
 * directory inside somebody else's dependency tree: listing it would offer the
 * operator `./drivers/<id>/index.ts` paths that do not resolve from where they
 * are standing, which is worse than offering nothing.
 */
function driversDir(env: CsmsEnv): string {
  const configured = env.OCPP_TCK_DRIVERS_DIR?.trim();
  return resolve(process.cwd(), configured ? configured : "drivers");
}

/**
 * There is deliberately NO built-in driver list. An earlier draft had one, and
 * it contradicted this module's own reason to exist: the moment the core names
 * a CSMS, adding a driver means editing a core file, which is a merge conflict
 * every time the core is re-synced from upstream -- and it puts a CSMS name
 * back into the half that is supposed not to know which CSMS it tests.
 *
 * `CSMS_DRIVER` is therefore always a module specifier, and an unset one is an
 * error that LISTS WHAT IT FOUND rather than guessing. Discovery is by
 * directory listing, so the core learns the drivers that exist without ever
 * naming one.
 */
function isPathLike(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/") || spec.includes("/");
}

/**
 * Resolution order for a specifier:
 *   1. relative to the CURRENT WORKING DIRECTORY, so an operator can point at
 *      a driver checkout without knowing where the core lives;
 *   2. as a bare package specifier, for a published driver.
 *
 * There used to be a third attempt, resolving the specifier relative to THIS
 * MODULE. It was removed when the core became an installable package: from
 * `node_modules/`, it can only ever reach a driver bundled with the core, so a
 * consumer's own `./drivers/<id>/index.ts` could silently load the core's copy
 * instead of theirs -- the specifier would appear to work, against the wrong
 * file.
 *
 * Every failure is collected and reported together: a driver that fails to
 * load because of a syntax error inside it, and one that fails because the
 * path is wrong, produce very different messages, and printing only the last
 * attempt hides whichever came first.
 */
async function importDriverModule(
  spec: string,
  env: CsmsEnv,
): Promise<unknown> {
  const attempts: string[] = [];
  if (isPathLike(spec)) {
    const fromCwd = isAbsolute(spec) ? spec : resolve(process.cwd(), spec);
    attempts.push(pathToFileURL(fromCwd).href);
  } else {
    attempts.push(spec);
  }

  const failures: string[] = [];
  for (const candidate of attempts) {
    try {
      return await import(candidate);
    } catch (err) {
      failures.push(
        `  ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(
    `CSMS_DRIVER="${spec}" could not be imported. Tried:\n${failures.join("\n")}\n` +
      whereToLook(env),
  );
}

/** Driver directories under the working directory, for error messages only. */
function discoverDrivers(env: CsmsEnv): string[] {
  const root = driversDir(env);
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => resolve(root, e.name, "index.ts"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Absolute paths, because a relative one is only meaningful next to the cwd it
 * was computed from and this message is read after something already went
 * wrong.
 *
 * It deliberately does NOT name the reference driver shipped with this
 * package, tempting as that is: a CSMS name in a string literal here is the
 * coupling this whole module exists to prevent, and a guard fails the build
 * for it. Where to find the bundled driver is the README's job.
 */
function whereToLook(env: CsmsEnv): string {
  const found = discoverDrivers(env);
  return found.length > 0
    ? `Drivers found under ${driversDir(env)}:\n` +
        found.map((p) => `  ${p}`).join("\n")
    : `No driver directory under ${driversDir(env)} ` +
        "(override with OCPP_TCK_DRIVERS_DIR); a driver may also be a bare " +
        "package specifier.";
}

export async function loadDriverModule(
  env: CsmsEnv = process.env,
): Promise<CsmsDriverModule> {
  const requested = env.CSMS_DRIVER?.trim();
  if (!requested) {
    throw new Error(
      "CSMS_DRIVER is not set. It names the driver module to load, e.g.\n" +
        "  CSMS_DRIVER=./drivers/<id>/index.ts\n" +
        whereToLook(env),
    );
  }

  const mod = (await importDriverModule(requested, env)) as {
    csmsDriver?: CsmsDriverModule;
    default?: CsmsDriverModule;
  };
  const driver = mod.csmsDriver ?? mod.default;
  if (!driver || typeof driver.create !== "function") {
    throw new Error(
      `CSMS_DRIVER="${requested}" resolved to a module exporting no ` +
        "`csmsDriver` (or default) CsmsDriverModule with a create() method.",
    );
  }
  return driver;
}
