#!/usr/bin/env bash
# The numbers AGENTS.md writes out are the numbers the repository has.
#
# THE PROPERTY, in three parts:
#   1. the "## <N> boundaries the guards enforce" heading's number is the
#      number of bullets in that section;
#   2. the gate sentence's three counts -- driver scope checks, in-process
#      guards, shell guards -- are what `tools/verify.sh` actually runs;
#   3. every step in `tools/verify.sh` falls into a category that sentence
#      accounts for. A step of a new kind is not silently uncounted; it makes
#      this guard red until the sentence is rewritten to mention it.
#
# WHY IT IS A GUARD AND NOT PROOFREADING. Three of these numbers were wrong at
# once, in one file, and each was wrong for the same undramatic reason: a
# number in prose sits next to a list that grows, and the list grows without
# it. "two in-process guards" when there were three. "Four boundaries" over
# five bullets, off by one since the bullet before it was added. "five shell
# guards", correct when written and stale one commit later.
#
# None of the three was caught by reading. A reader checks the sentence for
# sense, not the arithmetic behind it, and the sentence always makes sense --
# that is the whole failure mode. Two were found by a reviewer counting on
# purpose and one by an automated one, which is another way of saying nobody
# would have found them next time.
#
# WHAT IT CANNOT CHECK: that the sentence describes the right categories, or
# that a bullet belongs in the section it sits in. Only that the numbers agree
# with what is there.
#
# Offline: reads two files, runs nothing.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

doc=AGENTS.md
verify=tools/verify.sh

for f in "$doc" "$verify"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

# The counts are written as words, because the prose is prose. Only the range
# the repository can plausibly reach is spelled out; a number outside it is
# reported rather than silently read as zero.
word_to_number() {
  case "$1" in
    one) echo 1 ;; two) echo 2 ;; three) echo 3 ;; four) echo 4 ;;
    five) echo 5 ;; six) echo 6 ;; seven) echo 7 ;; eight) echo 8 ;;
    nine) echo 9 ;; ten) echo 10 ;; eleven) echo 11 ;; twelve) echo 12 ;;
    *) echo "" ;;
  esac
}

status=0

report() {
  status=1
  echo "FAIL: $1" >&2
  echo "    written: $2" >&2
  echo "    actual:  $3" >&2
}

# ---------------------------------------------------------------- part 1
#
# The heading and its bullets. Only top-level bullets count -- `- **` is the
# shape every boundary uses, and a continuation line indented under one is not
# a sixth boundary.
heading_word=$(sed -n 's/^## \([a-zA-Z]*\) boundaries the guards enforce$/\1/p' "$doc" | head -1)
if [ -z "$heading_word" ]; then
  status=1
  echo "FAIL: no '## <N> boundaries the guards enforce' heading in $doc." >&2
  echo "  → the heading was renamed; teach this guard the new shape or it is" >&2
  echo "    checking a section that no longer exists." >&2
else
  heading_count=$(word_to_number "$(printf '%s' "$heading_word" | tr '[:upper:]' '[:lower:]')")
  bullets=$(awk '
    /^## [A-Za-z]+ boundaries the guards enforce$/ { inside = 1; next }
    inside && /^## / { exit }
    inside && /^- \*\*/ { n++ }
    END { print n + 0 }
  ' "$doc")
  if [ -z "$heading_count" ]; then
    report "the boundaries heading does not spell a number this guard knows." \
      "$heading_word" "$bullets bullets"
  elif [ "$heading_count" != "$bullets" ]; then
    report "the boundaries heading counts something other than its bullets." \
      "$heading_word ($heading_count)" "$bullets bullets"
  fi
fi

# ---------------------------------------------------------------- parts 2, 3
#
# What the gate actually runs, by category. `tools/verify.sh` is the list
# tests/gate-parity.sh already holds the workflow to, so counting it counts all
# three declarations of the gate.
commands=$(sed -n 's/^[[:space:]]*run "[^"]*" //p' "$verify")
if [ -z "$commands" ]; then
  echo "FAIL: extracted no commands from $verify." >&2
  echo "  → its shape changed under this guard's pattern; it is reading" >&2
  echo "    nothing, not counting nothing." >&2
  exit 1
fi

scope=0
inprocess=0
shellguards=0
unclassified=""

while IFS= read -r cmd; do
  [ -n "$cmd" ] || continue
  case "$cmd" in
    # Named on its own in the sentence, so not a shell guard for this count.
    "bash tests/types-current.sh") ;;
    "bun run typecheck") ;;
    # The linter is deliberately absent from the sentence: it is not fatal
    # when missing, so it is not one of the checks the gate promises.
    shellcheck*) ;;
    "bun run check:driver:"*) scope=$((scope + 1)) ;;
    "bun tests/"*.ts) inprocess=$((inprocess + 1)) ;;
    "bash tests/"*.sh) shellguards=$((shellguards + 1)) ;;
    *) unclassified="$unclassified  $cmd"$'\n' ;;
  esac
done <<< "$commands"

# Part 3, before the counts: an unclassified step means the sentence has a
# category it does not mention, and every count below it is then a claim about
# a list that is not the list.
if [ -n "$unclassified" ]; then
  status=1
  echo "FAIL: $verify runs a step the gate sentence has no category for:" >&2
  printf '%s' "$unclassified" >&2
  echo "  → rewrite the sentence in $doc to account for it, and teach this" >&2
  echo "    guard the category. Leaving it uncounted makes every number in" >&2
  echo "    that sentence a claim about a different list." >&2
fi

# The sentence wraps, so it is read as one line.
sentence=$(tr '\n' ' ' < "$doc" | tr -s ' ')
read -r said_scope said_inprocess said_shell <<< "$(
  printf '%s' "$sentence" |
    sed -n 's/.*, \([a-z]*\) driver scope checks, \([a-z]*\) in-process guards and \([a-z]*\) shell guards.*/\1 \2 \3/p'
)"

if [ -z "${said_scope:-}" ]; then
  status=1
  echo "FAIL: could not find the gate sentence's counts in $doc." >&2
  echo "  → it is the '<N> driver scope checks, <N> in-process guards and" >&2
  echo "    <N> shell guards' clause; it was reworded, so this guard is" >&2
  echo "    checking nothing." >&2
else
  for pair in "driver scope checks:$said_scope:$scope" \
              "in-process guards:$said_inprocess:$inprocess" \
              "shell guards:$said_shell:$shellguards"; do
    label=${pair%%:*}
    rest=${pair#*:}
    word=${rest%%:*}
    actual=${rest#*:}
    n=$(word_to_number "$word")
    if [ -z "$n" ]; then
      report "the gate sentence's $label count is not a number this guard knows." \
        "$word" "$actual"
    elif [ "$n" != "$actual" ]; then
      report "the gate sentence miscounts $label." "$word ($n)" "$actual in $verify"
    fi
  done
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "  → these numbers sit next to lists that grow, and they do not grow" >&2
  echo "    with them. That is what this guard is for; fix the prose." >&2
  exit 1
fi

echo "Doc counts hold: $heading_count boundaries, and the gate sentence's" \
     "$scope/$inprocess/$shellguards match $verify."
