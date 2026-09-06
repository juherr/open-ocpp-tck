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
# v3 adds `upstream-forked` for the runner layer upstream ceded to this
# repository (shiv3/ocpp-cp-simulator#271): such a row keeps the upstream path
# and the fork-point digest, pins no local bytes and carries no patch. What is
# verified instead is the Apache-2.0 §4(b) notice itself — the file's first
# lines must name the upstream path and the FORK commit, in a JSDoc block so
# it reaches the published declarations — and NOTICE must list the file (A10).
# v3 also renames `local-upstreamable` to `local-native`: with the runner
# ceded, those files are this repository's own rather than queued for an
# upstream pull request.
#
# AND THE VENDORED ARTIFACTS THAT ARE NOT FILES (A14): the container images
# this repository pins by digest — the simulator, and one block per bundled
# CSMS stack — each recorded in a two-column table naming the file that
# declares it. The inventory parser below excludes every one of those tables
# structurally, so until A14 the pins that decide what a sweep actually runs
# against were compared to nothing.
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
forked_rows=""

# The FORK commit, for A12 — deliberately not `Pinned commit`. The pin is where
# the verbatim rows were last imported from and moves on every re-import; the
# fork commit is where the forked files stopped tracking upstream and never
# moves. Validating headers against the pin would mean a re-import of an
# unrelated verbatim file silently invalidated every forked file's §4(b)
# notice, or forced a rewrite of ten headers that describe an event that did
# not happen.
# shellcheck disable=SC2016  # \1 is a sed backreference, not a shell expansion.
fork="$(sed -n 's/^### Fork commit: `\([0-9a-f]\{40\}\)`.*/\1/p' "$manifest" | head -1)"
if [ -z "$fork" ]; then
  echo "FAIL: $manifest states no '### Fork commit: <sha>' heading — forked rows have no fork point to cite." >&2
  echo "  → this is a separate fact from 'Pinned commit'; see the fork section of $manifest." >&2
  exit 1
fi

