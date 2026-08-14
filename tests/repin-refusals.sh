#!/usr/bin/env bash
# tools/repin-vendored.sh refuses, and writes nothing when it refuses.
#
# THE PROPERTY, one case per refusal the script promises, plus the two ways it
# is allowed to continue:
#   1. a patch with an UNSTAGED edit -- reconstruction would overwrite it;
#   2. a patch with a STAGED edit -- same edit, and the case that slipped
#      through, because `git diff --quiet -- <path>` compares the working tree
#      to the index and a `git add` puts it on the other side of that compare;
#   3. a reconstructed upstream that does not match the pinned digest -- HEAD
#      is not the state the manifest describes;
#   4. a path with no row in the manifest;
#   5. a path that is not on disk at all;
#   and in every one of those, THE FILES ARE UNCHANGED. A refusal that has
#   already rewritten half the manifest is not a refusal.
#   6. a verbatim file that is still verbatim is a no-op: it says so, returns
#      success, and the rest of the batch runs;
#   7. an edited patched file is re-pinned -- patch and digest both, together.
#
# WHY THIS EXISTS. This is the only script in the repository that writes to
# VENDOR.md and patches/, it is the one with the most to lose when it is
# wrong, and until now it was the only one with no test at all. Both defects
# found in it were found by reading, and each cost a manual, carefully
# reversible experiment to demonstrate -- append to a patch, stage it, run,
# restore. That is not repeatable, and "I checked it by hand last time" is
# what the next reviewer inherits.
#
# HOW: a throwaway git repository in a temp dir, with a copy of the script.
# The script does `cd "$(dirname "$0")/.."`, so a copy at <fixture>/tools/
# operates on the fixture and can never touch this repository -- which is the
# only reason a test of a script that rewrites the manifest can be safe to
# run in the gate.
#
# WHAT IT CANNOT CHECK: the real VENDOR.md, the real patches, and the real
# integrity check -- the fixture stubs the last one, because what is under
# test here is which states the script refuses to write, not what
# tests/vendor-integrity.sh makes of the result. That guard has its own.
#
# Offline: git plumbing in a temp dir, no network, nothing outside it.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

