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
#   every driver       must name only its own
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
drivers_dir="$subtree/drivers"

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

# --- who owns which name ----------------------------------------------------
# A driver may name its own CSMS -- that is what it is for. Naming another's is
# the coupling, so the pattern applied to a driver is the union of every name
# below MINUS the row it owns, and the pattern applied to the core is the whole
# union.
#
# WHAT TO SCAN IS DERIVED; WHAT TO FORBID IS DECLARED. Which directories exist
# under drivers/ is read off the disk, because that half used to be written out
# -- one `drivers/steve`, hardcoded, serving as both "the directory to scan"
# and "the driver whose names are allowed there". drivers/citrineos was added
# later and was scanned by neither: it could name SteVe in an identifier and
# the guard reported the tree clean, and the core's pattern never learnt the
# word `citrineos` either. Reading the listing is what gets the next driver
# scanned the day it lands rather than the day somebody remembers a third line.
#
# The names, and which driver owns them, cannot be read off the disk -- no
# listing knows SteVe's schema is `stevedb` -- so they are declared here, and
# the union below is built from THIS DECLARATION, never from the listing.
# Building it from the listing reads as the same thing and is not: an earlier
# draft did, and `rm -r drivers/steve` then took `steve` out of the CORE's
# pattern, turning the guard green on a `SteveFailure` in tck/standing.ts it
# had been red on a moment earlier. A guard whose strictness can be edited by
# the tree it guards fails in the LAXER direction, the one this file already
# says is the only one that matters. Measured, not imagined.
#
# So `known_drivers` is the authority, and both ways it can drift are reported
# rather than silently subtracted from the union: a directory that is not in
# it, and an entry of it with no `csms_names` row.
#
# `mariadb` is SteVe's, and no `postgres` row answers it on the CitrineOS side:
# this table holds names that IDENTIFY a CSMS. `mariadb` is inherited from the
# core's original pattern and kept because a `mariadb` in the core is SteVe's
# stack leaking; `postgres` in a third driver would be a database, not a name.
#
# The rows are redundant on purpose. Matching is by SUBSTRING, so `steve`
# already covers `stevedb` and `citrine` already covers `citrineos` -- the same
# way `firebase` already covers `firebasetoken` below. Reducing each row to its
# minimal set would leave the guard byte-for-byte as strict and leave the table
# unable to answer the only question a reader brings to it: what names does
# this CSMS go by.
#
# CONTRIBUTING.md tells a driver author to edit `known_drivers` and
# `csms_names` by name -- rename them there too, or that page sends the next
# author looking for a variable this file no longer has.
known_drivers='steve citrineos'

csms_names() { # <driver directory> -> alternation of the names that driver owns
  case "$1" in
    steve) printf 'steve|stevedb|mariadb' ;;
    citrineos) printf 'citrine|citrineos' ;;
    *) return 1 ;;
  esac
}

is_known() { # <driver directory> -> is it declared above?
  case " $known_drivers " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# The CSMS with no driver here: the private third party this core was
# generalised against. Nobody owns it, so nobody may name it -- and, further
# down, not in a comment either.
unowned_names='brs|firebase|firebasetoken|bornerecharge'

# A glob, the same idiom and for the same reason as
# tools/extract-fixture-tags.sh: the next driver is covered the day it lands,
# and an empty glob is itself a failure rather than a silent pass.
shopt -s nullglob
drivers=()
for d in "$drivers_dir"/*/; do
  d="${d%/}"
  drivers+=("${d##*/}")
done
shopt -u nullglob

if [ "${#drivers[@]}" -eq 0 ]; then
  echo "FAIL: no driver directory under $drivers_dir." >&2
  echo "  → this guard takes its scans from that listing, so an empty one" >&2
  echo "    means it checked nothing and said the tree was clean." >&2
  status=1
fi

# One pass over the declaration, and `declared` carries the ids that survived
# it. The second loop below then never sees a `known_drivers` entry with no
# row, so it needs no error branch of its own -- an earlier shape had one that
# stayed silent "because the first loop reported it", which is an ordering
# invariant a comment can assert and nothing can check.
all_names="$unowned_names"
declared=''
for id in $known_drivers; do
  if ! owned="$(csms_names "$id")"; then
    echo "FAIL: '$id' is in known_drivers with no csms_names() row." >&2
    echo "  → the list and the table have drifted, and the names that driver" >&2
    echo "    owns are missing from every pattern below, the core's included." >&2
    status=1
    continue
  fi
  declared="$declared $id"
  all_names="$all_names|$owned"
done

scan "$core_dir" "$all_names" \
  "the core names a CSMS — it must not know which one it is testing"

for id in ${drivers[@]+"${drivers[@]}"}; do
  if ! is_known "$id"; then
    echo "FAIL: drivers/$id is not declared in known_drivers." >&2
    echo "  → declare it there and give it a csms_names() row; until then it" >&2
    echo "    is not scanned, and every other driver may name its CSMS." >&2
    status=1
    continue
  fi
  others="$unowned_names"
  for other in $declared; do
    if [ "$other" != "$id" ]; then
      others="$others|$(csms_names "$other")"
    fi
  done
  scan "$drivers_dir/$id" "$others" \
    "this driver names a CSMS that is not its own"
done

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

# `$drivers_dir`, not one driver each: this find recurses and filters on no
# extension, so every driver is covered -- README and compose file included --
# and a driver csms_names() has never heard of is covered too. THIS COVERAGE
# MUST NOT DEPEND ON THAT TABLE. The scans above are about coupling and can
# afford to report an unknown driver and move on; this one is about a third
# party's name reaching a public diff, and the driver most likely to carry it
# is the one nobody has finished wiring in yet.
#
# `$unowned_names` and not a second spelling of it: this is the same list, the
# names no driver here owns, and it was written out twice until the two copies
# had drifted by an entry -- harmlessly, since `firebase` covers
# `firebasetoken` by substring, but with no way for a reader to tell drift from
# design. A driver's own names are deliberately NOT in it: `steve` and
# `citrineos` name public projects, and drivers/citrineos/README.md compares
# its gaps to the SteVe driver's on purpose -- documentation, not disclosure.
for public_dir in "$core_dir" "$drivers_dir" "$subtree/patches" "$subtree/bin"; do
  scan_including_comments "$public_dir" "$unowned_names" \
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
  echo "Core is CSMS-neutral: no CSMS named in $core_dir, no driver in $drivers_dir names another's, and no upstream-bound file depends on a private driver."
fi
exit "$status"