while IFS=$'\t' read -r path origin up_src up_sha loc_sha patch_rel; do
  [ -n "$path" ] || continue
  local_path="$vendor_dir/$path"

  # A1 — the origin vocabulary is closed. An origin outside the set is checked
  # by nothing: the row exists but pins no property.
  case "$origin" in
    upstream-verbatim | upstream-patched | upstream-forked | local-native | local-private) ;;
    *)
      echo "FAIL[$path]: unknown origin '$origin' in $manifest." >&2
      echo "  → one of: upstream-verbatim, upstream-patched, upstream-forked, local-native, local-private." >&2
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
  if [ "$origin" = "local-native" ] || [ "$origin" = "local-private" ]; then
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

  # --- origin = upstream-forked --------------------------------------------
  # A12 — a forked file pins its provenance, not its bytes. The upstream digest
  # is the fork point and must be a digest; the local digest and the patch are
  # forbidden (there is no upstream original to diff against any more); and
  # the file's first three lines must carry the §4(b) notice naming the
  # upstream path and the pinned commit. NOTICE is cross-checked in A10.
  if [ "$origin" = "upstream-forked" ]; then
    forked_rows="$forked_rows$path"$'\n'
    # NOTE ON WHAT THIS DIGEST IS. For a patched row the digest is checkable
    # offline: reverse-applying the patch has to reproduce it. A forked row
    # has no patch, so nothing here can re-derive the fork-point bytes, and
    # this check is a FORMAT check. Correlating the digest with the pinned
    # commit needs upstream, which means the network -- so
    # `tools/vendor-diff.sh` does it, and this file stays deterministic and
    # offline. Both halves are stated in VENDOR.md so neither is mistaken for
    # the other.
    if ! printf '%s' "$up_sha" | grep -Eq '^[0-9a-f]{64}$'; then
      echo "FAIL[$path]: an 'upstream-forked' row must record the fork-point upstream sha256 ('$up_sha')." >&2
      status=1
      continue
    fi
    for cell in "$loc_sha" "$patch_rel"; do
      if ! is_empty_cell "$cell"; then
        echo "FAIL[$path]: an 'upstream-forked' row must leave the local digest and patch empty ('—')." >&2
        echo "  → the file is maintained here; nothing about its bytes is pinned." >&2
        status=1
        break
      fi
    done
    if ! head -3 "$local_path" | grep -Fq "Derived from shiv3/ocpp-cp-simulator $up_src"; then
      echo "FAIL[$path]: no 'Derived from shiv3/ocpp-cp-simulator $up_src' notice in the first three lines." >&2
      echo "  → Apache-2.0 §4(b): a forked file must say what it was forked from." >&2
      status=1
    elif ! head -3 "$local_path" | grep -Fq "@ $fork"; then
      echo "FAIL[$path]: the Derived-from notice does not cite the fork commit $fork." >&2
      echo "  → the header and $manifest's '### Fork commit' name different fork points; one is wrong." >&2
      status=1
    elif ! head -3 "$local_path" | grep -Eq 'Modified:[[:space:]]*[^[:space:]]'; then
      # Apache-2.0 §4(b) asks for a prominent notice stating that the file was
      # CHANGED, not merely where it came from. The patch used to carry that;
      # with patches/ gone this sentence is the only place it is stated, so a
      # header trimmed back to its provenance would satisfy every other check
      # here and drop the obligation.
      echo "FAIL[$path]: the notice says where the file came from but not what changed." >&2
      echo "  → add the 'Modified: …' clause. Apache-2.0 §4(b) wants the change" >&2
      echo "    stated, and since patches/ is gone this sentence is where it lives." >&2
      status=1
    fi

    # A13 — the notice has to survive into the PUBLISHED DECLARATIONS. These
    # files ship as a package and `types/**/*.d.ts` is what a consumer reads,
    # so that is where the check looks: tsc keeps a leading `/** */` block and
    # drops both `//` lines and ordinary `/* */` blocks, and a shape heuristic
    # here would pass the one it silently loses. Checking the artifact costs
    # nothing extra and cannot disagree with what is shipped.
    declaration="types/${path%.ts}.d.ts"
    if [ ! -f "$declaration" ]; then
      # Skipping when the file is absent would let a build-configuration
      # change stop emitting a declaration and take the published notice with
      # it, silently. Every forked file has one today.
      echo "FAIL[$path]: no published declaration at $declaration." >&2
      echo "  → run bun run build:types. If this file genuinely emits none, the" >&2
      echo "    §4(b) notice reaches no consumer of the package and this guard" >&2
      echo "    needs a decision rather than an exemption." >&2
      status=1
    else
      if ! grep -Fq "Derived from shiv3/ocpp-cp-simulator $up_src" "$declaration"; then
        echo "FAIL[$path]: the Derived-from notice is missing from $declaration." >&2
        echo "  → tsc keeps a leading /** */ block and drops // lines and plain" >&2
        echo "    /* */ blocks. Put the notice in the file's JSDoc header and run" >&2
        echo "    bun run build:types." >&2
        status=1
      elif ! grep -Fq "Modified:" "$declaration"; then
        echo "FAIL[$path]: $declaration carries the provenance but not the change." >&2
        echo "  → the 'Modified: …' clause has to reach the published declaration" >&2
        echo "    too; that is the copy a consumer of this package reads." >&2
        status=1
      fi
    fi
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
    # Naming the command, not the manual. This guard is where a deliberate edit
    # announces itself, so it is the one place that knows the reader is holding
    # a modified file right now -- and "as described in the refresh procedure"
    # sent them to the section for moving the PIN upstream, which is a
    # different job with a different order of steps.
    if [ "$origin" = "upstream-patched" ]; then
      echo "  → revert (git diff -- $local_path), or, if the edit is deliberate, re-pin the" >&2
      echo "    patch and the digest in one step:  tools/repin-vendored.sh $path" >&2
    else
      echo "  → revert (git diff -- $local_path). $origin means these bytes are upstream's;" >&2
      echo "    an edit here is also a change of origin, so the row in $manifest moves with it." >&2
    fi
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
  # An inventory ROW, not the path mentioned anywhere in the file. The looser
  # match was satisfiable by ordinary prose: drivers/steve/provision.ts shipped
  # with no row at all and passed this check because a paragraph elsewhere in
  # the manifest happened to name it. `| `path` |` is the row's own shape, and
  # -F keeps the path's dots and slashes literal.
  if ! grep -Fq "| \`$rel\` |" "$manifest"; then
    echo "FAIL[$rel]: present under the harness but has no row in $manifest." >&2
    echo "  → add a row (origin, provenance, digests), or delete the file." >&2
    echo "  → a mention in prose is not a row; the table column must contain it." >&2
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
  manifest_patched="$(printf '%s%s' "$patched_rows" "$forked_rows" | grep -v '^$' | sort || true)"
  notice_patched="$(
    awk '/^Files modified relative to upstream/,/^Apache-2.0 obligations/' "$notice" |
      grep -oE '^  [A-Za-z0-9_./-]+' | tr -d ' ' | sort -u || true
  )"
  if [ "$manifest_patched" != "$notice_patched" ]; then
    echo "FAIL: $notice's modified-file list and $manifest's 'upstream-patched' + 'upstream-forked' rows disagree." >&2
    echo "  (< NOTICE, > VENDOR.md)" >&2
    diff <(printf '%s\n' "$notice_patched") <(printf '%s\n' "$manifest_patched") >&2 || true
    status=1
  fi
