#!/usr/bin/env bash
# Do this repository's archived traces still read the way its logs do?
#
# Deliberately NOT part of `bun run verify` or `bun run test`: its input is a
# corpus of real traces, which this repository does not commit -- CI's sweeps
# leave them as artifacts. Given one, it runs offline.
#
# Every `*.jsonl` trace in <archive-dir> must read through tck/trace.ts's
# readTrace without a refusal, and where the matching `*.log` sits beside it,
# the trace and the log must agree frame for frame. See
# tools/trace-conformance.ts for why that agreement is the property.
#
# Whether the READER implements the format is no longer asked here. The
# reader is @open-ocpp-trace/core and @open-ocpp-trace/jsonl, and the SDK's CI
# runs the specification's fixtures and the schema differential against ajv
# on the same pinned specification commit this script used to clone.
#
# RUN IT after changing tck/trace.ts or tck/ocpp.ts's parseLog, or after
# moving the SDK pin. A green `bun run verify` does not cover the corpus.
#
# Usage:
#   tools/trace-conformance.sh <archive-dir>
#
# To get a corpus from CI, where this repository's sweeps leave them:
#
#   gh run download <run-id> --dir /tmp/tck-artifacts
#   tools/trace-conformance.sh "$(dirname "$(find /tmp/tck-artifacts -name '*.jsonl' | head -1)")"
set -eu

case "${1-}" in
  -h | --help)
    sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

archive=${1-}
if [ -z "$archive" ]; then
  echo "usage: tools/trace-conformance.sh <archive-dir> (see --help)" >&2
  exit 2
fi
if [ ! -d "$archive" ]; then
  echo "Not a directory: $archive" >&2
  exit 2
fi
archive=$(cd "$archive" && pwd)

cd "$(dirname "$0")/.." || exit 1
exec bun tools/trace-conformance.ts "$archive"
