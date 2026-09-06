#!/usr/bin/env bash
# A demotion list a driver keeps by hand names every scenario it is about.
#
# THE PROPERTY, in three parts:
#   1. every registered `cert201-` scenario is named in
#      `drivers/citrineos/variant.ts`'s `CERT_201_SCENARIOS`;
#   2. every name in that list is a registered scenario;
#   3. the list is READ. A rename of the constant, or of the array's shape,
#      makes both directions range over nothing, and two empty sets agree.
#
# WHY IT IS A GUARD AND NOT ALREADY COVERED. `tck/scope.ts`'s `scopeCoverage`
# -- what `bun run check:driver:citrineos-v1` runs -- reports a row that is
# MISSING from a scope table and a row that is STALE. It cannot report a row
# that is PRESENT AND NOT DEMOTED, because a demotion is not a row: it is a
# rewrite `v1Scope()` applies to the rows named in this list. So a `cert201-`
# scenario absent from the list still gets its v2 row -- the coverage check
# forces that -- and the v1 table inherits it DRIVABLE.
#
# That is not a hypothetical. When this guard was written the list held five of
# the seven registered `cert201-` scenarios, and the two it had never gained --
# `cert201-tcb06-get-variables` and `cert201-tcb09-set-variables` -- were
# declared DRIVABLE on a line whose `speaksOcpp201("v1")` is false, with
# `check:driver:citrineos-v1` green. `variant.ts` says so about itself, in the
# doc comment above the list: "a sixth `cert201-` scenario added without a line
# here still gets its v2 row ... leaving the v1 table claiming exactly what the
# comment above that function calls wrong". A known hole written down is still
# a hole; this is the check that hole was waiting for.
#
# DIRECTION 2 IS REACHABLE TODAY THROUGH TWO OTHER DOORS, and neither is this
# one. `scope.ts` re-types the list as `readonly (keyof typeof V2_SCOPE)[]`, so
# a name with no v2 row is a type error; and a v2 row for no registered
# scenario is `scopeCoverage`'s stale direction. Both point at `scope.ts` for a
# mistake made in `variant.ts`, and both go quiet the moment somebody adds the
# v2 row and forgets the scenario. Asserting it here costs one `comm` and names
# the file the name is in.
#
# WHY IT READS THE INVENTORY rather than importing the specs: the same reason
# tests/oca-201-slice.sh does. `tck/specs/ASSERT-INVENTORY.txt` is generated
# from the sources and guarded by tests/spec-invariants.sh, so this guard
# cannot disagree with what that artifact says exists, and it stays offline and
# free of a runtime.
#
# WHY THE PREFIX AND NOT THE DECLARED VERSION. The two are held equal by
# tests/cert201-declares-its-version.sh, which runs before this. The prefix is
# what `CERT_201_SCENARIOS` is spelled in, so it is what this guard compares;
# reading the declaration instead would silently pass a scenario that declares
# 2.0.1 under another name, which is that guard's business and not this one's.
#
# WHAT IT CANNOT CHECK: that demoting these scenarios on v1 is the right
# answer. That is a measurement, and `variant.ts`'s `NO_OCPP_201_ON_V1` says
# what would change it.
#
# Offline: reads two files, runs nothing.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

inventory=tck/specs/ASSERT-INVENTORY.txt
variant=drivers/citrineos/variant.ts

for f in "$inventory" "$variant"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

# The array literal, and only it. Bounded by its own opening and closing lines
# rather than by "the next `]`", so a nested literal inside the list would end
# the scan where the list ends and not before it.
awk '
  /^export const CERT_201_SCENARIOS = \[/ { inside = 1; next }
  inside && /^\]/ { exit }
  inside && match($0, /"[^"]+"/) { print substr($0, RSTART + 1, RLENGTH - 2) }
' "$variant" | sort -u > "$work/listed"

awk '/^  SPEC cert201-/ { print $2 }' "$inventory" | sort -u > "$work/registered"

# Part 3. EXTRACTING NOTHING IS NOT AGREEING ON NOTHING -- the failure this
# repository has already had one level up, in tests/gate-parity.sh: two empty
# lists are identical, and every comparison below would pass by reading no
# file. Each side says which file changed shape under which pattern, because
# the two have different causes: the list is TypeScript this guard parses, the
# other side is a generated artifact.
if [ ! -s "$work/listed" ]; then
  echo "FAIL: extracted no scenario from CERT_201_SCENARIOS in $variant." >&2
  echo "  → the constant was renamed, or the array no longer opens with" >&2
  echo "    'export const CERT_201_SCENARIOS = ['. This guard is reading" >&2
  echo "    nothing, not agreeing about nothing -- teach it the new shape." >&2
  exit 1
fi
if [ ! -s "$work/registered" ]; then
  echo "FAIL: $inventory registers no 'cert201-' scenario." >&2
  echo "  → either every OCPP 2.0.1 scenario was deleted, in which case delete" >&2
  echo "    the list too, or the artifact's SPEC lines changed shape. Both" >&2
  echo "    directions below would otherwise be vacuous." >&2
  exit 1
fi

status=0

# Part 1 -- the direction scopeCoverage structurally cannot see.
if missing=$(comm -13 "$work/listed" "$work/registered") && [ -n "$missing" ]; then
  status=1
  echo "FAIL: registered 'cert201-' scenarios that CERT_201_SCENARIOS does not name:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$missing" >&2
  echo "  → v1Scope() demotes what this list names, so each of these is" >&2
  echo "    inherited from the v2 table and declared DRIVABLE on a line that" >&2
  echo "    declares no OCPP 2.0.1 surface. check-driver cannot see it: a" >&2
  echo "    demotion is not a row, so nothing is missing and nothing is stale." >&2
fi

# Part 2 -- a demotion of nothing.
if extra=$(comm -23 "$work/listed" "$work/registered") && [ -n "$extra" ]; then
  status=1
  echo "FAIL: CERT_201_SCENARIOS names scenarios that are not registered:" >&2
  awk '{ printf "  %s\n", $1 }' <<< "$extra" >&2
  echo "  → the list demotes a row nothing registers. Either the scenario was" >&2
  echo "    renamed and this list did not follow, or the entry is a typo." >&2
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "$variant's CERT_201_SCENARIOS and the registered OCPP 2.0.1 scenarios" >&2
  echo "are meant to be edited together: the scenario records that we can" >&2
  echo "measure the case, the list records the line that cannot." >&2
  exit 1
fi

echo "CitrineOS v1 demotions cover every registered OCPP 2.0.1 scenario" \
     "($(wc -l < "$work/registered" | tr -d ' ') of them)."
