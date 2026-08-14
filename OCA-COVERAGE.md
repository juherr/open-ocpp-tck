# OCA-COVERAGE.md

Which OCA test case each scenario traces to, and every obligation that case
puts on the **Central System** in response to a request the charge point sent.

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

## Coverage

"asserted before" is what the scenario checked about the CSMS's answer before
issue #11 was addressed; "added" is what `assertAllAnswered` now checks.
46 checks added across 24 scenarios.

### `tck/specs/core.ts`

| scenario | OCA case | mandated `.conf` | asserted before | added |
|---|---|---|---|---|
| `cert16-tc001-cold-boot` | TC_001 | BootNotification, Heartbeat, StatusNotification | BootNotification | **Heartbeat, StatusNotification** |
| `cert16-tc003-charging-plugin-first` | TC_003 | Authorize, StartTransaction, StatusNotification | StartTransaction | **Authorize, StatusNotification** |
| `cert16-tc004-charging-id-first` | TC_004_1 | Authorize, StartTransaction, StatusNotification | StartTransaction | **Authorize, StatusNotification** |
| `cert16-tc005-ev-side-disconnect` | TC_005_1 | StatusNotification, StopTransaction | — | **StatusNotification, StopTransaction** |
| `cert16-tc013-hard-reset` | TC_013 | BootNotification, StatusNotification | — | **BootNotification, StatusNotification** |
| `cert16-tc014-soft-reset` | TC_014 | BootNotification, StatusNotification | — | **BootNotification, StatusNotification** |
| `cert16-tc017-unlock-occupied` | TC_017_1, TC_017_2 | — | — | — |
| `cert16-tc018-unlock-failure` | TC_018_1 | StatusNotification, StopTransaction | — | **StatusNotification, StopTransaction** |
| `cert16-tc019-get-configuration-all` | TC_019_1 | — | — | — |
| `cert16-tc019-get-configuration-key` | TC_019_2 | — | — | — |
| `cert16-tc021-change-configuration` | TC_021 | — | — | — |
| `cert16-tc024-lock-failure` | TC_024 | StatusNotification | — | **StatusNotification** |
| `cert16-tc031-unlock-unknown-connector` | TC_031 | — | — | — |
| `cert16-tc061-clear-cache` | TC_061 | — | — | — |
| `cert16-tc064-data-transfer` | TC_064 | DataTransfer | DataTransfer | — |

### `tck/specs/authlist-reservation.ts`

| scenario | OCA case | mandated `.conf` | asserted before | added |
|---|---|---|---|---|
| `cert16-tc042-1-get-local-list-version-not-supported` | TC_042_1 | — | — | — |
| `cert16-tc042-2-get-local-list-version-empty` | TC_042_2 | — | — | — |
| `cert16-tc043-1-send-local-list-not-supported` | TC_043_1 | — | — | — |
| `cert16-tc043-3-send-local-list-failed` | TC_043_3 | — | — | — |
| `cert16-tc043-4-send-local-list-full` | TC_043_4 | — | — | — |
| `cert16-tc043-5-send-local-list-differential` | TC_043_5 | — | — | — |
| `cert16-reservation-basic` | TC_046 | Authorize, StartTransaction, StatusNotification | — | **Authorize, StartTransaction, StatusNotification** |
| `cert16-tc048-1-reserve-now-faulted` | TC_048_1 | — | — | — |
| `cert16-tc048-2-reserve-now-occupied` | TC_048_2 | StatusNotification | — | **StatusNotification** |
| `cert16-tc048-3-reserve-now-unavailable` | TC_048_3 | StatusNotification | — | **StatusNotification** |
| `cert16-tc048-4-reserve-now-rejected` | TC_048_4 | — | — | — |
| `cert16-tc051-cancel-reservation` | TC_051 | StatusNotification | — | **StatusNotification** |
| `cert16-tc052-cancel-reservation-rejected` | TC_052 | StatusNotification | — | **StatusNotification** |

### `tck/specs/remotetrigger-smartcharging.ts`