script=tools/repin-vendored.sh
[ -f "$script" ] || { echo "FAIL: $script is missing." >&2; exit 1; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

repo_root=$(pwd)
fixture=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$fixture"' EXIT

status=0
pass() { echo "  ok   $1"; }
fail() { status=1; echo "  FAIL $1" >&2; }

# A pinned commit the manifest can cite. Forty hex characters is all the
# script's parser asks of it, and the fixture has no upstream to point at.
PIN=0123456789abcdef0123456789abcdef01234567

# Built once and restored between cases with `git reset --hard`, so each case
# starts from the same committed state and no case can be read as passing
# because a previous one left the tree in a helpful shape.
build_fixture() {
  (
    cd "$fixture" || exit 1
    git init -q .
    git config user.email tck@example.invalid
    git config user.name "TCK fixture"
    git config commit.gpgsign false

    mkdir -p tools tests patches/src src

    cp "$repo_root/$script" tools/repin-vendored.sh
    chmod +x tools/repin-vendored.sh

    # Stubbed: this guard is about which states the script refuses to write.
    printf '#!/usr/bin/env bash\necho "(fixture) integrity check stubbed"\n' \
      > tests/vendor-integrity.sh

    printf 'alpha\nbeta\ngamma\n' > "$fixture/upstream-patched-src"
    printf 'alpha\nBETA\ngamma\n' > src/patched.ts
    printf 'delta\nepsilon\n' > src/verbatim.ts

    {
      printf -- '--- a/upstream/patched.ts (upstream @ %s)\n' "$PIN"
      printf -- '+++ b/src/patched.ts\n'
      diff -u "$fixture/upstream-patched-src" src/patched.ts | tail -n +3
    } > patches/src/patched.ts.patch

    up_patched=$(sha256_of "$fixture/upstream-patched-src")
    loc_patched=$(sha256_of src/patched.ts)
    verbatim=$(sha256_of src/verbatim.ts)

    {
      echo "# Fixture manifest"
      echo
      echo "Pinned commit: **\`$PIN\`** (fixture)"
      echo
      echo '| path | origin | upstream path | upstream sha256 | local sha256 | patch |'
      echo '|---|---|---|---|---|---|'
      echo "| \`src/patched.ts\` | \`upstream-patched\` | \`upstream/patched.ts\` | \`$up_patched\` | \`$loc_patched\` | \`patches/src/patched.ts.patch\` |"
      echo "| \`src/verbatim.ts\` | \`upstream-verbatim\` | \`upstream/verbatim.ts\` | \`$verbatim\` | \`$verbatim\` | \`—\` |"
    } > VENDOR.md

    git add -A
    git commit -qm "fixture"
  ) || { echo "FAIL: could not build the fixture repository." >&2; exit 1; }
}

reset_fixture() {
  git -C "$fixture" reset -q --hard HEAD
  git -C "$fixture" clean -qfd
}

# A refusal has two halves, and the second one is why this takes a message.
#
# NOTHING WAS WRITTEN. Compared against HEAD rather than against a snapshot,
# so a script that wrote and then restored would still be caught by the
# patch's own guard, not by this one being generous about how it got back.
#
# AND REFUSED FOR THE STATED REASON. Asserting only that the exit code was
# non-zero is not enough, and this is not a hypothetical: deleting the
# manifest-row check left this guard GREEN, because an empty row falls through
# to `case "$origin"` and is refused as "it pins nothing" instead. Every
# refusal here is defended in depth by the next one down, so "it refused" is
# nearly free and says almost nothing. The message is the only thing that
# distinguishes the rule under test from the one behind it.
assert_refused() {
  local label=$1 expected=$2
  local ok=1
  if ! git -C "$fixture" diff --quiet HEAD -- VENDOR.md patches/; then
    ok=0
    fail "$label — REFUSED BUT WROTE:"
    git -C "$fixture" diff --stat HEAD -- VENDOR.md patches/ >&2
  fi
  if ! grep -qF "$expected" "$fixture/out"; then
    ok=0
    fail "$label — refused for a different reason; expected \"$expected\":"
    sed 's/^/    /' "$fixture/out" >&2
  fi
  if [ "$ok" -eq 1 ]; then
    pass "$label — refused for its own reason, wrote nothing"
  fi
}

run_repin() {
  ( cd "$fixture" && bash tools/repin-vendored.sh "$@" ) > "$fixture/out" 2>&1
}

build_fixture

echo "repin-vendored.sh refusals:"

# ---------------------------------------------------------------- 1
reset_fixture
printf '\n' >> "$fixture/patches/src/patched.ts.patch"
if run_repin src/patched.ts; then
  fail "an unstaged patch edit — accepted, and the edit is gone"
else
  git -C "$fixture" checkout -q -- patches/src/patched.ts.patch
  assert_refused "an unstaged patch edit" "has uncommitted changes"
fi

# ---------------------------------------------------------------- 2
#
# The regression: `git diff --quiet -- <path>` compares the working tree to
# the INDEX, so this case reads as clean unless HEAD is named. `git add` is
# the ordinary step between repairing a patch and committing it.
reset_fixture
printf '\n' >> "$fixture/patches/src/patched.ts.patch"
git -C "$fixture" add patches/src/patched.ts.patch
if run_repin src/patched.ts; then
  fail "a STAGED patch edit — accepted, and the edit is gone"
else
  git -C "$fixture" reset -q --hard HEAD
  assert_refused "a staged patch edit" "has uncommitted changes"
fi

# ---------------------------------------------------------------- 3
reset_fixture
perl -pi -e 's/\| `[0-9a-f]{64}` \| `([0-9a-f]{64})` \| `patches/| `0000000000000000000000000000000000000000000000000000000000000000` | `$1` | `patches/' \
  "$fixture/VENDOR.md"
git -C "$fixture" commit -qam "corrupt the pinned upstream digest"
if run_repin src/patched.ts; then
  fail "a reconstructed upstream that does not match the pin — accepted"
else
  assert_refused "a wrong pinned upstream digest" "reconstructed upstream does not match"
fi
reset_fixture
git -C "$fixture" reset -q --hard HEAD~1

# ---------------------------------------------------------------- 4
#
# THE FILE HAS TO EXIST, and finding that out is the reason every case above
# asserts a message. The first version of this case passed a path that was not
# on disk, so `[ -f "$path" ]` answered first and the case went green while
# testing a rule it does not name -- and stayed green when the manifest-row
# check was deleted outright. Two layers deep, in a guard written by someone
# who had just read the paragraph about exactly this.
reset_fixture
printf 'unlisted\n' > "$fixture/src/unlisted.ts"
if run_repin src/unlisted.ts; then
  fail "a path with no manifest row — accepted"
else
  assert_refused "a path with no manifest row" "has no row for"
fi

# ---------------------------------------------------------------- 5
reset_fixture
if run_repin src/absent.ts; then
  fail "a path that is not on disk — accepted"
else
  assert_refused "a path that is not on disk" "does not exist"
fi

echo
echo "repin-vendored.sh continues:"

# ---------------------------------------------------------------- 6 and 7
#
# One run covers both: a no-op verbatim target FIRST, so that if it ended the
# batch the edited target behind it would go un-re-pinned -- which is exactly
# what it used to do.
#
# THE EDIT IS UNCOMMITTED, and that is the workflow rather than a shortcut:
# the script reconstructs upstream from HEAD's file and HEAD's patch, and
# diffs that against the WORKING TREE -- so the file, its patch and its digest
# are committed together, in one commit, after the re-pin. Committing the edit
# first is what the fixture did on the first attempt, and the script correctly
# refused: HEAD's patch no longer reverse-applied to HEAD's file.
reset_fixture
perl -pi -e 's/^BETA$/BETA BETA/' "$fixture/src/patched.ts"
before=$(sha256_of "$fixture/patches/src/patched.ts.patch")
if run_repin src/verbatim.ts src/patched.ts; then
  after=$(sha256_of "$fixture/patches/src/patched.ts.patch")
  if [ "$before" = "$after" ]; then
    fail "a no-op target then an edited one — exited 0 without re-pinning"
  elif grep -q "Nothing to do" "$fixture/out"; then
    new_sha=$(sha256_of "$fixture/src/patched.ts")
    if grep -qF "$new_sha" "$fixture/VENDOR.md"; then
      pass "a no-op target does not end the batch — the next path was re-pinned"
      pass "an edited patched file — patch and digest both updated"
    else
      fail "the patch was rewritten but the manifest digest was not"
    fi
  else
    fail "the verbatim no-op target was not reported"
  fi
else
  fail "a no-op target ended the batch, and the edited path behind it was lost"
  sed 's/^/    /' "$fixture/out" >&2
fi

echo
if [ "$status" -ne 0 ]; then
  echo "FAIL: $script accepted a state it promises to refuse, or wrote while" >&2
  echo "  refusing. It is the only script here that rewrites VENDOR.md and" >&2
  echo "  patches/; read the case above before touching anything else." >&2
  exit 1
fi
echo "repin-vendored.sh refuses what it promises to refuse, and writes nothing when it does."
