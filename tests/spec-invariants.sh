#!/usr/bin/env bash
# The scenarios are the yardstick. This test is what keeps them one.
#
# ADR-0089 decision 1 pinned the vendored specs byte-for-byte against upstream
# and INFERRED the property that mattered: "a harness that adapts its
# assertions to the CSMS it tests measures nothing". Byte-identity was a proxy
# -- an excellent one, because it needs no interpretation.
#
# Making the harness CSMS-neutral edits those specs, so the proxy is gone and
# the property has to be stated directly:
#
#   The set of checks each scenario performs, their order, their nesting, and
#   every literal they compare against, are unchanged. Only the syntax by which
#   a scenario asks a CSMS to act may change.
#
# That decomposes into two halves, both required:
#
#   ASSERT-INVENTORY.txt  what is measured (assert)   -- must not change at all
#   DRIVE-TRACE.txt       what is done    (drive)     -- normalised operation
#                                                        sequence must not change
#
# Pinning only the first half is the trap. A drive() that drops a step makes
# every assertion fail honestly; a drive() that issues an operation twice or
# retargets one produces green for the wrong reason.
#
# Both artifacts are COMMITTED TEXT, regenerated here and diffed -- not
# digests. A digest tells a reviewer THAT something moved; the diff tells them
# WHAT, in the pull request, with no tooling. A hash bump is a one-character
# change nobody can evaluate, so it gets waved through.
#
# Offline and deterministic: the extractors run in the pinned bun image with
# the subtree mounted read-only, fetch is stubbed, and timers are collapsed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

subtree="."
bun_image="oven/bun:1.3.14-alpine"
typescript_version="5.9.2"

for artifact in ASSERT-INVENTORY.txt DRIVE-TRACE.txt; do
  if [ ! -f "tck/specs/$artifact" ]; then
    echo "FAIL: tck/specs/$artifact is missing." >&2
    echo "  → without it nothing pins the scenarios, and a check could be" >&2
    echo "    deleted or an expected value flipped with no test going red." >&2
    echo "  → regenerate with: bash tests/spec-invariants.sh --regenerate" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "FAIL: docker is required (the extractors run in $bun_image)." >&2
  exit 1
fi

regenerate=0
if [ "${1:-}" = "--regenerate" ]; then
  regenerate=1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

# The repository is mounted READ-ONLY and copied inside the
# container before anything installs a dependency: no node_modules, lockfile or
# generated artifact is ever written back into the repo by this test.
if ! docker run --rm \
  -v "$repo_root:/src:ro" \
  -v "$work:/out" \
  "$bun_image" \
  sh -c "set -e
    mkdir -p /work
    cp -r /src/. /work/
    cd /work
    rm -rf node_modules
    bun add -d 'typescript@$typescript_version' >/dev/null 2>&1
    bun tools/extract-assert-inventory.ts tck/specs > /out/ASSERT-INVENTORY.txt
    bun tools/extract-drive-trace.ts > /out/DRIVE-TRACE.txt
  " 2>&1; then
  echo "FAIL: the spec-invariant extractors did not run (see the output above)." >&2
  exit 1
fi

for artifact in ASSERT-INVENTORY.txt DRIVE-TRACE.txt; do
  if [ ! -s "$work/$artifact" ]; then
    echo "FAIL: the extractor produced an empty $artifact." >&2
    echo "  → an empty artifact would compare equal to an empty committed one" >&2
    echo "    and pin nothing. Treat it as a broken extractor, not as 'no specs'." >&2
    exit 1
  fi
done

if [ "$regenerate" -eq 1 ]; then
  for artifact in ASSERT-INVENTORY.txt DRIVE-TRACE.txt; do
    cp "$work/$artifact" "tck/specs/$artifact"
    echo "regenerated tck/specs/$artifact"
  done
  echo
  echo "Read the diff before committing. Regenerating is how the guarantee is"
  echo "given up; it should happen in its own commit, with the reason in the"
  echo "message, and never in a commit that also changes a driver."
  exit 0
fi

status=0
for artifact in ASSERT-INVENTORY.txt DRIVE-TRACE.txt; do
  if ! diff -u "tck/specs/$artifact" "$work/$artifact"; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "FAIL: a scenario's assertions or its CSMS call sequence changed." >&2
  echo >&2
  echo "  ADR-0089 decision 1: the scenarios are the yardstick. A harness that" >&2
  echo "  adapts its assertions to the CSMS it tests measures nothing. Byte" >&2
  echo "  identity with upstream no longer holds -- the specs are driver-" >&2
  echo "  agnostic now -- so THIS is the guarantee that replaces it." >&2
  echo >&2
  echo "  The diff above is the whole review question: did the MEANING change," >&2
  echo "  or only the syntax?" >&2
  echo "  → only the syntax: the artifacts should NOT have moved. Fix the" >&2
  echo "    refactor, not the artifact." >&2
  echo "  → the meaning genuinely must change: regenerate with" >&2
  echo "      bash tests/spec-invariants.sh --regenerate" >&2
  echo "    in its OWN commit, with the reason in the message." >&2
  exit 1
fi

specs="$(grep -c '^  SPEC ' "$subtree/tck/specs/ASSERT-INVENTORY.txt" || true)"
echo "Scenario invariants hold: $specs scenario(s), assertions and CSMS call sequences unchanged."
