#!/usr/bin/env bash
# "Generic" is a property of the code, not a claim in a README.
#
# The core -- the scenario specs, the OCPP-J assertion engine, the runner, the
# driver contract -- must not be able to name any CSMS. One surviving `steve`
# identifier in it means it still knows which CSMS it tests, and the next
# person to write a driver copies that coupling instead of removing it.
#
# This is not hypothetical in either direction. The vendored assert.ts shipped
# a sentinel literally spelled " BRS_UNVERIFIABLE:", named after the private
# downstream driver the core was being generalised against; and the core is
# itself derived from a harness written for exactly one CSMS.
#
# The scan runs in two directions, because the boundary has two sides:
#
#   the core           must name NO CSMS at all
#   the reference driver   must name only its own
#
# Plus the layering rule, which is what keeps this repository consumable as a
# package: the core imports no driver. A driver depends on the core, never the
# reverse -- that is what lets a driver for a CSMS this repository has never
# heard of live in somebody else's repository and still work.
#
# Deterministic and offline.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

subtree="."
status=0

core_dir="$subtree/tck"
steve_driver="$subtree/drivers/steve"

if [ ! -d "$core_dir" ]; then
  echo "FAIL: $core_dir does not exist — there is no core left to check." >&2
  exit 1
fi

# Generated artifacts (ASSERT-INVENTORY.txt, DRIVE-TRACE.txt) are deliberately
# NOT scanned. They are a rendering of the sources, so a CSMS name can only
# reach them from a source file that is itself scanned — reporting both would
# name one defect twice and tempt someone to "fix" the artifact.
# Comments are stripped before matching, and that distinction is the whole
# rule: an IDENTIFIER, a STRING LITERAL or an IMPORT naming a CSMS is a
# coupling -- the core would be behaving differently depending on which CSMS is
# under test. A sentence in a doc comment explaining WHY the contract is
# neutral, by citing the CSMS-shaped design it replaced, is the opposite: it is
# the reasoning a future reader needs in order not to reintroduce the coupling.
# An earlier draft of this test refused both, which would have forced the
# rationale out of the code and into a document nobody reads next to it.
#
# Generated artifacts (ASSERT-INVENTORY.txt, DRIVE-TRACE.txt) are not scanned
# either: they render the sources, so a CSMS name can only reach them from a
# source file that IS scanned. Reporting both would name one defect twice and
# tempt someone to "fix" the artifact.
strip_comments() {
  # Block comments, then line comments, then shell comments -- the last one
  # matters: a .sh file's `#` lines were NOT stripped by the first draft, so a
  # shell comment naming a CSMS was reported while the equivalent TypeScript
  # comment was not.
  #
  # A block comment only ever OPENS when `/*` is the first thing on the line.
  # An earlier version moved every `/*` to the start of a line and then used a
  # sed range delete, so a `/*` inside a STRING LITERAL opened a comment that
  # ran to the next `*/`. In the downstream repository this was extracted from,
  # a single "/commands/*" in a driver hid the following 336 lines from the
  # scan, which went on reporting the tree clean. Found by mutation, not by
  # reading: a planted identifier SURVIVED.
  #
  # Being naive about `//` or `#` inside a string literal only ever makes the
  # scan stricter. Being naive about `/*` made it LAXER, which is the one
  # direction a guard must not fail in.
  case "$1" in
    *.sh) sed -e 's@#.*@@' "$1" ;;
    *)
      awk '
        in_block { if ($0 ~ /\*\//) in_block = 0; next }
        /^[[:space:]]*\/\*/ {
          if ($0 ~ /\*\//) { sub(/^[[:space:]]*\/\*.*\*\//, "") }
          else { in_block = 1; next }
        }
        /^[[:space:]]*\*/ { next }
        { sub(/\/\/.*/, ""); print }
      ' "$1"
      ;;
  esac
}

scan() { # scan <dir> <forbidden-alternation> <why>
  local dir="$1" pattern="$2" why="$3" hits
  [ -d "$dir" ] || return 0
  while IFS= read -r f; do
    # SUBSTRING, not whole-word. A word-boundary match looked right and had a
    # hole big enough to drive the actual defect through: `_` is a word
    # character, so `BRS_UNVERIFIABLE` and `SteveOps` both slipped past a
    # boundary-anchored pattern while the guard reported the core clean.
    # Caught by mutation, not by reading. False positives are possible and are
    # the right trade: a name that must appear can be renamed or, if it is
    # genuinely unavoidable, marked PROVENANCE.
    hits="$(strip_comments "$f" | grep -nEi "${pattern}" || true)"
    [ -n "$hits" ] || continue
    echo "FAIL[${f#"$repo_root/"}]: $why" >&2
    printf '%s\n' "$hits" | sed 's/^/    /' >&2
    status=1
  done < <(find "$dir" -type f \( -name '*.ts' -o -name '*.json' -o -name '*.sh' \) | sort)
}

scan "$core_dir" 'steve|stevedb|mariadb|brs|firebase|firebasetoken' \
  "the core names a CSMS — it must not know which one it is testing"
scan "$steve_driver" 'brs|firebase|firebasetoken' \
  "the reference driver names a CSMS that is not its own"

# --- one third party's name, comments included -------------------------------
# The scans above strip comments first, and that is the right rule for a CSMS
# name in general: a doc comment explaining WHY the contract is neutral, by
# citing the CSMS-shaped design it replaced, is the reasoning a future reader
# needs in order not to reintroduce the coupling.
#
# One name is the exception, for a reason that has nothing to do with coupling.
# This core was generalised while a driver for a private, third-party CSMS was
# being written against it, and its comments picked up that CSMS's name in
# eleven places. This repository is public and patches/ is the artifact an
# upstream pull request is cut from -- naming somebody's private system in that
# diff is their business, not ours. The sentences were also, after the split,
# simply false.
#
# patches/ is scanned even though it holds no code, and the scan is not
# filtered by extension: the previous one only read .ts/.json/.sh, so a stale
# reference inside a .patch was invisible to it. Both holes verified by
# mutation before this was trusted.
scan_including_comments() { # <dir> <forbidden-alternation> <why>
  local dir="$1" pattern="$2" why="$3" hits
  [ -d "$dir" ] || return 0
  while IFS= read -r f; do
    hits="$(grep -nEi "${pattern}" "$f" || true)"
    [ -n "$hits" ] || continue
    echo "FAIL[${f#"$repo_root/"}]: $why" >&2
    printf '%s\n' "$hits" | sed 's/^/    /' >&2
    status=1
  done < <(find "$dir" -type f | sort)
}

for public_dir in "$core_dir" "$steve_driver" "$subtree/patches" "$subtree/bin"; do
  scan_including_comments "$public_dir" 'brs|firebase|bornerecharge' \
    "names a third party's private CSMS — comments and patches included, because this repository is public and patches/ becomes an upstream pull request"
done

# --- layering --------------------------------------------------------------
# The core defines the contract; drivers implement it. An import in the other
# direction means the contract was shaped around one implementation -- and it
# is also what would make this repository impossible to re-sync from upstream
# without dragging a CSMS client along.
if [ -d "$subtree/drivers" ] && grep -rnE 'from "[^"]*drivers/' "$core_dir" 2>/dev/null; then
  echo "FAIL: the core imports a driver (see above)." >&2
  echo "  → the core defines the contract; drivers implement it. An import in this" >&2
  echo "    direction means the contract was shaped around one implementation." >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Core is CSMS-neutral: no CSMS named in $core_dir, and no upstream-bound file depends on a private driver."
fi
exit "$status"
