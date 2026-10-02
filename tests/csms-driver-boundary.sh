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

# A self-reference resolves through package.json#exports, so it reaches the
# TCK without spelling a path: `import "open-ocpp-tck"` is tck/index.ts, and
# the subpaths only matched the rule above by the accident of the package's
# name containing `tck/`. Every specifier naming this package is refused --
# the library reaches its own modules relatively, and nothing else of it.
package_name="$(sed -n 's/^  "name": "\([^"]*\)",$/\1/p' package.json)"
[ -n "$package_name" ] || { echo "FAIL: could not read the package name from package.json." >&2; exit 1; }
self_refs="$(grep -R -n -E "(from|import)[[:space:]]*\(?[[:space:]]*[\"']${package_name}[/\"']" "$source_dir" --include='*.ts' || true)"
if [ -n "$self_refs" ]; then
  echo "FAIL: the reusable CSMS library imports its own package by name:" >&2
  printf '%s\n' "$self_refs" >&2
  exit 1
fi

# The daemon is a transport adapter over the generic contract (issue #156): an
# allowlist rather than a list of drivers, so a third bundled driver is covered
# the day it is added. Every relative specifier under server/ is a sibling or
# one of the contract modules.
server_imports="$(grep -R -n -E "(from|import)[[:space:]]*\(?[[:space:]]*[\"']\.\.?/" "$source_dir/server" --include='*.ts' \
  | grep -v -E "[\"'](\./[^/\"']+|\.\./(contracts|models|charge-points))[\"']" || true)"
if [ -n "$server_imports" ]; then
  echo "FAIL: the CSMS daemon imports beyond the generic contract:" >&2
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
