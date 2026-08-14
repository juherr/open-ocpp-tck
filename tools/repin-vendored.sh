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
# AND THE OTHER DIRECTION, upstream-verbatim -> upstream-patched. Editing a
# verbatim file is also a change of origin: the row moves, a patch appears, and
# NOTICE grows a line. Doing that by hand had a failure mode worse than the
# ordering trap above, because it is SILENT -- resolving a VENDOR.md conflict
# during a rebase with `--ours` takes upstream's row and reverts the origin,
# and the file goes on being edited against a manifest that calls it verbatim.
# It happened twice in one branch. So this script bootstraps that transition
# too: for a verbatim file the upstream bytes ARE HEAD's copy, which is the one
# thing that made it hand-work in the first place. NOTICE still needs a line by
# hand -- what changed is a sentence, and a script guessing it would be worse
# than the guard refusing without it.
#
# COMMIT A BOOTSTRAP BEFORE RE-PINNING AGAIN. Every reconstruction here starts
# from HEAD, so a second run over a patch that exists only in the working tree
# says the patch is not committed. That is the safety rule doing its job, not a
# failure of the bootstrap.
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
    if ($2 == want) { printf "%s\t%s\t%s\t%s\t%s\n", $3, $4, $5, $6, $7 }
  }' "$manifest")

if [ -z "$row" ]; then
  echo "repin: $manifest has no row for $path." >&2
  exit 1
fi

IFS=$'\t' read -r origin up_src up_sha loc_sha patch_rel <<EOF
$row
EOF

# The pin, for a bootstrapped patch's attribution header. One line in the
# manifest owns it, so a patch can never cite a commit the manifest does not.
# shellcheck disable=SC2016  # \1 is a sed backreference, not a shell expansion.
pin=$(sed -n 's/^Pinned commit: \*\*`\([0-9a-f]\{40\}\)`\*\*.*/\1/p' "$manifest" | head -1)
if [ -z "$pin" ]; then
  echo "repin: $manifest does not state a pinned commit." >&2
  exit 1
fi

case "$origin" in
  upstream-patched | upstream-verbatim) ;;
  *)
    echo "repin: $path is '$origin' — it pins nothing, so there is nothing to re-pin." >&2
    exit 1
    ;;
esac

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# HEAD's file, never the working tree: that is what is being re-pinned.
git show "HEAD:$path" > "$work/head-local" 2>/dev/null ||
  { echo "repin: $path is not committed at HEAD; commit or stash first." >&2; exit 1; }

if [ "$origin" = "upstream-verbatim" ]; then
  # Verbatim means HEAD's copy IS upstream -- the guard proved it when the row
  # was written, and the digest check below proves it again before anything is
  # written. No patch to reverse-apply, which is the whole reason this
  # transition used to be hand-work.
  bootstrap=1
  patch_rel="patches/$path.patch"
  cp "$work/head-local" "$work/upstream"
else
  bootstrap=0
  # HEAD's file + HEAD's patch, which the guard proved consistent when they
  # were committed.
  git show "HEAD:$patch_rel" > "$work/head-patch" 2>/dev/null ||
    { echo "repin: $patch_rel is not committed at HEAD." >&2; exit 1; }

  if ! patch -R -s -t -o "$work/upstream" "$work/head-local" "$work/head-patch" 2>/dev/null; then
    echo "repin: HEAD's patch does not reverse-apply to HEAD's $path." >&2
    echo "  → re-pin from a clean HEAD, or repair the patch by hand." >&2
    exit 1
  fi
fi

reconstructed=$(sha256_of "$work/upstream")
if [ "$reconstructed" != "$up_sha" ]; then
  echo "repin: reconstructed upstream does not match the pinned digest." >&2
  echo "  expected $up_sha" >&2
  echo "  got      $reconstructed" >&2
  echo "  → HEAD is not the state VENDOR.md describes; nothing was written." >&2
  exit 1
fi

new_sha=$(sha256_of "$path")
if [ "$new_sha" = "$up_sha" ]; then
  if [ "$bootstrap" = 1 ]; then
    echo "repin: $path is byte-identical to upstream — it is already correctly" >&2
    echo "  marked 'upstream-verbatim'. Nothing to do." >&2
  else
    echo "repin: $path is now byte-identical to upstream." >&2
    echo "  → mark the row 'upstream-verbatim' and delete $patch_rel." >&2
  fi
  exit 1
fi

# The two header lines name the upstream path and the pinned commit, and are
# prose rather than diff: keep them verbatim so a re-pin never rewrites the
# attribution Apache-2.0 §4(b) rests on. A bootstrap has none to keep, so it
# writes the pair -- TWO lines, because everything downstream assumes a unified
# diff's `---`/`+++` and a one-line header makes the NEXT re-pin emit a
# malformed patch.
if [ "$bootstrap" = 1 ]; then
  mkdir -p "$(dirname "$patch_rel")"
  {
    printf -- '--- a/%s (upstream @ %s)\n' "$up_src" "$pin"
    printf -- '+++ b/%s\n' "$path"
  } > "$work/new-patch"
else
  head -2 "$work/head-patch" > "$work/new-patch"
fi
diff -u "$work/upstream" "$path" | tail -n +3 >> "$work/new-patch" || true

mv "$work/new-patch" "$patch_rel"

# Only this row's local-sha cell, so a digest that happens to appear twice in
# the manifest cannot be rewritten by accident.
awk -F'|' -v want="$path" -v new="$new_sha" \
       -v boot="$bootstrap" -v patchrel="$patch_rel" '
  BEGIN { OFS = "|" }
  /^\|/ && NF == 8 {
    p = $2; gsub(/`/, "", p); gsub(/^[ \t]+|[ \t]+$/, "", p)
    if (p == want) {
      $6 = " `" new "` "
      if (boot == 1) { $3 = " `upstream-patched` "; $7 = " `" patchrel "` " }
      print; next
    }
  }
  { print }
' "$manifest" > "$work/manifest" && mv "$work/manifest" "$manifest"

echo "repin: $path"
if [ "$bootstrap" = 1 ]; then
  echo "  origin upstream-verbatim -> upstream-patched"
fi
echo "  patch  $patch_rel"
echo "  digest $loc_sha"
echo "      -> $new_sha"

if [ "$bootstrap" = 1 ]; then
  echo
  echo "  ONE THING LEFT, and it is the half a script must not guess: NOTICE"
  echo "  lists every modified file with WHAT was modified, and that sentence"
  echo "  is editorial. Add a line for $path under"
  echo "  \"Files modified relative to upstream\", then re-run the guard --"
  echo "  it cross-checks that list against the manifest and will say so."
fi
echo
bash tests/vendor-integrity.sh
