#!/usr/bin/env bash
# tools/mutate.sh concludes nothing when the mutation or the command did not run.
#
# THE PROPERTY, in four parts. `mutate.sh` is the one script here where a
# NON-ZERO exit is the good news -- "the guard went red" -- so every way of
# failing to reach a verdict has to be told apart from that, or it is read as
# the verdict:
#   1. a command that cannot be launched (127 not found, 126 not executable)
#      is REFUSED: exit 2, and the report never says the guard went red;
#   2. a mutation that matches nothing is refused too, because the command
#      would otherwise run against unmodified code and pass;
#   3. in both refusals the target file is byte-identical afterwards -- this
#      script edits in place, so a refusal that leaves a mutation behind is
#      worse than no refusal;
#   4. and the two verdicts it IS allowed to reach still work: a mutation that
#      applies and a command that goes red exits 0, one that applies and stays
#      green exits 1.
#
# WHY THIS EXISTS. Part 1 was a real false verdict, not a hypothetical: on #77
# three mutations were run as `-- $G`, which zsh passed as a single word. The
# command was never found, exited 127, and mutate.sh reported all three as
# `OK: the guard went red`. Three claims of a new guard looked verified while
# nothing had been tested. The script already classified 130/131/143 for
# exactly this reason -- an interrupted run concludes nothing -- and 126/127
# are the same class arriving one step earlier.
#
# It matters more here than in any other guard because this is the tool the
# OTHER guards are validated with. A mutation tester that says "verified" when
# it verified nothing does not fail alone; it certifies whatever was run
# through it.
#
# HOW: a throwaway directory with a copy of the script. `mutate.sh` does
# `cd "$(dirname "$0")/.."`, so a copy at <fixture>/tools/ resolves its target
# inside the fixture and can never edit this repository -- the same reason
# tests/repin-refusals.sh is safe to run in the gate.
#
# WHAT IT CANNOT CHECK: that a guard is red "for that reason and no other".
# The script says so itself and no script can do it. This covers only the
# cases where there is no reason at all.
#
# IF YOU MUTATION-TEST THIS GUARD, you will be running `mutate.sh` against
# `mutate.sh`, and the two copies do not see the same bytes: bash has already
# parsed the outer one, so it restores itself from the original in memory,
# while the fixture copy is taken after the edit and is the mutated one. That
# is why breaking `restore()` reddens the cases below and still leaves this
# repository clean -- surprising, but the right way round.
#
# Offline: writes one file in a temp dir, runs `true`/`false` against it.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

script=tools/mutate.sh
[ -f "$script" ] || { echo "FAIL: $script is missing." >&2; exit 1; }

fixture=$(mktemp -d) || { echo "FAIL: could not create a temp dir." >&2; exit 1; }
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/tools" || exit 1
cp "$script" "$fixture/tools/mutate.sh" || exit 1
chmod +x "$fixture/tools/mutate.sh" || exit 1

status=0
pass() { echo "  ok   $1"; }
fail() { status=1; echo "  FAIL $1" >&2; }

TARGET_CONTENT='const answer = 42;'
target=target.ts

# Each case starts from the same file, so none can read as passing because a
# previous one left the fixture in a helpful shape.
reset_target() { printf '%s\n' "$TARGET_CONTENT" > "$fixture/$target"; }

# Runs the fixture's copy and captures output and exit code together.
run_mutate() {
  ( cd "$fixture" && tools/mutate.sh "$@" >"$fixture/out" 2>&1 )
  echo $?
}

target_unchanged() {
  [ "$(cat "$fixture/$target")" = "$TARGET_CONTENT" ]
}

said_red() { grep -q "the guard went red" "$fixture/out"; }

echo "mutate.sh refusals:"

# ---- 1. a command that cannot be launched
reset_target
code=$(run_mutate "$target" 's/42/43/' -- this-command-does-not-exist-4f2b)
if [ "$code" != "2" ]; then
  fail "an unlaunchable command exited $code, expected 2 (setup error)"
elif said_red; then
  fail "an unlaunchable command was reported as the guard going red"
elif ! target_unchanged; then
  fail "an unlaunchable command left the mutation in the file"
else
  pass "a command that cannot be run -- refused, no verdict, wrote nothing"
fi

# 126 is the same class: found, but not executable.
reset_target
printf '#!/usr/bin/env bash\ntrue\n' > "$fixture/not-executable.sh"
chmod -x "$fixture/not-executable.sh"
code=$(run_mutate "$target" 's/42/43/' -- ./not-executable.sh)
if [ "$code" != "2" ]; then
  fail "a non-executable command exited $code, expected 2"
elif said_red; then
  fail "a non-executable command was reported as the guard going red"
else
  pass "a command that is not executable -- refused the same way"
fi

# ---- 2. a mutation that matches nothing
reset_target
code=$(run_mutate "$target" 's/no-such-text/x/' -- false)
if [ "$code" != "1" ]; then
  fail "a mutation matching nothing exited $code, expected 1"
elif said_red; then
  fail "a mutation that never applied was reported as the guard going red"
elif ! target_unchanged; then
  fail "a mutation matching nothing still modified the file"
else
  pass "a mutation that matches nothing -- refused before the command runs"
fi

# ---- 4. the two real verdicts still work
reset_target
code=$(run_mutate "$target" 's/42/43/' -- false)
if [ "$code" != "0" ]; then
  fail "an applied mutation with a red command exited $code, expected 0"
elif ! said_red; then
  fail "an applied mutation with a red command did not report the guard red"
elif ! target_unchanged; then
  fail "an applied mutation was not restored afterwards"
else
  pass "mutation applied and command red -- the verdict this tool exists for"
fi

reset_target
code=$(run_mutate "$target" 's/42/43/' -- true)
if [ "$code" != "1" ]; then
  fail "an applied mutation with a green command exited $code, expected 1"
elif ! grep -q "stayed GREEN" "$fixture/out"; then
  fail "an applied mutation with a green command did not say the guard stayed green"
elif ! target_unchanged; then
  fail "an applied mutation was not restored afterwards"
else
  pass "mutation applied and command green -- the guard does not protect it"
fi

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "mutate.sh is how every other guard in this repository is validated." >&2
  echo "When it reports a verdict it did not reach, whatever was checked with" >&2
  echo "it is certified on nothing -- which is how three claims shipped as" >&2
  echo "verified on #77." >&2
  exit 1
fi
echo "mutate.sh refuses what it cannot conclude, and restores what it edits."
