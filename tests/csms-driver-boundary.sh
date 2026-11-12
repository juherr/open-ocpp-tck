#!/usr/bin/env bash
# The reusable CSMS library is a dependency, not a directory of this
# repository. It moved to @ovarilo/csms-drivers, and what this guard holds is
# that it stays there and that the TCK consumes exactly one copy of it:
#
#   1. No tracked file imports or names a path under packages/csms-driver.
#      CHANGELOG.md is exempt: released entries describe the tree they shipped.
#   2. package.json#dependencies pins @ovarilo/csms-drivers at an EXACT
#      version -- no range, no tag, no git, file or link spec. The contract
#      this package re-exports is that version's, so a range would let an
#      install change the public API without a commit here.
#   3. tck/driver.ts re-exports the package root, and the two public subpaths
#      kept for consumers, ./csms-driver and ./csms-driver/server, resolve to
#      modules re-exporting the root and ./server respectively.
#
# Then it runs the guards whose subject is the TCK side of that boundary: the
# re-exported contract, the TCK's factories and its daemon.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

package=@ovarilo/csms-drivers
status=0

# 1. No path into the old in-tree copy.
self=tests/csms-driver-boundary.sh
mentions="$(git grep -n -F 'packages/csms-driver' -- ':!CHANGELOG.md' ":!$self" || true)"
if [ -n "$mentions" ]; then
  echo "FAIL: a tracked file still names a path under packages/csms-driver:" >&2
  printf '%s\n' "$mentions" >&2
  echo "  → the library is $package now; import it by that name." >&2
  status=1
fi

# 2. An exact version.
spec="$(bun -e "const p = require('./package.json'); console.log(p.dependencies?.['$package'] ?? '')")"
if [ -z "$spec" ]; then
  echo "FAIL: package.json#dependencies does not declare $package." >&2
  status=1
elif ! printf '%s' "$spec" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "FAIL: $package is declared as \"$spec\", not an exact version." >&2
  echo "  → pin it (e.g. \"0.0.3\"): the contract this package re-exports is that version's." >&2
  status=1
fi

# 3. The re-exports.
reexports() { # <file> <specifier>
  grep -Fxq "export * from \"$2\";" "$1"
}
if ! reexports tck/driver.ts "$package"; then
  echo "FAIL: tck/driver.ts does not re-export $package." >&2
  status=1
fi
while read -r subpath specifier; do
  target="$(bun -e "const e = require('./package.json').exports['$subpath']; console.log(e?.default ?? '')")"
  if [ -z "$target" ] || [ ! -f "$target" ] || ! reexports "$target" "$specifier"; then
    echo "FAIL: the public subpath $subpath does not resolve to a module re-exporting $specifier (got '${target}')." >&2
    status=1
  fi
done <<EOF
./csms-driver $package
./csms-driver/server $package/server
EOF

[ "$status" -eq 0 ] || exit "$status"

bun tests/csms-driver-contract-exports.ts
bun tests/csms-driver-factories.ts
bun tests/csms-server.ts

echo "CSMS library boundary holds: $package@$spec is the only copy, re-exported by tck/driver.ts and both public subpaths."
