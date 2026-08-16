#!/usr/bin/env bash
# The install command the documentation gives installs the contract it documents.
#
# THE PROPERTY, in four parts:
#   1. every tracked `*.md` citing a `github:<owner>/<repo>#<ref>` install
#      command names THIS repository -- the slug read from package.json's
#      `repository.url`, not spelled here -- and at least one page does;
#   2. they all cite the SAME ref;
#   3. and then that ref is one of exactly two things --
#      CASE A, a TAG THAT EXISTS in this repository whose `tck/driver.ts` is
#      identical, byte for byte, to the one in the tree;
#   4. CASE B, a tag that does NOT exist yet, whose name is exactly `v<the
#      version package.json declares>`, that version being strictly greater
#      than every `vN.N.N` tag this clone has -- and it must have one. The
#      tree declaring, under its own name, the release that will carry it.
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
# CASE A'S BYTE COMPARISON IS THE ONE THAT DOES THE WORK. Parts 1 and 2 catch
# a typo. The comparison goes red the second the driver contract moves under a
# ref that is already released -- which is not a hypothetical, it is precisely
# how the rot above happened, and the only signal that arrives at the moment
# the documentation stops being true rather than whenever somebody next reads
# it.
#
# WHY CASE B EXISTS, and what it costs. The first shape of this guard had case
# A alone, and it demanded, at the moment it went red, an action that is
# IMPOSSIBLE from where the red appears: nobody can cut a tag from an unmerged
# branch. So the red did not address whoever triggered it. It addressed a
# future releaser, and broke everyone's build in the meantime -- `main`
# included, for as long as the release took. Measured on this repository: four
# commits out of a hundred and eighteen touched `tck/driver.ts`, which sounds
# survivable until you notice they arrive in bursts, three of them inside two
# days, each burst leaving `main` red for days. That is how "the red is normal
# here" gets established, and the other guards in the gate lose their signal
# with it.
#
# Case B does not delete that price, it SWAPS it, and the swap is the decision
# to disagree with. Between the merge and the tag, the documentation now names
# an install ref that DOES NOT RESOLVE; before, it named one that resolved to
# the wrong contract only after a release, and the tree was red instead. The
# trade is the one this guard's own history already argued: a 404 is a bad five
# minutes, a stale tag is a working installation of the wrong contract, found
# by a reader debugging their own driver. Case B keeps the second failure
# impossible and moves the first into a window that a release closes -- and
# even inside that window the tree is not silent, because it has to declare, in
# package.json, the release that will carry the change.
#
# WHAT MOVED, in the four situations that matter:
#
#   `tck/driver.ts` drifts, doc and manifest frozen ....... red   -> red
#   driver.ts changes, version and both pages bumped ...... red   -> GREEN
#   driver.ts changes, nothing bumped .................... red   -> red
#   doc repointed, manifest forgotten (or the reverse) ... GREEN  -> RED
#
# The first line is the property, and it does not move. The last is a gain:
# a manifest and a documentation page disagreeing about the next release was
# invisible here until case B had to read both.
#
# WHY CASE B INSISTS THE CLONE ALREADY HAS A TAG, which reads like belt and
# braces and is not. The naive spelling of case B -- "the ref equals
# v<version>, and that tag is missing" -- is SATISFIED BY A BROKEN CHECKOUT. A
# clone with no tags has every tag missing, so a tagless CI job would go green
# here and the byte comparison would never run again, silently, in the one
# place it is supposed to run on every commit. That is not hypothetical
# either: this repository shipped exactly that clone once, and the "NO tags at
# all" branch below is what made it visible. Ordering the declared version
# against the greatest tag the clone has needs a tag to exist, so the
# monotonicity rule and the tagless diagnostic are the same check, and neither
# can be dropped without the other.
#
# The rule also does what it says on the tin: a manifest accidentally moved
# BACKWARDS -- a bad merge, a revert that reached package.json -- would
# otherwise be a silent way out of case A, since the ref would agree with the
# manifest and the tag would be missing for the wrong reason.
#
# WHY THE ORDERING IS ARITHMETIC AND NOT `sort -V`. Two implementations run
# this file -- BSD sort on a contributor's mac, GNU sort on the ubuntu runner
# -- and they do agree on plain `vN.N.N`. But that agreement is a property of
# a program this repository never runs both of, asserted in a comment and
# checked nowhere, which is the exact shape the header above refuses for the
# repository slug. Three integers compared as one number depend on nothing.
# The cost is a narrower domain, and it is paid out loud: a version this
# guard CANNOT order -- `v0.3.0-rc1`, anything that is not three numbers --
# is refused by name rather than guessed at.
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
# covers the repository slug and the declared version, both read from the
# manifest -- and note the slug is now something this guard CHECKS, not merely
# something it filters by.
# Filtering by it was the first shape, and it made the one page that named a
# different repository the one page the guard could not see.
#
# CONSIDERED AND LEFT OUT: a further part forbidding an npm-install form
# (`bun add open-ocpp-tck`), the other half of what was broken. README.md may
# legitimately DISCUSS npm -- the naive grep is a false positive waiting to
# happen -- and one more claim in this header is one more mutation to defend.
# The parts above already fail on the install line that matters.
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

