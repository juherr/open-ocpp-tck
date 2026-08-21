#!/usr/bin/env bash
# Everything CI checks before it starts a container, in one command.
#
# WHY THIS EXISTS. The gate was nine steps in .github/workflows/ci.yml and
# nothing reproduced it locally: `bun test` covers three of them, so anyone
# wanting the real answer chained the rest by hand. That is how a `| tail -1`
# ends up in the chain and reports a FAILING guard as passing -- `tail` exits
# 0, and the `&&` after it happily continues. It happened here, and the guard
# stayed red for two rounds.
#
# So: pipefail, an explicit status per step, and one exit code.
#
# EVERY STEP RUNS even after one fails. CI stops at the first, which is right
# for a signal; locally the useful thing is the whole list, because a rename
# usually breaks the typecheck AND the declarations AND a guard, and fixing
# them one round trip at a time is the slow way.
#
# Offline and deterministic, like `bun test`: no CSMS, no docker, no network.
# The live counterparts are `ocpp-tck driver selftest` (seconds, needs a CSMS)
# and `bun run e2e` (a sweep, needs docker).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

failed=""
run() {
  label=$1
  shift
  printf '\n=== %s\n' "$label"
  if "$@"; then
    printf '    ok\n'
  else
    printf '    FAILED\n'
    failed="$failed$label"$'\n'
  fi
}

run "typecheck" bun run typecheck
# Regenerates into a temp dir and diffs against types/, so it must run after
# nothing in particular -- but before the guards, since a stale declaration is
# the cheapest failure to read.
run "declarations are current" bash tests/types-current.sh
run "driver scope: steve" bun run check:driver:steve
run "driver scope: citrineos" bun run check:driver:citrineos
# The second table the same driver declares. `scope` is a function of the
# environment, so checking only the default line would leave half of what this
# driver claims unverified -- and the v1 table is the derived one.
run "driver scope: citrineos (v1)" bun run check:driver:citrineos-v1
run "driver scope follows the env" bun tests/driver-env-scope.ts
# The exit-code rule, whole. Pure and offline because tck/standing.ts is a
# module of its own -- reaching these rows through a sweep would take a
# container per row, and engineering a CSMS that fails a chosen scenario a
# chosen way for the rows that matter.
run "exit-code rule holds" bun tests/expected-failure-standing.ts
run "a CALLERROR fails, a truncated log does not" bun tests/assert-answered.ts
# In-process for the third time, and the most literal case of it: both bundled
# drivers spell an unfiltered GetConfiguration `{"key":[]}`, so the encoding
# TC_019_1 used to reject -- an omitted member -- cannot be produced by any run
# this repository can perform, only by handing the helper the frames.
run "an unfiltered GetConfiguration is a shape, not a spelling" bun tests/get-configuration-filter.ts
# And in-process because the foreign-sweep refusal reads `docker ps`, so
# checking it from a shell would mean starting a container per row on the very
# daemon it protects.
run "the foreign-sweep refusal sees every namespace" bun tests/foreign-sweep-scope.ts
# And in-process because buildDockerArgs is pure and its one caller spawns
# docker in the next statement, so the argv a scenario would run is not
# printable from a shell -- nor is a resolution from an environment that is not
# this process's.
run "the simulator argv says what the run was asked to do" bun tests/sim-docker-argv.ts
# And in-process for the same reason the three above are: every refusal
# tck/trace.ts makes needs a trace no run here produces -- 94 archived
# scenarios, 1576 records, not one missing a member -- so the only way into
# those branches is handing the mapper its records.
run "the wire trace reads as the frames the log would have given" bun tests/trace-frames.ts
# And in-process because what it checks is an interleaving between lanes that
# share one driver instance. From a shell that is a whole sweep, and there the
# property is a 45%-of-the-time event -- issue #77 took 91 archived artifacts
# and a preserved wire trace to see once.
run "the manager-UI client survives concurrent lanes" bun tests/steve-ui-session-race.ts
# And in-process because every branch it classifies needs a CSMS engineered to
# refuse a request a chosen way -- a 503, a body that stalls mid-stream, a 200
# that is not JSON. The pinned image produces none of them on demand.
run "a request that never reached the CSMS says so" bun tests/citrineos-transport-classification.ts
run "core is CSMS-neutral" bash tests/generic-core.sh
# The one reading in this repository that lives in the workflow rather than in
# a file the gate can run -- so it is a file now, and this is what runs it.
run "a red row is red whatever its namespace" bash tests/summary-red-rows.sh
# The other layering boundary the repository declares in prose: AGENTS.md and
# everything it governs must not depend on the harness file.
run "harness layering holds" bash tests/harness-layer.sh
# This file, the workflow and `bun run test` are three copies of the list
# above. They used to be kept in step by hand, and were not.
run "gate parity holds" bash tests/gate-parity.sh
# And the other thing AGENTS.md asserts about this file: the numbers it writes
# out in prose. Three of them were wrong at once.
run "doc counts hold" bash tests/doc-counts.sh
# The other documentation claim with a checkable referent: the install command
# the docs give installs the driver contract they document. Needs tags, which
# is why CI checks out with fetch-tags.
run "documented install ref resolves" bash tests/documented-install-ref.sh
# Before vendor-integrity, which reads the manifest this one proves the re-pin
# script will not corrupt. Builds a throwaway git repository; touches nothing
# here.
run "repin refuses what it promises to" bash tests/repin-refusals.sh
# The other writing script, and the one every other guard is validated with:
# a non-zero exit is its good news, so a command that never ran reads as a
# guard going red unless something tells the two apart.
run "mutate concludes nothing when nothing ran" bash tests/mutate-refusals.sh
run "vendored files match VENDOR.md" bash tests/vendor-integrity.sh
run "scenario invariants" bash tests/spec-invariants.sh
# After spec-invariants: this reads the artifact that one regenerates, so a
# stale inventory should be reported as stale, not as a coverage hole.
run "every OCA obligation has a check" bash tests/oca-obligations.sh
# And beside it, for the same reason and off the same artifact: the OCPP 2.0.1
# scenarios are the ones a written selection rule governs, and the rule and the
# scenarios are two files that can disagree.
run "the OCPP 2.0.1 slice is the selected one" bash tests/oca-201-slice.sh

# Not fatal when absent: shellcheck is a linter, and refusing to verify a
# TypeScript repository because a shell linter is missing would push people to
# skip the whole command. CI has it and enforces it.
if command -v shellcheck >/dev/null 2>&1; then
  run "shellcheck" shellcheck tests/*.sh tools/*.sh
else
  printf '\n=== shellcheck\n    skipped (not installed; CI enforces it)\n'
fi

if [ -n "$failed" ]; then
  printf '\nFAILED:\n%s' "$failed" >&2
  exit 1
fi
printf '\nAll checks passed.\n'
