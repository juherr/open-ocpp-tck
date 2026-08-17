// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/sim-docker-argv.ts -- what the operator asked for is what the container
 * gets.
 *
 * PROPERTY, in four parts:
 *   1. an empty environment produces the argv this runner has always produced,
 *      plus an explicit `--ocpp-version OCPP-1.6J` -- the CLI's own default, so
 *      the 47 `cert16-` scenarios drive exactly what they drove before;
 *   2. `SIM_OCPP_VERSION` resolves onto {@link SimConfig.ocppVersion} and
 *      reaches the argv, and a value the CLI does not accept is REFUSED by name
 *      with the list of the ones it does;
 *   3. `SIM_EXTRA_ARGS` is the last word on a flag this module also passes: when
 *      it names one, ours is not emitted, so which value applies is not a
 *      question about upstream's argument parser;
 *   4. a trace path produces a bind mount of its DIRECTORY before the image and
 *      a `--trace-output` UNDER that mount, or neither of the two. Half the
 *      pair is worse than none: a flag without a mount writes the trace inside
 *      a container that `stop()` then removes, which is how the format was
 *      unreachable through this runner in the first place.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. `buildDockerArgs` is pure and
 * nothing prints its result without starting a container: the one caller that
 * renders the argv (`startSim`) spawns docker in the next statement. And
 * `defaultSimConfig` takes the environment as an argument, which is the half a
 * shell cannot reach at all -- the CLI only ever hands it `process.env`, so a
 * resolution that read the ambient environment instead of the one it was given
 * would agree with itself in every run and disagree with every caller.
 *
 * WHY THE FIRST PART IS A WHOLE-ARGV COMPARISON rather than a search for the
 * flags this change added: the flags are positional in effect. Docker's own
 * options must precede the image and the CLI's must follow it, and a push
 * landing on the wrong side of `cfg.image` produces an argv that still contains
 * everything this guard would have looked for. What is worth pinning is the
 * list, in order.
 *
 * Offline: builds argv arrays and resolves synthetic environments. Starts
 * nothing, reads no file.
 */

import {
  buildDockerArgs,
  DEFAULT_SIM_IMAGE,
  DEFAULT_SIM_OCPP_VERSION,
  defaultSimConfig,
  SIM_OCPP_VERSIONS,
  type SimConfig,
} from "../tck/sim";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

function expectArgs(
  what: string,
  got: readonly string[],
  want: readonly string[],
): void {
  if (got.length === want.length && got.every((arg, i) => arg === want[i])) {
    return;
  }
  fail(
    what,
    `expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`,
  );
}

const CP = "CP1";
const CONTAINER = "simts-cp1-cert16-tc001-cold-boot";

const argsFor = (env: Record<string, string>): string[] =>
  buildDockerArgs(CP, CONTAINER, defaultSimConfig(env));

// ---------------------------------------------------------------------------
// 1. The default argv, whole and in order.
// ---------------------------------------------------------------------------

expectArgs("the default argv", argsFor({}), [
  "run",
  "-i",
  "--rm",
  "--name",
  CONTAINER,
  "--entrypoint",
  "bun",
  DEFAULT_SIM_IMAGE,
  "src/cli/main.ts",
  "--ws-url",
  "ws://localhost:8080/ocpp/CP1",
  "--cp-id",
  CP,
  "--json",
  "--ocpp-version",
  DEFAULT_SIM_OCPP_VERSION,
]);

if (DEFAULT_SIM_OCPP_VERSION !== "OCPP-1.6J") {
  fail(
    "the default version is the CLI's own default",
    `every cert16- scenario drives ${DEFAULT_SIM_OCPP_VERSION} now; the ` +
      "image defaults to OCPP-1.6J when the flag is absent, and 47 scenarios " +
      "were written against it",
  );
}

// ---------------------------------------------------------------------------
// 2. SIM_OCPP_VERSION: resolved, carried, and refused when it is not a version.
// ---------------------------------------------------------------------------

for (const version of SIM_OCPP_VERSIONS) {
  const cfg = defaultSimConfig({ SIM_OCPP_VERSION: version });
  if (cfg.ocppVersion !== version) {
    fail(
      `SIM_OCPP_VERSION=${version} resolves onto the field`,
      `got ${cfg.ocppVersion}`,
    );
    continue;
  }
  const args = buildDockerArgs(CP, CONTAINER, cfg);
  const idx = args.indexOf("--ocpp-version");
  if (idx === -1 || args[idx + 1] !== version) {
    fail(
      `SIM_OCPP_VERSION=${version} reaches the argv`,
      `--ocpp-version is ${idx === -1 ? "absent" : args[idx + 1]}`,
    );
  }
}