fi

# A14 — every container image this repository pins, against the file that
# declares it.
#
# WHY IT IS HERE AND NOT IN A GUARD OF ITS OWN. It is the same claim every
# assertion above makes -- that what this repository ships is what the manifest
# says it ships -- for the vendored artifacts that are not files in the tree.
# A digest is the whole reproducibility claim of a conformance run: change one
# and every sweep afterwards measures a different CSMS, or a different charge
# point, and says nothing about the bytes the last one tested.
#
# WHY IT WAS MISSING FOR AS LONG AS IT WAS, and this is the part worth writing
# down, because it is a CLASS and not an instance. The inventory parser above
# filters `NF == 8`, and its comment says the strictness is deliberate: it
# excludes the two-column image tables STRUCTURALLY rather than by hoping one
# of their cells looks wrong. That is right for reading the inventory and it is
# exactly what left every image pin in this file compared to nothing -- the
# simulator's, and one block per bundled CSMS stack. A9 sees `tck/sim.ts` and
# the compose files have rows; A4 sees the bytes of the ones it pins match
# their digests; nothing ever opens the image string inside them. Moving a pin
# in one place and not the other was invisible, and has been done by hand:
# the CitrineOS stack moved from `v2.0.0-beta1` to `v2.0.0-beta3` with the
# manifest updated by hand precisely because no check would have said so.
#
# SO IT IS DRIVEN OFF THE MANIFEST'S OWN `declared in` FIELD rather than off a
# list of the three blocks that exist today. A fourth pin block -- a second
# simulator, a third CSMS stack -- is covered the moment it is written, without
# editing this file. What it compares, per block:
#
#   - the set of `image@digest` pairs is the same on both sides. Both
#     directions: a pin recorded and not declared is a manifest describing a
#     run nobody performs, and a pin declared and not recorded is a container
#     this suite starts and the manifest does not name.
#   - where the declaration also carries a TAG -- compose files do,
#     `DEFAULT_SIM_IMAGE` does not -- it matches the block's `tag resolved`.
#     A digest that agrees under a tag that does not is the shape of a copied
#     row, and it is the half a reader reproduces the resolution from.
#
# WHAT IT CANNOT CHECK: that a digest names an image that exists, or that it is
# what the tag resolves to today. That is a registry lookup, so it belongs with
# `tools/vendor-diff.sh` and the rest of the network side; this file stays
# deterministic and offline.
work14="$(mktemp -d)" || {
  echo "FAIL: could not create a temp dir for the image-pin comparison." >&2
  exit 1
}
trap 'rm -rf "$work14"' EXIT

