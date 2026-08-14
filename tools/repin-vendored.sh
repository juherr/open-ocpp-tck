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
# Usage: tools/repin-vendored.sh tck/main.ts [tck/sim.ts ...]
#
# IT TAKES SEVERAL PATHS, and that is not a convenience. The integrity check at
# the end is repository-wide, so re-pinning two edited files one command at a
# time fails on the first: it re-pins that file correctly and then reports the
# OTHER one as still drifted, which reads as a broken re-pin rather than as an
# unfinished one -- and chained with `&&`, the second command never runs. A
# change touching two vendored files, the ordinary shape of a runner change,
# hit exactly that. So every path is re-pinned, then the check runs once.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

if [ "$#" -eq 0 ]; then
  echo "Usage: tools/repin-vendored.sh <path>...   (e.g. tck/main.ts tck/sim.ts)" >&2
  exit 2
fi

manifest=VENDOR.md

# The pin, for a bootstrapped patch's attribution header. One line in the
# manifest owns it, so a patch can never cite a commit the manifest does not.
# Read once: it is a property of the manifest, not of any path.
# shellcheck disable=SC2016  # \1 is a sed backreference, not a shell expansion.
pin=$(sed -n 's/^Pinned commit: \*\*`\([0-9a-f]\{40\}\)`\*\*.*/\1/p' "$manifest" | head -1)
if [ -z "$pin" ]; then
  echo "repin: $manifest does not state a pinned commit." >&2
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

