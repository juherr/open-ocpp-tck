#!/usr/bin/env bash
# Every OCPP 2.0.1 scenario traces to a selected case, and every selected case
# is implemented or declined in writing.
#
# PROPERTY: `tck/specs/OCA-201-SLICE.txt` and the `cert201-` scenarios actually
# registered describe the same set. A scenario for a case the list does not
# select is a case that got in without the rule, which is the failure
# OCA-201-SELECTION.md was written to stop -- "a small representative set" is a
# judgement each reviewer makes differently, and the drift is silent because
# every individual addition looks reasonable. A case on the list with neither a
# scenario nor a stated reason is the same drift running the other way: the
# list stops describing what was decided and starts describing what was
# intended.
#
# And two things about the table itself, without which the property above is a
# statement about whichever rows this guard happened to read:
#   - EVERY LINE IS A COMMENT, BLANK, OR A ROW of at least two fields. A
#     mistyped row read by neither pass is an obligation that quietly stops
#     being checked -- the failure tests/oca-obligations.sh measured on its own
#     table, where truncating a row left the guard printing a total that
#     included it.
#   - A `not-implemented` ROW CARRIES A REASON. Declining a mandatory case is
#     a decision; "not yet" with nothing after it is the absence of one, and it
#     reads identically six months later.
#
# AND THE CASE A SCENARIO TRACES TO IS ONE ANSWER, not two. OCA-OBLIGATIONS.txt
# names an OCA case per row as well, and nothing read it against anything:
# `cert201-tcb20-reset-accepted ... TC_B_01` satisfied both guards, because that
# one never compares its case column and this one never opened that file. Two
# tables assigning a scenario to two different cases is the same drift as a
# scenario with no case at all, one step subtler.
#
# WHY IT READS THE INVENTORY rather than importing the specs: the same reason
# tests/oca-obligations.sh does. `tck/specs/ASSERT-INVENTORY.txt` is generated
# from the sources and already guarded by tests/spec-invariants.sh, so this
# guard cannot disagree with what that artifact says exists, and removing a
# scenario has to get past both. It also keeps this offline and free of a
# runtime.
#
# WHY IT EXISTS AT ALL, AND WHY ONLY NOW. OCA-201-SELECTION.md records that it
# owed this guard from the day it was written and could not have it: direction
# one had nothing to range over, and direction two would have been red on all
# seven rows from the first commit -- a build red on purpose is a build nobody
# reads. The first `cert201-` scenario is what makes both directions
# satisfiable, and that page names writing it as the moment this arrives.
#
# WHAT IT CANNOT CHECK: that the seven rows are the right seven -- that they
# are what the rule selects from Part 5 §4. That is a reading of a PDF this
# repository cannot contain; the method is written down where the rule is. What
# this stops is the set drifting afterwards.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

slice=tck/specs/OCA-201-SLICE.txt
inventory=tck/specs/ASSERT-INVENTORY.txt
obligations=tck/specs/OCA-OBLIGATIONS.txt

for f in "$slice" "$inventory" "$obligations"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ONE DEFINITION OF A ROW, and both passes read it. Two fields are required and
# the rest is the reason, so `NF >= 2` is the shape -- a line with one field is
# a case nobody said anything about, and refusing it here is what keeps it from
# being skipped by both passes while still looking like a row.
if ! awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  NF >= 2 { print; next }
  { printf "  line %d: %s\n", FNR, $0 > "/dev/stderr"; bad = 1 }
  END { exit(bad ? 1 : 0) }
' "$slice" > "$work/rows"; then
  echo "FAIL: $slice has a line that is neither a comment nor a row:" >&2
  echo "  → a row is <OCA case> <templateId | not-implemented> [reason]." >&2
  echo "    Skipping the ones that do not parse is how a case stops being" >&2
  echo "    checked with nothing going red." >&2
  exit 1
fi

status=0

# A declined case says why. `not-implemented` with nothing after it is the one
# row shape that parses and means nothing.
#
# A SECOND PASS AND NOT A RULE IN THE PARSER ABOVE, which would be one fewer
# traversal of a 7-row file: the parser's failure is "this line is not a row"
# and points at the syntax, where this one's is "write down what blocks it" and
# points at the decision. Folding them makes the cheaper message win for the
# case where the expensive one is the whole point.
while read -r case_id scenario reason; do
  [ "$scenario" = "not-implemented" ] || continue
  [ -n "${reason:-}" ] && continue
  status=1
  echo "FAIL: $case_id is declined with no reason given." >&2
  echo "  → write what blocks it, in the row. A case this suite is allowed to" >&2
  echo "    implement and does not is a decision; unexplained, it is" >&2
  echo "    indistinguishable from an oversight, and stays that way." >&2
done < "$work/rows"

# Direction 1: every scenario the slice claims to have is registered.
awk '$2 != "not-implemented" { print $2 }' "$work/rows" | sort -u > "$work/claimed"

# Direction 2: every registered scenario in the certification namespace this
# page governs. Derived from the inventory's SPEC lines, whose first token
# after `SPEC` is the templateId.
awk '/^  SPEC cert201-/ { print $2 }' "$inventory" | sort -u > "$work/registered"

if missing=$(comm -23 "$work/claimed" "$work/registered") && [ -n "$missing" ]; then
  status=1
  echo "FAIL: $slice names scenarios that are not registered:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$missing" >&2
  echo "  → the row claims a case is implemented and nothing implements it." >&2
  echo "    Either register the scenario, or make the row not-implemented and" >&2
  echo "    say why." >&2
fi

if extra=$(comm -13 "$work/claimed" "$work/registered") && [ -n "$extra" ]; then
  status=1
  echo "FAIL: registered scenarios that no row of $slice selects:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$extra" >&2
  echo "  → a scenario for a case outside the selection rule is the drift" >&2
  echo "    OCA-201-SELECTION.md exists to prevent. Either it belongs, in" >&2
  echo "    which case extend the list there and here and say on what" >&2
  echo "    grounds, or it does not." >&2
fi

# Direction 3: the obligations table assigns each of these scenarios to the
# same case this list does. Only the rows about scenarios this file selects --
# the obligations table is mostly OCPP 1.6 and none of its business here.
awk '$2 != "not-implemented" { print $2 "\t" $1 }' "$work/rows" | sort -u \
  > "$work/case-of"
awk '$1 ~ /^cert201-/ { print $1 "\t" $4 }' "$obligations" | sort -u \
  > "$work/obliged"

if disagree=$(comm -23 "$work/obliged" "$work/case-of") && [ -n "$disagree" ]; then
  status=1
  echo "FAIL: $obligations traces a scenario to a case $slice does not:" >&2
  awk '{ printf "  %s\t%s\n", $1, $2 }' <<< "$disagree" >&2
  echo "  → one scenario, one case. Whichever of the two is wrong, they" >&2
  echo "    cannot both be read as the answer." >&2
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "$slice and the registered scenarios disagree. Both are meant to be" >&2
  echo "edited together: the row records which cases the rule selects, the" >&2
  echo "scenario records that we implemented one." >&2
  exit 1
fi

cases=$(wc -l < "$work/rows" | tr -d ' ')
implemented=$(wc -l < "$work/claimed" | tr -d ' ')
echo "OCPP 2.0.1 slice: $cases case(s) selected, $implemented implemented."