# Every two-column `| field | value |` table, as `<block>\t<KIND>\t<value>`.
# A block is one contiguous run of such rows: prose, a heading, a new `field`
# header, or one of the six-column inventory rows all end it, which is what
# stops two neighbouring pin tables from being read as one.
awk -F'|' '
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  function strip(s) { gsub(/`/, "", s); return trim(s) }
  /^\|/ && NF == 4 {
    field = strip($2)
    if (field == "field") { inblock = 0; next }
    if (field ~ /^-+$/) next
    if (!inblock) { inblock = 1; block++ }
    if (field == "image")             printf "%d\tIMAGE\t%s\n",  block, strip($3)
    else if (field == "tag resolved") printf "%d\tTAG\t%s\n",    block, strip($3)
    else if (field == "digest")       printf "%d\tDIGEST\t%s\n", block, strip($3)
    else if (field == "declared in")
      # The FIRST backticked token. The cell carries prose too, and for the
      # simulator also the constant name and the override variable.
      printf "%d\tFILE\t%s\n", block,
        (match($3, /`[^`]+`/) ? substr($3, RSTART + 1, RLENGTH - 2) : "")
    next
  }
  { inblock = 0 }
' "$manifest" > "$work14/rows"

# READING NOTHING IS NOT AGREEING ABOUT NOTHING. Both halves of this check are
# patterns over a shape somebody may rename, and an empty set agrees with an
# empty set -- the failure this repository has already had one level up, in
# tests/gate-parity.sh. The count is taken from the raw text so that a
# `declared in` row this parser fails to attribute to a block is reported
# rather than skipped: a pin block silently dropped is the one outcome that
# looks exactly like a repository with fewer pins.
declared_in_rows="$(grep -c '^| declared in |' "$manifest" || true)"
attributed_files="$(awk -F'\t' '$2 == "FILE" && $3 != ""' "$work14/rows" | wc -l | tr -d ' ')"
if [ "$declared_in_rows" -eq 0 ]; then
  echo "FAIL: $manifest declares no image pin at all ('| declared in |')." >&2
  echo "  → either every pinned image was removed, or the two-column pin" >&2
  echo "    tables changed shape. The inventory parser excludes them on" >&2
  echo "    purpose, so nothing else in this file would notice." >&2
  status=1
elif [ "$attributed_files" != "$declared_in_rows" ]; then
  echo "FAIL: $manifest has $declared_in_rows 'declared in' row(s) but this check attributed $attributed_files to a pin table." >&2
  echo "  → a pin block changed shape under this parser and was skipped." >&2
  echo "    A skipped block is a pin compared to nothing, which is the state" >&2
  echo "    this assertion exists to end." >&2
  status=1
