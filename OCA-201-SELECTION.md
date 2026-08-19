# OCA-201-SELECTION.md

Which OCPP 2.0.1 certification cases this suite is allowed to implement, stated
as a rule rather than as a list, and what a scope row about 2.0.1 may cite.

OCPP 2.0.1 Part 6 is 914 pages. The milestone that introduces 2.0.1 says
explicitly that the suite is not to be ported, and names six candidate
messages. Six names chosen by hand is not a rule, and without a rule a
"small representative set" is a judgement each reviewer makes differently and
the milestone grows by a case at a time.

This file is the rule. It is not a coverage table: at the time of writing there
is **no `cert201-` scenario in the tree**, and the coverage arithmetic for OCPP
1.6 lives in [`OCA-COVERAGE.md`](OCA-COVERAGE.md), where it counts a different
reference and must not absorb this one.

## The reference, and what may be committed

*OCPP 2.0.1 Part 5 — Certification Profiles and Test Cases* supplies the
selection matrix; *Part 6 — Test Cases* supplies the cases themselves. Both are
**CC BY-ND 4.0**. This repository is public and Apache-2.0, and BY-ND permits
no derivative works, so their text, their tables and the PDFs stay out of it.

What may be committed, and what everything below is made of: **case
identifiers** (`TC_B_01`), **requirement identifiers** (`P02.FR.06`),
**feature identifiers** (`C-45`), **counts**, and our own prose. That is
already the line the OCPP 1.6 scenarios sit on.

The line is drawn on **extent**, not on shape, and that is what decides an
argument later: the 104-case pool the rule selects is **not** committed here,
while the handful of cases named below are. Citing the cases under discussion
is a citation; committing the column in full re-renders the matrix's own
selection, whatever the surrounding markup looks like. So the tables on this
page stay at the size of the argument they support, and none of them is the
pool.

## How the counts below were derived

Part 5 §4 is a matrix with a `Conf. test for CSMS` column, where `M` means
mandatory for the profile, `C` means conditional on a declared feature, and
blank means the case does not address this role at all.

The columns cannot be recovered from PDF reading order, but they can be
recovered from x-position: `pdftotext -bbox-layout`, then bucket the `M` and
`C` glyphs by column. That is a dozen lines of text processing, and it is
written down here so it can be **redone** rather than re-read when the
reference is revised — the same arrangement, and for the same reason, as
`OCA-COVERAGE.md`'s derivation note.

The per-profile counts below, and the `M` / `C` status of every case this page
names, were produced that way once. Nothing in this repository can check them —
the PDF is not here and cannot be — so they carry exactly the status
`OCA-COVERAGE.md`'s own totals carry: measured, then written into prose.
Everything else numeric here is cited from the references rather than counted,
and the two places where that distinction changes what may be concluded say so
on the spot.

## The rule

> **profile = Core, role = CSMS, status = `M`.**

A case is in the candidate pool if and only if it sits in the Core
certification profile, addresses the CSMS role, and is marked mandatory.
Everything else — the other profiles, the conditionals, the
charging-station-only cases — is out, and out by arithmetic rather than by
taste.

## What the rule is drawn against

| Certification profile | rows | CSMS `M` | CSMS `C` | CSMS blank (CS-only) |
|---|---|---|---|---|
| **Core** | 364 | **104** | 83 | 177 |
| Advanced Security | 8 | 6 | 2 | 0 |
| Smart Charging | 40 | 36 | 4 | 0 |
| ISO 15118 Support | 64 | 59 | 5 | 0 |

For scale, against the 1.6 suite this repository already implements: that whole
certification set has 77 `_CSMS` cases ([`OCA-COVERAGE.md`](OCA-COVERAGE.md)
counts what they cover). **The Core profile of 2.0.1 alone has more than twice
the mandatory CSMS surface of the entire 1.6 suite**, and Part 6 devotes
p608–p900 to 251 `*_CSMS` cases.

Two narrowings, and only the first is a rule: the rule takes Core's 364 rows to
the 104 that are mandatory for this role, and the slice below takes those 104 to
seven. Part 6's 251 is scale, not a term in either — it is a different
document's count of a different population, and how it relates to the matrix's
rows was **not measured**.

## What the rule corrects on a hand-drawn list

This is what a written rule buys, and it is kept here rather than smoothed
away, because a list that agreed with the rule everywhere would be evidence for
neither.

