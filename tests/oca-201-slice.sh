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
#   - ONE ROW PER CASE, ONE ROW PER SCENARIO, AND THE COUNTS ADD UP. Both
#     duplicates were reproduced defeating the rest of this guard rather than
#     supposed: a second row for a scenario already listed makes the pair set
#     below a superset that absorbs any disagreement with the obligations
#     table, and two rows naming the same case drop a mandatory case out of
#     the list entirely while the summary still prints the row count as though
#     it were a case count.
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
  { sub(/\r$/, "") }
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

# ONE ROW PER CASE. Two rows naming the same case is not a tidiness problem: it
# drops a case out of the list while every count still adds up against the rows,
# so a mandatory case can stop being selected by anything with the summary
# unchanged. Reproduced, not supposed.
if dup=$(awk '{ print $1 }' "$work/rows" | sort | uniq -d) && [ -n "$dup" ]; then
  status=1
  echo "FAIL: $slice lists a case more than once:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$dup" >&2
  echo "  → one row per case. A second row for a case already listed leaves" >&2
  echo "    the case it replaced selected by nothing, and every count in this" >&2
  echo "    file still adds up." >&2
fi

# ONE ROW PER SCENARIO, for the reason direction 3 below needs: it reads the
# rows as a case-per-scenario answer, and a scenario listed twice turns that
# into a set of acceptable answers -- which absorbs any disagreement with the
# obligations table. Also reproduced.
if dup=$(awk '$2 != "not-implemented" { print $2 }' "$work/rows" | sort | uniq -d) \
  && [ -n "$dup" ]; then
  status=1
  echo "FAIL: $slice claims a scenario for more than one case:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$dup" >&2
  echo "  → one scenario implements one case here. Two rows make the" >&2
  echo "    cross-check below vacuous." >&2
fi

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

# THE SCENARIO-TO-CASE ANSWER THIS FILE GIVES, projected once and read by both
# directions below: direction 1 needs the scenarios, direction 3 needs the
# pairs, and spelling the `not-implemented` sentinel in two places is one place
# too many for a value that is the same set both times. The duplicate check
# above deliberately keeps its own raw projection -- deriving it from a
# `sort -u` would let the very rows it looks for collapse before it ran.
awk '$2 != "not-implemented" { print $2 "\t" $1 }' "$work/rows" | sort -u \
  > "$work/case-of"

# Direction 1: every scenario the slice claims to have is registered.
cut -f1 "$work/case-of" | sort -u > "$work/claimed"

# Direction 2: every registered scenario written for this protocol. Keyed on
# the VERSION THE SCENARIO DECLARES, not on how it is named -- `cert201-` is a
# convention nothing enforces, and a 2.0.1 scenario named anything else was
# invisible here, which is the drift this guard exists for arriving through the
# door it was watching. The inventory carries the declaration because
# tools/extract-assert-inventory.ts puts it on the SPEC line, so the templateId
# and the protocol are one line apart and neither is inferred.
awk '/^  SPEC / && /ocppVersion="OCPP-2.0.1"/ { print $2 }' "$inventory" \
  | sort -u > "$work/registered"

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
#
# WHICH ROWS THOSE ARE IS READ FROM $work/claimed, not from the `cert201-`
# prefix, for the reason direction 2 above is keyed on the declared version:
# the prefix is a convention nothing enforces, and keying half this guard on it
# left a 2.0.1 scenario named anything else selected by the slice, registered
# by the inventory, and invisible to the only check that catches two tables
# assigning it to two different cases. `claimed` is the same set direction 1
# validates, so this door and that one now open on the same list.
#
# The shape check the sibling applies to this file applies here too, because
# this guard reads it before that one has necessarily run: a truncated row
# yields an empty case column, which renders as trailing whitespace and sends
# the reader to edit the OTHER file. That is the sibling's own recorded lesson,
# and it arrives here through a different door.
if ! awk '
  NR == FNR { claimed[$1]; next }
  { sub(/\r$/, "") }
  !($1 in claimed) { next }
  NF == 4 { next }
  { printf "  line %d: %s\n", FNR, $0 > "/dev/stderr"; bad = 1 }
  END { exit(bad ? 1 : 0) }
' "$work/claimed" "$obligations"; then
  echo "FAIL: $obligations has an OCPP 2.0.1 row that is not four fields." >&2
  echo "  → scenario / action / checked-by / OCA case. Read as fewer, its" >&2
  echo "    case column reads empty and this guard blames the other file." >&2
  exit 1
fi

awk '
  NR == FNR { claimed[$1]; next }
  { sub(/\r$/, "") }
  ($1 in claimed) { print $1 "\t" $4 }
' "$work/claimed" "$obligations" | sort -u > "$work/obliged"

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

# The summary is arithmetic over ONE set, and this asserts it rather than
# trusting it -- the sibling's rule, arrived at the same way. `cases` counts
# rows and `implemented` counts distinct scenarios, so without this the two
# could count different things and the line would still read sensibly. The
# duplicate refusals above are what make the first equality hold; this is what
# would notice if one of them were ever removed.
cases=$(wc -l < "$work/rows" | tr -d ' ')
implemented=$(wc -l < "$work/claimed" | tr -d ' ')
declined=$(awk '$2 == "not-implemented" { n++ } END { print n + 0 }' "$work/rows")
distinct=$(awk '{ print $1 }' "$work/rows" | sort -u | wc -l | tr -d ' ')
if [ "$((implemented + declined))" != "$cases" ] || [ "$distinct" != "$cases" ]; then
  echo "FAIL: the slice counts do not add up: $implemented implemented + $declined declined" >&2
  echo "  != $cases row(s), or $distinct distinct case(s) != $cases row(s)." >&2
  echo "  → a row is counted by something other than the rows of $slice, or" >&2
  echo "    two rows name the same case or the same scenario." >&2
  exit 1
fi
echo "OCPP 2.0.1 slice: $cases case(s) selected, $implemented implemented."
