# AGENTS.md

Working notes for anyone changing this repository. Everything here is a fact
about the repo that otherwise costs a round trip to rediscover — the reasoning
behind each rule lives in the file it protects.

`README.md` is the user-facing tour, `CONTRIBUTING.md` is how to write a
driver, `VENDOR.md` is the vendoring manifest, `OCA-COVERAGE.md` maps every
OCPP 1.6 scenario to its OCA test case and to what that case obliges the CSMS
to answer, `OCA-201-SELECTION.md` is the rule deciding which OCPP 2.0.1 cases
may be implemented at all, `CHANGELOG.md` is what a consumer reads before
moving a pinned ref. This file is the working loop.

## First

```sh
bun install --frozen-lockfile
```

`typecheck` and `tests/types-current.sh` shell out to `node_modules/.bin/tsc`;
without it they fail with `tsc: command not found` rather than with a type
error.

## The gate

`bun run verify` is every check CI runs before it starts a container —
typecheck, committed declarations, three driver scope checks, twelve in-process
guards and fifteen shell guards — with one exit code, and every step runs even
after one fails, where CI enumerates them and stops at the first.

There is a third copy of that list — `bun run test`, the guards without the
typecheck, the declarations and the linter. The three were kept in step by
hand and drifted three times, always the same way: a guard added to `verify`
and to `bun run test`, and not to the workflow, is linted by CI and never run
by it. `tests/gate-parity.sh` now holds `verify` and the workflow to the same
sequence, and every link of `bun run test` to being one of its steps.

It is usually the wrong command *during* iteration: `tests/spec-invariants.sh`
pulls a pinned bun image, and it can only break if something under `tck/specs/`
changed. The fast loop — the typecheck, the driver scope checks, the
in-process guards, and the two shell guards that read a scenario registry
rather than a document:

```sh
bun run typecheck
bun run check:driver:steve
bun run check:driver:citrineos
bun run check:driver:citrineos-v1     # the same driver's other release line
bun tests/driver-env-scope.ts
bun tests/capability-parity.ts
bun tests/expected-failure-standing.ts
bun tests/assert-answered.ts
bun tests/get-configuration-filter.ts
bun tests/foreign-sweep-scope.ts
bun tests/sim-docker-argv.ts
bun tests/trace-frames.ts
bun tests/steve-ui-session-race.ts
bun tests/citrineos-transport-classification.ts
bun tests/citrineos-device-model-fixture.ts
bun tests/state-plan-201.ts
bash tests/cert201-declares-its-version.sh
bash tests/cert201-scope-rows.sh       # both read tck/specs/ASSERT-INVENTORY.txt,
                                       # so a NEW scenario reaches them only once
                                       # spec-invariants.sh has regenerated it
```

then `bun run verify` once before committing.

Everything above is offline: no CSMS, no container, no credentials. The live
counterparts are `ocpp-tck driver selftest` (seconds, needs a running CSMS) and
`bun run e2e` (a full sweep, needs docker).

## Vendored files: re-pin before verifying

Part of `tck/` descends from `shiv3/ocpp-cp-simulator`, and `VENDOR.md`'s
inventory says per file how. **Check the row's origin before editing anything
under `tck/`:**

| origin | editing it means |
|---|---|
| `local-native`, `local-private` | nothing to do |
| `upstream-forked` | nothing to do — keep the `Derived from …` header on its first lines |
| `upstream-patched` | re-pin: `tools/repin-vendored.sh <path>` |
| `upstream-verbatim` | also a change of origin — same command, it bootstraps the row, the patch and the digest, then names the one `NOTICE` line it will not word for you |