# `vMAJOR.MINOR.PATCH` as one comparable integer, or a refusal. Five digits per
# component is the domain this guard is willing to order; the multipliers below
# are what keeps the components from bleeding into each other, so they and the
# `{1,5}` have to move together.
version_key() {
  [[ $1 =~ ^v([0-9]{1,5})\.([0-9]{1,5})\.([0-9]{1,5})$ ]] || return 1
  printf '%d' "$((10#${BASH_REMATCH[1]} * 10000000000 +
                  10#${BASH_REMATCH[2]} * 100000 +
                  10#${BASH_REMATCH[3]}))"
}

# ------------------------------------------------------------------ part 3
#
# CASE A or CASE B, decided here and nowhere else. Case A is the released
# shape and gets the byte comparison below; case B is the window between a
# merge and the release that carries it, and every condition it adds exists to
# keep that window from being a hole.
if ! git rev-parse --verify --quiet "refs/tags/$ref^{commit}" >/dev/null; then
  # NOT A TAG YET -- so either the release is genuinely still ahead of the
  # tree (case B), or this clone cannot see the tags at all. The second is
  # settled FIRST, because case B's remaining conditions are all satisfiable
  # by a clone that has no tags to disagree with, and a broken checkout going
  # green here would retire the byte comparison in the one place it runs on
  # every commit.
  if [ "$(git tag -l | wc -l | tr -d ' ')" -eq 0 ]; then
    echo "FAIL: the documented ref '$ref' is not a tag, and this clone has" >&2
    echo "      NO tags at all." >&2
    echo "  → so this says nothing about the release. Fix the checkout:" >&2
    echo "    the check job sets fetch-depth: 0 and fetch-tags: true for" >&2
    echo "    exactly this, and a shallow tagless clone would otherwise" >&2
    echo "    make this guard answer a question it cannot see the answer to." >&2
    exit 1
  fi

  # The version the tree declares it will be published as. Read from the
  # manifest for the same reason as the slug, and read HERE rather than up
  # top: case A does not need it, and a guard that demands what it does not
  # use fails for reasons it cannot explain.
  version=$(sed -n 's|^  "version": *"\([^"]*\)".*|\1|p' "$manifest" | head -1)
  if [ -z "$version" ]; then
    echo "FAIL: the documented ref '$ref' is not a tag, and package.json's" >&2
    echo "      version could not be read to see whether it declares one." >&2
    echo "  → the field moved or changed shape; teach this guard the new one." >&2
    exit 1
  fi
  declared="v$version"

  if [ "$ref" != "$declared" ]; then
    echo "FAIL: the documented ref '$ref' is not a tag, and it is not the" >&2
    echo "      release package.json declares either." >&2
    echo >&2
    echo "    documentation cites: $ref" >&2
    echo "    package.json declares: $declared" >&2
    echo >&2
    sed 's/^/    /' "$work/citations" >&2
    echo >&2
    echo "  → an unreleased ref is only acceptable while the tree says, in" >&2
    echo "    its own manifest, which release will carry it. These two" >&2
    echo "    disagree, so one of them was updated and the other was not:" >&2
    echo "    bump the manifest, or repoint the pages, whichever is behind." >&2
    echo "  → note a branch or a commit sha would not help: one moves, the" >&2
    echo "    other is not what anybody pins. The documented install ref has" >&2
    echo "    to be a tag, released or about to be." >&2
    exit 1
  fi

  if ! ref_key=$(version_key "$ref"); then
    echo "FAIL: the documented ref '$ref' is not a tag, and this guard" >&2
    echo "      cannot order it against the ones that exist." >&2
    echo "  → it accepts vMAJOR.MINOR.PATCH and nothing else, so that" >&2
    echo "    'later than every release so far' is arithmetic rather than a" >&2
    echo "    guess about how some sort implementation ranks a suffix." >&2
    echo "  → cut and cite a three-number release, or teach this guard the" >&2
    echo "    ordering you want -- deliberately, with the mutation to match." >&2
    exit 1
  fi

  # The greatest release so far, over the tags this guard can order. Tags of
  # another shape are passed over rather than refused: they are somebody
  # else's convention and they are not what `v<version>` has to beat.
  latest=""
  latest_key=""
  while IFS= read -r tag; do
    key=$(version_key "$tag") || continue
    if [ -z "$latest_key" ] || [ "$key" -gt "$latest_key" ]; then
      latest_key=$key
      latest=$tag
    fi
  done < <(git tag -l)

  if [ -z "$latest" ]; then
    echo "FAIL: the documented ref '$ref' is not a tag, and no tag in this" >&2
    echo "      clone has a vMAJOR.MINOR.PATCH shape to compare it against." >&2
    echo "    This clone has: $(git tag -l | tr '\n' ' ')" >&2
    echo "  → an unreleased ref is accepted only when it is demonstrably" >&2
    echo "    AHEAD of what has been released, and there is nothing here to" >&2
    echo "    demonstrate it against. Check the checkout brought the tags." >&2
    exit 1
  fi

  if [ "$ref_key" -le "$latest_key" ]; then
    echo "FAIL: the documented ref '$ref' is not a tag, and it is not later" >&2
    echo "      than the last release, '$latest'." >&2
    echo >&2
    echo "  → package.json declares $declared while $latest is already cut," >&2
    echo "    so this is a manifest that moved backwards -- a bad merge, or" >&2
    echo "    a revert that reached it. Left alone it is a silent way out of" >&2
    echo "    the byte comparison: the ref agrees with the manifest and the" >&2
    echo "    tag is missing for the wrong reason." >&2
    exit 1
  fi

  echo "Documented install ref holds, unreleased: $(wc -l < "$work/citations" | tr -d ' ')" \
       "citation(s) of '$ref', the release package.json declares, ahead of '$latest'."
  echo "  Cutting that tag is what puts $contract back under the byte comparison."
  exit 0
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
  echo "    failure this guard exists for, and it is not a false alarm." >&2
  echo "  → and you can clear it from here, without cutting anything:" >&2
  echo "    bump package.json to the release that will carry this change" >&2
  echo "    and repoint both pages at it. That is case B, it goes green on" >&2
  echo "    a branch, and cutting the tag later returns it to this check" >&2
  echo "    with nothing else to change." >&2
  exit 1
fi

echo "Documented install ref holds: $(wc -l < "$work/citations" | tr -d ' ')" \
     "citation(s) of '$ref', a tag whose $contract matches the tree."
