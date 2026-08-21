# OCA-201-SELECTION.md

Which OCPP 2.0.1 certification cases this suite is allowed to implement, stated
as the rule the list is drawn from, and what a scope row about 2.0.1 may cite.

OCPP 2.0.1 Part 6 is 914 pages, so the question "which of it do we owe?" needs
an answer that is not a judgement. It was first asked in the other direction:
the milestone that introduced 2.0.1 said explicitly that the suite was not to
be ported and named six candidate messages, and six names chosen by hand is not
a rule — without one, "a small representative set" is a judgement each reviewer
makes differently and the milestone grows by a case at a time.

The milestone now asks for the whole mandatory CSMS set, and the same rule
answers the opposite question: not how little is enough, but what completeness
*means*. It still says no — to the conditionals and to the charging-station
cases — and it is still the only thing standing between a 914-page reference
and a perimeter someone re-draws per review.

This file is the rule. It is not a coverage table and it is not the list: the
list is [`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt), one row
per selected case, and the coverage arithmetic for OCPP 1.6 lives in
[`OCA-COVERAGE.md`](OCA-COVERAGE.md).

Writing a driver scope row rather than choosing scenarios? The section you want
is [what a 2.0.1 `reason` cites](#what-a-201-reason-cites); nothing between here
and there concerns you.

## The rule

Part 5 §4 is a matrix with a `Conf. test for CSMS` column, where `M` means
mandatory for the profile, `C` means conditional on a declared feature, and
blank means the case does not address this role at all. So:

> **role = CSMS, status = `M`**, on every certification profile.

Everything else — the conditionals and the charging-station-only cases — is
out, and out by arithmetic rather than by taste.

**This rule used to carry a third term, `profile = Core`, and dropping it is
the change the coverage milestone makes.** The term was never part of the
arithmetic; it was the first slice's way of saying "one profile is enough to
prove the architecture". It was, and the proof is spent. What it selects now is
205 cases rather than 104.

## What the rule is drawn against

| Certification profile | rows | CSMS `M` | CSMS `C` | CSMS blank (CS-only) |
|---|---|---|---|---|
| **Core** | 364 | **104** | 83 | 177 |
| **Advanced Security** | 8 | **6** | 2 | 0 |
| **Smart Charging** | 40 | **36** | 4 | 0 |
| **ISO 15118 Support** | 64 | **59** | 5 | 0 |
| | 476 | **205** | 94 | 177 |

One narrowing, and it is the rule: 476 rows to the 205 mandatory for this role.
There used to be a second, taking Core's 104 to a seven-case slice; that one was
never a rule and is gone.

For scale: the entire OCPP 1.6 certification set has 77 `_CSMS` cases — the
count [`OCA-COVERAGE.md`](OCA-COVERAGE.md) derives and this suite's 47 OCPP 1.6
scenarios are measured against. One profile of 2.0.1 asks for more mandatory
CSMS cases than 1.6 has cases at all, and all four ask for nearly three times.
Part 6 devotes p608–p900 to 251 `*_CSMS` cases, which is scale rather than a
term in the narrowing: it is a different document's count of a different
population, and how it relates to the matrix's rows was **not measured**.

**How the counts above were derived.** The columns cannot be recovered from PDF
reading order, but they can be recovered from x-position: `pdftotext
-bbox-layout`, then bucket the `M` and `C` glyphs by column. That is a dozen
lines of text processing, written down so it can be **redone** rather than
re-read when the reference is revised — the same arrangement, and for the same
reason, as `OCA-COVERAGE.md`'s derivation note. Nothing in this repository can
check the result; the PDF is not here and cannot be. Those counts, and the `M` /
`C` status of every case this page names, carry exactly the status
`OCA-COVERAGE.md`'s own totals carry: measured, then written into prose.
Everything else numeric here is cited from the references rather than counted.

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
the parse did not produce. Look it up before a status scenario is written, and
do not read the row above as calling it mandatory.

## The coverage target

The rule selects 205 cases, every one of them `M`. They belong **in
[`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt)** rather than here
— one row per case, naming the scenario that implements it or the reason there
is none — and that file currently enumerates **seven** of them, which the
paragraph below owns rather than glosses. It is machine-readable and guarded in
both directions; this page states the rule it was drawn against. The
arrangement, and the reason for it, is [`OCA-COVERAGE.md`](OCA-COVERAGE.md)'s
with
[`OCA-OBLIGATIONS.txt`](tck/specs/OCA-OBLIGATIONS.txt): a second copy of a list
drifts, and the prose copy is the one nobody diffs.

