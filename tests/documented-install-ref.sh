#!/usr/bin/env bash
# The install command the documentation gives installs the contract it documents.
#
# THE PROPERTY, in four parts:
#   1. every tracked `*.md` citing a `github:<owner>/<repo>#<ref>` install
#      command names THIS repository -- the slug read from package.json's
#      `repository.url`, not spelled here -- and at least one page does;
#   2. they all cite the SAME ref;
#   3. that ref is a TAG THAT EXISTS in this repository;
#   4. `tck/driver.ts` at that tag is identical, byte for byte, to the one in
#      the tree.
#
# WHY IT IS A GUARD AND NOT PROOFREADING. Both documented install commands were
# broken at once, and had been for a hundred-odd commits. One was obvious in
# hindsight -- `bun add open-ocpp-tck` 404s, the package is not on npm -- and
# the other is the one this guard exists for: `#v0.1.0` RESOLVED. It cloned, it
# installed, and then CONTRIBUTING.md went on to document a driver contract
# that release does not have -- `scope: (env) => ...` against a `readonly
# scope?: ScopeTable`, an "Expected failures" section for an `expectedFailures`
# that does not exist, driverScope() / driverCapabilities() /
# driverExpectedFailures() absent entirely.
#
# A 404 is a bad five minutes. A stale tag is a working installation of the
# wrong contract, and the reader debugs their own driver against a document
# that was describing a different package the whole time. Nothing goes red;
# that is why it lasted.
#
# PART 4 IS THE ONE THAT DOES THE WORK. Parts 1 to 3 catch a typo. Part 4 goes
# red the second the driver contract moves without a new tag -- which is not a
# hypothetical, it is precisely how the rot above happened, and the only signal
# that arrives at the moment the documentation stops being true rather than
# whenever somebody next reads it.
#
# THE PRICE, stated so it is a decision and not a surprise. After a change to
# `tck/driver.ts`, this guard is red -- on the branch, and on `main` after the
# merge -- until the release is cut and both pages cite the new tag. That is
# the release procedure it enforces, and the red is the reminder: merge, tag,
# repoint. Making the guard tolerate the gap would delete the property.
#
# WHY `tck/driver.ts` ALONE, and not everything behind package.json's
# `exports`. It is the file that carries `scope`, `capabilities` and
# `expectedFailures` -- the shape CONTRIBUTING.md actually shows the reader and
# asks them to implement. The rest of the surface can move without the
# documentation lying. This is a CHOICE, not an oversight: widening it to the
# whole export surface would turn every internal change into a release blocker,
# for a document that never described those files.
#
# WHY THE REF IS EXTRACTED AND NEVER SPELLED HERE. A guard that repeats the
# constant it checks verifies nothing but its own copy. The same reasoning
# covers the repository slug, which is read from the manifest -- and note the
# slug is now something this guard CHECKS, not merely something it filters by.
# Filtering by it was the first shape, and it made the one page that named a
# different repository the one page the guard could not see.
#
# CONSIDERED AND LEFT OUT: a further part forbidding an npm-install form
# (`bun add open-ocpp-tck`), the other half of what was broken. README.md may
# legitimately DISCUSS npm -- the naive grep is a false positive waiting to
# happen -- and a fourth claim in this header is a fourth mutation to defend.
# Parts 1-4 already fail on the install line that matters.
#
# EXTRACTING NOTHING IS NOT AGREEING ON NOTHING, twice over: a documentation
# page that stops matching the pattern, and a repository with no tags at all,
# both look like "no disagreement found". Both fail here instead, by name.
#
# Offline: `git rev-parse` and `git show` read the local object database. This
# script fetches nothing, so CI must hand it a clone that already has the tags
# -- `fetch-depth: 0` AND `fetch-tags: true` on the `check` job's checkout, for
# the reason spelled out there. When they are absent this guard says so in as
# many words rather than reporting it as a missing release.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

manifest=package.json
contract=tck/driver.ts

for f in "$manifest" "$contract"; do
  [ -s "$f" ] || { echo "FAIL: $f is missing or empty." >&2; exit 1; }
done

# Before anything else, so that "no such tag" cannot be the message for "no
# such repository". The two failures need different fixes and this guard is
# only entitled to report the one it actually found.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FAIL: not a git repository, so no ref can be resolved." >&2
  echo "  → this guard compares the tree against a tag; without the object" >&2
  echo "    database it has nothing to compare against, and passing here" >&2
  echo "    would be a green light issued by a failed lookup." >&2
  exit 1
fi

# The slug, from the manifest rather than from this file. `repository.url` is
# the canonical spelling of where the documented command installs from.
slug=$(sed -n 's|.*"url": *"git+https://github.com/\([^"]*\)\.git".*|\1|p' \
  "$manifest" | head -1)
if [ -z "$slug" ]; then
  echo "FAIL: could not read repository.url from $manifest." >&2
  echo "  → the field moved or changed shape; teach this guard the new one." >&2
  echo "    Hardcoding the slug here instead would make every check below a" >&2
  echo "    claim about a repository nobody declared." >&2
  exit 1
fi

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

