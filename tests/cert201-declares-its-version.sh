#!/usr/bin/env bash
# A scenario's `cert201-` prefix and the protocol it declares are one fact.
#
# THE PROPERTY, in three parts:
#   1. every registered scenario whose templateId starts with `cert201-`
#      declares `ocppVersion="OCPP-2.0.1"`;
#   2. every registered scenario declaring that version has a `cert201-`
#      templateId;
#   3. the artifact is READ -- a SPEC line that changed shape makes both
#      directions range over nothing, and two empty sets agree.
#
# WHY IT IS A GUARD AND NOT A CONVENTION. Nothing ties the two together.
# `ocppVersion` is an optional member of `ScenarioSpec`, and a scenario that
# omits it runs on whatever the environment says -- OCPP 1.6 by default. The
# resulting run is not a failure: a `cert201-` scenario measured against 1.6
# goes six checks of seven green (issue #57 §C is that measurement), which is
# the shape of finding nobody reads a log for.
#
# THAT IS THE EXACT FAILURE `ScenarioSpec.ocppVersion` WAS INTRODUCED TO
# PREVENT, arriving through the one door nothing was watching -- the member
# exists, and a scenario simply does not carry it.
#
# AND IT IS INVISIBLE TO tests/oca-201-slice.sh IN BOTH DIRECTIONS, which is
# what makes it worth its own guard rather than a stricter clause over there.
# That guard is keyed on the declared version, deliberately: its own comment
# records that "`cert201-` is a convention nothing enforces, and a 2.0.1
# scenario named anything else was invisible here". Keyed that way, an
# undeclared `cert201-` scenario is not registered as far as it can tell -- so
# a slice row claiming it reads as a row naming a scenario nobody wrote, and if
# the case was declined instead there is no row at all and nothing to read.
# Keying on the prefix would bring the mirror failure back rather than remove
# it. The two keys have to select the same set, and that is a third statement
# neither of them can make about itself.
#
# WHY IT READS THE INVENTORY rather than importing the specs: the same reason
# tests/oca-201-slice.sh does. `tck/specs/ASSERT-INVENTORY.txt` is generated
# from the sources and guarded by tests/spec-invariants.sh, and it carries the
# declaration on the SPEC line for precisely this purpose --
# tools/extract-assert-inventory.ts's comment above that field names issue #57
# §C as the reason it is rendered at all. So the templateId and the protocol
# are one line apart and neither is inferred, this guard cannot disagree with
# what that artifact says exists, and it stays offline and free of a runtime.
#
# WHAT IT CANNOT CHECK: that a scenario measures the protocol it declares. The
# declaration selects the simulator's protocol and the driver's operation set;
# whether the assertions underneath are 2.0.1 assertions is what
# tests/spec-invariants.sh pins and what a reader reads.
#
# Offline: reads one file, runs nothing.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

inventory=tck/specs/ASSERT-INVENTORY.txt
version='ocppVersion="OCPP-2.0.1"'

[ -s "$inventory" ] || { echo "FAIL: $inventory is missing or empty." >&2; exit 1; }

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

# Part 3 first. A SPEC line that changed shape leaves both selections below
# empty, and two empty sets agree -- the failure this repository has already
# had one level up, in tests/gate-parity.sh.
total=$(grep -c '^  SPEC ' "$inventory")
if [ "$total" -eq 0 ]; then
  echo "FAIL: $inventory has no '  SPEC ' line at all." >&2
  echo "  → the artifact changed shape under this guard's pattern; it is" >&2
  echo "    reading nothing, not agreeing about nothing. Teach it the new" >&2
  echo "    shape, or regenerate the inventory." >&2
  exit 1
fi

# BOTH SELECTIONS MATCH A WHOLE FIELD, not a substring. `$2` is the templateId
# and the declaration is one field of its own, so `ocppVersion="OCPP-2.0.1x"`
# is not this version and `cert2016-…` does not carry this prefix.
awk -v want="$version" '
  /^  SPEC / && $2 ~ /^cert201-/ {
    for (i = 3; i <= NF; i++) if ($i == want) next
    print $2
  }
' "$inventory" | sort -u > "$work/undeclared"

awk -v want="$version" '
  /^  SPEC / && $2 !~ /^cert201-/ {
    for (i = 3; i <= NF; i++) if ($i == want) { print $2; next }
  }
' "$inventory" | sort -u > "$work/misnamed"

status=0

# Direction 1: the prefix promises the protocol.
if [ -s "$work/undeclared" ]; then
  status=1
  echo "FAIL: 'cert201-' scenarios that do not declare $version:" >&2
  sed 's/^/  /' "$work/undeclared" >&2
  echo "  → the run then takes the protocol from the environment -- OCPP 1.6" >&2
  echo "    by default -- and passes six checks of seven while measuring the" >&2
  echo "    wrong one. Declare ocppVersion on the spec." >&2
fi

# Direction 2: the protocol promises the prefix.
if [ -s "$work/misnamed" ]; then
  status=1
  echo "FAIL: scenarios declaring $version without a 'cert201-' templateId:" >&2
  sed 's/^/  /' "$work/misnamed" >&2
  echo "  → tests/oca-201-slice.sh ranges over the declaration;" >&2
  echo "    tests/cert201-scope-rows.sh and every driver list spelled in the" >&2
  echo "    prefix range over the name. A scenario in one set and not the" >&2
  echo "    other is checked by half of what it looks checked by. Rename it." >&2
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "The prefix and the declaration are two spellings of one decision, and" >&2
  echo "the guards downstream are split between them." >&2
  exit 1
fi

declared=$(grep -c "^  SPEC .* $version" "$inventory")
echo "Every OCPP 2.0.1 scenario is spelled both ways: $declared of $total" \
     "registered scenario(s) carry the 'cert201-' prefix and the declaration."
