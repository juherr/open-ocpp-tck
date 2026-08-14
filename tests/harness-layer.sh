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

# ONE PASS, and the exclusions declared once as pathspecs.
#
# The first shape ran `git grep -l` to list offenders and then re-grepped each
# one for its lines. Two greps that had to be kept in step by hand, and they
# were not: the inner one lost `--untracked`, so for exactly the case the flag
# exists for, the guard printed a filename with no lines under it.
#
# WHAT THE EXCLUSIONS MEAN. The property is DIRECTIONAL -- the generic layer
# must not depend on the harness layer -- so what is excluded is the harness
# layer itself, not two convenient paths. `CLAUDE.md` and anything under
# `.claude/` may cite it freely: a harness file referring to its own overlay is
# the layer talking to itself, which is the arrow this guard permits. Only the
# other direction is a defect. Without that, committing a `.claude/` skill that
# points at the overlay would turn the gate red with advice -- "move the rule
# into AGENTS.md" -- that is the exact inverse of the rule.
#
# This file is the third exclusion, and it necessarily contains the string it
# forbids, the same way generic-core.sh must name the CSMSes it bans. Hardcoded
# rather than derived from `$0`, which is whatever the caller typed: the failure
# mode of a stale path here is loud, because the guard reports ITSELF as an
# offender and names the path to fix.
#
# --untracked, because this is a pre-commit guard: a file that violates the rule
# and has not been `git add`ed yet is exactly the file its author is about to
# commit. Scanning only the index would go green on it and red one commit later,
# which is the shape of a guard people learn to run afterwards. It honours
# .gitignore, so node_modules and results/ stay out.
offenders=$(git grep --untracked -n -F "$harness_doc" -- . \
  ":(exclude)$harness_doc" \
  ":(exclude).claude/" \
  ":(exclude)tests/harness-layer.sh" || true)

if [ -n "$offenders" ]; then
  echo "FAIL: $harness_doc is cited from outside the harness layer." >&2
  echo >&2
  printf '%s\n' "$offenders" | sed 's/^/  /' >&2
  echo >&2
  echo "  → $harness_doc says AGENTS.md is the working loop and that nothing" >&2
  echo "    in it is harness-specific. A file citing $harness_doc points the" >&2
  echo "    generic half of the repository at the specific half, and sends a" >&2
  echo "    reader to a document that tells them it is not for them." >&2
  echo "  → move the rule into AGENTS.md and cite that; leave the pointer in" >&2
  echo "    $harness_doc, the way its re-pin bullet already does." >&2
  exit 1
fi

echo "Harness layering holds: $harness_doc is cited only from inside the harness layer."
