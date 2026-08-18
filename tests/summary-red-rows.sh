#!/usr/bin/env bash
# A red row in a sweep summary is found whatever the namespace, wherever the
# column, and a table nobody could read is refused rather than answered.
#
# PROPERTY, in three parts -- one per claim `tools/summary-red-rows.ts` makes:
#   1. NO SCENARIO NAMESPACE. A `FAIL`/`ERROR` row is found whether its
#      template id opens `cert16-`, `cert201-` or something nobody has proposed.
#   2. THE VERDICT COLUMN IS FOUND BY NAME. Inserting a column before it, or
#      appending one after it, does not move the answer.
#   3. AN UNREADABLE TABLE IS REFUSED. No header, no `verdict` column, a ragged
#      row, or a verdict cell spelling no verdict: exit 2, never exit 1.
#
# WHY THIS EXISTS. The reading was a `grep -qE '^\| cert16-…'` inside
# .github/workflows/ci.yml, and it carried both bindings at once: a red
# `cert201-` row would not have been red, and a column inserted before `verdict`
# would have silently matched prose. Neither could be tested -- a line of YAML
# is only reachable by running a 15-minute sweep and reading the job -- so
# neither would have been noticed until an investigation wanted the CSMS log
# that was never captured.
#
# WHAT IT CANNOT CHECK: that capturing the CSMS log is the right response to a
# red row, or that `results/summary.md` really looks like the tables below --
# `writeSummary` owns that, and no artifact pins it. What it pins is that the
# reading survives the table growing a column and the suite growing a namespace.
# The verdict vocabulary is not on that list on purpose: the tool imports
# `VERDICTS` from `tck/standing.ts` instead of copying it, so a renamed verdict
# fails the typecheck at that array and then reaches the tool through the
# import -- neither a fixture here nor a spelling in the tool to go stale.
#
# Offline: writes fabricated summaries into a temp dir and runs one tool.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

tool=tools/summary-red-rows.ts
[ -s "$tool" ] || { echo "FAIL: $tool is missing or empty." >&2; exit 1; }

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

status=0
cases=0

# `expect <exit> <name> <<'EOF'` -- the heredoc is the TABLE, and only the
# table. The prose around it is the same in every case and is prepended here, so
# what a fixture varies (a namespace, a column, a verdict cell) is all a reader
# has to compare. It is also what the header search has to skip past.
expect() {
  want=$1
  name=$2
  cases=$((cases + 1))
  {
    printf '# OCPP verification results — group: all\n\n'
    printf 'Run at 2026-01-01T00:00:00Z. Host load 1.00 over 8 core(s).\n\n'
    cat
  } > "$work/$name.md"
  got=0
  out=$(bun "$tool" "$work/$name.md" 2>&1) || got=$?
  [ "$got" = "$want" ] && return 0
  status=1
  echo "FAIL[$name]: expected exit $want, got $got." >&2
  printf '%s\n' "$out" | sed 's/^/    /' >&2
}

# ------------------------------------------------------------------ part 1
#
# The same table three times, differing only in the namespace of the failing
# row. The `cert16-` case is what the expression this replaces got right; the
# other two are what it got wrong.
expect 0 red-cert16 <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | FAIL | 5 | 1 | 0 |
EOF

expect 0 red-cert201 <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert201-tcb01-cold-boot | CERTCP1 | ERROR | - | - | - |
EOF

expect 0 red-unproposed-namespace <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert21-tcb01-cold-boot | CERTCP1 | FAIL | 5 | 1 | 0 |
EOF

# The other direction, and it is half the property: a table with no failing row
# must answer 1, or "capture the log" degenerates into "always capture". Every
# non-failing verdict appears, including the two whose cells carry free prose.
expect 1 no-red-row <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | PASS | 5 | 0 | 0 |
| cert16-tc019-get-configuration-all | CERTCP2 | PARTIAL | 4 | 0 | 1 |
| cert16-reservation-basic | CERTCP3 | NOT APPLICABLE (no reservations) | - | - | - |

1 PARTIAL, 1 NOT APPLICABLE. Neither fails the sweep.
EOF

# ------------------------------------------------------------------ part 2
#
# A column INSERTED BEFORE `verdict`. Under a positional read the third column
# is now `lane`, and the red row below is lost.
expect 0 column-inserted-before-verdict <<'EOF'
| scenario | cp | lane | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | 1 | FAIL | 5 | 1 | 0 |
EOF

# The column `writeSummary` really does append, on a run that passed
# --retry-failed-isolated. Appending must not move the answer either.
expect 0 column-appended <<'EOF'
| scenario | cp | verdict | checks | failed | skipped | isolated retry |
| --- | --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | FAIL | 5 | 1 | 0 | PASS (flake) |
EOF

# ------------------------------------------------------------------ part 3
#
# Five shapes, five refusals. Each would otherwise be answered "no red row",
# which is the one wrong answer: it is indistinguishable from a clean sweep.
expect 2 no-header <<'EOF'
| cert16-tc001-cold-boot | CERTCP1 | FAIL | 5 | 1 | 0 |
EOF

expect 2 no-verdict-column <<'EOF'
| scenario | cp | outcome | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | FAIL | 5 | 1 | 0 |
EOF

expect 2 ragged-row <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | PASS |
EOF

expect 2 unknown-verdict <<'EOF'
| scenario | cp | verdict | checks | failed | skipped |
| --- | --- | --- | --- | --- | --- |
| cert16-tc001-cold-boot | CERTCP1 | INCONCLUSIVE | 5 | 0 | 0 |
EOF

# The sweep that died before writing a table -- the case with the most to say
# and the least to read. Refused for the same reason.
expect 2 no-table < /dev/null

# And no argument at all: a caller that forgot the path must not be told there
# is nothing to capture. It cannot go through `expect`, which names a file.
cases=$((cases + 1))
got=0
bun "$tool" >/dev/null 2>&1 || got=$?
if [ "$got" != 2 ]; then
  status=1
  echo "FAIL[no-argument]: expected exit 2 with no summary named, got $got." >&2
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "The red-row reading no longer holds. A sweep whose summary this tool" >&2
  echo "misreads captures no CSMS log, and the job is green either way -- so" >&2
  echo "nothing else in the build would have said so." >&2
  exit 1
fi

echo "Red-row reading holds: $cases summary shape(s), namespace-free, verdict column by name."
