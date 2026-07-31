#!/usr/bin/env bash
# Anti-drift guard for the vendored half of this harness.
#
# tck/ holds scenario specifications and an OCPP-J
# assertion engine copied from shiv3/ocpp-cp-simulator. Those files are the
# *reference* the campaign is judged against. Editing one of them to make a
# failing scenario pass would not fix the CSMS: it would silently rewrite the
# yardstick, and the campaign would keep reporting success in the reassuring
# direction while proving nothing.
#
# VENDOR.md v2 records, per file, TWO digests and (for modified files) a patch:
#
#   upstream sha256 — what upstream shipped. Changes only on re-import.
#   local sha256    — what we ship. Changes on every deliberate edit.
#   patch           — the difference, reverse-applied and verified here.
#
# v1 had a single digest column with a single meaning ("this is what upstream
# shipped"), which is unfalsifiable for a file we modified: the pin recorded
# OUR bytes under a label claiming they were UPSTREAM's. Splitting the column
# is what lets `upstream-verbatim` mean something a test can check.
#
# Deterministic and offline: digests are compared against the manifest and
# against each other, never against upstream over the network. `mise run
# ocpp-verify-vendor-diff` is the network-side comparison and must stay out of
# verify-config.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# The vendored subtree is now the repository itself.
vendor_dir="."
manifest="VENDOR.md"
status=0

if [ ! -f "$manifest" ]; then
  echo "FAIL: $manifest is missing — the vendored subtree has no manifest, so no drift can be detected." >&2
  exit 1
fi

# macOS ships shasum, most Linux images ship sha256sum. Pick whichever exists.
if command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
else
  echo "FAIL: neither shasum nor sha256sum is available — cannot verify the vendored files." >&2
  exit 1
fi

# patch(1) is what turns patches/ from prose into a verified artifact. Without
# it assertion A7 below would be skipped silently, and a truncated or stale
# diff would sail through — which is exactly the state Apache-2.0 §4(b)
# forbids: an unrecorded modification that looks recorded.
if ! command -v patch >/dev/null 2>&1; then
  echo "FAIL: patch(1) is required to verify that patches/ still reconstructs the pinned upstream bytes." >&2
  exit 1
fi

# `is_empty_cell VALUE` — the manifest writes an unused cell as an em dash.
# ASCII "-" is accepted too so a hand-edited row is not rejected on typography.
is_empty_cell() { [ "$1" = "—" ] || [ "$1" = "-" ]; }

