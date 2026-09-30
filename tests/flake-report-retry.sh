#!/usr/bin/env bash
# The flake record reads every isolated-retry cell the runner has ever written
# into the statistic that cell stands for.
#
# PROPERTY, one line per retry-cell shape, each checked in BOTH places
# `tools/flake-report.ts` reports it -- the observation's `retryVerdict` and
# the scenario's flake / confirmed / unadjudicated counts:
#   1. `PASS (flake)` is an adjudicated flake.
#   2. `FAIL (confirmed)` is a confirmation.
#   3. `ERROR (inconclusive)` -- a retry whose CSMS never accepted its
#      BootNotification (#141) -- carries NO retry verdict and counts as
#      UNADJUDICATED. Re-derived from its ERROR, it would count as a
#      confirmation, which is the misreading this row exists for.
#   4. `ERROR (confirmed)`, the only way a failing ERROR retry was rendered
#      before #145, still reads as a confirmation: the archived corpus cannot
#      tell a lost CSMS from a crash, and the tool says so rather than guessing.
#   5. A failure with no retry (`-`) is unadjudicated -- the control for 3,
#      which shares its column.
#
# WHY THIS EXISTS. Row 3 is the one reading in that file that trusts a word
# rather than re-deriving it through `effectivelyFailed`, and a mistake in it
# is silent twice over: the report still renders, and the numbers it gets
# wrong are about ~119 archived runs nobody re-reads by hand.
#
# WHAT IT CANNOT CHECK: that `writeSummary` in `tck/main.ts` renders the cell
# as `<VERDICT> (<adjudication>)`. That is reachable only from a sweep. What
# links the two sides is the vocabulary -- both import `RETRY_ADJUDICATIONS`
# from `tck/standing.ts` -- so a renamed adjudication reaches this tool through
# the import, and the fixtures below go red on the spelling they still carry.
#
# Offline: writes a fabricated corpus into a temp dir and runs one tool.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

tool=tools/flake-report.ts
[ -s "$tool" ] || { echo "FAIL: $tool is missing or empty." >&2; exit 1; }

work=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$work"' EXIT

# One scenario per shape, so each row's counts are its own.
mkdir -p "$work/corpus/run-1"
cat > "$work/corpus/run-1/summary.md" <<'EOF'
# OCPP verification results — group: all

Run at 2026-01-01T00:00:00Z. Host load 1.00 over 8 core(s).

| scenario | cp | verdict | checks | failed | skipped | isolated retry |
| --- | --- | --- | --- | --- | --- | --- |
| row1-flake | CERTCP1 | FAIL | 5 | 1 | 0 | PASS (flake) |
| row2-confirmed | CERTCP2 | FAIL | 5 | 1 | 0 | FAIL (confirmed) |
| row3-inconclusive | CERTCP3 | FAIL | 5 | 5 | 0 | ERROR (inconclusive) |
| row4-pre-145-error-confirmed | CERTCP1 | ERROR | - | - | - | ERROR (confirmed) |
| row5-no-retry | CERTCP2 | FAIL | 5 | 1 | 0 | - |
EOF

out=$(bun "$tool" "$work/corpus" --json 2>"$work/stderr") || {
  echo "FAIL: $tool exited non-zero on the fixture corpus." >&2
  sed 's/^/    /' "$work/stderr" >&2
  exit 1
}

# shellcheck disable=SC2016  # ${...} is a JS template literal, not a shell expansion.
got=$(printf '%s' "$out" | bun -e '
const report = JSON.parse(await Bun.stdin.text());
const stats = new Map(report.scenarios.map((s) => [s.templateId, s]));
const lines = report.observations.map((o) => {
  const s = stats.get(o.templateId);
  return `${o.templateId} retry=${o.retryVerdict ?? "-"} flake=${s.adjudicatedFlakes} confirmed=${s.confirmed} unadjudicated=${s.unadjudicated}`;
});
console.log(lines.sort().join("\n"));
') || { echo "FAIL: could not read $tool's --json output." >&2; exit 1; }

want='row1-flake retry=PASS flake=1 confirmed=0 unadjudicated=0
row2-confirmed retry=FAIL flake=0 confirmed=1 unadjudicated=0
row3-inconclusive retry=- flake=0 confirmed=0 unadjudicated=1
row4-pre-145-error-confirmed retry=ERROR flake=0 confirmed=1 unadjudicated=0
row5-no-retry retry=- flake=0 confirmed=0 unadjudicated=1'

if [ "$got" != "$want" ]; then
  echo "FAIL: the flake record misreads an isolated-retry cell." >&2
  diff <(printf '%s\n' "$want") <(printf '%s\n' "$got") | sed 's/^/    /' >&2
  echo "  (< expected, > got)" >&2
  echo >&2
  echo "A retry cell read as the wrong statistic corrupts every flake rate the" >&2
  echo "archived corpus reports, and the report renders fine either way." >&2
  exit 1
fi

echo "Flake record reads 5 retry-cell shape(s): flake, confirmed, inconclusive, pre-#145 ERROR (confirmed), none."
