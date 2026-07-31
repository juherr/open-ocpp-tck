#!/usr/bin/env bun
// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The `ocpp-tck` executable.
 *
 * Deliberately the ONLY place in this package that terminates the process.
 * Everything under tck/ is also importable as a library -- a consumer can
 * embed the runner, or call `cli()` from their own wrapper -- and a library
 * that can kill its host on a bad argument is not one.
 *
 * The bun check is here rather than in engines-only form because the failure
 * it prevents is otherwise unhelpful: the package resolves fine under node and
 * then dies inside startSim() with `Bun is not defined`, several seconds and
 * one container into a run.
 */
import { cli } from "../tck/main";

if (typeof Bun === "undefined") {
  process.stderr.write(
    "ocpp-tck requires bun: it spawns the simulator with Bun.spawn and writes " +
      "results with Bun.write. Install bun (https://bun.sh) and re-run.\n",
  );
  process.exit(1);
}

cli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `Fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
