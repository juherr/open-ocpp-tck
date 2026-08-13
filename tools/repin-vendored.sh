#!/usr/bin/env bash
# Re-pin one vendored file after editing it: patch and digest, in one step.
#
# WHY THIS EXISTS. VENDOR.md's refresh procedure is prose, and running it by
# hand has exactly one ordering trap: regenerate the patch, record the digest,
# then touch the file again -- and the recorded digest now describes a file
# that no longer exists. That happened here, and the guard that caught it was
# read as passing because its output went through `| tail -1`. One command
# cannot get the order wrong.
#
# WHERE UPSTREAM COMES FROM, since regenerating a patch needs the original
# bytes and this repository does not vendor them: HEAD's copy of the file and
# HEAD's copy of its patch are consistent by construction -- the guard passed
# when they were committed -- so reverse-applying the second to the first
# reconstructs upstream. The result is then checked against the upstream digest
# frozen in VENDOR.md before anything is written, so a wrong reconstruction
# stops here instead of being pinned.
#
# Usage: tools/repin-vendored.sh tck/main.ts
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

path=${1-}
if [ -z "$path" ]; then
  echo "Usage: tools/repin-vendored.sh <path>   (e.g. tck/main.ts)" >&2
  exit 2
fi
[ -f "$path" ] || { echo "repin: $path does not exist." >&2; exit 1; }

manifest=VENDOR.md

# The row, as the guard reads it: `| path | origin | upstream path | up sha | local sha | patch |`
row=$(awk -F'|' -v want="$path" '
  /^\|/ && NF == 8 {
    for (i = 2; i <= 7; i++) { gsub(/`/, "", $i); gsub(/^[ \t]+|[ \t]+$/, "", $i) }
    if ($2 == want) { printf "%s\t%s\t%s\t%s\n", $3, $5, $6, $7 }
  }' "$manifest")

if [ -z "$row" ]; then
  echo "repin: $manifest has no row for $path." >&2
  exit 1
fi

IFS=$'\t' read -r origin up_sha loc_sha patch_rel <<EOF
$row
EOF

if [ "$origin" != "upstream-patched" ]; then
  echo "repin: $path is '$origin', not 'upstream-patched' — nothing to re-pin." >&2
  exit 1
fi

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# HEAD's file + HEAD's patch, which the guard proved consistent when they were
# committed. Never the working tree: that is what is being re-pinned.
git show "HEAD:$path" > "$work/head-local" 2>/dev/null ||
  { echo "repin: $path is not committed at HEAD; commit or stash first." >&2; exit 1; }
git show "HEAD:$patch_rel" > "$work/head-patch" 2>/dev/null ||
  { echo "repin: $patch_rel is not committed at HEAD." >&2; exit 1; }

if ! patch -R -s -t -o "$work/upstream" "$work/head-local" "$work/head-patch" 2>/dev/null; then
  echo "repin: HEAD's patch does not reverse-apply to HEAD's $path." >&2
  echo "  → re-pin from a clean HEAD, or repair the patch by hand." >&2
  exit 1
fi

reconstructed=$(sha256_of "$work/upstream")
if [ "$reconstructed" != "$up_sha" ]; then
  echo "repin: reconstructed upstream does not match the pinned digest." >&2
  echo "  expected $up_sha" >&2
  echo "  got      $reconstructed" >&2
  echo "  → HEAD is not the state VENDOR.md describes; nothing was written." >&2
  exit 1
fi

# The two header lines name the upstream path and the pinned commit, and are
# prose rather than diff: keep them verbatim so a re-pin never rewrites the
# attribution Apache-2.0 §4(b) rests on.
head -2 "$work/head-patch" > "$work/new-patch"
diff -u "$work/upstream" "$path" | tail -n +3 >> "$work/new-patch" || true

new_sha=$(sha256_of "$path")
if [ "$new_sha" = "$up_sha" ]; then
  echo "repin: $path is now byte-identical to upstream." >&2
  echo "  → mark the row 'upstream-verbatim' and delete $patch_rel." >&2
  exit 1
fi

mv "$work/new-patch" "$patch_rel"

# Only this row's local-sha cell, so a digest that happens to appear twice in
# the manifest cannot be rewritten by accident.
awk -F'|' -v want="$path" -v new="$new_sha" '
  BEGIN { OFS = "|" }
  /^\|/ && NF == 8 {
    p = $2; gsub(/`/, "", p); gsub(/^[ \t]+|[ \t]+$/, "", p)
    if (p == want) { $6 = " `" new "` " ; print; next }
  }
  { print }
' "$manifest" > "$work/manifest" && mv "$work/manifest" "$manifest"

echo "repin: $path"
echo "  patch  $patch_rel"
echo "  digest $loc_sha"
echo "      -> $new_sha"
echo
bash tests/vendor-integrity.sh