A case is covered when it is implemented **or declined in writing**. Declining
a mandatory case is a decision, and the guard refuses a `not-implemented` row
with nothing after it, so the two are not the same as "not done yet".

**The list is seven rows, not 205, and that gap is deliberate rather than
overlooked.** Two things have to happen before the rest can be written, and
they are the milestone's first two issues:

- the identifiers behind the 205 have never been enumerated. The per-profile
  totals in the table above were counted; the rows were not. The method for
  redoing the parse is [in the derivation note](#what-the-rule-is-drawn-against),
  and this time it has to keep the case identifier per row rather than only the
  count;
- committing 205 rows is the thing [the licensing
  section](#what-may-be-committed-here-and-what-may-not) currently forbids, and
  that has to be answered before the file is produced rather than after.

Until then the file still bounds what may be implemented — direction 1 of the
guard is what does that, and it does not care how long the file is. What is
temporarily untrue is the stronger claim, that the file **is** the pool.

**What the first slice bounded, kept because it is the worked example of
writing the number down before the work.** Its seven cases were boot, reading
and writing one variable, reset — three mandatory cases of its own — and
heartbeat, chosen because between them they touched boot, the device model and
a CSMS-initiated operation: the three parts of the driver contract that
milestone changed. Five of the seven are CSMS-initiated — the three Reset
cases, plus reading and writing a variable — but between them they spell only
**three kinds of operation**, which is the count a vocabulary is measured in.
So the first 2.0.1 vocabulary needed three, not eighteen, and "as
few as the first slice needs" was a number instead of an intention before a
line of it was written. The same arithmetic is owed for 205 and has not been
done.

A scenario issue may implement fewer than the list holds and say why — which
the first one did, leaving `TC_B_06` and `TC_B_09` to the device-model
provisioning they have nothing to read or write without, with the reason in the
row. It may not implement a case outside the list without either extending it
or changing the rule, which is the whole point of the list existing rather than
being re-drawn per review. That half is checked: see [the guard](#the-guard).

## 95 of the 205 have no attestation behind them

The rule is a property of the specification, so it selects the same 205 cases
whatever CSMS is on the other end. What is *not* uniform across those 205 is the
thing this suite leans on when a scenario goes red.

The argument runs: CitrineOS is certified, so a red is first of all information
about *our* scenario rather than about the CSMS. Certificate
`OCA.0201.0053.CSMS` — the same one cited below — declares **Core Pass** and
**Advanced Security Pass**. Local Authorization List Management, Smart Charging,
Advanced Device Management, Reservation, Advanced User Interface and ISO 15118
Support are all **Not Tested**.

| Profile | mandatory CSMS cases | attested |
|---|---|---|
| Core | 104 | yes |
| Advanced Security | 6 | yes |
| Smart Charging | 36 | **no** |
| ISO 15118 Support | 59 | **no** |

So for 95 of the 205 the argument is unavailable, and so is its converse: a
green says the build happens to answer, not that anyone assessed the answer.
That is not a reason to drop those cases — the rule selects them and the rule is
about the specification — but it is a reason to say once, here, that a verdict
in those two profiles carries less than a verdict in the other two. How it is
reported is an open decision; the vocabulary this repository already has for
outcomes of that shape is in `tck/standing.ts` and `tck/scope.ts`, and the
question is whether "never assessed on this profile" is one of them or genuinely
new.

The build-level version of the same argument — that we pin neither the certified
1.5.1 nor any release — is its own issue, and the two sharpen each other rather
than overlap.

## `M` only, not `M` plus the conditionals a CSMS declares

The alternative reading — the pool is `M`, plus every `C` whose feature the
CSMS under test declares `Yes` — is more faithful to how a certification tool
actually selects, and it is a strictly larger set. It is rejected, and the
reason is not size.

`M` is a property of the **specification**. "`C`, and the feature is declared"
is a property of **one CSMS**. Folding the second into the selection rule would
make this harness's own perimeter depend on one vendor's attestation, which is
the boundary `tck/scope.ts` is built on — and the place that fact already lives
is the **driver's** scope table. The rule stays CSMS-independent; a conditional
case becomes reachable through a driver declaring it, in the vocabulary the
next section gives it.

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
template under the [no-derivatives licence](#what-may-be-committed-here-and-what-may-not)
the references carry, and a vendor's filled copy is not ours to publish — does
not bite, because **the OCA publishes the filled abstract itself**, inside the
certificate. Certificate `OCA.0201.0053.CSMS` (S44 Energy, product CitrineOS,
OCPP software version 1.5.1, certified 2024-12-12 by DEKRA Certification, Inc.
against OCPP 2.0.1 Edition 3 FINAL incl. Errata 2024-11) carries 35 Yes/No
declarations, `C-11`…`C-50.2` and `AQ-1`…`AQ-6`:

<https://openchargealliance.org/wp-content/uploads/2025/01/Certificate_OCA.0201.0053.CSMS_S44.pdf>

A scope row derived from a public attestation cites a URL. Nothing needs
republishing, and a reviewer can check the claim without asking the vendor for
a spreadsheet.

**`reason` stays `string`.** Both ways of structuring that identifier — a
closed union, and an optional free-string field beside `reason` — are declined
for now, and the argument sits where they get re-proposed, next to the
declaration in `tck/scope.ts`. `CONTRIBUTING.md` carries the instruction alone,
for a driver author who never opens this page.

## What may be committed here, and what may not

*OCPP 2.0.1 Part 5 — Certification Profiles and Test Cases* supplies the
selection matrix; *Part 6 — Test Cases* supplies the cases themselves. Both are
**CC BY-ND 4.0**. This repository is public and Apache-2.0, and BY-ND permits
no derivative works, so their text, their tables and the PDFs stay out of it.
What may be committed, and what this page is made of: **case identifiers**
(`TC_B_01`), **requirement identifiers** (`P02.FR.06`), **feature identifiers**
(`C-45`), **counts**, and our own prose — already the line the OCPP 1.6
scenarios sit on.

The line is drawn on **extent**, not shape: citing the handful of cases under
discussion is a citation, while committing the mandatory column in full
re-renders the matrix's own selection whatever the markup around it looks like.
So no table on this page is the pool, and the pool is not committed anywhere.

**And the coverage target asks for exactly that, so this section is now an open
question rather than a settled one.** A 205-row `OCA-201-SLICE.txt` is the
column the paragraph above forbids. There is no version of the milestone that
does not have to answer it, and answering it by committing the file and seeing
whether anyone objects is answering it by default. The two readings — that a
list of case identifiers mandatory for one role is a *fact about the
specification* rather than a derivative of its prose, or that rows may only be
committed as cases are handled, at the cost of the file no longer expressing a
perimeter — are set out in the milestone issue, and the decision is the
repository owner's. **Until it is made, this section stands as written and the
list stays at seven rows.**

## Why this became a selection axis

Certification profiles are a ready-made way to select scenarios by domain. This
page used to say the axis was deliberately not built, and the argument for
waiting was a good one right up until the target changed.

What the tree has today is one way to select scenarios and one way to tell them
apart:

- `--group` **selects**. Five of its six buckets mirror an upstream file's
  array membership rather than any taxonomy, which is the problem issue #34
  opens for OCPP 1.6; the sixth is the file the 2.0.1
  scenarios are written in, which is the same kind of accident of authorship
  rather than a version axis — nothing derives a bucket from a `templateId`.
- the **certification namespace** a `templateId` opens with — `cert16-`,
  `cert201-` — **separates**. The runner and its guards treat it as a
  first-class concept, deliberately without a version literal anywhere in them,
  but no flag reads it: it scopes container names and guard reach, not a sweep.

That separation was enough while the slice was seven scenarios: a handful can be
named or swept without an axis at all. The objection to building `--profile`
then was that it would be built on a **single value**, deciding blind the
questions #34 exists to settle — whether the axis is declared in the vendored
spec files (each edit costs a re-pin) or in a registry beside the groups (no
re-pin, a second place to keep in step), and whether the vocabulary is closed or
open.

**Four profiles and 205 cases retire that objection and replace it with the
opposite one.** The axis now has values to be built on, and doing nothing does
not leave the tree axis-less — it produces `smartcharging-201`,
`security-201`, `iso15118-201` beside `core-201`, which is N×M buckets where two
axes give N+M, and each one arrives looking like a reasonable local decision.

The rule that applies is unchanged and is now satisfiable rather than
prohibitive: if 2.0.1 introduces a selection axis it must be **the** mechanism
#34 builds, not a second one beside it, or the milestone after inherits two ways
to select the same thing. #34 has moved into this milestone for that reason, and
#74 — a scenario's protocol being a declaration rather than whatever
`SIM_OCPP_VERSION` resolved — is the other half of the same seam.

## The guard

The failure mode this page has is the ordinary one: the written rule and the
implemented perimeter drift apart, quietly, and the page keeps reading well.
It is the failure `OCA-COVERAGE.md` records under its own obligation count.

`tests/oca-201-slice.sh` is the check, and it has two directions:

1. every registered `cert201-` scenario traces to a row of
   [`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt);
2. every row of that file is either implemented or declined **with a reason**.

**It could not have existed before the first scenario**, which is why this page
carried its absence as a decision rather than an omission. Direction 1 had
nothing to range over, and direction 2 would have been red on every row
from the first commit — a build that is red on purpose is a build nobody reads.
A guard that cannot be made to fail cannot be shown to fail *correctly*, and
that demonstration is this repository's entry condition for a guard.

What the guard cannot check is the thing that matters most: that the rows really
are the cases the rule selects. That is a reading of a PDF this repository
cannot contain, the method for redoing it is above, and those rows carry exactly
the status `OCA-COVERAGE.md`'s totals carry — measured, then written down. What
stops afterwards is the drift.

**And it cannot check that the rows are all of them.** Direction 2 ranges over
the file, so a file short of the pool is a file the guard finds complete. That
is the exposure the coverage target creates and the reason the gap is named in
[the section that owns it](#the-coverage-target) rather than left for a reader
to notice: at seven rows out of 205 the build is green on a list that describes
a seventh of what was promised, and nothing in the tree says so.

One shape it deliberately does not have, and the precedent is exact — the
header of `tests/oca-obligations.sh` refuses a per-namespace breakdown in the
same terms: with one namespace in the file it would be a second spelling of the
same number.

## Still out of scope

Written out, because 914 pages of test cases make an unwritten line slip. This
list got shorter when the target grew, which is the point of keeping it: what
leaves it leaves by a decision someone can find.

- **the 94 conditional rows** — everything the table above counts that the rule
  does not select. The reason is [above](#m-only-not-m-plus-the-conditionals-a-csms-declares)
  and it is not size;
- **a shared 1.6 / 2.0.1 abstraction layer.** One slice was not evidence; 205
  cases may become some, and that is an argument to make once the second
  vocabulary exists rather than a reason to generalise ahead of it;
- **charging-station-role testing** — the 177 rows the matrix marks blank for
  this role, and a milestone of its own;
- **any claim that passing this harness is OCA certification.** Certification
  runs through an accredited laboratory, a declaration form and the official
  testing tool; the certificate cited above is what that produces, and it is not
  what this produces.

A `Reusable State` fixture mechanism used to be on this list, named as a gap
rather than built, on the grounds that inlining a state per scenario was cheaper
than a mechanism. At seven scenarios it was. Part 6 defines 13 of them for the
CSMS role, and at 205 cases the copies drift and each one reads reasonably, so
it is now in scope and has an issue.
