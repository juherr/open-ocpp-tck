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
147 cases rather than 104.

## What the rule is drawn against

| Certification profile | rows | CSMS `M` | CSMS `C` | CSMS blank (CS-only) |
|---|---|---|---|---|
| **Core** | 364 | **104** | 83 | 177 |
| **Advanced Security** | 8 | **4** | 0 | 4 |
| **Smart Charging** | 40 | **21** | 1 | 18 |
| **ISO 15118 Support** | 64 | **36** | 1 | 27 |
| | 476 | **165** | 85 | 226 |

One narrowing, and it is the rule: 476 rows to the 165 mandatory for this role.
There used to be a second, taking Core's 104 to a seven-case slice; that one was
never a rule and is gone.

**165 rows, 147 cases**, and the difference is not a third narrowing. A case can
appear in two profiles, and 37 do — every one of them in both Smart Charging and
ISO 15118. Nineteen of those carry `M` for this role somewhere: eighteen in both
profiles, and `TC_K_10` in ISO 15118 only, where Smart Charging leaves it
conditional. A case is a case, so the pool is the 147 distinct identifiers — and
that is also what [`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt)
can hold, since its guard refuses a second row for a case already listed.

For scale: the entire OCPP 1.6 certification set has 77 `_CSMS` cases — the
count [`OCA-COVERAGE.md`](OCA-COVERAGE.md) derives and this suite's 47 OCPP 1.6
scenarios are measured against. One profile of 2.0.1 asks for more mandatory
CSMS cases than 1.6 has cases at all, and all four ask for nearly twice as many.
Part 6 devotes p608–p900 to 251 `*_CSMS` cases, which is scale rather than a
term in the narrowing: it is a different document's count of a different
population, and how it relates to the matrix's rows was **not measured**.

**How the counts above were derived.** The columns cannot be recovered from PDF
reading order, but they can be recovered from x-position: `pdftotext
-bbox-layout`, then bucket the `M` and `C` glyphs by column. That is a dozen
lines of text processing, written down so it can be **redone** rather than
re-read when the reference is revised — the same arrangement, and for the same
reason, as `OCA-COVERAGE.md`'s derivation note. Nothing in this repository can
check the result; the PDF is not here and [will not
be](#what-may-be-committed-here-and-what-may-not). Those counts, and the `M` /
`C` status of every case this page names, carry exactly the status
`OCA-COVERAGE.md`'s own totals carry: measured, then written into prose.
Everything else numeric here is cited from the references rather than counted.

**Which reading the counts are of, because the first pass did not say.** *Part 5
— Certification Profiles*, **Edition 4, 2025-12-03**. The note above was written
without an edition on it, which is the one thing a note written to be redone
cannot leave out: a re-run that disagrees then has two explanations for the
disagreement and no way to tell them apart.

**And what the re-run corrected.** Redoing the parse to keep the identifiers
rather than only the counts moved three of the four profile totals. The numbers
being replaced, as `CSMS M / C / blank`, were **6 / 2 / 0** for Advanced
Security, **36 / 4 / 0** for Smart Charging and **59 / 5 / 0** for ISO 15118
Support, summing to the 205 this page and nine other tracked files quoted.

Core reproduced exactly, all four numbers, and so did every row total — 364, 8,
40, 64. The three that moved are reproduced exactly by counting a row as selected
when `M` appears in **either** status column, which is what the first pass did to
the three small tables: 6 / 2 / 0 and 59 / 5 / 0 fall straight out of it. The
tell was in the published table all along — a `CSMS blank (CS-only)` of **0** on
three profiles, when a column blank nowhere is not a column anyone read. Smart
Charging is the one that does not land on the old numbers under either reading,
37 / 3 against 36 / 4, which is what an edition apart looks like and is the
second reason the edition is now pinned.

The correction is kept here rather than applied silently, for
`OCA-COVERAGE.md`'s reason: a page that quietly agrees with itself is evidence
for nothing, and the next reader of a number wants to know whether it was
measured or inherited.

## What the rule corrects on a hand-drawn list

This is what a written rule buys, and it is kept here rather than smoothed
away, because a list that agreed with the rule everywhere would be evidence for
neither.

Against the six candidate messages named when the milestone was scoped:

| Candidate | Core CSMS rows |
|---|---|
| BootNotification | `TC_B_01` **M**; `TC_B_02` C (`C-44`), `TC_B_30` / `TC_B_31` C |
| **Heartbeat** | `TC_F_20` **M** — and it is a `TriggerMessage` case. See [below](#the-coverage-target). |
| Reset | `TC_B_20`, `TC_B_21`, `TC_B_22` — all **M** |
| GetVariables | `TC_B_06` **M**; `TC_B_07` C (`C-45`) |
| SetVariables | `TC_B_09` **M**; `TC_B_10` C (`C-46`) |
| **StatusNotification** | `TC_G_01` / `TC_G_02` are **charging-station only**. The only Core CSMS row in that block is `TC_G_20`. |

The candidate list was drawn up from message names; the certification matrix is
organised by **which side is under test**. `Reset` turning out to be three
mandatory cases and `StatusNotification` turning out to be none is the
correction, and it runs in both directions.

**And a third way it runs**, found later and by reading the case rather than
the matrix: a row of this table names the message a candidate *selected*, not
the message the case obliges the CSMS to send. `TC_F_20` is here under
Heartbeat and is *Trigger message - Heartbeat* — the heartbeat is what the
station is made to send, and what the CSMS must send is a `TriggerMessage`.
The matrix cannot say that; only Part 6 can.

`TC_G_20`'s own status was the one cell in this table the first parse did not
produce, and the re-run resolved it: **`M` for the CSMS, blank for the charging
station**. So the row above reads as it appears to — the one Core CSMS row the
status-notification group has is mandatory, and it is in the pool.

## The coverage target

The rule selects 147 cases, every one of them `M`. They belong **in
[`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt)** rather than here
— one row per case, naming the scenario that implements it or the reason there
is none — and that file enumerates **all 147**. It is machine-readable and
guarded in both directions; this page states the rule it was drawn against. The
arrangement, and the reason for it, is [`OCA-COVERAGE.md`](OCA-COVERAGE.md)'s
with
[`OCA-OBLIGATIONS.txt`](tck/specs/OCA-OBLIGATIONS.txt): a second copy of a list
drifts, and the prose copy is the one nobody diffs.

