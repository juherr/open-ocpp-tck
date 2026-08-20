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
# the message says which. Exit 2 is a usage or setup error -- including a
# command that could not be launched at all, which exits 126/127 and is a
# mistake in the invocation, not a verdict -- 3 a failed restore (read that
# one: the mutation is still in the tree), and 130/131/143 an interrupted run.
# Everything but 0 and 1 concludes nothing either way.
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

# FAIL CLOSED FROM HERE ON. This script edits a source file in place, so every
# step between the backup and the restore is one where giving up quietly would
# leave a mutation in somebody's working tree. Each is checked, and the backup
# is deleted only once the original is demonstrably back.
backup="$(mktemp)" || {
  echo "mutate: could not create a temp file; refusing to edit $file." >&2
  exit 2
}
cp "$file" "$backup" || {
  echo "mutate: could not back up $file; refusing to edit it." >&2
  rm -f "$backup"
  exit 2
}

restored=0
restore() {
  [ "$restored" -eq 1 ] && return 0
  restored=1
  if ! cp "$backup" "$file"; then
    echo >&2
    echo "FAIL: could not restore $file from its backup." >&2
    echo "  → the mutation is STILL IN YOUR WORKING TREE." >&2
    echo "  → the backup is kept at $backup; put it back by hand before" >&2
    echo "    doing anything else, and do not trust the verdict above." >&2
    return 1
  fi
  rm -f "$backup"
}

# EXIT covers the normal path and every `exit` below. A failed restore beats
# whatever the mutation test concluded: a verdict is worthless next to a source
# file left edited.
on_exit() {
  local rc=$?
  restore || rc=3
  exit "$rc"
}
trap on_exit EXIT

# INT/TERM get handlers of their own rather than sharing the EXIT one, so that
# a signal cannot end in a success classification. They disarm the traps first
# -- `restored` already makes a second restore a no-op, but re-entering during
# a restore is not worth reasoning about -- and exit with the conventional
# 128+signal, which the caller can tell from any verdict this script issues.
on_signal() {
  trap - EXIT INT TERM
  echo >&2
  echo "INTERRUPTED by SIG$1 -- restoring $file, concluding nothing." >&2
  restore || exit 3
  exit "$2"
}
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM

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
# No `set +e` dance: `-e` is not on (see `set -uo pipefail` above), and turning
# it on afterwards -- which the previous shape did -- armed a trap nobody asked
# for over the reporting below.
"$@"
status=$?

# A command KILLED BY A SIGNAL exits 128+n, and 130/131/143 in particular are a
# Ctrl-C or a `kill` reaching the guard rather than the guard disagreeing with
# the mutated code. Classified before the generic non-zero branch, because
# "non-zero" there means "the guard went red", and reporting an interrupted run
# as a verified one is the exact failure this script exists to prevent -- one
# level up from the mutation that silently does not apply.
case "$status" in
  130 | 131 | 143)
    echo >&2
    echo "INTERRUPTED: the command was killed (exit $status), not run to a" >&2
    echo "  verdict. Nothing is verified; $file is being restored." >&2
    exit "$status"
    ;;
  # A command that never STARTED is the same class as one that was killed, and
  # it is the easier one to misread: 127 looks like any other non-zero, so the
  # branch below would call it a guard going red. The usual cause is passing
  # the command through a shell variable -- `-- $CMD` arrives here as one word,
  # which is not the name of any program -- and the report then says a guard
  # caught a mutation that was never run against it.
  126 | 127)
    echo >&2
    echo "REFUSED: the command could not be run (exit $status), so it never" >&2
    echo "  reached a verdict. Nothing is verified; $file is being restored." >&2
    echo "  → 127 is \"command not found\", 126 \"found but not executable\"." >&2
    echo "  → spell the command out after \`--\`; a \$VARIABLE holding it is" >&2
    echo "    passed as a single argument and cannot be found." >&2
    exit 2
    ;;
esac

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
