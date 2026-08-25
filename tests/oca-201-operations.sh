#!/usr/bin/env bash
# The measured operation per case, the slice, and the driver's union describe
# the same vocabulary.
#
# PROPERTY: `tck/specs/OCA-201-OPERATIONS.txt` answers "how wide a vocabulary do
# the selected cases ask for" for exactly the cases
# `tck/specs/OCA-201-SLICE.txt` selects, its answers do not contradict the
# reasons that file gives, no row claims a case implemented that the contract
# cannot express, and the table OCA-201-SELECTION.md spends them in is derived
# from them. Four directions, and none of them compares this file
# to a literal written in its own header -- the shape tests/oca-obligations.sh
# refuses in writing, because a number checked against a second spelling of
# itself is checked against nothing.
#
#   1. THE TWO FILES COVER THE SAME CASES, both ways. A case selected and not
#      measured is a case whose vocabulary cost is unknown while the count reads
#      complete; a case measured and not selected is an answer to a question
#      nobody asked, and it would inflate the same count. The 147 is the slice's
#      to define, so this direction takes it from there and never spells it.
#
#   2. A REASON THAT NAMES AN OPERATION AGREES WITH THE MEASUREMENT. The slice's
#      reasons were written per group from Part 5's arrangement, before anything
#      read Part 6, and where they generalise they are wrong: TC_M_24, TC_M_26
#      and TC_M_28 shared a reason with rows that really do need a certificate
#      operation and drive none. This is what turns those reasons into a
#      cross-check instead of a second, unmeasured source.
#
#      WHICH NAMES IT LOOKS FOR, AND THE HOLE THAT LEAVES. The search set is the
#      operations table's own value column plus `CSMS_OPERATION_201_ACTIONS`,
#      so the
#      guard carries no vocabulary of its own to go stale. The cost: an
#      operation spelled NOWHERE in either -- because it is wrong on every row
#      that should carry it -- is a word this direction does not look for, and a
#      reason naming it passes. Stated rather than papered over, because what
#      covers it is `tools/extract-201-operations.ts --diff` re-deriving every
#      row from the reference, and nothing in the gate can do that.
#      `CsmsOperation201`, which 66 reasons name, is outside the set for the
#      same reason and by the same accident -- not by a rule.
#
#   4. THE PUBLISHED TRANCHE TABLE IS THE ONE THE ROWS DERIVE. Its own
#      paragraph below, because the reason it exists is that it failed.
#
#   3. AN IMPLEMENTED ROW'S OPERATIONS EXIST IN THE CONTRACT. If the slice says
#      a scenario implements a case, and the case needs an operation
#      `CSMS_OPERATION_201_ACTIONS` does not carry, then the scenario cannot be
#      making the request the case is about -- it is measuring some other part
#      of the exchange and the row claims the whole case. Reproduced, not
#      supposed: `TC_F_20` is "Trigger message - Heartbeat", whose only tool
#      validation is the CSMS sending a TriggerMessageRequest, and the scenario
#      that claimed it drove a heartbeat from the station and asserted the
#      answer. Both guards over the slice passed, because neither had anything
#      to compare the case's content against.
#
# AND THE TABLE'S OWN SHAPE, without which the three above are statements about
# whichever rows this guard happened to read -- the lesson
# tests/oca-obligations.sh recorded on its own table and tests/oca-201-slice.sh
# inherited:
#   - EVERY LINE IS A COMMENT, BLANK, OR A ROW OF EXACTLY TWO FIELDS. Not
#     `NF >= 2`, which is right for the slice because its reason is free text
#     and wrong here: a space inside the value column is a row that parses and
#     silently drops every operation after the first.
#   - ONE ROW PER CASE. A second row for a case already measured leaves the
#     first selected by nothing while the row count still matches the slice's.
#   - `none` IS SPELLED, never an empty column. 57 of the 147 drive no operation
#     at all, and that is a measurement; a blank is the absence of one, and the
#     two are indistinguishable six months later.
#
# WHAT IT CANNOT CHECK, and this is the same sentence its two siblings carry:
# that a row is what Part 6 says. That is a reading of a PDF this repository
# does not contain, `tools/extract-201-operations.ts --diff` is how it is
# redone, and OCA-201-SELECTION.md carries the edition it was last run against.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

operations=tck/specs/OCA-201-OPERATIONS.txt
slice=tck/specs/OCA-201-SLICE.txt
driver=tck/driver.ts

for f in "$operations" "$slice" "$driver"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# EXACTLY TWO FIELDS, and the refusal is here rather than folded into the
# passes below for tests/oca-201-slice.sh's reason: this message points at the
# syntax, and the ones below point at a decision.
if ! awk '
  { sub(/\r$/, "") }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  NF == 2 { print; next }
  { printf "  line %d: %s\n", FNR, $0 > "/dev/stderr"; bad = 1 }
  END { exit(bad ? 1 : 0) }
