// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/sim-docker-argv.ts -- what the operator asked for is what the container
 * gets.
 *
 * PROPERTY, in six parts:
 *   1. an empty environment produces the argv this runner has always produced,
 *      plus an explicit `--ocpp-version OCPP-1.6J` -- the CLI's own default, so
 *      the 47 `cert16-` scenarios drive exactly what they drove before;
 *   2. `SIM_OCPP_VERSION` resolves onto {@link SimConfig.ocppVersion} and
 *      reaches the argv, and a value the CLI does not accept is REFUSED by name
 *      with the list of the ones it does;
 *   3. `SIM_EXTRA_ARGS` is the last word on the two flags this module passes as
 *      a preference -- `--ocpp-version` and `--trace-output`: when it names
 *      one, ours is not emitted, so which value applies is not a question
 *      about upstream's argument parser. A flag it does not name is untouched;
 *      the connection flags are not negotiable at all;
 *   4. a trace path produces a bind mount of its DIRECTORY before the image and
 *      a `--trace-output` UNDER that mount, or neither of the two. Half the
 *      pair is worse than none: a flag without a mount writes the trace inside
 *      a container that `stop()` then removes, which is how the format was
 *      unreachable through this runner in the first place;
 *   5. `SIM_TRACE=0`, and only that value, says no to a trace at all. It
 *      resolves in `tck/sim.ts` with the rest of the `SIM_*` namespace, which
 *      is what puts it under this guard instead of under none;
 *   6. the run shape follows the IMAGE, not a constant: the pinned image keeps
 *      `bun src/cli/main.ts`, `SIM_LAUNCH` picks `dist` (`bun dist-cli/main.js`,
 *      an image built after shiv3/ocpp-cp-simulator#590) or `image` (its own
 *      entrypoint, flags first), any other image is `auto` and is probed once,
 *      a probe that fails falls back to the pinned shape with a warning, and
 *      `SIM_ENTRYPOINT` / `SIM_COMMAND` stay verbatim and exclusive of
 *      `SIM_LAUNCH`. The probe's docker call is the seam; its verdicts are
 *      what the rows hold.
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
  createLaunchDetector,
  DEFAULT_SIM_IMAGE,
  defaultSimConfig,
  parseLaunchProbe,
  resolveAutoLaunch,
  SIM_LAUNCHES,
  SIM_OCPP_VERSIONS,
  type SimConfig,
  type SimLaunch,
  traceRequested,
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
    `expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}\n` +
      "  (this row pins the argv WHOLE and IN ORDER, so it also goes red on a " +
      "changed default -- read the diff above before reading the summary below)",
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
  // Spelled, not `DEFAULT_SIM_OCPP_VERSION`: the constant compared against
  // itself pins nothing, and what this row is for is that the 47 `cert16-`
  // scenarios still drive what they were written against -- the image's own
  // default when the flag is absent.
  "OCPP-1.6J",
]);

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
  const args = argsFor({
    SIM_EXTRA_ARGS: extra,
    SIM_OCPP_VERSION: "OCPP-1.6J",
  });
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

// ---------------------------------------------------------------------------
// 4. A trace path is a MOUNT plus a flag under it, or neither.
// ---------------------------------------------------------------------------