# Normalise the Markdown inventory into six tab-separated columns.
#
# A row `| a | b | c | d | e | f |` splits on `|` into exactly 8 awk fields
# (two empty sentinels at the ends). `NF == 8` is stricter than v1's `NF >= 6`:
# it excludes the two-column "Simulator container image" table and the
# five-column column-rules table STRUCTURALLY, instead of relying on one of
# their cells happening to look wrong.
rows="$(
  awk -F'|' '
    /^\|/ && NF == 8 {
      for (i = 2; i <= 7; i++) {
        gsub(/`/, "", $i)
        gsub(/^[ \t]+|[ \t]+$/, "", $i)
      }
      if ($2 == "" || $2 == "path" || $2 ~ /^-+$/) next
      printf "%s\t%s\t%s\t%s\t%s\t%s\n", $2, $3, $4, $5, $6, $7
    }
  ' "$manifest"
)"

if [ -z "$rows" ]; then
  echo "FAIL: $manifest lists no file at all — the inventory table was emptied or its format changed." >&2
  exit 1
fi

verbatim_count=0
patched_rows=""

while IFS=$'\t' read -r path origin up_src up_sha loc_sha patch_rel; do
  [ -n "$path" ] || continue
  local_path="$vendor_dir/$path"

  # A1 — the origin vocabulary is closed. An origin outside the set is checked
  # by nothing: the row exists but pins no property.
  case "$origin" in
    upstream-verbatim | upstream-patched | local-upstreamable | local-private) ;;
    *)
      echo "FAIL[$path]: unknown origin '$origin' in $manifest." >&2
      echo "  → one of: upstream-verbatim, upstream-patched, local-upstreamable, local-private." >&2
      status=1
      continue
      ;;
  esac

  # A manifest row pointing at nothing is worse than no row: every check below
  # would have nothing to compare and would pass vacuously.
  if [ ! -f "$local_path" ]; then
    echo "FAIL[$path]: listed in $manifest as '$origin' but $local_path does not exist." >&2
    echo "  → restore the file, or remove its row from $manifest if it was dropped on purpose." >&2
    status=1
    continue
  fi

  # A2 — local rows pin nothing. Pinning a file under active development makes
  # re-pinning a reflex, and a reflex re-pin is how a spec digest gets bumped
  # without anyone reading the diff. Keep the pins rare so they stay loud.
  if [ "$origin" = "local-upstreamable" ] || [ "$origin" = "local-private" ]; then
    for cell in "$up_src" "$up_sha" "$loc_sha" "$patch_rel"; do
      if ! is_empty_cell "$cell"; then
        echo "FAIL[$path]: a '$origin' row must leave upstream path, both digests and patch empty ('—')." >&2
        echo "  → this file has no upstream original, so there is nothing to pin it against." >&2
        status=1
        break
      fi
    done
    continue
  fi

  # From here on the row claims an upstream original.
  if is_empty_cell "$up_src"; then
    echo "FAIL[$path]: an '$origin' row must name the upstream path it came from." >&2
    echo "  → Apache-2.0 §4(b) requires naming the file that was copied or modified." >&2
    status=1
    continue
  fi

  # A3 — both digest columns really are digests.
  digests_ok=1
  for pair in "upstream:$up_sha" "local:$loc_sha"; do
    if ! printf '%s' "${pair#*:}" | grep -Eq '^[0-9a-f]{64}$'; then
      echo "FAIL[$path]: the ${pair%%:*} sha256 column is not a digest ('${pair#*:}')." >&2
      status=1
      digests_ok=0
    fi
  done
  [ "$digests_ok" -eq 1 ] || continue

  # A4 — the local digest matches the bytes on disk. v1's only real check, now
  # applied to modified files too: an edit to a patched file used to be
  # invisible because "not pinned" was its whole record.
  actual_sha="$(sha256_of "$local_path")"
  if [ "$actual_sha" != "$loc_sha" ]; then
    echo "FAIL[$path]: the vendored copy drifted from the local digest pinned in $manifest." >&2
    echo "  expected $loc_sha" >&2
    echo "  actual   $actual_sha" >&2
    echo "  This file is the reference the campaign is judged against — hand-editing it makes the" >&2
    echo "  verdict lie in the reassuring direction." >&2
    echo "  → revert (git diff -- $local_path), or, if the edit is deliberate, regenerate the patch" >&2
    echo "    AND both digests as described in $manifest's refresh procedure." >&2
    status=1
    continue
  fi

  if [ "$origin" = "upstream-verbatim" ]; then
    verbatim_count=$((verbatim_count + 1))

    # A5 — verbatim means verbatim. A modified file labelled verbatim is the
    # exact confusion v1 could not detect.
    if [ "$up_sha" != "$loc_sha" ]; then
      echo "FAIL[$path]: marked 'upstream-verbatim' but the upstream and local digests differ." >&2
      echo "  → either the file was hand-edited (revert it), or it is genuinely modified:" >&2
      echo "    mark it 'upstream-patched' and ship a patch." >&2
      status=1
    fi

    # A5b — and carries no patch. A patch on an unmodified file describes
    # nothing, and would silently pass A7 as a no-op diff.
    if ! is_empty_cell "$patch_rel"; then
      echo "FAIL[$path]: an 'upstream-verbatim' row must not reference a patch." >&2
      status=1
    fi
    continue
  fi

  # --- origin = upstream-patched -------------------------------------------
  patched_rows="$patched_rows$path"$'\n'

  # A6 — patched means a real, present, non-empty patch.
  if [ "$up_sha" = "$loc_sha" ]; then
    echo "FAIL[$path]: marked 'upstream-patched' but both digests are identical — nothing was changed." >&2
    echo "  → mark it 'upstream-verbatim' and delete the patch." >&2
    status=1
    continue
  fi
  if is_empty_cell "$patch_rel"; then
    echo "FAIL[$path]: marked 'upstream-patched' but records no patch." >&2
    echo "  → Apache-2.0 §4(b) requires stating what changed; an unrecorded modification does not." >&2
    status=1
    continue
  fi
  if [ ! -s "$vendor_dir/$patch_rel" ]; then
    echo "FAIL[$path]: $vendor_dir/$patch_rel is missing or empty." >&2
    status=1
    continue
  fi

  # A7 — the patch actually relates the two pinned digests. This is the
  # assertion v1 could never make. Without it patches/ is a document: it can
  # rot, be trimmed by a whitespace hook (already observed on all four patches,
  # see .pre-commit-config.yaml), or describe an edit other than the one
  # shipped — while still looking like a satisfied §4(b) obligation.
  #
  # Side benefit: with this green, patches/ is a MECHANICALLY APPLICABLE
  # contribution, not a description of one. The licence obligation and the
  # upstream PR become the same object, so neither can rot without the other
  # failing loudly.
  reconstructed="$(mktemp)"
  if ! patch -R -s -t -o "$reconstructed" "$local_path" "$vendor_dir/$patch_rel" 2>/dev/null; then
    echo "FAIL[$path]: $patch_rel does not apply in reverse to the local file." >&2
    echo "  → the file moved on without its patch. Regenerate:" >&2
    echo "      diff -u /tmp/ocpp-upstream/$up_src $local_path > $vendor_dir/$patch_rel" >&2
    status=1
  else
    reconstructed_sha="$(sha256_of "$reconstructed")"
    if [ "$reconstructed_sha" != "$up_sha" ]; then
      echo "FAIL[$path]: reversing $patch_rel yields $reconstructed_sha," >&2
      echo "  but $manifest pins the upstream bytes at $up_sha." >&2
      echo "  → the patch and the upstream digest describe two different files; one of them is stale." >&2
      status=1
    fi
  fi
  rm -f "$reconstructed"
done <<<"$rows"

# A11 — with patched rows now digest-pinned too, relabelling everything
# `upstream-patched` is the cheap way to stop having to think about upstream.
# This guard makes that a deliberate, visible act rather than a drift.
if [ "$verbatim_count" -eq 0 ]; then
  echo "FAIL: $manifest marks no file as 'upstream-verbatim' — the upstream pins were removed." >&2
  status=1
fi

# A8 — reverse direction, patches: an orphan patch documents a modification to
# a file nobody tracks.
if [ -d "$vendor_dir/patches" ]; then
  while IFS= read -r p; do
    rel="${p#"$vendor_dir/"}"
    if ! grep -Fq "\`$rel\`" "$manifest"; then
      echo "FAIL[$rel]: a patch with no 'upstream-patched' row in $manifest." >&2
      echo "  → add the row, or delete the patch." >&2
      status=1
    fi
  done < <(find "$vendor_dir/patches" -type f -name '*.patch' | sort)
fi

# A9 — reverse direction, files. v1 only swept runner/specs/; that was enough
# while everything else was hand-listed, but an unlisted file is an
# unattributed, unlicensed, untracked file wherever it sits.
while IFS= read -r f; do
  rel="${f#"$vendor_dir/"}"
  if ! grep -Fq "\`$rel\`" "$manifest"; then
    echo "FAIL[$rel]: present under the harness but absent from $manifest." >&2
    echo "  → add a row (origin, provenance, digests), or delete the file." >&2
    status=1
  fi
done < <(find "$vendor_dir/tck" "$vendor_dir/drivers" -type f \
  \( -name '*.ts' -o -name '*.json' -o -name '*.txt' \) | sort)

# A10 — NOTICE and VENDOR.md cannot disagree. Its "Files modified relative to
# upstream" list and the set of `upstream-patched` rows are two statements of
# the same fact. They disagreed on tsconfig.json (verbatim in the manifest,
# ADAPTED in NOTICE) for the whole life of v1, and nothing could tell which was
# right. Apache-2.0 §4(b) is satisfied by the NOTICE a recipient reads, not by
# the manifest a maintainer reads: if they differ, at least one is lying to
# someone.
notice="$vendor_dir/NOTICE"
if [ ! -f "$notice" ]; then
  echo "FAIL: $notice is missing — Apache-2.0 §4(b) attribution has no home." >&2
  status=1
else
  manifest_patched="$(printf '%s' "$patched_rows" | grep -v '^$' | sort || true)"
  notice_patched="$(
    awk '/^Files modified relative to upstream/,/^Apache-2.0 obligations/' "$notice" |
      grep -oE '^  [A-Za-z0-9_./-]+' | tr -d ' ' | sort -u || true
  )"
  if [ "$manifest_patched" != "$notice_patched" ]; then
    echo "FAIL: $notice's modified-file list and $manifest's 'upstream-patched' rows disagree." >&2
    echo "  (< NOTICE, > VENDOR.md)" >&2
    diff <(printf '%s\n' "$notice_patched") <(printf '%s\n' "$manifest_patched") >&2 || true
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  patched_count="$(printf '%s' "$patched_rows" | grep -cv '^$' || true)"
  echo "Vendored files match $manifest ($verbatim_count verbatim, $patched_count patched and reverse-verified)."
fi
exit "$status"