Against the six candidate messages named when the milestone was scoped:

| Candidate | Core CSMS rows |
|---|---|
| BootNotification | `TC_B_01` **M**; `TC_B_02` C (`C-44`), `TC_B_30` / `TC_B_31` C |
| Heartbeat | `TC_F_20` **M** |
| Reset | `TC_B_20`, `TC_B_21`, `TC_B_22` — all **M** |
| GetVariables | `TC_B_06` **M**; `TC_B_07` C (`C-45`) |
| SetVariables | `TC_B_09` **M**; `TC_B_10` C (`C-46`) |
| **StatusNotification** | `TC_G_01` / `TC_G_02` are **charging-station only**. The only Core CSMS row in that block is `TC_G_20`. |

The candidate list was drawn up from message names; the certification matrix is
organised by **which side is under test**. `Reset` turning out to be three
mandatory cases and `StatusNotification` turning out to be none is the
correction, and it runs in both directions.

`TC_G_20`'s own status was **not measured** — it is the one cell in this table
the parse above did not produce. Look it up before a status scenario is
written, and do not read the row above as calling it mandatory.

## The v0.3 slice

The rule gives a pool of 104. The first vertical slice is a subset of that
pool, and this is it — seven cases, every one of them `M`:

| Case | What it exercises |
|---|---|
| `TC_B_01` | cold boot, accepted |
| `TC_B_06` | read one variable |
| `TC_B_09` | write one variable |
| `TC_B_20`, `TC_B_21`, `TC_B_22` | reset, three mandatory cases |
| `TC_F_20` | heartbeat |

Chosen because between them they touch boot, the device model and a
CSMS-initiated operation — the three parts of the driver contract this
milestone changes. A slice that exercised only charge-point-initiated messages
would leave the half of the contract that is actually new untested.

**What this bounds, and why it is written before the contract work rather than
after it.** Only three of the seven are CSMS-initiated: `Reset`,
`GetVariables`, `SetVariables`. `BootNotification` and `Heartbeat` are
observed, not driven. So the first 2.0.1 operation vocabulary needs **three
operations**, not eighteen, and "as few as the first slice needs" is now a
number instead of an intention.

A scenario issue may implement fewer of these seven and say why. It may not
implement a case outside them without either extending this list or changing
the rule — which is the whole point of the list being here rather than in a
review comment.

## `M` only, not `M` plus the conditionals a CSMS declares

The alternative reading — the pool is `M`, plus every `C` whose feature the
CSMS under test declares `Yes` — is more faithful to how a certification tool
actually selects, and it is a strictly larger set. It is rejected, and the
reason is not size.

`M` is a property of the **specification**. "`C`, and the feature is declared"
is a property of **one CSMS**. Folding the second into the selection rule would
make this harness's own perimeter depend on a particular vendor's attestation,
which is exactly the boundary the core is built not to cross: what a CSMS can
and cannot drive is a fact about that CSMS, not about this harness, and the
place it already lives is the **driver's** scope table.

So the two halves of this file close on each other. The rule stays
CSMS-independent; a conditional case becomes reachable through a driver
declaring it, in the vocabulary the next section gives it.

## What a 2.0.1 `reason` cites

A `ScopeEntry` is `{ status, reason }`, and every `reason` must cite the
precise limitation — an endpoint that does not exist, a member that is absent.
For OCPP 1.6 that is necessarily prose, because 1.6 offers no identifier to
name.

2.0.1 does. Part 5 §1 is explicit that **features**, not test cases, are the
unit of optionality, and §4's `Feature no.` column binds each conditional case
to one: `C-13`, `C-45`, `R-0`, `LA-0`, `DM-0`, `UI-0`, `SC-4`, `ISO-4`. A
`CONDITIONAL` or `NOT_APPLICABLE` row about a `cert201-` scenario can cite the
same feature a certification tool would have used to skip the same case.

**The convention: open the `reason` with that identifier.**

```ts
"C-45: the CSMS declares no support for reading a variable's full attribute
 set, so TC_B_07 has no request to make."
```

