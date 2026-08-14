#!/usr/bin/env bash
# Every OCA obligation has a check, and every answered-check has an obligation.
#
# PROPERTY: `tck/specs/OCA-OBLIGATIONS.txt` and the assertions actually written
# in `tck/specs/*.ts` describe the same set. An obligation the reference states
# and no scenario checks is a coverage hole; a check with no obligation behind
# it is an assertion nobody can trace to the document it claims to implement.
#
# WHY THIS EXISTS. The obligations were derived once, by hand, from the OCA
# Test Case Document, and the count was written into prose: "46 obligations, 46
# checks". Nothing verified it, and it was wrong -- there are 53, of which 46
# are the checks issue #11 added and 7 were already covered by other helpers.
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

# Declared: the obligations this file says assertAllAnswered covers.
awk '!/^#/ && NF >= 3 && $3 == "assertAllAnswered" { print $1 "\t" $2 }' \
  "$obligations" | sort -u > "$work/declared"

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
done < <(awk '!/^#/ && NF >= 3 && $3 != "assertAllAnswered" { print $1, $2, $3 }' "$obligations")

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "OCA-OBLIGATIONS.txt and the scenarios disagree. Both are meant to be" >&2
  echo "edited together: the row records what the reference obliges, the check" >&2
  echo "records that we look for it." >&2
  exit 1
fi

total=$(grep -c '^cert16' "$obligations")
answered=$(wc -l < "$work/declared" | tr -d ' ')
echo "OCA obligations: $total covered, $answered of them by assertAllAnswered."