# ONE PASS over the documentation, and every check below reads its output: the
# slugs, the set of refs, and -- when either disagrees -- the file and line of
# each citation. Two greps kept in step by hand is how tests/harness-layer.sh
# once printed a filename with no lines under it.
#
# ANY owner/repo, not just this one. Matching `github:$slug#` would have made a
# page citing a DIFFERENT repository invisible: it would not be collected, so
# it could not disagree with anything, and the remaining pages would agree with
# themselves. A rename that updates the manifest and one page out of two is the
# ordinary way to arrive there, and the result is a document sending readers to
# somebody else's repository under this one's name.
#
# Prose that spells the shape rather than an install command -- AGENTS.md's
# `github:<slug>#<ref>` -- does not match, because `<` is not in the character
# class. That is why the placeholders are angle-bracketed there.
#
# Tracked files only: `.context/` and other ignored scratch copies of these
# documents are not what anybody installs from.
git ls-files -z -- '*.md' \
  | xargs -0 grep -on "github:[A-Za-z0-9._-]\+/[A-Za-z0-9._-]\+#[A-Za-z0-9._/-]*" \
    > "$work/citations" 2>/dev/null

if [ ! -s "$work/citations" ]; then
  echo "FAIL: no tracked *.md cites 'github:<owner>/<repo>#<ref>'." >&2
  echo "  → either the documented install command was removed, or it was" >&2
  echo "    reworded past this pattern. Both leave this guard reading" >&2
  echo "    nothing, which is not the same as finding nothing wrong." >&2
  exit 1
fi

# ------------------------------------------------------------------ part 1
#
# The right repository, before the right ref. A citation of another repository
# has no business agreeing or disagreeing about a ref: whatever it points at,
# it is not this package.
if grep -vF ":github:$slug#" "$work/citations" > "$work/foreign" && [ -s "$work/foreign" ]; then
  echo "FAIL: the documentation cites an install command for another" >&2
  echo "      repository than '$slug'." >&2
  echo >&2
  sed 's/^/    /' "$work/foreign" >&2
  echo >&2
  echo "  → package.json's repository.url says this package lives at" >&2
  echo "    '$slug'. A page naming anything else installs a different" >&2
  echo "    package from the one the rest of the documentation describes --" >&2
  echo "    the same defect as a stale ref, one level up, and the usual way" >&2
  echo "    in is a rename that reached the manifest and some of the pages." >&2
  exit 1
fi

sed 's/.*#//' "$work/citations" | sort -u > "$work/refs"

# ------------------------------------------------------------------ part 2
if [ "$(wc -l < "$work/refs")" -ne 1 ]; then
  echo "FAIL: the documentation cites more than one install ref." >&2
  echo >&2
  sed 's/^/    /' "$work/citations" >&2
  echo >&2
  echo "  → one page was repointed and the other was not. Whichever is" >&2
  echo "    stale, a reader following it installs a different package from" >&2
  echo "    the one the rest of the documentation describes." >&2
  exit 1
fi

ref=$(cat "$work/refs")

# ------------------------------------------------------------------ part 3
if ! git rev-parse --verify --quiet "refs/tags/$ref^{commit}" >/dev/null; then
  echo "FAIL: the documented ref '$ref' is not a tag in this repository." >&2
  # WHICH of the two causes it is, rather than a pair of bullets leaving the
  # reader to guess. They need opposite fixes -- cut a release, or fix the
  # checkout -- and the clone itself knows the answer. Printing it is also
  # what makes CI self-verifying: a tagless clone says so in the log instead
  # of impersonating a missing release.
  tags=$(git tag -l | wc -l | tr -d ' ')
  if [ "$tags" -eq 0 ]; then
    echo "    This clone has NO tags at all." >&2
    echo "  → so this says nothing about the release. Fix the checkout:" >&2
    echo "    the check job sets fetch-depth: 0 and fetch-tags: true for" >&2
    echo "    exactly this, and a shallow tagless clone would otherwise" >&2
    echo "    make this guard red no matter what the documentation says." >&2
  else
    echo "    This clone has $tags tag(s): $(git tag -l | tr '\n' ' ')" >&2
    echo "  → the clone has tags and '$ref' is not among them, so the" >&2
    echo "    release has not been cut. Cut it: the documentation is" >&2
    echo "    already telling people to install a tag that does not exist." >&2
  fi
  echo "  → note a branch or a commit sha would not help: one moves, the" >&2
  echo "    other is not what anybody pins. The documented install ref has" >&2
  echo "    to be a tag." >&2
  exit 1
fi

# ------------------------------------------------------------------ part 4
if ! git show "refs/tags/$ref:$contract" > "$work/tagged" 2>"$work/show-err"; then
  echo "FAIL: $contract does not exist at tag '$ref'." >&2
  sed 's/^/    /' "$work/show-err" >&2
  echo "  → the documented release predates the file the documentation" >&2
  echo "    teaches people to implement." >&2
  exit 1
fi

if ! cmp -s "$work/tagged" "$contract"; then
  echo "FAIL: $contract has moved since tag '$ref'." >&2
  # A count and the command that shows the change, rather than the diff: the
  # tagged side lives in a temp directory, so printing it here would name a
  # path the reader cannot revisit -- and truncating a long diff to fit would
  # be a silent cap on the evidence.
  echo "    $(diff "$work/tagged" "$contract" | grep -c '^[<>]') differing lines." >&2
  echo "    see them with: git diff refs/tags/$ref -- $contract" >&2
  echo >&2
  echo "  → the driver contract in the tree is not the one 'bun add" >&2
  echo "    github:$slug#$ref' installs, so CONTRIBUTING.md documents a" >&2
  echo "    shape its own install command does not deliver. That is the" >&2
  echo "    failure this guard exists for, and it is not a false alarm:" >&2
  echo "    cut a new tag and repoint the pages at it." >&2
  exit 1
fi

echo "Documented install ref holds: $(wc -l < "$work/citations" | tr -d ' ')" \
     "citation(s) of '$ref', a tag whose $contract matches the tree."
