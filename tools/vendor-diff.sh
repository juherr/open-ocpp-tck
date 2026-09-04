#!/usr/bin/env bash
# How far upstream has moved since the pinned import. NETWORK REQUIRED.
#
# Deliberately NOT part of `bun test`: that suite stays deterministic and
# offline. The offline counterpart is tests/vendor-integrity.sh, which compares
# against the sha256 digests frozen in VENDOR.md rather than against a clone.
set -eu

upstream_url=https://github.com/shiv3/ocpp-cp-simulator
manifest=VENDOR.md

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

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

# THE FORK-POINT DIGESTS, which nothing offline can check. A forked row keeps
# no patch, so `tests/vendor-integrity.sh` can only confirm its upstream digest
# is shaped like a digest; correlating it with the pinned commit needs upstream
# itself. That is this script's job, and it is why the offline guard says so
# rather than pretending to have checked.
# shellcheck disable=SC2016  # \1 is a sed backreference, not a shell expansion.
fork=$(sed -n 's/^### Fork commit: `\([0-9a-f]\{40\}\)`.*/\1/p' "$manifest" | head -1)
if [ -z "$fork" ]; then
  echo "NOT VERIFIED: $manifest states no '### Fork commit', so no forked row could be checked."
  echo
elif ! git -C "$work/upstream" cat-file -e "$fork^{commit}" 2>/dev/null; then
  # Silence here would read as success: the FORKED lines below still print,
  # and the one check that correlates a recorded digest with upstream bytes
  # would simply not have run.
  echo "NOT VERIFIED: the fork commit $fork is unreachable from upstream (force-push or rebase)."
  echo "  No forked row's digest was checked. The recorded fork point is now only a claim."
  echo
else
  echo "fork commit         : $fork"
  # Rows into a file first: a `while` on the right of a pipe runs in a
  # subshell, and the mismatch count would not survive it.
  awk -F'|' 'NF == 8 {
    gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2);
    gsub(/^[ \t]+|[ \t]+$/, "", $3); gsub(/`/, "", $3);
    gsub(/^[ \t]+|[ \t]+$/, "", $4); gsub(/`/, "", $4);
    gsub(/^[ \t]+|[ \t]+$/, "", $5); gsub(/`/, "", $5);
    if ($3 == "upstream-forked") print $2 "\t" $4 "\t" $5;
  }' "$manifest" > "$work/forked-rows"
  forked_bad=0
  while IFS="$(printf '\t')" read -r local_path up_path up_sha; do
    [ -n "$up_path" ] || continue
    if ! git -C "$work/upstream" show "$fork:$up_path" > "$work/at-fork" 2>/dev/null; then
      echo "  GONE      $up_path did not exist at the fork commit"
      forked_bad=1
      continue
    fi
    actual=$(sha256_of "$work/at-fork")
    if [ "$actual" = "$up_sha" ]; then
      echo "  verified  $local_path  <-  $up_path"
    else
      echo "  MISMATCH  $local_path: $manifest says $up_sha, the fork commit has $actual"
      forked_bad=1
    fi
  done < "$work/forked-rows"
  [ "$forked_bad" -eq 0 ] || echo "  (a mismatch means the recorded fork point is not the one the bytes came from)"
  echo
fi

# Per-file drift. Rows whose origin is `local-*` have no upstream counterpart;
# `upstream-forked` rows are expected to differ and are reported as such —
# what is worth knowing about them is only whether upstream still ships the
# file at all.
awk -F'|' 'NF == 8 && $3 !~ /origin/ {
  gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2);
  gsub(/^[ \t]+|[ \t]+$/, "", $3); gsub(/`/, "", $3);
  gsub(/^[ \t]+|[ \t]+$/, "", $4); gsub(/`/, "", $4);
  if ($3 ~ /^local-/) next;
  # Skip the separator row: it is as wide as a file row, and reporting it as
  # a GONE file named --- is noise the reader has to learn to ignore.
  if ($2 ~ /^-+$/) next;
  print $2 "\t" $3 "\t" $4;
}' "$manifest" | while IFS="$(printf '\t')" read -r local_path origin up_path; do
  [ -n "$up_path" ] || continue
  if [ ! -f "$work/upstream/$up_path" ]; then
    echo "GONE     $up_path (was vendored as $local_path)"
    continue
  fi
  if [ "$origin" = "upstream-forked" ]; then
    echo "FORKED   $local_path  (upstream still ships $up_path)"
  elif diff -q "$work/upstream/$up_path" "$local_path" >/dev/null 2>&1; then
    echo "SAME     $local_path"
  else
    echo "DIFFERS  $local_path  <-  $up_path"
  fi
done