The licensing objection this invites — that the declaration form is an OCA
template under BY-ND and a vendor's filled copy is not ours to publish — does
not bite, because **the OCA publishes the filled abstract itself**, inside the
certificate. Certificate `OCA.0201.0053.CSMS` (S44 Energy, product CitrineOS,
OCPP software version 1.5.1, certified 2024-12-12 by DEKRA Certification, Inc.
against OCPP 2.0.1 Edition 3 FINAL incl. Errata 2024-11) carries 35 Yes/No
declarations, `C-11`…`C-50.2` and `AQ-1`…`AQ-6`:

<https://openchargealliance.org/wp-content/uploads/2025/01/Certificate_OCA.0201.0053.CSMS_S44.pdf>

A scope row derived from a public attestation cites a URL. Nothing needs
republishing, and a reviewer can check the claim without asking the vendor for
a spreadsheet.

**`reason` stays `string`.** Typing that identifier — a closed union, so a typo
is a build error — is the obvious next move and it is not made here. The
argument sits where it would be re-proposed, next to the declaration in
`tck/scope.ts`, and the instruction alone is in `CONTRIBUTING.md` for a driver
author who never opens this page.

## Why this is not a selection axis, yet

Certification profiles are a ready-made way to select scenarios by domain, and
that makes it tempting to build `--profile` here. It is not built, deliberately.

What the tree has today is **one** way to select scenarios and one way to tell
them apart, which are not the same thing:

- `--group` selects. Its five buckets mirror an upstream file's array
  membership rather than any taxonomy, which is the problem issue #34 opens for
  OCPP 1.6 in a later milestone.
- the **certification namespace** a `templateId` opens with — `cert16-`,
  `cert201-` — separates. The runner and its guards already treat it as a
  first-class concept, deliberately without a version literal anywhere in them,
  but **no flag selects on it**: it scopes container names and guard reach, not
  a sweep.

That separation is enough for v0.3, because a handful of new scenarios can be
named or swept without an axis at all. A `--profile` built now would be built
on a **single value**, deciding blind the questions #34 exists to settle: whether
the axis is declared in the vendored spec files (each edit costs a re-pin) or
in a registry beside the groups (no re-pin, a second place to keep in step),
and whether the vocabulary is closed or open.

The rule that applies is the milestone's own (issue #25): if 2.0.1 introduces a
selection axis it must be **the** mechanism #34 builds, not a second one beside
it, or the milestone after inherits two ways to select the same thing.
Building it here is precisely how that happens.

So this page states a rule and a list, and #34 gets to decide how a list
becomes a flag.

## The guard this page does not have yet

The failure mode this page has is the ordinary one: the written rule and the
implemented perimeter drift apart, quietly, and the page keeps reading well.
It is the failure `OCA-COVERAGE.md` records under its own obligation count, so
the question is not whether a guard is wanted but whether one can exist yet.

It cannot, for the reason in the opening: nothing implements the rule. The
guard worth having has two directions, and both are empty:

1. every registered `cert201-` scenario traces to a case in the slice list
   above;
2. every case in that list is either implemented or marked as not yet.

Direction 1 has nothing to range over. Direction 2 would be red on all seven
rows from the first commit, which is a build that is red on purpose and
therefore a build nobody reads. A guard that cannot be made to fail today
cannot be shown to fail *correctly* today, and that demonstration is this
repository's entry condition for a guard.

**The trigger is the first `cert201-` scenario.** The issue that writes it owns
this guard, and by then both directions have rows to break. Written down here
so that "should this have a guard?" is a decision on the record rather than an
omission someone re-discovers.

The precedent is exact and worth reading before re-proposing: the OCA
obligations guard refuses a per-namespace breakdown for the same reason, in the
same terms — with one namespace in the file it would be a second spelling of
the same number.

## Not in v0.3

Written out, because 914 pages of test cases make an unwritten line slip:

- the other three certification profiles — Advanced Security, Smart Charging,
  ISO 15118 Support — and Core's conditional rows: everything the table above
  counts that the rule does not select;
- the Core mandatory cases beyond the slice — all but the seven above;
- a shared 1.6 / 2.0.1 abstraction layer. One slice is not evidence;
- a `Reusable State` fixture mechanism. Part 6 defines 13 of them for the CSMS
  role, and this suite has timers and one-shot provisioning, which are not the
  same thing. Named as a gap, not built;
- charging-station-role testing;
- any claim that passing this harness is OCA certification. Certification runs
  through an accredited laboratory, a declaration form and the official testing
  tool; the certificate cited above is what that produces, and it is not what
  this produces.
