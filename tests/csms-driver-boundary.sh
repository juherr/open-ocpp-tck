#!/usr/bin/env bash
# The reusable CSMS library has no dependency back into the TCK or its verdict
# model, and its source files must be included in the package TypeScript build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

source_dir=packages/csms-driver
[ -d "$source_dir" ] || { echo "FAIL: $source_dir is missing." >&2; exit 1; }

imports="$(grep -R -n -E "(from|import)[[:space:]]*\(?[[:space:]]*[\"'][^\"']*(tck/|drivers/)" "$source_dir" --include='*.ts' || true)"
if [ -n "$imports" ]; then
  echo "FAIL: the reusable CSMS library imports its TCK adapter layer:" >&2
  printf '%s\n' "$imports" >&2
  exit 1
fi

# The daemon is a transport adapter over the generic contract, so it may not
# reach for a bundled driver's implementation (issue #156).
server_imports="$(grep -R -n -E "(from|import)[[:space:]]*\(?[[:space:]]*[\"'][^\"']*\.\./(steve|citrineos)" "$source_dir/server" --include='*.ts' || true)"
if [ -n "$server_imports" ]; then
  echo "FAIL: the CSMS daemon imports a concrete driver:" >&2
  printf '%s\n' "$server_imports" >&2
  exit 1
fi

if ! grep -Fq 'packages/csms-driver/**/*.ts' tsconfig.build.json; then
  echo "FAIL: the declaration build does not include packages/csms-driver." >&2
  exit 1
fi

bun tests/csms-driver-contract-exports.ts
bun tests/csms-driver-factories.ts
bun tests/csms-driver-charge-points.ts
bun tests/csms-server.ts
bun examples/csms-driver-smoke.ts

echo "CSMS library dependency boundary holds."