| scenario | OCA case | mandated `.conf` | asserted before | added |
|---|---|---|---|---|
| `cert16-tc010-remote-start` | TC_010 | Authorize, StartTransaction, StatusNotification | — | **Authorize, StartTransaction, StatusNotification** |
| `cert16-tc011-remote-start-stop` | TC_011_1 | Authorize, StartTransaction, StatusNotification | — | **Authorize, StartTransaction, StatusNotification** |
| `cert16-tc012-remote-stop` | TC_012 | StatusNotification, StopTransaction | — | **StatusNotification, StopTransaction** |
| `cert16-tc026-remote-start-rejected` | TC_026 | — | — | — |
| `cert16-tc028-remote-stop-rejected` | TC_028 | — | — | — |
| `cert16-tc054-trigger-message` | TC_054 | DiagnosticsStatusNotification, FirmwareStatusNotification, Heartbeat, MeterValues, StatusNotification | — | **DiagnosticsStatusNotification, FirmwareStatusNotification, Heartbeat, MeterValues, StatusNotification** |
| `cert16-tc055-trigger-message-rejected` | TC_055 | — | — | — |
| `cert16-tc056-central-smart-charging-txdefault` | TC_056 | — | — | — |
| `cert16-tc057-central-smart-charging-txprofile` | TC_057 | — | — | — |
| `cert16-tc059-remote-start-with-profile` | TC_059 | Authorize, StartTransaction, StatusNotification | — | **Authorize, StartTransaction, StatusNotification** |
| `cert16-tc066-get-composite-schedule` | TC_066 | — | — | — |
| `cert16-tc067-clear-charging-profile` | TC_067 | — | — | — |

### `tck/specs/firmware.ts`

| scenario | OCA case | mandated `.conf` | asserted before | added |
|---|---|---|---|---|
| `cert16-tc044-1-firmware-update` | TC_044_1 | BootNotification, FirmwareStatusNotification, StatusNotification | — | **BootNotification, FirmwareStatusNotification, StatusNotification** |
| `cert16-tc044-2-firmware-download-failed` | TC_044_2 | FirmwareStatusNotification | — | **FirmwareStatusNotification** |
| `cert16-tc044-3-firmware-install-failed` | TC_044_3 | BootNotification, FirmwareStatusNotification, StatusNotification | — | **BootNotification, FirmwareStatusNotification, StatusNotification** |
| `cert16-tc045-1-get-diagnostics` | TC_045_1 | DiagnosticsStatusNotification | — | **DiagnosticsStatusNotification** |

### `tck/specs/authorize.ts`

| scenario | OCA case | mandated `.conf` | asserted before | added |
|---|---|---|---|---|
| `cert16-tc023-1-authorize-invalid` | TC_023_1 | Authorize | Authorize | — |
| `cert16-tc023-2-authorize-expired` | TC_023_2 | Authorize | Authorize | — |
| `cert16-tc023-3-authorize-blocked` | TC_023_3 | Authorize | Authorize | — |

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

**29 of the 77 `_CSMS` cases have no scenario at all.** The 47 scenarios cover
48 cases -- `cert16-tc017-unlock-occupied` answers both `TC_017_1` and
`TC_017_2`. Uncovered:

```
TC_004_2  TC_007    TC_011_2  TC_030    TC_032_1  TC_037_1  TC_037_3  TC_039
TC_040_1  TC_040_2  TC_045_2  TC_047    TC_049    TC_053    TC_073    TC_074
TC_075_1  TC_075_2  TC_076    TC_077    TC_078    TC_079    TC_080    TC_081
TC_083    TC_085    TC_086    TC_087    TC_088
```

That is a coverage gap in the other direction, and a much larger piece of work
than issue #11: each needs a charge-point-side scenario template, and the
templates are not in this repository -- they are baked into the pinned
`ocpp-cp-simulator` image (`tck/sim.ts`). Stated here so the suite's extent is
a number rather than an inference from "47 scenarios".

## Keeping this current

The reference is revised. When it is, re-derive rather than re-read: the
extraction above is a dozen lines of text processing over `pdftotext -layout`
output, and the useful diff is in the *mandated* column, not the prose.