# One file, whole. `set -e` aborts the batch on the first failure, which does
# leave earlier paths re-pinned and later ones not -- and that is recoverable
# rather than tidy, for a reason worth writing down because it is the whole
# argument against staging the writes: REPIN_ONE IS IDEMPOTENT AGAINST HEAD. It
# reconstructs upstream from `git show HEAD:...`, never from the working tree,
# so re-running the same command line after fixing the cause reproduces exactly
# the same result on the paths already done. A two-phase commit -- validate all
# N, then write -- was considered and buys nothing that idempotence does not
# already give, at the price of splitting the function in half.
#
# A BOOTSTRAP IS THE EXCEPTION, and the header says why: it writes a patch that
# exists only in the working tree, so a second run over the same path reports
# it as uncommitted. Bootstrap one path, commit, then carry on.
repin_one() {
  local path=$1
  local row origin up_src up_sha loc_sha patch_rel reconstructed new_sha bootstrap
  [ -f "$path" ] || { echo "repin: $path does not exist." >&2; return 1; }

  # The row, as the guard reads it: `| path | origin | upstream path | up sha | local sha | patch |`
  row=$(awk -F'|' -v want="$path" '
    /^\|/ && NF == 8 {
      for (i = 2; i <= 7; i++) { gsub(/`/, "", $i); gsub(/^[ \t]+|[ \t]+$/, "", $i) }
      if ($2 == want) { printf "%s\t%s\t%s\t%s\t%s\n", $3, $4, $5, $6, $7 }
    }' "$manifest")

  if [ -z "$row" ]; then
    echo "repin: $manifest has no row for $path." >&2
    return 1
  fi

  IFS=$'\t' read -r origin up_src up_sha loc_sha patch_rel <<< "$row"

  case "$origin" in
    upstream-patched | upstream-verbatim) ;;
    *)
      echo "repin: $path is '$origin' — it pins nothing, so there is nothing to re-pin." >&2
      return 1
      ;;
  esac

  # HEAD's file, never the working tree: that is what is being re-pinned.
  git show "HEAD:$path" > "$work/head-local" 2>/dev/null ||
    { echo "repin: $path is not committed at HEAD; commit or stash first." >&2; return 1; }

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

    # Refuse to discard an uncommitted edit to the patch. Everything here is
    # reconstructed from HEAD, so a patch repaired by hand and not yet committed
    # is read as if the repair never happened and then overwritten -- silently,
    # and with a plausible-looking result. That is how a one-line-header fix got
    # undone thirty seconds after it was made, by the person who had just made
    # it and had just read the paragraph above explaining why HEAD is the source.
    #
    # AGAINST HEAD, not against the index. `git diff --quiet -- <path>` compares
    # the working tree to the INDEX, so the one edit it does not see is the one
    # that has been `git add`ed -- and `git add` is the step between repairing a
    # patch and committing it. The check would then pass on exactly the state it
    # exists to refuse, and the repair would be overwritten below. Naming HEAD
    # covers staged and unstaged with one command. No `2>/dev/null` either: it
    # turned a git that failed for some other reason into "nothing to report".
    if ! git diff --quiet HEAD -- "$patch_rel"; then
      echo "repin: $patch_rel has uncommitted changes, and this would discard them." >&2
      echo "  Everything here is reconstructed from HEAD, so the edit in your" >&2
      echo "  working tree is not read -- it is replaced." >&2
      echo "  → commit the patch first if the edit was deliberate," >&2
      echo "    or 'git restore --staged --worktree $patch_rel' if it was not" >&2
      echo "    -- plain 'git checkout --' restores from the index, which is" >&2
      echo "    where a staged edit already is." >&2
      return 1
    fi
    # HEAD's file + HEAD's patch, which the guard proved consistent when they
    # were committed.
    git show "HEAD:$patch_rel" > "$work/head-patch" 2>/dev/null ||
      { echo "repin: $patch_rel is not committed at HEAD." >&2; return 1; }

    if ! patch -R -s -t -o "$work/upstream" "$work/head-local" "$work/head-patch" 2>/dev/null; then
      echo "repin: HEAD's patch does not reverse-apply to HEAD's $path." >&2
      echo "  → re-pin from a clean HEAD, or repair the patch by hand." >&2
      return 1
    fi
  fi

  reconstructed=$(sha256_of "$work/upstream")
  if [ "$reconstructed" != "$up_sha" ]; then
    echo "repin: reconstructed upstream does not match the pinned digest." >&2
    echo "  expected $up_sha" >&2
    echo "  got      $reconstructed" >&2
    echo "  → HEAD is not the state VENDOR.md describes; nothing was written." >&2
    return 1
  fi

  # THE TWO BYTE-IDENTICAL CASES ARE NOT THE SAME EVENT, and they return
  # differently because `set -e` makes the return value decide whether the rest
  # of the batch runs.
  #
  # A verbatim file that is still verbatim is a NO-OP: the manifest already
  # describes it correctly and there is nothing to fix. Ending the batch on it
  # -- and skipping the repository-wide check at the end -- would reproduce the
  # failure this script's several-paths shape exists to remove, on the one row
  # where nothing is wrong. It says so and gets out of the way.
  #
  # A patched file that has drifted BACK to upstream is a defect: the row still
  # claims upstream-patched, the patch is now empty of meaning, and no
  # subsequent re-pin can repair either. Aborting is right, and re-running the
  # same command line after the row is fixed reproduces everything already done
  # -- see the note above repin_one on idempotence.
  #
  # AGGREGATING FAILURES AND CHECKING AT THE END was proposed and rejected for
  # that asymmetry: it turns a manifest this script cannot repair into one more
  # line of a summary, after N further writes have been made against it.
  new_sha=$(sha256_of "$path")
  if [ "$new_sha" = "$up_sha" ]; then
    if [ "$bootstrap" = 1 ]; then
      echo "repin: $path is byte-identical to upstream — it is already correctly" >&2
      echo "  marked 'upstream-verbatim'. Nothing to do." >&2
      return 0
    fi
    echo "repin: $path is now byte-identical to upstream." >&2
    echo "  → mark the row 'upstream-verbatim' and delete $patch_rel." >&2
    return 1
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
}

for target in "$@"; do
  repin_one "$target"
done

echo
bash tests/vendor-integrity.sh
