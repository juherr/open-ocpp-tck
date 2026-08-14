#!/usr/bin/env bash
# Mutation-test one guard: break what it protects, confirm it goes red, restore.
#
# WHY THIS EXISTS. AGENTS.md asks for a mutation test on every new guard --
# break what it protects, watch it go red for that reason and no other, revert
# -- and doing it by hand has one failure mode that looks exactly like success:
# THE EDIT DOES NOT APPLY. A `perl -0pi -e 's/…/…/'`
# whose pattern misses (a ternary branch mistaken for the other, an escaped
# brace, whitespace that moved) leaves the file untouched, the guard passes,
# and the guard is recorded as verified having tested nothing.
#
# That happened here, once, in about twelve mutations. It cost only a round
# trip because the substitution was obviously wrong on a second read; a subtler
# miss would have been recorded as a working guard.
#
# So this script asserts the mutation LANDED before it draws any conclusion,
# and restores the file whatever happens.
#
# Usage:
#   tools/mutate.sh <file> <perl-expression> -- <command...>
#
#   tools/mutate.sh tck/standing.ts \
#     's/return "expected-fail";/return "ok";/' \
#     -- bun tests/expected-failure-standing.ts
#
# Exit 0 means the guard did its job: the mutation applied AND the command went
# red. Exit 1 means either the mutation did not apply, or it applied and the
# guard stayed green -- both are the guard failing to protect its property, and
# the message says which.
#
# READ THE OUTPUT, do not just trust the exit code. "Goes red" is necessary but
# not sufficient: the rule is red *for that reason and no other*, and no script
# can check that. The guard's own output is printed for exactly that.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

file=${1-}
expr=${2-}
shift 2 2>/dev/null || true
if [ "${1-}" = "--" ]; then shift; fi

if [ -z "$file" ] || [ -z "$expr" ] || [ "$#" -eq 0 ]; then
  echo "Usage: tools/mutate.sh <file> <perl-expression> -- <command...>" >&2
  exit 2
fi
[ -f "$file" ] || { echo "mutate: $file does not exist." >&2; exit 2; }

backup="$(mktemp)"
cp "$file" "$backup"
# EXIT covers the normal path and every `exit` below; INT/TERM cover a Ctrl-C
# mid-run. Restoring a source file is not something to leave to the caller.
restore() { cp "$backup" "$file"; rm -f "$backup"; }
trap restore EXIT INT TERM

if ! perl -0pi -e "$expr" "$file"; then
  echo "mutate: the perl expression failed to run." >&2
  exit 1
fi

if cmp -s "$backup" "$file"; then
  echo "FAIL: the mutation did not apply -- $file is byte-identical." >&2
  echo "  → the pattern matched nothing, so the command below would have" >&2
  echo "    passed against UNMODIFIED code and told you nothing." >&2
  echo "  → check the expression against the current source; this is the" >&2
  echo "    failure this script exists to make impossible to miss." >&2
  exit 1
fi

printf '=== mutated %s, running: %s\n' "$file" "$*" >&2
set +e
"$@"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo >&2
  echo "FAIL: the mutation applied and the guard stayed GREEN." >&2
  echo "  → the property this guard claims to protect is not protected." >&2
  exit 1
fi

echo >&2
echo "OK: the guard went red (exit $status) on a mutation that applied." >&2
echo "  → now read its output above: the rule is red for THAT reason and no" >&2
echo "    other, which no exit code can tell you." >&2