' "$operations" > "$work/rows"; then
  echo "FAIL: $operations has a line that is neither a comment nor a row:" >&2
  echo "  → a row is <OCA case> <operation[,operation] | none>, two fields." >&2
  echo "    Operations are comma-separated WITHOUT spaces: a space makes the" >&2
  echo "    rest of the list a third field, which parses and is then dropped." >&2
  exit 1
fi

status=0

# ONE ROW PER CASE. Same failure the slice's own duplicate check names: the
# counts keep adding up against the rows while a case stops being measured.
if dup=$(awk '{ print $1 }' "$work/rows" | sort | uniq -d) && [ -n "$dup" ]; then
  status=1
  echo "FAIL: $operations measures a case more than once:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$dup" >&2
  echo "  → one row per case." >&2
fi

# `none` RATHER THAN A BLANK is enforced by the two-field rule above; what is
# left to refuse is a value that is neither `none` nor a list of operation
# names, because a typo there is invisible to every direction below -- it just
# becomes an operation nobody else names.
# `none` EXACTLY, or a comma-separated list of names each starting with a
# capital. Reproduced, not supposed: `None` passed the looser shape this
# replaces and became a 21st kind of operation driven by one case -- both
# printed counts moved and nothing refused, on the 140 rows direction 3 does
# not reach. A `none` INSIDE a list did the same and then matched the ordinary
# English word in unrelated reasons, so the run went red naming eight innocent
# rows and never the typo.
#
# THE CASE ARM IS WHY THIS IS NOT A REGEX. `None` is a capitalised word and an
# operation name is a capitalised word: no shape tells them apart, so the
# sentinel is matched exactly and anything differing from it only by case is
# refused by name. PER ELEMENT rather than per field, because the whole-field
# form let `Reset,None` through -- the capitalised half of the very typo the
# paragraph above says was reproduced. What still gets through is a value that
# is neither -- `non`, say -- and there is no offline answer to that: whether a
# name is an operation the reference produced is what `--diff` is for.
if bad=$(awk '
  $2 == "none" { next }
  {
    n = split($2, ops, ",")
    for (i = 1; i <= n; i++)
      if (ops[i] !~ /^[A-Z][A-Za-z0-9]*$/ || tolower(ops[i]) == "none") {
        print $1 "\t" $2
        next
      }
  }
' "$work/rows") && [ -n "$bad" ]; then
  status=1
  echo "FAIL: $operations has a value that is not an operation list:" >&2
  awk '{ printf "  %s\t%s\n", $1, $2 }' <<< "$bad" >&2
  echo '  → either none, or comma-separated OCPP message names.' >&2
fi

awk '{ print $1 }' "$work/rows" | sort -u > "$work/measured"

# Direction 1: the same cases the slice selects, both ways. The slice owns the
# 147 -- its own guard is what holds it to one row per case -- so this reads it
# rather than counting to a number of its own.
awk '
  { sub(/\r$/, "") }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  NF >= 2 { print $1 }
' "$slice" | sort -u > "$work/selected"

if missing=$(comm -13 "$work/measured" "$work/selected") && [ -n "$missing" ]; then
  status=1
  echo "FAIL: $slice selects cases $operations does not measure:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$missing" >&2
  echo "  → the vocabulary count is over the selected cases, so a case missing" >&2
  echo "    here is a cost left out of a total that reads complete." >&2
fi

if extra=$(comm -23 "$work/measured" "$work/selected") && [ -n "$extra" ]; then
  status=1
  echo "FAIL: $operations measures cases $slice does not select:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$extra" >&2
  echo "  → Part 6 has 251 CSMS cases and the rule selects 147. A row for one" >&2
  echo "    of the other 104 inflates the same total." >&2
fi

# The vocabulary this file uses, one name per line: the summary's count, and
# the rows half of direction 2's search set. It was rebuilt inside direction 2's
# awk while this file sat beside it -- defensible while that awk took one input
# and stopped being so when it took two, which left the value column's parse
# (the `none` sentinel, the comma) spelled in three places that nothing compares.
awk '$2 != "none" { n = split($2, ops, ","); for (i = 1; i <= n; i++) print ops[i] }' \
  "$work/rows" | sort -u > "$work/vocabulary"

# The driver contract's own vocabulary, ITS VALUE AND NOT ITS SOURCE TEXT. A
# regex over the array literal was written first and had two ways to go quiet
# that this does not: a comment inside the literal donates its first quoted
# word as a phantom member, and the closing `]);` anchor pins the guard to
# today's formatting rather than to the property. What `everyOneOf` holds the
# array to is checked by the typecheck, a separate step of the same gate; what
# this buys is the value rather than a regex's reading of the text. The
# precedent for a shell guard shelling into bun is tests/summary-red-rows.sh.
#
# Read here rather than beside direction 3 because BOTH directions below use
# it: it is also half of direction 2's search set.
bun -e 'import { CSMS_OPERATION_201_ACTIONS } from "./tck/driver";
  console.log(CSMS_OPERATION_201_ACTIONS.join("\n"));' \
  2>/dev/null | sort -u > "$work/union"

if [ ! -s "$work/union" ]; then
  echo "FAIL: no CSMS_OPERATION_201_ACTIONS members found in $driver." >&2
  echo "  → every implemented row would pass by having nothing to check" >&2
  echo "    against, which is the one way direction 3 can go quiet." >&2
  exit 1
fi

# Direction 2: a slice reason that names an operation names one the case needs.
# Read from the reason column only -- $1 is the case and $2 the scenario -- and
# on whole words after punctuation is blanked, or `Reset` would match inside a
# sentence about resetting and `SetVariables` inside `SetVariablesRequest`.
if ! awk '
  FILENAME == unionfile || FILENAME == vocabfile { vocab[$1]; next }
  FILENAME == rowsfile { needs[$1] = "," $2 ","; next }
  { sub(/\r$/, "") }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  NF < 3 { next }
  {
    reason = ""
    for (i = 3; i <= NF; i++) reason = reason " " $i
    gsub(/[^A-Za-z0-9]/, " ", reason)
    n = split(reason, words, " ")
    for (i = 1; i <= n; i++) {
      if (!(words[i] in vocab)) continue
      if (index(needs[$1], "," words[i] ",") > 0) continue
      printf "  %s: the reason names %s; measured %s\n", $1, words[i], \
        substr(needs[$1], 2, length(needs[$1]) - 2) > "/dev/stderr"
      bad = 1
    }
  }
  END { exit(bad ? 1 : 0) }
' unionfile="$work/union" vocabfile="$work/vocabulary" rowsfile="$work/rows" \
  "$work/union" "$work/vocabulary" "$work/rows" "$slice"; then
  status=1
  echo "FAIL: a reason in $slice names an operation the case does not drive." >&2
  echo "  → the reasons were written per group from Part 5's arrangement and" >&2
  echo "    generalise where the measurement does not. Whichever is wrong," >&2
  echo "    they cannot both be read as the answer." >&2
fi

# Direction 3: an implemented row's operations exist in the driver contract.
if ! awk '
  FILENAME == unionfile { union[$1]; next }
  FILENAME == rowsfile  { needs[$1] = $2; next }
  { sub(/\r$/, "") }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*$/ { next }
  $2 == "not-implemented" { next }
  NF < 2 { next }
  {
    if (needs[$1] == "" || needs[$1] == "none") next
    n = split(needs[$1], ops, ",")
    for (i = 1; i <= n; i++) {
      if (ops[i] in union) continue
      printf "  %s (%s) needs %s\n", $1, $2, ops[i] > "/dev/stderr"
      bad = 1
    }
  }
  END { exit(bad ? 1 : 0) }
' unionfile="$work/union" rowsfile="$work/rows" "$work/union" "$work/rows" "$slice"; then
  status=1
  echo "FAIL: $slice claims a case whose operation the driver contract has not." >&2
  echo "  → CsmsOperation201 cannot express the request the case is about, so" >&2
  echo "    whatever the scenario measures, it is not that case. Either add" >&2
  echo "    the operation and drive it, or make the row not-implemented and" >&2
  echo "    say so." >&2
fi

# Direction 4: the tranche table OCA-201-SELECTION.md publishes is the one the
# rows derive. Not a number checked against a second spelling of itself -- that
# is the shape tests/oca-obligations.sh refuses, and it is about a literal in a
# guard's OWN header. This is doc-counts.sh's shape instead: prose against the
# list it describes. It earns its place the way the others did, by having
# failed -- the table shipped with all sixteen `still blocked after` cells two
# too high, because it was arithmetic against a three-verb union and a fourth
# verb landed in the same branch. The function lived in a person.
#
# String containment rather than a markdown parser: the generator emits the
# rows verbatim, so the check is whether the page still holds what it printed.
selection=OCA-201-SELECTION.md
if [ -s "$selection" ]; then
  if ! bun tools/extract-201-operations.ts --tranches > "$work/tranches" 2>/dev/null; then
    status=1
    echo "FAIL: could not derive the tranche table." >&2
    echo "  → bun tools/extract-201-operations.ts --tranches reads $operations" >&2
    echo "    and $driver, and needs no reference. If it cannot run, the" >&2
    echo "    published table has no producer again." >&2
  else
    missing=0
    while IFS= read -r row; do
      case "$row" in '| '*) ;; *) continue ;; esac
      grep -qF -- "$row" "$selection" || { missing=1; echo "  $row" >&2; }
    done < "$work/tranches"
    if [ "$missing" -ne 0 ]; then
      status=1
      echo "FAIL: $selection's tranche table is not the one the rows derive." >&2
      echo "  → the rows above are what --tranches prints and the page does not" >&2
      echo "    carry. Paste them in; the arithmetic is not yours to redo." >&2
    fi
  fi
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "$operations, $slice and $driver disagree about the same vocabulary." >&2
  exit 1
fi

cases=$(wc -l < "$work/rows" | tr -d ' ')
driving=$(awk '$2 != "none" { n++ } END { print n + 0 }' "$work/rows")
kinds=$(wc -l < "$work/vocabulary" | tr -d ' ')
echo "OCPP 2.0.1 operations: $cases case(s) measured, $driving driving," \
  "$kinds kind(s) of operation."