for (const rejected of ["OCPP-2.0", "2.0.1", "ocpp-2.0.1", "1.6J", "latest"]) {
  let message: string | undefined;
  try {
    defaultSimConfig({ SIM_OCPP_VERSION: rejected });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  if (message === undefined) {
    fail(
      `SIM_OCPP_VERSION=${rejected} is refused`,
      "it resolved instead, so the value travels into a container and comes " +
        "back as a boot timeout minutes later",
    );
    continue;
  }
  // The refusal has to be usable: the wrong word back, and the right ones.
  const namesTheValue = message.includes(rejected);
  const namesTheList = SIM_OCPP_VERSIONS.every((v) => message.includes(v));
  if (!namesTheValue || !namesTheList) {
    fail(
      `the refusal of SIM_OCPP_VERSION=${rejected} says what to write instead`,
      `names the value: ${namesTheValue}, names every accepted value: ` +
        `${namesTheList} (${message})`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. SIM_EXTRA_ARGS wins on a flag this module also passes.
// ---------------------------------------------------------------------------

const countOf = (args: readonly string[], flag: string): number =>
  args.filter((arg) => arg === flag || arg.startsWith(`${flag}=`)).length;

for (const extra of [
  "--ocpp-version OCPP-2.1",
  "--ocpp-version=OCPP-2.1",
  "--connectors 2 --ocpp-version OCPP-2.1",
]) {
  const args = argsFor({ SIM_EXTRA_ARGS: extra, SIM_OCPP_VERSION: "OCPP-1.6J" });
  if (countOf(args, "--ocpp-version") !== 1) {
    fail(
      `SIM_EXTRA_ARGS='${extra}' is the only --ocpp-version on the argv`,
      `${countOf(args, "--ocpp-version")} occurrences: ` +
        `${JSON.stringify(args.slice(args.indexOf("--json")))}`,
    );
  }
  if (args.includes("OCPP-1.6J")) {
    fail(
      `SIM_EXTRA_ARGS='${extra}' wins over the field`,
      `the field's value is on the argv: ${JSON.stringify(args)}`,
    );
  }
}

// A flag it does NOT name is untouched -- the rule is per flag, not "extraArgs
// present means stop passing our own".
{
  const args = argsFor({
    SIM_EXTRA_ARGS: "--connectors 2",
    SIM_OCPP_VERSION: "OCPP-2.0.1",
  });
  const idx = args.indexOf("--ocpp-version");
  if (idx === -1 || args[idx + 1] !== "OCPP-2.0.1") {
    fail(
      "unrelated extra args leave the version alone",
      JSON.stringify(args),
    );
  }
  if (args[args.length - 2] !== "--connectors") {
    fail(
      "extra args stay last",
      `they are what an operator adds to override, so they must come after ` +
        `everything this module pushes: ${JSON.stringify(args)}`,
    );
  }
}

// The type is what the CLI accepts, so a SimConfig built by hand cannot omit it.
const explicit: SimConfig = {
  ...defaultSimConfig({}),
  ocppVersion: "OCPP-2.0.1",
};
if (!buildDockerArgs(CP, CONTAINER, explicit).includes("OCPP-2.0.1")) {
  fail("an explicit SimConfig reaches the argv", "the field was ignored");
}

// ---------------------------------------------------------------------------
// 4. A trace path is a MOUNT plus a flag under it, or neither.
// ---------------------------------------------------------------------------

{
  const traced: SimConfig = {
    ...defaultSimConfig({}),
    tracePath: "/tmp/results/cert16-tc001-cold-boot.jsonl",
  };
  expectArgs("the argv with a trace path", buildDockerArgs(CP, CONTAINER, traced), [
    "run",
    "-i",
    "--rm",
    "--name",
    CONTAINER,
    // Before the image, because docker's own options must be, and a `-v`
    // pushed after it becomes an argument to the CLI instead.
    "-v",
    "/tmp/results:/trace",
    "--entrypoint",
    "bun",
    DEFAULT_SIM_IMAGE,
    "src/cli/main.ts",
    "--ws-url",
    "ws://localhost:8080/ocpp/CP1",
    "--cp-id",
    CP,
    "--json",
    "--ocpp-version",
    DEFAULT_SIM_OCPP_VERSION,
    // The file the mount makes reachable from the host. A path outside it
    // would be written inside the container and removed with it, which is
    // how this format was unusable through the runner before.
    "--trace-output",
    "/trace/cert16-tc001-cold-boot.jsonl",
  ]);
}

{
  // Nothing set: no mount, no flag. The 47 scenarios' argv without a trace is
  // the one part 1 pins, and this states the same thing from the other side --
  // an unset trace must not leave half of the pair behind.
  const args = argsFor({});
  if (args.includes("-v") || args.includes("--trace-output")) {
    fail(
      "no trace path means neither the mount nor the flag",
      JSON.stringify(args),
    );
  }
}

{
  // An operator's own --trace-output wins, like any other flag -- and the mount
  // stays, because it is the only host path this function knows about.
  const args = buildDockerArgs(CP, CONTAINER, {
    ...defaultSimConfig({ SIM_EXTRA_ARGS: "--trace-output /trace/mine.jsonl" }),
    tracePath: "/tmp/results/cert16-tc001-cold-boot.jsonl",
  });
  if (countOf(args, "--trace-output") !== 1) {
    fail(
      "SIM_EXTRA_ARGS' own --trace-output is the only one",
      `${countOf(args, "--trace-output")} occurrences: ${JSON.stringify(args)}`,
    );
  }
  if (!args.includes("/trace/mine.jsonl")) {
    fail("SIM_EXTRA_ARGS' own --trace-output wins", JSON.stringify(args));
  }
  if (!args.includes("/tmp/results:/trace")) {
    fail(
      "the mount survives an operator's own --trace-output",
      "without it their path resolves inside a container that is then removed",
    );
  }
}

if (failures > 0) {
  process.stderr.write(
    `\nthe simulator argv no longer says what the run was asked to do ` +
      `(${failures} check(s) wrong). Read the header: this argv is the only ` +
      `record of which protocol a run spoke, and a 1.6 scenario driven on ` +
      `2.0.1 passes six of its seven checks.\n`,
  );
  process.exit(1);
}

process.stdout.write("simulator docker argv: OK\n");
