# OCA-COVERAGE.md

Which OCA test case each scenario traces to, and every obligation that case
puts on the **Central System** in response to a request the charge point sent.

**Everything counted here is OCPP 1.6** — the reference below, and every total
derived from it. OCPP 2.0.1's cases come from another document and are governed
by [`OCA-201-SELECTION.md`](OCA-201-SELECTION.md).

`README.md` states the mapping rule; this file is where it is checked. It
exists because a scenario can assert everything the charge point *sent* and
still not notice that the CSMS answered with a CALLERROR -- which is exactly
what happened to `TC_044_{1,2,3}` (issue #11): three scenarios green against a
CSMS that answers `FirmwareStatusNotification.req` with
`NotSupported`.

## The reference

*OCPP Compliancy Testing Tool - Test Case Document*, revision **2025-09**,
linked from the [OCPP 1.6 certification page][octt]:

<https://openchargealliance.org/wp-content/uploads/2025/09/CompliancyTestTool-TestCaseDocument.pdf>

[octt]: https://openchargealliance.org/certificationocpp/certification-ocpp-1-6/

Its front matter states **CC BY-ND 4.0**, © 2010–2025 Open Charge Alliance —
the same licence OCPP 2.0.1's Parts 5 and 6 carry. So what may be taken from it
is [the same
rule](OCA-201-SELECTION.md#what-may-be-committed-here-and-what-may-not), and
`NOTICE` carries the attribution for both.

Section 2 is SUT = Charge Point (`TC_*_CS`). **Section 3 is SUT = Central
System (`TC_*_CSMS`)** -- 77 cases, and the only ones that apply here. Where a
`_CS` and a `_CSMS` case share a number they are different tests, not two
renderings of one.

## How this table was derived

Each `_CSMS` case has a two-column *Scenario Detail(s)* table: **Charge Point
(Tool)** on the left, **Central System (SUT)** on the right. Within a `_CSMS`
case, any `<Action>.conf` where `<Action>` is charge-point-initiated
(`Authorize`, `BootNotification`, `DataTransfer`,
`DiagnosticsStatusNotification`, `FirmwareStatusNotification`, `Heartbeat`,
`MeterValues`, `StartTransaction`, `StatusNotification`, `StopTransaction`) is
necessarily a step on the SUT side -- so the obligations can be read off
without parsing the column layout, which the PDF text extraction mangles.

Three cases delegate to a **reusable state** (section 3.22), which has to be
expanded first:

| reusable state | expands to |
|---|---|
| `Booted` | `BootNotification.conf`, `StatusNotification.conf` |
| `Authorized` | `Authorize.conf` |
| `Charging` | `Authorized` + `StatusNotification.conf` x2 + `StartTransaction.conf` |

One wrinkle in the reference itself: **TC_004_1_CSMS** declares
`Reusable State(s): n/a` and then gives its entire *Scenario Detail(s)* as the
bare list item `- Charging`. It is read here as executing the `Charging`
state, which is the only reading under which the case tests anything.

**What a derivation may carry across** is decided once, in
[`OCA-201-SELECTION.md`](OCA-201-SELECTION.md#what-may-be-committed-here-and-what-may-not).
Its worked example is OCPP 2.0.1, but the rule is about kinds of material and
this page is the older case of it — and the harder one, because what is read
here is a case's *Scenario Detail(s)* table rather than one column of a matrix.
What comes out of that reading is case identifiers, OCPP message names, counts
and our own prose. No step, precondition or expected result is reproduced, and
a row does not let a reader reconstruct the case: `TC_003` owing `Authorize`,
`StartTransaction` and `StatusNotification` is a fact about the case, not the
sentences that state it. That is what keeps this side of the line; bringing the
*Scenario Detail(s)* wording, or its two-column layout, into ours is what would
cross it.

## Coverage

The table itself is [`tck/specs/OCA-OBLIGATIONS.txt`](tck/specs/OCA-OBLIGATIONS.txt),
one row per obligation: scenario, action, the check that covers it, and the OCA
case it comes from. It lives there rather than here because
`tests/oca-obligations.sh` cross-checks it against
`tck/specs/ASSERT-INVENTORY.txt` in both directions — an obligation with no
check and a check with no obligation are both build failures.

**56 obligations. 49 are `assertAllAnswered` checks -- 46 added by issue #11,
three by `cert16-tc053` -- and the other 7 were already covered** by `assertResponseStatus`,
`assertIdTagInfoStatus`, or the hand-rolled block in `cert16-tc064`.

That count used to be stated here as "46 obligations, 46 checks", which was
wrong in a way nothing could catch — it counted only the new checks and called
them the whole set. The guard exists because of it, and found it.

Four of the 46 can never go green: the scenario carrying the obligation never
puts the request on the wire. Those report **SKIPPED**, which makes the
scenario PARTIAL — orange, outside the exit code — rather than PASS or FAIL.
Red would say "the CSMS did not answer" about a question nobody asked; green
would hide the gap. Which four was measured, not guessed: a full sweep plus
`tools/answered-report.ts`. There were seven until `cert16-tc054` triggered
all five messages its case lists rather than one.

## Unexercised obligations

Four `.conf` obligations report SKIPPED on every driver, because the scenario
does not put the corresponding request on the wire. Each was confirmed against
a real sweep's logs, not inferred from reading the specs. They are checked --
so a run shows them — but they cannot pass until the scenario changes.

| scenario | OCA step | obligation | why the request is never sent |
|---|---|---|---|
| `cert16-tc001-cold-boot` | TC_001 step 6 | `Heartbeat.conf` | the case's Heartbeat is periodic, at the interval `BootNotification.conf` returns, and the scenario holds 20 s. Measured on the wire: SteVe returns 14400 s, CitrineOS 60 s, codetics-ev-server-lite 60 s. See below for why the hold is not simply raised. TC_054 triggers a Heartbeat explicitly and carries the obligation instead. |
| `cert16-tc010-remote-start` | TC_010 step 6 | `Authorize.conf` | the simulator's `AuthorizeRemoteTxRequests` is read-only `false`, so it starts the transaction without authorizing first ([shiv3/ocpp-cp-simulator#921](https://github.com/shiv3/ocpp-cp-simulator/issues/921)). |
| `cert16-tc011-remote-start-stop` | TC_011_1 step 4 | `Authorize.conf` | same |
| `cert16-tc059-remote-start-with-profile` | TC_059 step 4 | `Authorize.conf` | same |

The `Authorize` rows are the same fact three times, and it is a fact about
the charge point this suite drives, not about remote start. OCPP 1.6 §5.11
makes the effect of `RemoteStartTransaction.req` depend on the
`AuthorizeRemoteTxRequests` key: when it is `true`, the charge point behaves
as for a local start and authorizes the idTag first, which may mean an
`Authorize.req`; only when it is `false` does it start straight away. The
three OCA cases are written for the first reading: the charge point sends
`Authorize.req` after its `RemoteStartTransaction.conf`, and the Central
System owes the `.conf`. §9.1.3 lets the charge point choose whether the key
is read-only, so the pinned simulator's read-only `false` is conformant; it
just leaves no scenario a way to turn the behaviour on. That is
[shiv3/ocpp-cp-simulator#921](https://github.com/shiv3/ocpp-cp-simulator/issues/921),
and these rows can go green once a pinned simulator lets the key be set to
`true`. Until then `TC_003` and `TC_004`, which are locally driven and do send
`Authorize`, are where that obligation is checked.

The `tc001` row stays open on purpose. Closing it faithfully means a hold
longer than the interval the CSMS returns, and that cannot be had cleanly for
every driver:

- **SteVe's interval is a global setting**, in whole minutes (its settings
  page, `ocppSettings.heartbeat`; 0 means "client default"). Shortening it
  would be a write to CSMS-wide state that no driver makes today, would apply
  to every station of every lane, and still has a floor of 60 s.
- **The simulator's Heartbeat is an idle timer**, re-armed by every CALL the
  station sends (`HeartbeatService.notifyOutgoingCall` at the pinned 0.10.1).
  So even at 60 s, the first Heartbeat leaves one interval after the last boot
  `StatusNotification`: about 70 s of hold for one Heartbeat, about 130 s to
  see the period the case describes, against 20 s today.

That is a sweep-time cost on every driver and a provisioning change on one, to
measure a `.conf` that `cert16-tc054` already measures with a Heartbeat it
triggers itself.

Closing any of these is a change to the scenario -- a longer hold, an extra
trigger -- not a change to what the checks assert. Until then each shows up as
a SKIPPED check whose detail is tagged `UNEXERCISED_PREFIX`, which is what
tells it apart from the other reason a check is skipped: a value THIS CSMS
could not supply. Those vary per driver; these do not. The tag is in the run
log, under the `SKIPPED:` line -- `summary.md` counts skipped checks but does
not say why, so read the run when the two need separating.

## One unanswered request that is nobody's fault

The sweep turns up exactly one charge-point request that went unanswered
across all 44 scenarios:

```
cert16-tc013-hard-reset  StopTransaction  answered=0 callerror=0 unanswered=1
```

`TC_013_CSMS` does not put a `StopTransaction.conf` on the Central System, so
no check fires on it. The cause is on the charge point's side: a hard reset
sends `StopTransaction.req` and then tears the socket down without waiting.
The CSMS very likely did answer, into a closed socket.

It is recorded because it is the kind of thing this report exists to surface,
and because anyone who later adds a `StopTransaction` check to this scenario
should know it will go red for this reason.

## Findings recorded, not acted on

**`MeterValues.conf` is mandated by exactly one case.** Several scenarios
assert that `MeterValues` went out (`tc003`, `tc004`, `tc005`, `tc010`), but
only `TC_054_CSMS` -- the TriggerMessage case -- puts a `MeterValues.conf` on
the Central System. No check is added outside `tc054`. The omission is the
reference's, and copying it is deliberate: this file tracks the OCA cases, and
inventing obligations they do not state would make the suite's green mean
something no one can look up.

**`TC_043_2_CSMS` does not exist.** Our scenario ids run `tc043-1`, `-3`, `-4`,
`-5`, which reads like a gap. It is the reference's own numbering:
`TC_043_2_CS` exists (SUT = Charge Point) and has no `_CSMS` counterpart. There
is nothing to cover, and nothing to open an issue about.

**28 of the 77 `_CSMS` cases have no scenario at all.** The 48 OCPP 1.6
scenarios that trace to a case cover 49 cases -- `cert16-tc017-unlock-occupied` answers both `TC_017_1` and
`TC_017_2`. Uncovered:

```
TC_004_2  TC_007    TC_011_2  TC_030    TC_032_1  TC_037_1  TC_037_3  TC_039
TC_040_1  TC_040_2  TC_045_2  TC_047    TC_049    TC_073    TC_074    TC_075_1
TC_075_2  TC_076    TC_077    TC_078    TC_079    TC_080    TC_081    TC_083
TC_085    TC_086    TC_087    TC_088
```

That is a coverage gap in the other direction, and a much larger piece of work
than issue #11: each needs a charge-point-side scenario template, and the
templates are not in this repository -- they are baked into the pinned
`ocpp-cp-simulator` image (`tck/sim.ts`). Stated here so the suite's extent is
a number rather than an inference from "48 scenarios". The OCPP 2.0.1
scenarios are counted nowhere on this page: their own selection rule and list
are `OCA-201-SELECTION.md` and `tck/specs/OCA-201-SLICE.txt`.

## Scenarios no OCA case covers

One OCPP 1.6 scenario traces to the specification instead of to a case, and
its id says so: `cert16-spec48-…` rather than `cert16-tcNNN-…`, because
`README.md` ties the second shape to OCA case `TC_NNN`.

| scenario | clause | what it measures |
|---|---|---|
| `cert16-spec48-start-transaction-busy-connector` | OCPP 1.6 §4.8, with §3.7.1 for the consequence | a `StartTransaction.req` for a connector that already has an open transaction gets a `StartTransaction.conf` — not a CALLERROR — with a `transactionId` of its own and the tag's status, `Accepted` |

§4.8 has the Central System respond with a `StartTransaction.conf` and not let
the outcome of its own checks stop it; §3.7.1 is why that matters, since a
charge point answered with a CALLERROR resends the message and finally
discards it. No section-3 case sends a second `StartTransaction` on a busy
connector, so nothing above derives the obligation.

It deliberately carries no `assertAllAnswered` and no row in
`tck/specs/OCA-OBLIGATIONS.txt`: that table is the OCA cases' obligations and
nothing else, which is the rule "Findings recorded, not acted on" applies to
`MeterValues.conf`. Every count on this page is over OCA cases and leaves it
out. A §4.8 obligation is a SHOULD, so a CSMS failing it deviates from a
recommendation rather than breaking a requirement; the scenario still reports
`FAIL`, and a driver that knows its CSMS does so declares it in `expected.ts`.

## Checking a real sweep against this table

```sh
bun run e2e                             # writes results/<template-id>.log
bun tools/answered-report.ts results/   # or --csv
```

The report prints, per scenario and per action, how many charge-point requests
the CSMS answered, how many drew a CALLERROR, how many were never answered,
and how many were still in flight when the container was stopped. It has no
expectations and never fails; the checks are `assertAllAnswered`, in the
scenarios, against the table above.

Read the two together. An action the report flags that this table lists is a
scenario already going red. An action the report flags that this table does
**not** list is the more interesting case: either the reference obliges
something this audit missed, or the CSMS is failing an obligation no OCA case
happens to state.

This is also what makes issue #11's original observation re-checkable. It
rested on "scanning every captured wire log, `FirmwareStatusNotification` is
the only action answered with a CALLERROR anywhere in the suite" — true when
written, and unverifiable afterwards, because `results/` is gitignored and CI
artifacts expire. It is one command now.

## What the guard still cannot check

`tests/oca-obligations.sh` keeps the table and the scenarios describing the
same set. It cannot check that a row is FAITHFUL to the reference — that
TC_046 really does oblige a `StartTransaction.conf`. That is a reading of a
PDF; the method is written down above so it can be redone, and no guard
replaces redoing it.

So the failure mode that remains is a row that was wrong from the start, and it
stays wrong quietly. Re-derive rather than re-read when the reference is
revised.

## Keeping this current

The reference is revised. When it is, re-derive rather than re-read: the
extraction above is a dozen lines of text processing over `pdftotext -layout`
output, and the useful diff is in the *mandated* column, not the prose.
