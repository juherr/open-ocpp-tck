# AGENTS.md

Working notes for anyone changing this repository. Everything here is a fact
about the repo that otherwise costs a round trip to rediscover — the reasoning
behind each rule lives in the file it protects.

`README.md` is the user-facing tour, `CONTRIBUTING.md` is how to write a
driver, `VENDOR.md` is the vendoring manifest, `OCA-COVERAGE.md` maps every
scenario to its OCA test case and to what that case obliges the CSMS to
answer. This file is the working loop.

## First

```sh
bun install --frozen-lockfile
```

`typecheck` and `tests/types-current.sh` shell out to `node_modules/.bin/tsc`;
without it they fail with `tsc: command not found` rather than with a type
error.

## The gate

`bun run verify` is every check CI runs before it starts a container —
typecheck, committed declarations, three driver scope checks, three in-process
guards and eight shell guards — with one exit code, and every step runs even
after one fails, where CI enumerates them and stops at the first.

There is a third copy of that list — `bun run test`, the guards without the
typecheck, the declarations and the linter. The three were kept in step by
hand and drifted three times, always the same way: a guard added to `verify`
and to `bun run test`, and not to the workflow, is linted by CI and never run
by it. `tests/gate-parity.sh` now holds `verify` and the workflow to the same
sequence, and every link of `bun run test` to being one of its steps.

It is usually the wrong command *during* iteration: `tests/spec-invariants.sh`
pulls a pinned bun image, and it can only break if something under `tck/specs/`
changed. The fast loop:

```sh
bun run typecheck
bun run check:driver:steve
bun run check:driver:citrineos
bun run check:driver:citrineos-v1     # the same driver's other release line
bun tests/driver-env-scope.ts
bun tests/expected-failure-standing.ts
bun tests/assert-answered.ts
```

then `bun run verify` once before committing.

Everything above is offline: no CSMS, no container, no credentials. The live
counterparts are `ocpp-tck driver selftest` (seconds, needs a running CSMS) and
`bun run e2e` (a full sweep, needs docker).

## Vendored files: re-pin before verifying

Part of `tck/` is copied or patched from `shiv3/ocpp-cp-simulator`, and
`VENDOR.md`'s inventory pins a digest per file. **Check the row's origin before
editing anything under `tck/`:**

| origin | editing it means |
|---|---|
| `local-upstreamable`, `local-private` | nothing to do |
| `upstream-patched` | re-pin: `tools/repin-vendored.sh <path>` |
| `upstream-verbatim` | also a change of origin — same command, it bootstraps the row, the patch and the digest, then names the one `NOTICE` line it will not word for you |

`tck/main.ts` is `upstream-patched`, so any change to the runner needs the
re-pin. Doing it *before* `bun run verify` saves a full gate run; the script
regenerates the patch and the digest in one step, in the only order that
cannot record a digest for bytes that no longer exist.

## Generated artifacts, committed on purpose

Committed because this package is consumed as a pinned git dependency, and
because a diff is reviewable where a digest is not.

| artifact | regenerate with | guarded by |
|---|---|---|
| `types/**/*.d.ts` | `bun run build:types` | `tests/types-current.sh` |
| `tck/specs/ASSERT-INVENTORY.txt`, `DRIVE-TRACE.txt` | `bash tests/spec-invariants.sh --regenerate` | `tests/spec-invariants.sh` |
| `tck/specs/OCA-OBLIGATIONS.txt` | hand-maintained, not generated | `tests/oca-obligations.sh` |
| `patches/**`, `VENDOR.md` digests | `tools/repin-vendored.sh <path>` | `tests/vendor-integrity.sh` |

Never hand-edit them. The diff of `types/` **is** the change to this package's
public API — read it before committing.

## Tests

There is no unit-test framework and no `*.test.ts`. `tests/` holds offline
guards, each with a header stating the property it protects. `bun run test`
chains them — note `bun test` is Bun's own runner and finds nothing here.

Shell is the default, and the three TypeScript ones are TypeScript because
what they assert is unreachable through the CLI. `driver-env-scope.ts`: a
driver's declarations follow the env they are *resolved* with, where the CLI
can only ever pass `process.env`. `expected-failure-standing.ts`: the rule that
decides whether a red sweep ends the build, which from a shell would cost a
container per row — and, for the rows that matter, a CSMS engineered to fail a
chosen scenario a chosen way. `tck/standing.ts` is a module of its own so that
guard can be a table. `assert-answered.ts`: reaching `assertAllAnswered`'s
rules needs a CSMS that emits a CALLERROR and a run truncated between a CALL
and its response — both real, neither reproducible offline except by handing
the helper the frames.