The runner (`tck/main.ts`, `sim.ts`, `assert.ts`, `spec-types.ts`, the specs)
is `upstream-forked` since upstream ceded it (shiv3/ocpp-cp-simulator#271), so
a runner change is an ordinary edit — keep the leading `/** Derived from … @
<fork commit> */` block, which the guard checks against `VENDOR.md`'s
`### Fork commit` heading (a separate, frozen fact from `Pinned commit`, which
only a re-import moves). Only `tck/ocpp.ts` and `tck/util.ts` are
still `upstream-verbatim`; editing one of those is where the re-pin applies,
and doing it *before* `bun run verify` saves a full gate run: the script
bootstraps the patch and the digest in one step, in the only order that cannot
record a digest for bytes that no longer exist.

The manifest's other half is the **container image pins**, and they follow a
different rule: hand-maintained, in one of `VENDOR.md`'s two-column pin tables
and in the file that table's `declared in` row names — `tck/sim.ts` for the
simulator, a driver's `compose.yaml` for a CSMS stack. Move a digest and you
move both, in the same commit. `tests/vendor-integrity.sh`'s A14 compares every
image, digest and resolved tag in both directions, and it is driven off
`declared in` rather than off a list, so a new pin block is covered the moment
it is written. Until it existed the pins were compared to nothing: the
inventory parser selects rows by width, which excludes every two-column table
in the file.

## Generated artifacts, committed on purpose

Committed because this package is consumed as a pinned git dependency, and
because a diff is reviewable where a digest is not.

| artifact | regenerate with | guarded by |
|---|---|---|
| `types/**/*.d.ts` | `bun run build:types` | `tests/types-current.sh` |
| `tck/specs/ASSERT-INVENTORY.txt`, `DRIVE-TRACE.txt` | `bash tests/spec-invariants.sh --regenerate` | `tests/spec-invariants.sh` |
| `tck/specs/OCA-OBLIGATIONS.txt` | hand-maintained, not generated | `tests/oca-obligations.sh` |
| `tck/specs/OCA-201-SLICE.txt` | hand-maintained, not generated | `tests/oca-201-slice.sh` |
| `tck/specs/OCA-201-OPERATIONS.txt` | `bun tools/extract-201-operations.ts <part6.pdf>` — the reference is not in the tree, so this is hand-committed from a run you do, and `--diff` re-checks it | `tests/oca-201-operations.sh` |
| `OCA-201-SELECTION.md`'s tranche table | `bun tools/extract-201-operations.ts --tranches` — derived from the row file and the driver contract, no reference needed | `tests/oca-201-operations.sh` |
| `VENDOR.md` digests (and `patches/**`, should a row become `upstream-patched` again) | `tools/repin-vendored.sh <path>` | `tests/vendor-integrity.sh` |

Never hand-edit them. The diff of `types/` **is** the change to this package's
public API — read it before committing.

## Tests

There is no unit-test framework and no `*.test.ts`. `tests/` holds offline
guards, each with a header stating the property it protects. `bun run test`
chains them — note `bun test` is Bun's own runner and finds nothing here.

Shell is the default, and the twelve TypeScript ones are TypeScript because
what they assert is unreachable through the CLI. `driver-env-scope.ts`: a
driver's declarations follow the env they are *resolved* with, where the CLI
can only ever pass `process.env`. `capability-parity.ts`: the same reason and
one more — what it compares a declaration against is the parts `create(env)`
returns, which from the CLI means starting a sweep, and both halves have to be
read for one synthetic env. Its per-action half calls the driver's mapper
directly rather than `operations201.execute()`, because the client `execute`
closes over is built inside `create()` with the real `fetch`; the header says
what that weakens and why the two alternatives — exporting the driver's
internal factory, patching the global `fetch` — cost more than it buys.
`expected-failure-standing.ts`: the rule that
decides whether a red sweep ends the build, which from a shell would cost a
container per row — and, for the rows that matter, a CSMS engineered to fail a
chosen scenario a chosen way. `tck/standing.ts` is a module of its own so that
guard can be a table. `assert-answered.ts`: reaching `assertAllAnswered`'s
rules needs a CSMS that emits a CALLERROR and a run truncated between a CALL
and its response — both real, neither reproducible offline except by handing
the helper the frames. `get-configuration-filter.ts`: the same, one step
further — the encoding it pins TC_019_1 as accepting, a `GetConfiguration`
with its optional `key` member *omitted*, is one no CSMS here sends. Both
bundled drivers spell that request `{"key":[]}`, so the scenario was measuring
a spelling and no sweep, offline or live, could say so.
`foreign-sweep-scope.ts`: the refusal it guards reads `docker ps`, so a shell
version would start a container per row on the daemon this repository's own
sweeps share — and the rule is what can be wrong, so `classifyForeignSims` is
exported without the daemon in it, the same split `tck/standing.ts` is.
`sim-docker-argv.ts`: `buildDockerArgs` is pure and its one caller spawns
docker in the next statement, so the argv a scenario would run is not printable
from a shell — and `defaultSimConfig` resolving the env it is *handed* is the
same unreachable half as `driver-env-scope.ts`'s. `trace-frames.ts`: every
refusal `tck/trace.ts` makes needs a trace this repository cannot produce —
across 94 archived scenarios and 1576 records not one record is missing a
member, and both bundled drivers ride the same producer — so, like
`assert-answered.ts`, the way in is handing the mapper its records.
`steve-ui-session-race.ts`: what it pins is an *interleaving* between the lanes
that share one driver instance, and from the CLI that is a whole sweep — where
the property is a 45%-of-the-time event that took 91 archived artifacts and a
preserved wire trace to observe once. So the client takes its `fetch` as an
argument, the same seam-shaped split as the three above, and the guard hands it
a fake CSMS whose CSRF rules are modelled on the pinned image's. That model is
the guard's one assumption, and `tools/steve-csrf-race.ts` — live, out of the
gate — is how it gets re-checked when the pin moves.
`citrineos-transport-classification.ts`: it rides the same seam for the reason
the one above gives, and the branches it needs are further out of reach — a
503, a body that stalls mid-stream, a 200 that is not JSON are answers no CSMS
here can be asked for, and the two a broken deployment does give would each
cost a container and a misconfiguration to stage. What it holds is a line, not
a behaviour: which failures `warnOpFailed` lets out, so it is wrong in two
directions and half of its table asserts the *negative* — that a request the
CSMS answered stays an ordinary failure.
`citrineos-device-model-fixture.ts`: the one whose subject is
least visible from anywhere else. It holds a SEQUENCE of writes — which rows
`provision` seeds, which one the prepare hook points back, which ones teardown
refuses to remove — against a CSMS that answers a right fixture and a wrong one
with the same empty `StatusNotificationResponse`. There is no wire assertion
that could tell them apart, and the live measurement that can is four lines in
a CSMS log rather than a verdict. So the seam again: the provisioner takes its
`fetch`, and the guard answers from a store.
`state-plan-201.ts`: the last one, and the only one whose subject never touches
a CSMS at all. What a scenario DECLARES — the OCPP 2.0.1 `Reusable State`s its
case takes as a precondition — is not what the runner RUNS: `tck/states-201.ts`
folds the states' own post conditions into a condition, executes a dependency
edge only where that condition says the system is not already there, and picks
a state's branch from it. Every step of that is a decision no sweep can show
you, and the row that decides whether the rule is right — re-entering
`EnergyTransferStarted` after the `EVDisconnected` chain, where deduplicating
by a visited set silently drops an `Authorize` — walks a chain of five states
of which most have no reach this build can execute, so no sweep, live or
offline, could reach it. `planStates` is a total function for that reason, the
same split `tck/standing.ts` is. Its third claim is the odd one and belongs
with the rest anyway: a `states:` written as anything but a literal renders `·`
and is then OMITTED from `ASSERT-INVENTORY.txt`, so the guard RUNS the
extractor rather than reading the committed file — a guard comparing two
committed files goes green on a declaration factored out after the artifact was
generated.

Two guards build a fixture instead of reading the tree, and they are the two
that test the scripts under `tools/` which *write*.
`tests/repin-refusals.sh` exercises `tools/repin-vendored.sh` in a throwaway
git repository — it writes to `VENDOR.md` and to `patches/`, so what is worth
testing about it is which states it refuses to write, and that is a question
about a repository, not about a file. `tests/mutate-refusals.sh` does the same
for `tools/mutate.sh`, which edits a source file in place and restores it.
Both work because the scripts do `cd "$(dirname "$0")/.."`: a copy at
`<fixture>/tools/` can only ever operate on the fixture, which is what makes
running them in the gate safe.

`mutate.sh` is the one that had to be tested most, because it is the tool every
other guard is validated with, and it is the only script here where a NON-ZERO
exit is the good news. Every way of failing to reach a verdict therefore has to
be told apart from "the guard went red", or it is read as it.

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

## Twelve boundaries the guards enforce

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
- **Nothing under `tck/` may name a CSMS, no driver may name another's, and
  the core may not import a driver.** Doc comments may discuss a CSMS-shaped
  design they replaced; identifiers, string literals and imports may not. The
  drivers to scan are derived from `drivers/*`; the names each one owns are a
  table in the guard, and a driver missing from it is reported rather than
  skipped. (`tests/generic-core.sh`)
- **Every OCA obligation has a check, and every answered-check has an
  obligation.** `tck/specs/OCA-OBLIGATIONS.txt` is the table; adding an
  `assertAllAnswered` without a row, or a row without the check, fails.
  (`tests/oca-obligations.sh`)
- **An OCPP 2.0.1 scenario exists because a written rule selected its case.**
  `tck/specs/OCA-201-SLICE.txt` is that list — every registered `cert201-`
  scenario traces to a row, and every row is implemented or declined with a
  reason. `OCA-201-SELECTION.md` states the rule the list was drawn against,
  and no guard can check that part: it is a reading of a specification this
  repository does not contain. What this stops is the two drifting afterwards,
  which is the failure a page that keeps reading well always has. It does not
  stop the list being *short* — both directions range over the file, so a row
  deleted from it is a mandatory case that stops being owed with the build
  green. The file holds all 147 the rule selects, so that is now a regression
  rather than the state it sat in for a year; where it is owned is the
  selection page rather than here.
  And the two names such a scenario has are one fact, which is the half of
  this boundary that had nothing watching it: the slice guard keys on the
  declared `ocppVersion`, every driver list and every other reader keys on the
  `cert201-` prefix, and nothing tied the two together. A scenario carrying
  only one of them is checked by half of what it looks checked by — and one
  carrying only the prefix runs on the environment's protocol, 1.6 by default,
  and goes six checks of seven green.
  (`tests/oca-201-slice.sh`, `tests/cert201-declares-its-version.sh`)
- **A selected case's operation cost is measured, and a row may not claim a
  case the contract cannot express.** `tck/specs/OCA-201-OPERATIONS.txt` names
  the CSMS-initiated operation each of those 147 cases obliges the CSMS to send
  — how many kinds that is, and how far short of it the union stands, are
  `OCA-201-SELECTION.md`'s to state and the guard's to print. It holds the
  table to the same case set as the slice, agrees it against every
  slice reason that names a measured operation, refuses an implemented row
  whose case needs an operation `CSMS_OPERATION_201_ACTIONS` has not, and holds
  the selection page's tranche table to the one those rows derive. That last one
  is the direction with nothing else watching it: two files agreeing about
  *which* case a scenario is for say nothing about *what* the case asks for,
  and `TC_F_20` sat implemented for a milestone on a case whose only validation
  is a `TriggerMessage` no driver could be asked to send.
  (`tests/oca-201-operations.sh`)
- **A capability a driver declares is one it implements.** A driver says what
  it can do twice — `capabilities`, resolved offline, and the parts
  `create(env)` returns — and `check-driver` reads only the first. It cannot
  read the second by design: a declaration must be readable without
  credentials. So the guard holds the two to each other for every env a bundled
  driver's declarations are a function of, both directions, over the four
  omissible halves; requires a present `operations201` to be non-empty, since
  absent and empty are different claims and only one of them is ever honest
  here; and pushes `SAMPLE_OPERATION_201`, one well-formed operation per
  action that `tck/driver.ts` cannot compile without, through the driver's own
  mapper. That last direction is the one nothing watched: `check-driver`'s
  rule about `operations201` compares the declaration to
  `CSMS_OPERATION_201_ACTIONS`, so an arm added to the contract grows both
  sides in the same commit and the check is a tautology — CitrineOS declared
  `new Set(CSMS_OPERATION_201_ACTIONS)`, the whole constant, and would have
  claimed every one of the sixteen arms still to come at the moment each was
  added. What no offline guard can add is that the route a `case` names
  EXISTS: a plausible module/action pair compiles, is declared, and 404s, which
  `api-client.ts` classifies as a non-dispatch rather than a capability gap.
  (`tests/capability-parity.ts`)
- **A demotion a driver keeps by hand covers every scenario it is about.**
  `scopeCoverage` — what `check-driver` runs — reports a scope row that is
  MISSING and one that is STALE. A demotion is neither: it is a rewrite a
  derived table applies to the ids a driver lists, so a scenario the list
  forgets is inherited unchanged from the table it derives from, and the
  derived table goes on claiming a capability that release line does not have
  with the build green. The list is the only place the fact is written, because
  a scenario's declared protocol never reaches a driver. Not hypothetical, and
  not even unknown: `drivers/citrineos/variant.ts`'s `CERT_201_SCENARIOS` held
  five of the seven registered `cert201-` scenarios and the comment above it
  described that exact hole in prose, for a milestone, with `check-driver`
  green on both lines. (`tests/cert201-scope-rows.sh`)
- **A scenario's assertions and its CSMS call sequence may not change.**
  Changing what a scenario measures is legitimate and moves the two committed
  artifacts above — say why in the pull request. (`tests/spec-invariants.sh`)
- **A declared OCPP 2.0.1 `Reusable State` is one this build can establish, and
  its parameters reach the committed artifact.** `tck/states-201.ts` holds the
  fourteen Part 6 defines for the CSMS role; two have a reach and twelve are
  declared `planned` with a reason, which is what lets `OCA-201-SLICE.txt` cite
  a missing fixture by name instead of restating a blocker. Naming a planned
  one fails here rather than at run time, because a scenario that would go
  orange for something the build already knew is a scenario the build should
  have refused. The other half is the one with nothing else watching it: the
  `states:` declaration is DATA on the spec object, and a non-literal renders
  `·` and is then omitted from `ASSERT-INVENTORY.txt` rather than marked — so a
  fixture re-pointed at another connector or another tag moves no committed
  artifact and no diff says so. (`tests/state-plan-201.ts`)
- **The documented install command installs the contract the documents
  describe.** Every tracked `*.md` citing a `github:<owner>/<repo>#<ref>`
  install command names this repository and the same ref, and then that ref is
  one of exactly two things: a tag that exists whose `tck/driver.ts` matches
  the tree byte for byte, or a tag that does not exist yet named
  `v<package.json's version>`, that version being later than every `vN.N.N`
  tag the clone has — and it must have one, or a broken checkout would satisfy
  the second shape by having no tags to disagree with. The ref, the slug and
  the version are read from the files, never spelled in the guard — and the
  slug is checked, not merely filtered by, or the one page naming a different
  repository would be the one page invisible to the guard. The price is a
  swap, not a saving: between merge and release the documented ref does not
  resolve, where it used to be the build that was red. So changing
  `tck/driver.ts` obliges you to bump the manifest and repoint both pages in
  the same pull request, which is a thing you can actually do from a branch —
  cutting a tag is not. The header says why `tck/driver.ts` alone.
  (`tests/documented-install-ref.sh`)

## Conventions

Conventional Commits, `!` plus a `BREAKING CHANGE:` footer when the driver
contract changes shape. Branches are `juherr/<topic>`. Code, comments and
commit messages in English.

**What may be committed from an OCA reference is decided once**, in
`OCA-201-SELECTION.md`'s "What may be committed here, and what may not". Its
worked example is OCPP 2.0.1, but the rule it states is about kinds of material
and covers both protocols: identifiers, counts and our own prose are in; a
reference's prose, tables and step text brought into ours are out; the PDFs are
out for a reason of ours rather than the licence's. The §3(a) attribution the
answer owes is in `NOTICE`, because that is the file the package ships.

**A refactor that was tried and rejected gets a note where it would be
re-proposed.** Reviews converge on the same simplifications, and the second
reviewer has no way to know the first one measured it and said no — so the
argument gets re-run instead of read. `EnvDependent` in `tck/driver.ts` is the
worked example: folding its three resolvers into one generic helper is the
obvious de-duplication, and the type stops narrowing when you do. The note
costs four lines and is the difference between a decision and an opinion
someone will overturn by default.
