#!/usr/bin/env bash
# The gate is declared in three places, and the three declarations must agree.
#
# THE PROPERTY, in three parts:
#   1. `tools/verify.sh` runs exactly the commands the `check` job of
#      `.github/workflows/ci.yml` runs, in the same order, minus the CI-only
#      setup steps listed in SETUP_ONLY below.
#   2. every link in `package.json`'s `test` chain is one of those commands.
#   3. SETUP_ONLY is exhaustive -- an entry matching no CI step is an error,
#      not a spare exclusion someone can leave behind.
#
# WHY IT IS A GUARD AND NOT A CONVENTION. AGENTS.md used to say it in prose:
# "That the two lists agree is maintained by hand, and it has drifted three
# times". Three. The drift has one shape every time -- a guard is added to
# `verify` and to `bun run test`, and not to the workflow -- and one
# consequence: shellcheck lints the file, the workflow never runs it, and the
# repository ships a check nobody executes. `tests/assert-answered.ts` spent
# its whole life so far in that state.
#
# The direction matters. A step in `verify` and not in CI is the dangerous
# one, because local green then means less than it says. A step in CI and not
# in `verify` is milder but still a defect: `verify` exists precisely so that
# one command reproduces the gate, and a gate you cannot reproduce sends you
# to the pull request to find out what broke.
#
# ORDER IS PART OF IT. Two steps here are ordered for a stated reason --
# declarations before the guards because a stale declaration is the cheapest
# failure to read, and oca-obligations after spec-invariants so a stale
# inventory reports as stale rather than as a coverage hole. Comparing sets
# would let CI keep the reasons and lose the order.
#
# WHAT IT CANNOT CHECK: that a step does what its label claims, or that the
# list is the right list. Only that the three copies of it are one list.
#
# Offline: reads three files, runs nothing.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

workflow=.github/workflows/ci.yml
verify=tools/verify.sh
manifest=package.json

for f in "$workflow" "$verify" "$manifest"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

# CI-only steps: setup that has no counterpart in `verify.sh` because running
# `verify` presupposes it. Kept short on purpose -- every entry is a hole in
# part 1 of the property, and part 3 makes sure a hole cannot outlive its
# reason.
SETUP_ONLY=(
  "bun install --frozen-lockfile"
)

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

# The `check` job's steps, in order: from `  check:` to the next job key at the
# same indentation. Scoped that way rather than by grepping the whole file
# because the `e2e` job's steps are commands too, and they are deliberately NOT
# in `verify.sh` -- they need docker and a CSMS.
awk '
  /^  [A-Za-z_][A-Za-z0-9_-]*:[ \t]*$/ { inside = ($0 ~ /^  check:[ \t]*$/); next }
  inside && match($0, /^[ \t]*-?[ \t]*run:[ \t]*/) {
    print substr($0, RSTART + RLENGTH)
  }
' "$workflow" > "$work/ci-raw"

# A block scalar would make the line above print `|` and compare it against a
# command. Refused rather than normalised: a multi-line CI step has no
# single-command counterpart in `verify.sh`, so the parity question changes
# shape and this guard should be rewritten, not silently fed a `|`.
if grep -qE '^[|>]' "$work/ci-raw"; then
  echo "FAIL: the check job has a block-scalar 'run:' step." >&2
  echo "  → this guard compares one command per step; teach it the new" >&2
  echo "    shape rather than letting it compare a '|'." >&2
  exit 1
fi

# `run "<label>" <command...>` -- the label is this file's, the command is the
# gate's. The shellcheck step's globs stay unexpanded here, which is what makes
# it comparable to the workflow's text.
sed -n 's/^[[:space:]]*run "[^"]*" //p' "$verify" > "$work/verify"

# The `test` chain, one link per line. No quote appears inside the value, so
# field 4 is the whole chain.
awk -F'"' '/"test":[[:space:]]*"/ { print $4; exit }' "$manifest" \
  | awk '{ n = split($0, links, / && /); for (i = 1; i <= n; i++) print links[i] }' \
  > "$work/test-chain"

# EXTRACTING NOTHING IS NOT AGREEING ON NOTHING. Each of the three greps above
# is a pattern over a file's syntax, and a file that changes shape -- a job
# renamed, `run` given a different indentation, `test` moved into a script --
# makes it match zero lines. Two empty lists are identical, so without this the
# guard would pass by reading nothing, which is the failure mode it exists to
# prevent one level up.
for list in ci-raw verify test-chain; do
  [ -s "$work/$list" ] || {
    echo "FAIL: extracted no commands for '$list'." >&2
    echo "  → the file's shape changed under this guard's patterns; it is" >&2
    echo "    reading nothing, not agreeing about nothing." >&2
    exit 1
  }
done

status=0

# Part 3 first: a stale allowlist entry would silently widen part 1.
: > "$work/ci"
cp "$work/ci-raw" "$work/ci"
for setup in "${SETUP_ONLY[@]}"; do
  if ! grep -qxF "$setup" "$work/ci"; then
    status=1
    echo "FAIL: SETUP_ONLY lists a step the check job does not run:" >&2
    echo "    $setup" >&2
    echo "  → delete the entry. An exclusion that excludes nothing is a hole" >&2
    echo "    held open for a reason that has gone." >&2
    continue
  fi
  grep -vxF "$setup" "$work/ci" > "$work/ci-filtered" || true
  mv "$work/ci-filtered" "$work/ci"
done

# Part 1: same commands, same order.
if ! diff -u --label "$workflow (check job, minus setup)" --label "$verify" \
     "$work/ci" "$work/verify" > "$work/parity-diff"; then
  status=1
  echo "FAIL: the workflow and $verify do not run the same gate." >&2
  echo >&2
  sed 's/^/  /' "$work/parity-diff" >&2
  echo >&2
  echo "  → '-' is a step CI runs and $verify does not: the gate cannot be" >&2
  echo "    reproduced locally." >&2
  echo "  → '+' is a step $verify runs and CI does not: it is linted and" >&2
  echo "    never executed, which is how this drifted three times." >&2
  echo "  → a reordering counts: two steps here are ordered for a reason" >&2
  echo "    stated in $verify's comments." >&2
fi

# Part 2: `bun run test` is a subset -- the guards only, without the typecheck,
# the declarations, the driver scope checks or the linter.
while IFS= read -r link; do
  [ -n "$link" ] || continue
  if ! grep -qxF "$link" "$work/verify"; then
    status=1
    echo "FAIL: 'bun run test' runs a command $verify does not:" >&2
    echo "    $link" >&2
    echo "  → add it to $verify and to the workflow, or drop it here; a" >&2
    echo "    guard reachable only through 'bun run test' is not in the gate." >&2
  fi
done < "$work/test-chain"

if [ "$status" -ne 0 ]; then
  exit 1
fi

echo "Gate parity holds: $(wc -l < "$work/verify" | tr -d ' ') steps, same order in" \
     "$workflow and $verify; $(wc -l < "$work/test-chain" | tr -d ' ') of them in 'bun run test'."
