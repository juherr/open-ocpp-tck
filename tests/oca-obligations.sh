#!/usr/bin/env bash
# Every OCA obligation has a check, and every answered-check has an obligation.
#
# PROPERTY: `tck/specs/OCA-OBLIGATIONS.txt` and the assertions actually written
# in `tck/specs/*.ts` describe the same set. An obligation the reference states
# and no scenario checks is a coverage hole; a check with no obligation behind
# it is an assertion nobody can trace to the document it claims to implement.
#
# And two things about the table itself, without which the property above is a
# statement about whichever rows this file happened to read:
#   - EVERY LINE IS A COMMENT, BLANK, OR A ROW. Measured, not supposed: cutting
#     `cert16-tc003-charging-plugin-first StartTransaction assertIdTagInfoStatus
#     TC_003` down to its first two fields left this guard printing "53 covered"
#     and exiting 0, with that obligation checked by nothing.
#   - THE COUNTS IT PRINTS ADD UP, over those rows and nothing else.
# Both are namespace-agnostic, like the property: whether a row is about OCPP
# 1.6 or 2.0.1 has no bearing on whether it has a check behind it.
#
# WHY THIS EXISTS. The obligations were derived once, by hand, from the OCA
# Test Case Document, and the count was written into prose: "46 obligations, 46
# checks". Nothing verified it, and it was wrong -- the OCPP 1.6 derivation has
# 53, of which 46 are the checks issue #11 added and 7 were already covered by
# other helpers.
# Every other derivation in this repository is generated and guarded precisely
# so that no reviewer has to take a number on faith (see the artifact table in
# AGENTS.md); this one was the exception.
#
# WHAT IT READS, and why that is the right side to read. Not the sources:
# `tck/specs/ASSERT-INVENTORY.txt`, which is itself generated from them and
# already guarded by tests/spec-invariants.sh. So this guard cannot disagree
# with what that artifact says a scenario measures, and deleting a check has to
# get past both.
#
# WHAT IT CANNOT CHECK. That an obligation row is FAITHFUL to the reference --
# that TC_046 really does oblige a StartTransaction.conf. That is a reading of
# a PDF, it is recorded in OCA-COVERAGE.md with the method, and no guard can
# replace re-reading it. What this stops is the set drifting afterwards.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

obligations=tck/specs/OCA-OBLIGATIONS.txt
inventory=tck/specs/ASSERT-INVENTORY.txt

for f in "$obligations" "$inventory"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ONE DEFINITION OF A ROW, and everything below reads it.
#
# A row is scenario / action / checked-by / OCA case, four fields, and anything
# else that is neither a comment nor blank is REFUSED. It used to be `NF >= 3`
# in two places and `^cert16` in a third, which cost two things of the same kind.
#
# A line of fewer than three fields fell below `NF >= 3` and was read by neither
# pass, while still being counted by the third -- so a mistyped row could stop
# being checked with the summary still saying it was. That is the measurement in
# the header, and the diagnosis was worse than the miss where there was one: a
# truncated `assertAllAnswered` row was reported as "an assertAllAnswered call
# with no obligation behind it", which sends the reader to delete a good check.
#
# And the total counted a namespace where the other two numbers count the file,
# so the first `cert201-` row would have been missing from `total` and present
# in `answered`, and the summary would have claimed more
# covered-by-assertAllAnswered than covered.
#
# The number this prints is deliberately NAMESPACE-AGNOSTIC, like the property
# above it: "every obligation has a check" is true or false per row, whatever
# protocol version the row is about. A per-namespace breakdown is where this
# would be re-proposed, and it is not built: with one namespace in the file it
# would be a second spelling of the same number, and the 1.6 arithmetic that
# really is per-version lives in OCA-COVERAGE.md, which counts OCA cases rather
# than these rows.
if ! awk '
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  NF == 4 { print; next }
  { printf "  line %d: %s\n", FNR, $0 > "/dev/stderr"; bad = 1 }
  END { exit(bad ? 1 : 0) }
' "$obligations" > "$work/rows"; then
  echo "FAIL: $obligations has a line that is neither a comment nor a row:" >&2
  echo "  → a row is scenario / action / checked-by / OCA case. Skipping the" >&2
  echo "    ones that do not parse is how an obligation stops being checked" >&2
  echo "    without anything going red." >&2
  exit 1