else
  while IFS=$'\t' read -r block declaring; do
    [ -n "$block" ] || continue
    if [ ! -f "$declaring" ]; then
      echo "FAIL: $manifest says a pin block is declared in $declaring, which does not exist." >&2
      status=1
      continue
    fi

    # The block's own rows, as `<image>@<digest>\t<tag resolved>`. An IMAGE row
    # opens a triple and a DIGEST row closes it, so a block that pairs three
    # images with two digests loses one silently -- counted below rather than
    # trusted.
    awk -F'\t' -v b="$block" '
      $1 != b { next }
      $2 == "IMAGE"  { img = $3; tag = ""; images++; next }
      $2 == "TAG"    { tag = $3; next }
      $2 == "DIGEST" { digests++; if (img != "") { printf "%s@%s\t%s\n", img, $3, tag; img = "" } }
      END { printf "%d %d\n", images + 0, digests + 0 > "/dev/stderr" }
    ' "$work14/rows" 2> "$work14/counts" | sort > "$work14/from-manifest"
    read -r n_images n_digests < "$work14/counts"
    if [ "$n_images" -ne "$n_digests" ] || [ "$n_images" -eq 0 ]; then
      echo "FAIL: the pin block for $declaring pairs $n_images image row(s) with $n_digests digest row(s)." >&2
      echo "  → one 'image' row, one 'tag resolved' row and one 'digest' row" >&2
      echo "    per image, in that order. An unpaired row is a pin that reads" >&2
      echo "    like a record and is compared to nothing." >&2
      status=1
      continue
    fi

    # And what the file actually declares. One regex for both shapes a
    # declaration takes here -- a compose `image:` value and a digest-pinned
    # constant -- because the property is about the string, not about the
    # syntax around it.
    #
    # `|| true` IS LOAD-BEARING, not defensive noise: this file runs under
    # `set -e` with `pipefail`, so a grep that matches nothing would abort the
    # whole script with no message at all -- and "no digest-pinned image in the
    # declaring file" is precisely the state the refusal below exists to
    # report. Measured, not supposed: the first draft did exactly that, and the
    # mutation that removed the digest from `tck/sim.ts` came back as a silent
    # exit 1.
    { grep -oE '[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}' \
      "$declaring" 2>/dev/null || true; } |
      awk -F'@' '{
        name = $1; tag = ""
        if (match(name, /:[^:\/]+$/)) { tag = substr(name, RSTART + 1); name = substr(name, 1, RSTART - 1) }
        printf "%s@%s\t%s\n", name, $2, tag
      }' | sort > "$work14/from-file"

    if [ ! -s "$work14/from-file" ]; then
      echo "FAIL: $declaring declares no digest-pinned image." >&2
      echo "  → repository convention: never 'latest', never a bare tag. If" >&2
      echo "    the declaration moved or changed shape, teach this check the" >&2
      echo "    new one rather than leaving $manifest's block uncompared." >&2
      status=1
      continue
    fi

    cut -f1 "$work14/from-manifest" > "$work14/keys-manifest"
    cut -f1 "$work14/from-file" > "$work14/keys-file"

    if undeclared="$(comm -23 "$work14/keys-manifest" "$work14/keys-file")" && [ -n "$undeclared" ]; then
      echo "FAIL: $manifest pins images $declaring does not declare:" >&2
      awk '{ print "  " $0 }' <<< "$undeclared" >&2
      echo "  → the manifest records a run nobody performs. Move the pin in" >&2
      echo "    both places, or drop the row." >&2
      status=1
    fi
    if unrecorded="$(comm -13 "$work14/keys-manifest" "$work14/keys-file")" && [ -n "$unrecorded" ]; then
      echo "FAIL: $declaring declares images $manifest does not record:" >&2
      awk '{ print "  " $0 }' <<< "$unrecorded" >&2
      echo "  → this suite starts a container the manifest cannot name, so a" >&2
      echo "    reader cannot reproduce what was measured." >&2
      status=1
    fi

    # The tag, for the declarations that carry one. Joined on the pair the two
    # sides already agree about, so a tag disagreement is reported once and as
    # itself rather than as a second image mismatch.
    if tag_drift="$(join -t$'\t' "$work14/from-manifest" "$work14/from-file" |
      awk -F'\t' '$3 != "" && $2 != $3 { printf "  %s: %s recorded, %s declared\n", $1, $2, $3 }')" \
      && [ -n "$tag_drift" ]; then
      echo "FAIL: $declaring and $manifest agree on a digest under different tags:" >&2
      printf '%s\n' "$tag_drift" >&2
      echo "  → 'tag resolved' is how a reader re-resolves the digest. A tag" >&2
      echo "    that no longer names these bytes makes the record unusable" >&2
      echo "    while every digest still matches." >&2
      status=1
    fi
  done < <(awk -F'\t' '$2 == "FILE" && $3 != "" { print $1 "\t" $3 }' "$work14/rows")
fi

if [ "$status" -eq 0 ]; then
  patched_count="$(printf '%s' "$patched_rows" | grep -cv '^$' || true)"
  forked_count="$(printf '%s' "$forked_rows" | grep -cv '^$' || true)"
  pinned_images="$(awk -F'\t' '$2 == "IMAGE"' "$work14/rows" | wc -l | tr -d ' ')"
  echo "Vendored files match $manifest ($verbatim_count verbatim, $patched_count patched and reverse-verified, $forked_count forked with attribution headers), and $pinned_images container image(s) across $attributed_files declaring file(s) carry the same digest in both."
fi
exit "$status"
