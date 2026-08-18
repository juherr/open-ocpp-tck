#!/usr/bin/env bash
# trace-format/ must not depend on anything in this repository.
#
# THE PROPERTY: every import and re-export specifier under trace-format/ is
# either relative-and-inward (`./x`) or a Node built-in (`node:x`). A specifier
# that climbs out (`../x`) ties the library to this repository; a bare one
# (`some-package`) gives it a runtime dependency.
#
# WHY IT IS A GUARD AND NOT A LINE IN THE README. That directory is destined
# for the open-ocpp-trace organisation, and the only reason it can go there is
# that it never grew a tie back here. The tie is one line: `import type { Frame }
# from "../tck/ocpp"` compiles, typechecks, passes every other guard here, and
# quietly turns a library into a TCK-internal module. Nobody finds out until
# the day someone tries to move it, which is the day it is most expensive to
# undo.
#
# The direction of the mistake is the natural one -- everything a contributor
# needs is one directory up, and the editor will autocomplete it. A convention
# loses that argument; a red build wins it.
#
# `export ... from` counts, and that is not pedantry: index.ts is nothing but
# re-exports, and a re-export reaches outside the directory exactly as an
# import does.
#
# WHAT THIS DOES NOT CHECK. Whether the library is CORRECT against the format
# is tools/trace-conformance.sh, which needs the network and the
# specification's fixtures; whether its rules hold is tests/trace-format.ts.
# This guard only watches the boundary, which is the one property neither of
# those can see.
#
# AND: a search that fails is not a search that found nothing. `git grep` exits
# 1 on no match and 128 on error, and collapsing the two would print the
# success line on a broken search.
#
# Offline: greps the working tree, nothing else.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

subtree="trace-format"

if [ ! -d "$subtree" ]; then
  printf 'FAIL: %s/ does not exist -- this guard has nothing to protect.\n' \
    "$subtree" >&2
  exit 1
fi

# `<file>:<line>:<from|import> "<specifier>"`, one per occurrence.
found=$(
  git grep -n --untracked -oE \
    "(from|import)[[:space:]]+[\"'][^\"']+[\"']" -- "$subtree"
)
status=$?
if [ "$status" -gt 1 ]; then
  printf 'FAIL: git grep failed (exit %d) -- the search is broken, not empty.\n' \
    "$status" >&2
  exit 1
fi

# Reshaped to `<specifier> <file>:<line>` so the allow-list can anchor at the
# start of the line: a specifier is the only thing a pattern should be able to
# match, and `node:` inside a path would otherwise be indistinguishable from
# `node:` as a package.
offenders=$(
  printf '%s\n' "$found" |
    sed -E 's/^([^:]+:[0-9]+):.*["'"'"']([^"'"'"']+)["'"'"'].*$/\2 \1/' |
    grep -vE '^(\./|node:)' |
    sort -u
)

if [ -n "$offenders" ]; then
  printf 'FAIL: %s/ reaches outside itself:\n\n' "$subtree" >&2
  printf '%s\n' "$offenders" | sed 's/^/  /' >&2
  cat >&2 <<'MSG'

trace-format/ is destined for the open-ocpp-trace organisation, and it can go
there only while it depends on nothing here. A specifier that climbs out of
the directory ties the library to this repository; a bare specifier adds a
runtime dependency to every consumer of it, browser ones included.

Either move what is needed INTO trace-format/ -- if it is really about the
format -- or leave it out of the library and do the work in tck/, which is
where this suite's own policy belongs. See trace-format/README.md.
MSG
  exit 1
fi

files=$(git grep -l --untracked "" -- "$subtree" | wc -l | tr -d ' ')
specifiers=$(printf '%s\n' "$found" | grep -c . || true)
printf '%s/: %s files, %s import specifiers, none outside itself or node: -- OK\n' \
  "$subtree" "$files" "$specifiers"