fi

# Declared: the obligations this file says assertAllAnswered covers.
awk '$3 == "assertAllAnswered" { print $1 "\t" $2 }' \
  "$work/rows" | sort -u > "$work/declared"

# Written: every assertAllAnswered in the inventory, under the SPEC it sits in.
awk '
  /^  SPEC / { spec = $2; next }
  /assertAllAnswered\(/ {
    if (match($0, /"[A-Za-z]+"/)) {
      action = substr($0, RSTART + 1, RLENGTH - 2)
      print spec "\t" action
    }
  }
' "$inventory" | sort -u > "$work/written"

status=0

if missing=$(comm -23 "$work/declared" "$work/written") && [ -n "$missing" ]; then
  status=1
  echo "FAIL: obligations with no assertAllAnswered behind them:" >&2
  awk '{ printf "  %s\t%s\n", $1, $2 }' <<< "$missing" >&2
  echo "  → either add the check to the scenario, or, if the reference does not" >&2
  echo "    actually oblige it, remove the row and say why in OCA-COVERAGE.md." >&2
fi

if extra=$(comm -13 "$work/declared" "$work/written") && [ -n "$extra" ]; then
  status=1
  echo "FAIL: assertAllAnswered calls with no obligation behind them:" >&2
  awk '{ printf "  %s\t%s\n", $1, $2 }' <<< "$extra" >&2
  echo "  → a check that cannot be traced to an OCA case is a claim about" >&2
  echo "    conformance with nothing to look up. Add the row, or drop the check." >&2
fi

# The obligations covered by something other than assertAllAnswered are matched
# on the NAMED helper and the action together -- `assertIdTagInfoStatus(·, ·,
# "Authorize"` -- not on the action alone. Alone is not enough, and that is
# measured rather than assumed: renaming the action inside the covering helper
# left this guard green, because a neighbouring assertLineMatches regex in the
# same scenario also spells "Authorize".
#
# `inline` is the one row this cannot pin, because a hand-rolled block has no
# helper name to match. It renders in the inventory as `·.fail(...)` and
# control-flow tokens, so the action is only ever a literal in some other
# check. Those rows fall back to naming, and say so when they fail.
while read -r spec action by; do
  [ -n "${spec:-}" ] || continue
  if [ "$by" = "inline" ]; then
    needle="\"$action\""
  else
    needle="$by(·, ·, \"$action\""
  fi
  awk -v spec="$spec" -v needle="$needle" '
    /^  SPEC / { inspec = ($2 == spec); next }
    inspec && index($0, needle) { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$inventory" && continue
  status=1
  echo "FAIL: $spec owes a $action.conf, declared as covered by '$by'," >&2
  echo "  and no line under that scenario matches: $needle" >&2
done < <(awk '$3 != "assertAllAnswered" { print $1, $2, $3 }' "$work/rows")

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "OCA-OBLIGATIONS.txt and the scenarios disagree. Both are meant to be" >&2
  echo "edited together: the row records what the reference obliges, the check" >&2
  echo "records that we look for it." >&2
  exit 1
fi

# The summary line is arithmetic over ONE set, and this asserts it rather than
# trusting it. `total` used to be `grep -c '^cert16'` -- a count of a namespace
# where the other two count the file -- so the first row outside that namespace
# would have been missing from `total` and present in `answered`, and the line
# would have claimed more covered-by-assertAllAnswered than covered. Counting
# the same rows three ways makes that unstateable, and it is what gives the
# printed number an exit code instead of only a reader.
total=$(wc -l < "$work/rows" | tr -d ' ')
answered=$(wc -l < "$work/declared" | tr -d ' ')
otherwise=$(awk '$3 != "assertAllAnswered" { n++ } END { print n + 0 }' "$work/rows")
if [ "$((answered + otherwise))" != "$total" ]; then
  echo "FAIL: the obligation counts do not add up: $answered + $otherwise != $total." >&2
  echo "  → either one of them counts something other than the rows of" >&2
  echo "    $obligations, or two rows name the same scenario and action." >&2
  exit 1
fi
echo "OCA obligations: $total covered, $answered of them by assertAllAnswered."