{
  const traced: SimConfig = {
    ...defaultSimConfig({}),
    tracePath: "/tmp/results/cert16-tc001-cold-boot.jsonl",
  };
  expectArgs(
    "the argv with a trace path",
    buildDockerArgs(CP, CONTAINER, traced),
    [
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
      "OCPP-1.6J",
      // The file the mount makes reachable from the host. A path outside it
      // would be written inside the container and removed with it, which is
      // how this format was unusable through the runner before.
      "--trace-output",
      "/trace/cert16-tc001-cold-boot.jsonl",
    ],
  );
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

// ---------------------------------------------------------------------------
// 5. SIM_TRACE=0, the one thing that says no to a trace.
// ---------------------------------------------------------------------------

for (const [value, wanted] of [
  [undefined, true],
  ["0", false],
  ["1", true],
  ["", true],
] as const) {
  const env = value === undefined ? {} : { SIM_TRACE: value };
  if (traceRequested(env) !== wanted) {
    fail(
      `SIM_TRACE=${value === undefined ? "<unset>" : value} means ${
        wanted ? "trace" : "no trace"
      }`,
      `traceRequested returned ${traceRequested(env)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. The run shape follows the image.
// ---------------------------------------------------------------------------

const TAIL = [
  "--ws-url",
  "ws://localhost:8080/ocpp/CP1",
  "--cp-id",
  CP,
  "--json",
  "--ocpp-version",
  "OCPP-1.6J",
];
const OTHER_IMAGE = "ghcr.io/example/ocpp-cp-simulator:next";
const HEAD = ["run", "-i", "--rm", "--name", CONTAINER];

expectArgs(
  "SIM_LAUNCH=dist runs the bundle under bun",
  argsFor({ SIM_LAUNCH: "dist" }),
  [...HEAD, "--entrypoint", "bun", DEFAULT_SIM_IMAGE, "dist-cli/main.js", ...TAIL],
);
expectArgs(
  "SIM_LAUNCH=image uses the image's own entrypoint, flags first",
  argsFor({ SIM_LAUNCH: "image" }),
  [...HEAD, DEFAULT_SIM_IMAGE, ...TAIL],
);
expectArgs(
  "SIM_LAUNCH=src is the default shape, spelled",
  argsFor({ SIM_LAUNCH: "src" }),
  argsFor({}),
);
expectArgs(
  "SIM_IMAGE keeps working: the image is swapped, the pinned shape stays until probed",
  argsFor({ SIM_IMAGE: OTHER_IMAGE }),
  [...HEAD, "--entrypoint", "bun", OTHER_IMAGE, "src/cli/main.ts", ...TAIL],
);
expectArgs(
  "SIM_ENTRYPOINT and SIM_COMMAND stay verbatim",
  argsFor({ SIM_ENTRYPOINT: "node", SIM_COMMAND: "cli.js --x" }),
  [...HEAD, "--entrypoint", "node", DEFAULT_SIM_IMAGE, "cli.js", "--x", ...TAIL],
);
expectArgs(
  "SIM_ENTRYPOINT='' restores the image's entrypoint but keeps the command",
  argsFor({ SIM_ENTRYPOINT: "" }),
  [...HEAD, DEFAULT_SIM_IMAGE, "src/cli/main.ts", ...TAIL],
);

for (const [env, launch] of [
  [{}, "src"],
  [{ SIM_IMAGE: DEFAULT_SIM_IMAGE }, "src"],
  [{ SIM_IMAGE: OTHER_IMAGE }, "auto"],
  [{ SIM_IMAGE: OTHER_IMAGE, SIM_LAUNCH: "auto" }, "auto"],
  [{ SIM_IMAGE: OTHER_IMAGE, SIM_LAUNCH: "dist" }, "dist"],
  [{ SIM_IMAGE: OTHER_IMAGE, SIM_COMMAND: "x.js" }, "custom"],
  [{ SIM_COMMAND: "x.js" }, "custom"],
] as const) {
  const got = defaultSimConfig(env).launch;
  if (got !== launch) {
    fail(`launch for ${JSON.stringify(env)}`, `expected ${launch}, got ${got}`);
  }
}

for (const [what, env, needle] of [
  ["an unknown SIM_LAUNCH", { SIM_LAUNCH: "dist-cli" }, "dist"],
  ["SIM_LAUNCH with SIM_ENTRYPOINT", { SIM_LAUNCH: "dist", SIM_ENTRYPOINT: "bun" }, "SIM_ENTRYPOINT"],
  ["SIM_LAUNCH with SIM_COMMAND", { SIM_LAUNCH: "dist", SIM_COMMAND: "x" }, "SIM_COMMAND"],
] as const) {
  try {
    defaultSimConfig(env);
    fail(`${what} is refused`, "defaultSimConfig returned");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(needle) || !message.includes("SIM_LAUNCH")) {
      fail(`${what} is refused by name`, message);
    }
  }
}

// The probe's verdicts. The last row is the one that matters: an image with
// neither file must not be launched through bun with a path that is not there.
for (const [stdout, want] of [
  ["src\n", "src"],
  ["dist\n", "dist"],
  ["none\n", "image"],
  ["", "image"],
  ["Unable to find image locally\nsrc\n", "src"],
] as const) {
  const got = parseLaunchProbe(stdout);
  if (got !== want) {
    fail(`probe output ${JSON.stringify(stdout)}`, `expected ${want}, got ${got}`);
  }
}
if (SIM_LAUNCHES.join() !== "src,dist,image") {
  fail("the run shapes", `${SIM_LAUNCHES.join()} -- a new shape needs its own row above`);
}

{
  const asked: string[] = [];
  const warnings: string[] = [];
  const answers: Record<string, string | Error> = {
    "img:src": "src\n",
    "img:dist": "dist\n",
    "img:none": "none\n",
    "img:broken": new Error("exit 125: no such image"),
  };
  const detect = createLaunchDetector(
    async (image) => {
      asked.push(image);
      const answer = answers[image];
      if (answer instanceof Error) throw answer;
      return answer ?? "";
    },
    (message) => warnings.push(message),
  );
  const shapeOf = async (image: string): Promise<SimLaunch> => {
    const resolved = await resolveAutoLaunch(
      defaultSimConfig({ SIM_IMAGE: image }),
      detect,
    );
    return resolved.launch as SimLaunch;
  };
  const wantArgs: Record<string, string[]> = {
    "img:src": ["--entrypoint", "bun", "img:src", "src/cli/main.ts"],
    "img:dist": ["--entrypoint", "bun", "img:dist", "dist-cli/main.js"],
    "img:none": ["img:none"],
  };
  for (const image of ["img:src", "img:dist", "img:none"]) {
    const resolved = await resolveAutoLaunch(
      defaultSimConfig({ SIM_IMAGE: image }),
      detect,
    );
    expectArgs(
      `an auto image shaped ${image}`,
      buildDockerArgs(CP, CONTAINER, resolved).slice(HEAD.length, HEAD.length + wantArgs[image].length),
      wantArgs[image],
    );
  }
  if ((await shapeOf("img:broken")) !== "src" || warnings.length !== 1) {
    fail(
      "a failed probe falls back to the pinned shape with one warning",
      `warnings=${JSON.stringify(warnings)}`,
    );
  }
  await shapeOf("img:src");
  await shapeOf("img:broken");
  if (asked.length !== 4 || new Set(asked).size !== 4) {
    fail("each image is probed once", `probed ${JSON.stringify(asked)}`);
  }
  // An explicit shape and the pinned image never reach the probe.
  const before = asked.length;
  await resolveAutoLaunch(defaultSimConfig({}), detect);
  await resolveAutoLaunch(defaultSimConfig({ SIM_IMAGE: "img:src", SIM_LAUNCH: "dist" }), detect);
  await resolveAutoLaunch(defaultSimConfig({ SIM_IMAGE: "img:src", SIM_COMMAND: "x" }), detect);
  if (asked.length !== before) {
    fail("a known shape is not probed", `probed ${JSON.stringify(asked.slice(before))}`);
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