One guard builds a fixture instead of reading the tree.
`tests/repin-refusals.sh` exercises `tools/repin-vendored.sh` in a throwaway
git repository, because that script is the only one here that *writes* — to
`VENDOR.md` and to `patches/` — so what is worth testing about it is which
states it refuses to write, and that is a question about a repository, not
about a file. It works because the script does `cd "$(dirname "$0")/.."`: a
copy at `<fixture>/tools/` can only ever operate on the fixture, which is what
makes running it in the gate safe.

A new guard earns its place by failing correctly, so break what it protects and
watch it go red before committing it. `tools/mutate.sh <file> <perl-expr> --
<command>` does the edit, the run and the restore — and, the part worth having,
refuses to draw any conclusion when the expression matched nothing. A
substitution that silently applies to zero bytes leaves the guard green and
looks exactly like a guard that works; it happened here. The script cannot
check the other half of the rule — red *for that reason and no other* — so read
the output it prints.

**One mutation per claim the guard's header makes**, and take the list from
that header rather than from what is easy to break. `tests/oca-obligations.sh`
claims three things; the two obvious mutations passed, and the third —
renaming the action inside a covering helper — left it **green**, because a
neighbouring regex in the same scenario spelt the same literal. The rule was
weaker than its comment, and only the mutation nobody had to run said so.
Stopping at the obvious ones is not rigour, it is luck: the guard ships, and
its header is now a false claim about what the build checks.

## Six boundaries the guards enforce

- **The gate is one list.** `tools/verify.sh` and the workflow's `check` job
  must run the same commands in the same order, minus the CI-only setup the
  guard lists explicitly — a step added to one and not the other is either a
  gate you cannot reproduce locally or one CI lints and never runs.
  `bun run test` is a declared subset, the guards without the typecheck, the
  declarations and the linter: every link in it must be one of those commands,
  which is what stops a guard from being reachable only through it. Being a
  subset, it is neither complete nor ordered. (`tests/gate-parity.sh`)
- **The numbers written out above are the numbers there are.** The count in
  this heading against its bullets, and the gate sentence's three counts
  against what `tools/verify.sh` runs. A step of a kind that sentence does not
  mention fails too, rather than going uncounted. Three of these numbers were
  wrong at once, and none was found by reading — a reader checks the sentence
  for sense, and the sentence always makes sense. (`tests/doc-counts.sh`)
- **Nothing here depends on the harness overlay.** A coding harness may add a
  repo-root file of its own on top of this one; that file declares the split
  itself, and this document is the half that has to stand without it. A rule
  written down over there and then cited from `tools/`, `tests/` or here
  inverts the dependency, and sends a reader to a document that says it is not
  for them. The fix is always the same shape: move the rule here, leave a
  pointer there. Note that this bullet does not name the file — that is the
  rule applied to itself, and the guard's failure message names it for you.
  (`tests/harness-layer.sh`)
- **Nothing under `tck/` may name a CSMS, and the core may not import a
  driver.** Doc comments may discuss a CSMS-shaped design they replaced;
  identifiers, string literals and imports may not. (`tests/generic-core.sh`)
- **Every OCA obligation has a check, and every answered-check has an
  obligation.** `tck/specs/OCA-OBLIGATIONS.txt` is the table; adding an
  `assertAllAnswered` without a row, or a row without the check, fails.
  (`tests/oca-obligations.sh`)
- **A scenario's assertions and its CSMS call sequence may not change.**
  Changing what a scenario measures is legitimate and moves the two committed
  artifacts above — say why in the pull request. (`tests/spec-invariants.sh`)

## Conventions

Conventional Commits, `!` plus a `BREAKING CHANGE:` footer when the driver
contract changes shape. Branches are `juherr/<topic>`. Code, comments and
commit messages in English.

**A refactor that was tried and rejected gets a note where it would be
re-proposed.** Reviews converge on the same simplifications, and the second
reviewer has no way to know the first one measured it and said no — so the
argument gets re-run instead of read. `EnvDependent` in `tck/driver.ts` is the
worked example: folding its three resolvers into one generic helper is the
obvious de-duplication, and the type stops narrowing when you do. The note
costs four lines and is the difference between a decision and an opinion
someone will overturn by default.
