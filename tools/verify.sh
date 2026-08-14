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
run "core is CSMS-neutral" bash tests/generic-core.sh
# The other layering boundary the repository declares in prose: AGENTS.md and
# everything it governs must not depend on the harness file.
run "harness layering holds" bash tests/harness-layer.sh
run "vendored files match VENDOR.md" bash tests/vendor-integrity.sh
run "scenario invariants" bash tests/spec-invariants.sh
# After spec-invariants: this reads the artifact that one regenerates, so a
# stale inventory should be reported as stale, not as a coverage hole.
run "every OCA obligation has a check" bash tests/oca-obligations.sh

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
