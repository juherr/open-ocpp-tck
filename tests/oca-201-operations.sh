#!/usr/bin/env bash
# The measured operation per case, the slice, and the driver's union describe
# the same vocabulary.
#
# PROPERTY: `tck/specs/OCA-201-OPERATIONS.txt` answers "how wide a vocabulary do
# the selected cases ask for" for exactly the cases
# `tck/specs/OCA-201-SLICE.txt` selects, its answers do not contradict the
# reasons that file gives, and no row claims a case implemented that the
# contract cannot express. Three directions, and none of them compares this file
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
#      cross-check instead of a second, unmeasured source. Which names to look
#      for is read from this file's OWN value column, so the guard has no
#      vocabulary of its own to go stale -- and `CsmsOperation201`, which many
#      reasons name, is not an operation and is therefore not looked for.
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
if bad=$(awk '$2 !~ /^[A-Za-z0-9]+(,[A-Za-z0-9]+)*$/ { print $1 "\t" $2 }' \
  "$work/rows") && [ -n "$bad" ]; then
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

# The vocabulary this file uses, one name per line -- the summary's count, and
# nothing else reads it: direction 2 derives the same set from the rows it is
# already loading rather than being handed this file as a second input.
awk '$2 != "none" { n = split($2, ops, ","); for (i = 1; i <= n; i++) print ops[i] }' \
  "$work/rows" | sort -u > "$work/vocabulary"

# Direction 2: a slice reason that names an operation names one the case needs.
# Read from the reason column only -- $1 is the case and $2 the scenario -- and
# on whole words after punctuation is blanked, or `Reset` would match inside a
# sentence about resetting and `SetVariables` inside `SetVariablesRequest`.
if ! awk '
  FILENAME == rowsfile {
    needs[$1] = "," $2 ","
    if ($2 == "none") next
    n = split($2, ops, ",")
    for (i = 1; i <= n; i++) vocab[ops[i]]
    next
  }
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
' rowsfile="$work/rows" "$work/rows" "$slice"; then
  status=1
  echo "FAIL: a reason in $slice names an operation the case does not drive." >&2
  echo "  → the reasons were written per group from Part 5's arrangement and" >&2
  echo "    generalise where the measurement does not. Whichever is wrong," >&2
  echo "    they cannot both be read as the answer." >&2
fi

# Direction 3: an implemented row's operations exist in the driver contract.
# The union is read from tck/driver.ts rather than spelled here, for the reason
# direction 2 derives its vocabulary from the table: a second copy is a second
# thing to keep in step.
#
# ITS VALUE, NOT ITS SOURCE TEXT. A regex over the array literal was written
# first and had two ways to go quiet that this one does not: a comment inside
# the literal donates its first quoted word as a phantom member -- which
# weakens the one direction with nothing else watching it -- and the closing
# `]);` anchor pins the guard to today's formatting rather than to the
# property. `everyOneOf` already type-checks the array against the union, so
# importing it gets the compiler's answer instead of a regex's guess. The
# precedent for a shell guard shelling into bun is tests/summary-red-rows.sh.
bun -e 'import { CSMS_OPERATION_201_ACTIONS } from "./tck/driver";
  console.log(CSMS_OPERATION_201_ACTIONS.join("\n"));' \
  2>/dev/null | sort -u > "$work/union"

if [ ! -s "$work/union" ]; then
  echo "FAIL: no CSMS_OPERATION_201_ACTIONS members found in $driver." >&2
  echo "  → every implemented row would pass by having nothing to check" >&2
  echo "    against, which is the one way this direction can go quiet." >&2
  exit 1
fi

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

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "$operations, $slice and $driver disagree about the same vocabulary." >&2
  exit 1
fi

cases=$(wc -l < "$work/rows" | tr -d ' ')
driving=$(awk '$2 != "none" { n++ } END { print n + 0 }' "$work/rows")
kinds=$(wc -l < "$work/vocabulary" | tr -d ' ')
echo "OCPP 2.0.1 operations: $cases case(s) measured, $driving driving, $kinds kind(s) of operation."
