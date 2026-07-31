#!/usr/bin/env bash
# The committed declarations must be what the sources actually produce.
#
# types/ is generated but COMMITTED, because this package is consumed as a
# pinned git dependency and a git dependency does not reliably run
# prepack/prepare under bun -- a consumer would install a package whose
# `exports.*.types` point at files that do not exist.
#
# Committing a generated artifact is only safe with a guard that regenerates
# and diffs, which is this file. It is the same argument that already keeps
# ASSERT-INVENTORY.txt and DRIVE-TRACE.txt in the tree: the public API surface
# becomes a readable diff in a pull request instead of an invisible
# consequence of an edit somewhere else.
#
# Emits into a temporary directory, never over types/: a check that repairs
# what it is checking always passes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ ! -x node_modules/.bin/tsc ]; then
  echo "FAIL: node_modules/.bin/tsc is missing — run 'bun install' first." >&2
  exit 1
fi

if [ ! -d types ]; then
  echo "FAIL: types/ is missing — the exports map points into it." >&2
  echo "  → generate it with: bun run build:types" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

if ! node_modules/.bin/tsc -p tsconfig.build.json --outDir "$work" >"$work/tsc.log" 2>&1; then
  echo "FAIL: the declaration build failed." >&2
  cat "$work/tsc.log" >&2
  exit 1
fi

if ! diff -ru types "$work" --exclude tsc.log; then
  echo >&2
  echo "FAIL: types/ is stale — the committed declarations do not match the sources." >&2
  echo "  → regenerate and commit: bun run build:types" >&2
  echo "  → the diff above IS the change to this package's public API. Read it." >&2
  exit 1
fi

echo "Committed declarations match the sources ($(find types -name '*.d.ts' | wc -l | tr -d ' ') files)."
