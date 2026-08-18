#!/usr/bin/env bash
# Does trace-format/ implement the format it claims to? NETWORK REQUIRED.
#
# Deliberately NOT part of `bun run verify` or `bun run test`: that gate stays
# offline and deterministic. This is its network counterpart, the same split as
# tools/vendor-diff.sh against tests/vendor-integrity.sh -- and, like that
# pair, the offline half cannot answer this question at all.
#
# WHY IT CANNOT BE OFFLINE. trace-format/validate.ts is a TRANSCRIPTION of
# `schema/trace-v1.schema.json`, hand-written so the library ships no validator
# dependency to its consumers. A transcription can drift from its source, and
# the source is not vendored here -- VENDOR.md is single-upstream by
# construction, one URL and one commit, and generalising it for a second
# upstream's 32 test files would cost more than it buys. So the schema is
# fetched, at a pinned ref, and the reader is run against the specification's
# own fixtures. `tests/trace-format.ts` guards the RULES; only this says they
# are the right rules.
#
# RUN IT after changing trace-format/validate.ts or consumer-view.ts. A green
# `bun run verify` does not cover them.
#
# Usage:
#   tools/trace-conformance.sh [<archive-dir>]
#
# With <archive-dir>, a directory of `*.jsonl` traces (optionally with the
# matching `*.log` beside each), the archived corpus runs too -- the check that
# real records still read clean and that the trace and the log agree frame for
# frame. To get one from CI, where this repository's sweeps leave them:
#
#   gh run download <run-id> --dir /tmp/tck-artifacts
#   tools/trace-conformance.sh "$(dirname "$(find /tmp/tck-artifacts -name '*.jsonl' | head -1)")"
set -eu

# Pinned, not `main`: this script's whole job is to compare against a known
# version of the document. Following main would turn an upstream edit into a
# red build here with nothing in the diff to explain it -- and, worse, a green
# one into a false negative the day the fixtures get easier. Bump it
# deliberately, in a commit that says what moved.
spec_url=https://github.com/open-ocpp-trace/specification
spec_ref=c9c2499d821f6d5f7d5981da86b50d225c1d9ef8

case "${1-}" in
  -h | --help)
    sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

archive=${1-}
if [ -n "$archive" ] && [ ! -d "$archive" ]; then
  echo "Not a directory: $archive" >&2
  exit 2
fi

cd "$(dirname "$0")/.." || exit 1
repo=$(pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

git clone --quiet --filter=blob:none "$spec_url" "$work/spec"
if ! git -C "$work/spec" cat-file -e "$spec_ref^{commit}" 2>/dev/null; then
  echo "Pinned ref $spec_ref is not in $spec_url (force-push, or a typo)." >&2
  exit 1
fi
git -C "$work/spec" checkout --quiet "$spec_ref"

echo "specification : $spec_url"
echo "pinned ref    : $spec_ref"
head_sha=$(git -C "$work/spec" rev-parse origin/HEAD 2>/dev/null || echo unknown)
if [ "$head_sha" != "$spec_ref" ] && [ "$head_sha" != unknown ]; then
  count=$(git -C "$work/spec" rev-list --count "$spec_ref..$head_sha" 2>/dev/null || echo "?")
  echo "upstream HEAD : $head_sha ($count commit(s) ahead -- this run does NOT check those)"
fi
echo

exec bun "$repo/tools/trace-conformance.ts" "$work/spec/fixtures" ${archive:+"$archive"}
