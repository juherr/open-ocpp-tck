# CLAUDE.md

@AGENTS.md is the working loop for this repository — the install step, the
gate, the re-pin rule for vendored files, the generated artifacts and the two
boundaries the guards enforce. Read it first; nothing in it is Claude-specific.

What follows is only what the Claude Code harness needs on top.

## What is safe to run unattended

Everything in `bun run verify` is offline and side-effect free — it reads
files, runs `tsc`, and (for `tests/spec-invariants.sh`) runs the pinned bun
image over a read-only mount. No CSMS, no credentials, no writes outside a
temp dir.

Ask before running anything that reaches a server or leaves state behind:

- `bun run e2e`, `bun run e2e:smoke`, `ocpp-tck run`, `ocpp-tck run-all` —
  start simulator containers and drive a live CSMS.
- `ocpp-tck driver provision | verify | teardown | selftest` — talk to a CSMS,
  and the first and third of those write fixtures.
- `docker compose -f drivers/*/compose.yaml` — brings a CSMS up.
- `bash tools/vendor-diff.sh` — the one guard-adjacent script that uses the
  network.

## Two habits this repo rewards

- **Re-pin before verifying, not after.** Editing `tck/main.ts` and running
  the gate costs a full run to be told to run `tools/repin-vendored.sh`. See
  the origin table in @AGENTS.md.
- **Mutation-test a new guard as you write it.** `tools/mutate.sh` does the
  edit, the run and the restore, and refuses to conclude anything when the
  expression matched nothing — see the Tests section of @AGENTS.md. The
  cheapest moment to find out a guard fails for the *wrong* reason, or for no
  reason at all, is before it is committed.