A case is covered when it is implemented **or declined in writing**. Declining
a mandatory case is a decision, and the guard refuses a `not-implemented` row
with nothing after it, so the two are not the same as "not done yet".

**The list used to be seven rows and is now the pool**, which is the change
this milestone's enumeration made. What stood between the two was never a
decision: the per-profile totals in the table above had been counted and the
rows behind them had not, so there was nothing to write down. Redoing the parse
to keep the case identifier per row is what produced the 147 — and, on the way,
the [correction](#what-the-rule-is-drawn-against) to three of the four totals.

The other half of that gap was whether a list this long may be committed at
all, given that the references are CC BY-ND, and it is
[answered](#what-may-be-committed-here-and-what-may-not): it may.

Thirty-six of the 147 are implemented and 111 decline with a reason. Those
reasons are written per group rather than per case — 23 of them across the 111 —
and the file's header says why that is the granularity the decision was taken
at rather than a placeholder. What a guard still cannot say is whether these
are the *right* 147, and that is [unchanged](#the-guard).

**Six of the first seventeen arrived with the first operation tranche**, which
is the other way this number moves and the expensive one. `ChangeAvailability`
headed the table below; nine cases name it and no other operation, and reading
those nine in *Part 6* found six writable against the pinned simulator. The
other three are declined on a Reusable State this build cannot reach rather
than on the verb, and their rows say which state and why.

**Nine more arrived with the second, and it is the same move at the size the
table says to make it at.** `SetChargingProfile` headed the table with thirteen
cases and `GetCompositeSchedule` added two that need nothing else; the two were
bought together because both are Smart Charging, both address an EVSE the same
way and both live behind one CSMS module, so a driver wiring one had already
paid for the other. Reading the fifteen in *Part 6* found nine writable. Of the
six that are not, four need a charging-profile verb this pair does not contain
and their rows now name it; two are the pinned simulator's — `TC_K_15` wants an
RPC-level answer its dispatcher never raises, `TC_K_31` a continued report its
payload literal cannot mark. Those two are the first rows here declined on the
station rather than on the vocabulary *after* the vocabulary arrived, which is
the shape a tranche leaves behind and the reason a tranche's cases are read
before its verb is written.

**Seven more arrived with the third, and it is the first tranche bought
alone.** `GetChargingProfiles` headed the table once the Smart Charging pair was
spent — eight cases need it — and no second verb shares its module the way
`GetCompositeSchedule` shared `SetChargingProfile`'s, so there was nothing whose
wiring was already paid for. Reading the eight in *Part 6* found seven writable.
The eighth is `TC_K_31`, and it is the first row here a tranche arrives for and
does **not** move: it was already declined on the pinned simulator's report
payload rather than on the verb, so its verb landing changed nothing about it.
That is worth naming as a shape rather than as a fact about one row — a tranche
is sized by cases *blocked on the verb*, and a row blocked on two things is
bought by neither. `TC_K_05`, which needs `ClearChargingProfile` beside this one,
is the same shape seen a step earlier.

**Four of the first eleven arrived by falsifying a reason rather than by adding
an operation**, which is worth naming because it is the cheapest way this number
moves. `TC_C_02`, `TC_E_10`, `TC_F_27` and `TC_J_01` need no member
`CsmsOperation201` does not already have; three of them ask a driver for
nothing at all. What had declined them was a group reason asserting that the
station side could not be driven without a simulator scenario template, and the
simulator's JSON-Lines CLI drives it without one. The tranche table below is
about the 57 rows a verb would unblock; this is the other direction, and
`tck/specs/OCA-201-SLICE.txt`'s header records what the rewritten reasons say
instead.

**What the first slice bounded, kept because it is the worked example of
writing the number down before the work.** Its seven cases were boot, reading
and writing one variable, reset — three mandatory cases of its own — and a
trigger, chosen because between them they touched boot, the device model and
a CSMS-initiated operation: the three parts of the driver contract that
milestone changed. Six of the seven are CSMS-initiated — the three Reset
cases, reading and writing a variable, and `TC_F_20` — but between them they
spell only **four kinds of operation**, which is the count a vocabulary is
measured in. So the first 2.0.1 vocabulary needed four, not eighteen, and "as
few as the first slice needs" was a number instead of an intention before a
line of it was written.

That paragraph said **three**, and `TC_F_20` was the seventh case rather than
the sixth CSMS-initiated one — "heartbeat, observed on the wire rather than
driven". It is not. `TC_F_20_CSMS` is *Trigger message - Heartbeat*: its step 1
is the CSMS sending a `TriggerMessageRequest`, and that step carries the case's
only tool validation. The claim was read off the case's title, and a title names
the message the station is made to send where the reference organises a case by
which side is under test — the same correction [the six candidate
messages](#what-the-rule-corrects-on-a-hand-drawn-list) needed, arriving a
second time from the other end. The scenario has been completed to drive the
trigger and `CsmsOperation201` carries the verb.

## How wide a vocabulary the 147 ask for

**Twenty kinds of operation**, against the eight the contract carries. Ninety of the 147 drive at
least one CSMS-initiated request and **57 drive none at all** — a case that only
observes charge-point-initiated traffic needs no verb, which is why "add the
rest of the 2.0.1 messages" was the wrong shape for this and why the answer is
20 rather than the protocol's forty-odd.

The list is [`tck/specs/OCA-201-OPERATIONS.txt`](tck/specs/OCA-201-OPERATIONS.txt),
one row per case, beside the slice for the reason the slice is beside this page:
two files, two references, one guarded relation. It carries the same status the
counts above carry — measured, then written down — and from the same edition,
*Part 6 — Test Cases*, **Edition 4, 2025-12-03**. `bun
tools/extract-201-operations.ts <part6.pdf>` is how it is redone, and `--diff`
is how the committed rows are re-checked; the method is a command rather than a
note here because it is a two-level read that looks like a one-level one, and
the extractor's header says why.

**Tranches, sized by cases completed rather than by cases mentioning a verb.**
Six cases need more than one operation, so the two counts differ: adding
`GetInstalledCertificateIds` is named by eight rows and finishes six of them,
because `TC_M_20` and `TC_M_21` want `DeleteCertificate` and
`InstallCertificate` as well. Greedy from the nine the union has, which leaves
**46** of the 147 short of a verb. `bun tools/extract-201-operations.ts
--tranches` is what prints this table — no PDF, just the row file and the
contract — and `tests/oca-201-operations.sh` holds the two together:

| # | operation | cases it completes | still blocked after |
|---|---|---|---|
| 1 | `UpdateFirmware` | 10 | 36 |
| 2 | `CustomerInformation` | 6 | 30 |
| 3 | `GetInstalledCertificateIds` | 6 | 24 |
| 4 | `InstallCertificate` | 5 | 19 |
| 5 | `RequestStartTransaction` | 5 | 14 |
| 6 | `GetLog` | 4 | 10 |
| 7 | `CertificateSigned` | 3 | 7 |
| 8 | `ClearCache` | 2 | 5 |
| 9 | `DeleteCertificate` | 2 | 3 |
| 10 | `SetNetworkProfile` | 2 | 1 |
| 11 | `RequestStopTransaction` | 1 | 0 |

The right-hand column is the number a tranche is worth arguing about, and it is
not the number of scenarios that become writable: a verb removes *one* blocker,
and 57 of the 147 never had that blocker while every one of them has another.
`tck/specs/OCA-201-SLICE.txt`'s reason column is where the rest are named, and
#71 — nothing checks that a declared capability is implemented — is what a
vocabulary growing twelve more times makes urgent; it is now checked, by
`tests/capability-parity.ts`.

A scenario issue may implement fewer than the list holds and say why — which
the first one did, leaving `TC_B_06` and `TC_B_09` to the device-model
provisioning they have nothing to read or write without, with the reason in the
row. It may not implement a case outside the list without either extending it
or changing the rule, which is the whole point of the list existing rather than
being re-drawn per review. That half is checked: see [the guard](#the-guard).

## 39 of the 147 have no attestation behind them

The rule is a property of the specification, so it selects the same 147 cases
whatever CSMS is on the other end. What is *not* uniform across those 147 is the
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
| Advanced Security | 4 | yes |
| Smart Charging | 21 | **no** |
| ISO 15118 Support | 36 | **no** |

The split of the 147 is 108 attested and 39 not, rather than 104 + 4 against
21 + 36: eighteen of the Smart Charging cases are ISO 15118 cases too, and no
case is attested under one profile and unattested under another, because the two
profiles that carry the attestation share no case with the two that do not.

So for 39 of the 147 the argument is unavailable, and so is its converse: a
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
**CC BY-ND 4.0**, and this repository is public and Apache-2.0. What may be
committed, and what this page is made of: **case identifiers** (`TC_B_01`),
**requirement identifiers** (`P02.FR.06`), **feature identifiers** (`C-45`),
**counts**, and our own prose — already the line the OCPP 1.6 scenarios sit on.
Their text, their tables and the PDFs stay out, for two different reasons.

**The 147-row list may be committed.** This section used to draw the line
somewhere else, and what changed is not an appetite for risk but a reading of
the licence. The sentence to unlearn:

> The line is drawn on **extent**, not shape: citing the handful of cases under
> discussion is a citation, while committing the mandatory column in full
> re-renders the matrix's own selection whatever the markup around it looks
> like.

Extent is the one thing `BY-ND` says nothing about. §2(a)(1)(A) grants the right
to "reproduce and Share the Licensed Material, **in whole or in part**"; what
§2(a)(1)(B) withholds is Sharing **Adapted Material**, which §1(a) defines as
material in which the Licensed Material is "translated, altered, arranged,
transformed, or otherwise modified **in a manner requiring permission** under
the Copyright and Similar Rights held by the Licensor". `ND` is a limit on
modification. The paragraph above read it as a limit on quantity, and
everything it concluded followed from that.

**Why the list is not Adapted Material.** Nothing of Part 5 is in the file as
expression: not a sentence, not a cell, not a step, not a precondition, not an
expected result. What is in it is the answer to a question asked *of* the
matrix — which rows carry `M` in the `Conf. test for CSMS` column — and that
answer is a fact about the specification, the status this repository already
gives `P02.FR.06` and `C-45`. The licence says as much about itself in §8(a): it
"does not, and shall not be interpreted to, reduce, limit, restrict, or impose
conditions on any use of the Licensed Material that could lawfully be made
without permission under this Public License". So the first question is not
whether `ND` forbids the file. It is whether the file needs permission at all.

**And where it does, §4 grants it.** Take the objection at its strongest — Part
5 §4 is a database, and 147 rows drawn from one of its columns are a substantial
extraction of the contents — and the licence answers in those terms. §4(a): "for
the avoidance of doubt, Section 2(a)(1) grants You the right to extract, reuse,
reproduce, and Share all or a substantial portion of the contents of the
database, provided You do not Share Adapted Material." Substantial extraction is
named and permitted, and the proviso is the one already met.

**The risk taken, written down rather than argued away.** §4(b) is the limb that
could bite: where a substantial portion of a licensed database's contents ends
up in a database *in which You have Sui Generis Database Rights*, that database
— though not its individual contents — is Adapted Material, and Adapted Material
may not be Shared. The reading under which `OCA-201-SLICE.txt` is such a
database is not absurd, because it carries a column of ours beside the
identifiers. Against it: the right §1(i) names is Directive 96/9/EC's, which
arises from substantial investment in obtaining, verifying or presenting
contents, and a hand-maintained flat file is not that. **This repository asserts
no Sui Generis Database Right in `OCA-201-SLICE.txt` or in anything drawn from
it.** That is the assumed risk and the whole of it. If it is ever pressed the
remedy is to delete the file, which costs the perimeter and not one scenario.

**Attribution, so the fallback stays available.** §4(c) makes §3(a)'s conditions
apply to a substantial extraction, so they are satisfied here whether or not
they are owed — otherwise the §4 argument would be a violation at the moment it
was needed. §3(a)(2) allows them to be met "by providing a URI or hyperlink to a
resource that includes the required information", so it is one block rather than
a header on every file that names a case — **and the block is in
[`NOTICE`](NOTICE), because that is the file that ships.** `package.json`'s
`files` carries `NOTICE` and `tck/`, so a consumer of the pinned git dependency
receives `OCA-201-SLICE.txt` and the attribution together; this page is not in
the package at all, which is what makes it the wrong home for a notice and the
right one for the argument behind it.

**Where the line falls now.** It replaces the extent line, and only the first
part moved:

- **identifiers, counts, and our own prose about them** — in. Not the Licensed
  Material as expression, and length is not a term. The 147-row list is on this
  side; so is any table of identifiers a future page needs; and so, already, is
  [`OCA-OBLIGATIONS.txt`](tck/specs/OCA-OBLIGATIONS.txt), which is the harder
  case and had never been ruled on. Its OCPP 1.6 rows were read out of that
  reference's *Scenario Detail(s)* tables, so they look like an extraction of
  case content rather than of identifiers — but a row is our scenario id, an
  OCPP message name, our helper's name and a case identifier. Three columns are
  ours or the protocol's, the fourth is an identifier, and what came out of the
  reference is *which* messages a case owes: a fact, not the wording that
  states it. [`OCA-COVERAGE.md`](OCA-COVERAGE.md) is the worked application,
  and note what the test turns on — that no expression is carried across, which
  is a question that does not need to know which licence the reference carries;
- **Part 5's and Part 6's prose, tables and step text, brought into ours** —
  out, and this is where `ND` actually bites. A case's steps trimmed to fit a
  paragraph, a matrix reflowed into Markdown, an expected result paraphrased:
  each is the Licensed Material "arranged" or "otherwise modified", which is
  §1(a)'s Adapted Material and §2(a)(1)(B) withholds Sharing it. Every assertion
  in `tck/specs/core-201.ts` is written rather than copied for this reason, and
  that file's header says so under `WRITTEN, NOT COPIED`;
- **the PDFs, whole and unmodified** — out, and *not* because the licence
  forbids it: §2(a)(1)(A) would permit exactly that, with attribution. The
  reason is ours. Everything in an Apache-2.0 tree is offered on Apache-2.0
  terms to whoever clones it, and a `BY-ND` document sitting inside one
  misstates its own terms to every fork. So a reference is cited by URL and not
  committed, which is what [`OCA-COVERAGE.md`](OCA-COVERAGE.md) already does in
  practice with the OCPP 1.6 test case document.

**One qualifier on the middle bullet, written because the tree already relies on
it.** A short quotation that *identifies* what is under discussion is not step
text brought into ours. `tck/assert.ts` names the column `assertAllAnswered`
checks by quoting the one-line template a `_CSMS` case uses for it, and
[`OCA-COVERAGE.md`](OCA-COVERAGE.md) quotes two field values of `TC_004_1` to
report that the reference contradicts itself there. Both are marked as
quotations, both are the shortest form that leaves the claim checkable by
someone holding the reference, and neither carries a step anyone could execute.
§2(a)(2) puts a use covered by an exception outside this licence altogether and
§8(a) says the licence does not reach it. The line to hold is the purpose: a
quotation is here to *name* something, never to spare us writing our own.

**No table on this page is the pool, and that outlives the licensing question.**
The list lives in
[`tck/specs/OCA-201-SLICE.txt`](tck/specs/OCA-201-SLICE.txt) for the reason [the
coverage target](#the-coverage-target) gives, which is now the only one holding
that sentence up.

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

**Four profiles and 147 cases retire that objection and replace it with the
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
are the cases the rule selects. That is a reading of a PDF this repository does
not carry, the method for redoing it is above, and those rows carry exactly
the status `OCA-COVERAGE.md`'s totals carry — measured, then written down. What
stops afterwards is the drift.

**And it cannot check that the rows are all of them.** Direction 2 ranges over
the file, so a file short of the pool is a file the guard finds complete. The
enumeration closed the gap that exposure was named for — the file holds 147 of
147 — but it did not close the exposure, and the two are worth telling apart. A
row deleted from this list is a mandatory case that stops being owed, silently
and with a green build, exactly as it was when the file held seven. What the
guard did lose is the shape the drift had for a year: the file is no longer
short *by construction*, so a short file is now a regression rather than a
state.

One shape it deliberately does not have, and the precedent is exact — the
header of `tests/oca-obligations.sh` refuses a per-namespace breakdown in the
same terms: with one namespace in the file it would be a second spelling of the
same number.

## Still out of scope

Written out, because 914 pages of test cases make an unwritten line slip. This
list got shorter when the target grew, which is the point of keeping it: what
leaves it leaves by a decision someone can find.

- **the 85 conditional rows** — everything the table above counts that the rule
  does not select. The reason is [above](#m-only-not-m-plus-the-conditionals-a-csms-declares)
  and it is not size;
- **a shared 1.6 / 2.0.1 abstraction layer.** One slice was not evidence; 147
  cases may become some, and that is an argument to make once the second
  vocabulary exists rather than a reason to generalise ahead of it;
- **charging-station-role testing** — the 226 rows the matrix marks blank for
  this role, and a milestone of its own;
- **any claim that passing this harness is OCA certification.** Certification
  runs through an accredited laboratory, a declaration form and the official
  testing tool; the certificate cited above is what that produces, and it is not
  what this produces.

A `Reusable State` fixture mechanism used to be on this list, named as a gap
rather than built, on the grounds that inlining a state per scenario was cheaper
than a mechanism. At seven scenarios it was. Part 6 defines 14 of them for the
CSMS role, and at 147 cases the copies drift and each one reads reasonably, so
it is now in scope and has an issue. THIRTEEN WAS THIS PAGE'S FIRST COUNT and
it was not a miscount: thirteen of the fourteen carry the label `Reusable
State` and the fourteenth is labelled `Memory State`, while the case that
invokes it calls it a reusable state in its own text. So thirteen counts
labels and fourteen counts fixtures a case can name, which is the number a
mechanism has to serve. `tck/specs/core-201.ts` carried the correction first.
