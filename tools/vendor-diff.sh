#!/usr/bin/env bash
# How far upstream has moved since the pinned import. NETWORK REQUIRED.
#
# Deliberately NOT part of `bun test`: that suite stays deterministic and
# offline. The offline counterpart is tests/vendor-integrity.sh, which compares
# against the sha256 digests frozen in VENDOR.md rather than against a clone.
set -eu

upstream_url=https://github.com/shiv3/ocpp-cp-simulator
manifest=VENDOR.md

pinned=$(grep -oE '[0-9a-f]{40}' "$manifest" | head -1)
if [ -z "$pinned" ]; then
  echo "No 40-hex commit found in $manifest — cannot tell what this was imported from." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
git clone --quiet --filter=blob:none "$upstream_url" "$work/upstream"

head_sha=$(git -C "$work/upstream" rev-parse HEAD)
echo "pinned in $manifest : $pinned"
echo "upstream main       : $head_sha"
if [ "$pinned" = "$head_sha" ]; then
  echo "Upstream main is still at the pinned commit."
elif git -C "$work/upstream" cat-file -e "$pinned^{commit}" 2>/dev/null; then
  count=$(git -C "$work/upstream" rev-list --count "$pinned..$head_sha")
  echo "upstream moved by $count commit(s) since the import:"
  git -C "$work/upstream" log --oneline --no-decorate "$pinned..$head_sha" | head -30
else
  # The pinned commit can become unreachable (force-push, rebase upstream). Do
  # not die on it: the per-file diff below is the useful half anyway.
  echo "The pinned commit is no longer reachable from upstream main (force-push or rebase)."
fi
echo

# Per-file drift. Rows whose origin is `local-*` have no upstream counterpart.
awk -F'|' 'NF == 8 && $3 !~ /origin/ {
  gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2);
  gsub(/^[ \t]+|[ \t]+$/, "", $3); gsub(/`/, "", $3);
  gsub(/^[ \t]+|[ \t]+$/, "", $4); gsub(/`/, "", $4);
  if ($3 ~ /^local-/) next;
  print $2 "\t" $4;
}' "$manifest" | while IFS="$(printf '\t')" read -r local_path up_path; do
  [ -n "$up_path" ] || continue
  if [ ! -f "$work/upstream/$up_path" ]; then
    echo "GONE     $up_path (was vendored as $local_path)"
    continue
  fi
  if diff -q "$work/upstream/$up_path" "$local_path" >/dev/null 2>&1; then
    echo "SAME     $local_path"
  else
    echo "DIFFERS  $local_path  <-  $up_path"
  fi
done
