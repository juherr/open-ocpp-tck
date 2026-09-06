#!/usr/bin/env bash
# The e2e matrix runs every shard of the suite, and every job says which one.
#
# WHAT CAN GO WRONG HERE IS SILENT, which is the whole reason this file exists.
# The shard count lives in two places -- the matrix list the jobs fan out over,
# and the SHARD_TOTAL the command interpolates -- and they can disagree without
# anything going red. A matrix of [1, 2] against SHARD_TOTAL 3 runs two thirds
# of the suite in two green jobs, and the third of the scenarios that ran
# nowhere is not a failure, an error, or a row: it is an absence. The runner
# cannot catch it either, because each job is individually correct.
#
# THE OTHER SILENT ONE IS THE ARTIFACT NAME. Two shards of one driver upload to
# the same run; if the name does not carry the shard the second collides with
# the first, and the archive ends up holding half of each run with nothing
# saying so -- which would quietly corrupt tools/flake-report.ts's corpus rather
# than break it.
#
# FOUR CLAIMS:
#   1. the matrix's shard list is exactly 1..N, in order, no gaps
#   2. SHARD_TOTAL is that same N
#   3. the sweep interpolates BOTH -- a literal in either half is a run that
#      cannot be resharded by editing the list
#   4. the results artifact name carries the shard
#
# AND A REFUSAL. Every anchor below is searched for and its absence is a
# failure, never a pass: a guard that greps for a line someone renamed reports
# "no disagreement found" forever. 68d3458 is the commit that rule comes from.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

WF=.github/workflows/ci.yml
failures=0

fail() {
  failures=$((failures + 1))
  printf 'FAIL: %s\n      %s\n' "$1" "$2" >&2
}

ok() { printf '  ok: %s\n' "$1"; }

if [ ! -f "$WF" ]; then
  echo "REFUSED: $WF does not exist" >&2
  exit 2
fi

# 1 + 2. The list and the total.
shard_line=$(grep -E '^ +shard: \[' "$WF" || true)
if [ -z "$shard_line" ]; then
  fail "the matrix" "no 'shard: [...]' line in $WF -- renamed, or the matrix lost its shards"
else
  # bash 3.2 on macOS: keep this to parameter expansion and tr, no arrays of
  # captures and no `case` inside a command substitution.
  list=${shard_line#*\[}
  list=${list%\]*}
  got=$(printf '%s' "$list" | tr -d ' ')
  total=$(grep -E '^ +SHARD_TOTAL: [0-9]+$' "$WF" | tr -dc '0-9' || true)
  if [ -z "$total" ]; then
    fail "the total" "no 'SHARD_TOTAL: <n>' line in $WF"
  else
    want=""
    i=1
    while [ "$i" -le "$total" ]; do
      if [ -z "$want" ]; then want="$i"; else want="$want,$i"; fi
      i=$((i + 1))
    done
    if [ "$got" != "$want" ]; then
      fail "the matrix and the total" \
        "matrix shards are [$got] and SHARD_TOTAL is $total, so the jobs cover $got of 1..$total"
    else
      ok "the matrix runs shards 1..$total and SHARD_TOTAL agrees"
    fi
  fi
fi

# 3. The sweep interpolates both halves. The single quotes below are the point:
#    what is searched for is the literal `${{ ... }}` and `$SHARD_TOTAL` TEXT in
#    the YAML, not their values here. shellcheck's SC2016 is disabled for that
#    line for exactly that reason.
# shellcheck disable=SC2016
if ! grep -qF -- '--shard ${{ matrix.shard }}/$SHARD_TOTAL' "$WF"; then
  fail "the sweep command" \
    "the conformance sweep does not pass '--shard \${{ matrix.shard }}/\$SHARD_TOTAL'; a literal in either half makes the matrix list a lie"
else
  ok "the sweep interpolates the matrix shard and the total"
fi

# 4. The artifact name carries the shard.
if ! grep -qE '^ +name: ocpp-tck-.*matrix\.shard.*results' "$WF"; then
  fail "the artifact name" \
    "the results artifact name does not carry \${{ matrix.shard }}; two shards of one driver would collide on it"
else
  ok "the results artifact name carries the shard"
fi

if [ "$failures" -gt 0 ]; then
  cat >&2 <<'EOF'

The e2e matrix and the shard total disagree, or a job cannot be told from its
sibling. None of these is a red row on its own -- a suite that runs two thirds
of itself in two green jobs reports exactly what a complete one does, minus the
scenarios nobody notices are missing. Fix the workflow.
EOF
  exit 1
fi

echo "Shard matrix: OK (every shard runs, and every job says which)"
