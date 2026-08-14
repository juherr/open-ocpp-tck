#!/usr/bin/env bash
# The generic layer must not depend on the harness layer.
#
# THE PROPERTY: no file in this repository cites CLAUDE.md, except CLAUDE.md
# itself and this guard.
#
# CLAUDE.md declares the split in its own first paragraph -- "@AGENTS.md is the
# working loop for this repository ... nothing in it is Claude-specific. What
# follows is only what the Claude Code harness needs on top." That makes
# AGENTS.md, tools/ and tests/ the generic half: they must be readable, and
# followable, by somebody who never opens the harness file, and by a harness
# that is not this one.
#
# WHY IT IS A GUARD AND NOT A CONVENTION. The rule was broken within hours of
# being written down, by the author of the sentence: tools/mutate.sh cited
# CLAUDE.md three times as the source of the practice it implements. It was
# caught by an unrelated grep, not by anything systematic -- and the direction
# of the mistake is the natural one, because the harness file is where a
# practice tends to get written first. What makes it a defect rather than a
# style question is that it inverts a dependency the repository states: a
# reader following tools/ is sent to a file that says it is not for them.
#
# THE FIX IS ALWAYS THE SAME SHAPE: move the rule to AGENTS.md, where it is
# generic, and leave a pointer in CLAUDE.md. Its re-pin bullet already does
# exactly that.
#
# Offline: greps the working tree, nothing else.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

harness_doc="CLAUDE.md"
# This file necessarily contains the string it forbids, the same way
# generic-core.sh must name the CSMSes it bans. Excluded by path, not by a
# cleverer pattern: an exclusion a reader can check beats one they have to
# decode.
self="tests/harness-layer.sh"

# --untracked, because this is a pre-commit guard: a file that violates the
# rule and has not been `git add`ed yet is exactly the file its author is about
# to commit. Scanning only the index would go green on it and red one commit
# later, which is the shape of a guard people learn to run afterwards. It
# honours .gitignore, so node_modules and results/ stay out.
offenders=$(git grep --untracked -l -F "$harness_doc" -- . \
  | grep -v -x -F "$harness_doc" \
  | grep -v -x -F "$self" || true)

if [ -n "$offenders" ]; then
  echo "FAIL: $harness_doc is cited outside itself." >&2
  echo >&2
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    echo "  $file" >&2
    git grep -n -F "$harness_doc" -- "$file" | sed 's/^/      /' >&2
  done <<< "$offenders"
  echo >&2
  echo "  → $harness_doc says AGENTS.md is the working loop and that nothing" >&2
  echo "    in it is harness-specific. A file citing $harness_doc points the" >&2
  echo "    generic half of the repository at the specific half, and sends a" >&2
  echo "    reader to a document that tells them it is not for them." >&2
  echo "  → move the rule into AGENTS.md and cite that; leave the pointer in" >&2
  echo "    $harness_doc, the way its re-pin bullet already does." >&2
  exit 1
fi

echo "Harness layering holds: $harness_doc is cited only by itself."
