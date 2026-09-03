# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Released as `0.3.0`. The documented install ref already points at that tag, so
`tests/documented-install-ref.sh` is what notices when it is cut.

### Added

- `tck/specs/OCA-201-OPERATIONS.txt` — which CSMS-initiated operation each of
  the 147 selected OCPP 2.0.1 cases obliges the CSMS to send. **Twenty kinds of
  operation** between them, against the four `CsmsOperation201` now carries: 90
  of the 147 drive at least one, and 57 drive none at all. That is the number
  `OCA-201-SELECTION.md` said was owed and the number issue [#87] asked for, and
  the page now carries it beside a tranche table sized by cases *completed* per
  verb rather than by cases mentioning one ([#87])
- `tools/extract-201-operations.ts` — the measurement, as a command rather than
  a note. Takes the Part 6 path as a required argument, since the reference is
  cited by URL and not committed, and `--diff` re-checks the committed rows
  against it. Not in `bun run test`, which stays offline ([#87])
- `tests/oca-201-operations.sh` — the table covers the cases the slice selects,
  a slice reason that names an operation agrees with the measurement, and no
  slice row claims a case whose operation `CSMS_OPERATION_201_ACTIONS` has not
  ([#87])
- `TriggerMessage` joins `CsmsOperation201`, with `MessageTrigger201` for OCPP
  2.0.1's `MessageTriggerEnumType`. The vocabulary is four operations, not
  three, because `TC_F_20` needs it — see Fixed ([#87])

- `CsmsDeviceModelRecords` — what the CSMS *recorded* when a
  `StatusNotification` arrived, as `records.deviceModel`. It is the one part of
  the contract the wire cannot reach: a 2.0.1 CSMS answers every status with an
  empty response whatever it did with the payload, so "stored" and "dropped"
  look identical from the charge point. Two methods, the connector entity and
  the device model, because a CSMS can lose a status at either. An optional
  capability like `reservations` — a driver that omits it gets the throwing
  stub — but note that a status is only observable after the run, so every call
  site is in `assert()`, where the runner's NOT APPLICABLE net does not reach.
  A driver without it declares the scenario NOT_APPLICABLE in its scope table
  ([#86])
- `drivers/citrineos` provisions the OCPP 2.0.1 device model, which is what
  makes a station's `StatusNotification`s land anywhere. `driver provision`
  seeds the tenant-scoped half — an EVSE type, a `Connector` component and an
  `AvailabilityState` variable per `(evseId, connectorId)` the station reports
  — and `prepareStation` writes the per-station EVSEs and connectors, which
  hang off a row that does not exist until a station connects. `driver verify`
  and `driver teardown` follow, the latter keeping any row a scenario left
  pointing at a fixture. Measured: the four `StatusNotificationService`
  warnings that named the gap are gone, and stay gone across runs ([#86])
- `cert201-tcb01-cold-boot` asserts that each status the station reported was
  RECORDED, not merely answered — the pairs read back from the frames rather
  than from a list, so a station reporting a third connector is checked for one
  ([#86])
- `tests/citrineos-device-model-fixture.ts`, which holds the fixture's shape
  offline in six parts: the station-scope `(0, 0)` target is provisioned, each
  target gets its own distinctly-instanced component, `verify` names each
  missing piece, `teardown` keeps what is still referenced, the prepare hook
  re-asserts a join CitrineOS breaks on every status it files, and an insert
  that loses a race to a parallel lane is a no-op where one that fails for any
  other reason is still reported ([#86])
- `FetchLike` in the core (`open-ocpp-tck/driver`) — the `fetch` seam a driver's
  HTTP client takes so an offline guard can hand it a fake CSMS. It was declared
  in `drivers/steve/ui-client.ts`, which still re-exports it, so nothing that
  imported it from there has to move ([#80])
- A second, opt-in operation vocabulary for OCPP 2.0.1 — `CsmsOperation201`
  with `Reset`, `GetVariables` and `SetVariables` (and `TriggerMessage`, added
  later in this cycle — see above); `operations201?` on
  `CsmsDriverParts` and `CsmsCapabilities`; `csms201` on `DriveContext`. A
  driver that speaks only OCPP 1.6 declares nothing and compiles untouched
  ([#70])
- Report which OCPP 2.0.1 operations a driver drives, in `check-driver` and in
  its `--json` summary, answerable offline and without a container ([#70])
- Keep the simulator's JSONL wire trace beside its log, per scenario ([#64])
- The first five OCPP 2.0.1 scenarios — `cert201-tcb01-cold-boot`,
  `cert201-tcb20-reset-accepted`, `cert201-tcb21-reset-scheduled`,
  `cert201-tcb22-reset-rejected` and `cert201-tcf20-heartbeat` — in a
  `core-201` group that `run-all` sweeps like any other ([#73])
- `cert201-tcb06-get-variables` and `cert201-tcb09-set-variables`, which
  complete the seven cases the first slice bounded. Both were declined as blocked
  on CSMS device-model provisioning; measurement says they were not. The device
  model that answers a `GetVariables` is the *station's* — the pinned simulator
  resolves the pair through a component/variable map of its own — and CitrineOS
  reads its own only for optional batching limits, which fall back when it is
  empty. Driven green against an unprovisioned device model ([#25])
- A scenario can declare the OCPP version it is written for, and whether the
  simulator runs a scenario template of its name. Neither field is set by the
  47 scenarios that predate them ([#73])
- `drivers/citrineos` drives the OCPP 2.0.1 vocabulary against the v2 line:
  `Reset`, `GetVariables` and `SetVariables` over the same message API, with
  the version as a path segment ([#73])
- `ResetRequest`'s optional `evseId`, which is what makes a rejected reset
  expressible ([#73])
- `tck/specs/OCA-201-SLICE.txt`, the list of selected OCPP 2.0.1 cases, and
  `tests/oca-201-slice.sh`, which holds it and the registered scenarios to each
  other in both directions ([#73])
- `OCA-201-SELECTION.md`, the rule deciding which OCPP 2.0.1 certification
  cases this suite may implement at all ([#68])
- A feature identifier for an OCPP 2.0.1 scope `reason` to cite ([#68])
- This changelog ([#70])

### Changed

- The runner layer — `tck/main.ts`, `sim.ts`, `assert.ts`, `spec-types.ts` and
  the five spec modules — is **forked, not vendored**. Upstream agreed in
  [shiv3/ocpp-cp-simulator#271](https://github.com/shiv3/ocpp-cp-simulator/issues/271)
  that it belongs here and will retire its own copy, so `VENDOR.md` now marks
  those ten rows `upstream-forked`: upstream path and fork-point digest kept
  for provenance, no local digest, no patch. `tests/vendor-integrity.sh`
  checks the Apache-2.0 §4(b) notice on each file's first lines instead of
  reverse-applying a patch, and the seven files that had no such notice got
  one. `tck/ocpp.ts` and `tck/util.ts` stay `upstream-verbatim`
- **BREAKING** — `CsmsCapabilities` gains a required `deviceModel: boolean`,
  beside `reservations` and `chargingProfiles`. An out-of-tree driver adds one
  line; a driver that does not gets a compiler error naming the field, which is
  the point of it not being optional ([#86])
- **BREAKING** — `SteveUiOps.isLoggedIn`, `.login` and `.ensureLogin` are
  private. None of them is serialised — they run under the lock `postForm`
  takes — so a second entry point into the session was a way to reopen the race
  that no guard could observe. They had no caller outside the class here, but
  they were exported and shipped in `types/`, so an external one stops
  compiling: same reason `SimTransportDefaults.extraArgs` was marked breaking
  in 0.2.0 despite nothing reading it. `postForm` and `op` keep their
  signatures, so the break is confined to the three methods above — but not
  their behaviour: `postForm` now serialises login, page fetch and submit
  against every other call on the instance, and `op` delegates to it. The
  constructor takes an optional `fetch` as a second argument ([#77])
- **BREAKING** — the OCPP 1.6 operation vocabulary now says which protocol it
  is: `CsmsOperation` → `CsmsOperation16`, `CsmsOperationAction` →
  `CsmsOperation16Action`, `CsmsOperations` → `CsmsOperations16`, `ResetType` →
  `ResetType16`, `CSMS_OPERATION_ACTIONS` → `CSMS_OPERATION_16_ACTIONS`,
  `CsmsDriverParts.operations` and `CsmsCapabilities.operations` →
  `operations16`, `DriveContext.csms` → `csms16`. A driver updates its imports
  and renames those members; no behaviour changes and no signature changes
  shape ([#70])
- **BREAKING** — the OCPP version moved from the driver's transport defaults to
  `SimConfig`, where it is a property of the scenario rather than of the CSMS
  ([#64])
- The OCPP 2.0.1 selection rule drops its `profile = Core` term and its
  seven-case slice. It now reads `role = CSMS, status = M` on every
  certification profile, which selects **147 cases** rather than 104 or seven —
  Core 104, Advanced Security 4, Smart Charging 21, ISO 15118 Support 36, less
  the 18 the last two profiles share — and a case is covered when it is
  implemented *or declined in writing*. No scenario, guard or type changes
  shape: what moves is what the suite says it owes. Of the 147, 39 run against
  a profile the CitrineOS certificate does not attest, which
  `OCA-201-SELECTION.md` states once rather than leaving to be noticed ([#25])
- The licensing question is answered: **a list of case identifiers may be
  committed, whatever its length.** `OCA-201-SELECTION.md` forbade it on an
  argument about *extent*; CC BY-ND draws its line on modification, and a list
  of identifiers modifies nothing. That page's licensing section now carries the
  argument, the one risk the answer accepts, and the line that replaces the
  extent one — identifiers in, a reference's prose and tables out, the PDFs out
  for a reason of ours rather than the licence's. The line is drawn on kinds of
  material, so it covers both protocols: `tck/specs/OCA-OBLIGATIONS.txt`'s OCPP
  1.6 rows are the harder case and are named as in, with `OCA-COVERAGE.md`
  carrying the worked application beside the derivation it belongs to. The line
  also gains the clause the tree was already relying on unwritten: a short
  marked quotation that *identifies* what is under discussion — `tck/assert.ts`
  naming the column `assertAllAnswered` checks — is not step text brought into
  ours. Unblocks taking the 2.0.1 list from seven rows to the whole pool ([#84])
- The OCPP 1.6 *Compliancy Testing Tool - Test Case Document* is recorded as
  CC BY-ND 4.0, © 2010–2025 Open Charge Alliance, read off its own front
  matter. `OCA-COVERAGE.md` cited the revision and the URL but never the terms,
  so the licence under which this suite's oldest reference sits was an
  assumption. It is the same one OCPP 2.0.1's Parts 5 and 6 carry, which is why
  one rule covers both ([#84])
- `NOTICE` carries the OCA attribution the answer above owes. It goes there
  rather than on the page that argues for it, because `NOTICE` is in
  `package.json`'s `files` and that page is not: a consumer of the pinned git
  dependency receives `tck/specs/OCA-201-SLICE.txt`, so it has to receive the
  notice too ([#84])
- `tck/specs/OCA-201-SLICE.txt` holds all **147** selected OCPP 2.0.1 cases
  rather than seven, so it is the pool instead of a bound on it. Seven are
  implemented; 140 decline with a reason, written per group of cases that share
  a blocker rather than per row. Nothing a consumer calls changes — the file is
  what says which `cert201-` scenarios may exist at all ([#85])
- The per-profile totals the selection rule is measured against are corrected.
  Three of the four had been counted with a row selected when `M` appeared in
  *either* of the certification matrix's two status columns rather than in its
  CSMS one, which is why the rule was published as selecting 205 cases;
  re-reading it selects 165 matrix rows and 147 distinct cases. Core was right.
  `OCA-201-SELECTION.md` now records the correction, and pins the edition it
  was measured against, which the first derivation note never did ([#85])
- `OCA-201-SELECTION.md` cites the slice list instead of restating it, the way
  `OCA-COVERAGE.md` cites `OCA-OBLIGATIONS.txt` ([#73])
- The runner refuses a run where `SIM_EXTRA_ARGS` would silently replace a
  scenario's declared OCPP version, and writes the simulator's argv as the
  first line of `results/<scenario>.log` so an archived run can say which
  protocol it spoke ([#73])
- `ASSERT-INVENTORY.txt` records the OCPP version a scenario declares, so
  dropping the declaration — which changes nothing else a committed artifact
  can see, and silently measures the other protocol — moves the diff ([#73])
- A scenario is judged on the simulator's JSONL wire trace, with the log as the
  floor rather than the source of truth ([#65])
- `Verdict` is derived from `VERDICTS`, so the list cannot lose a member
  without the typecheck saying so ([#65])

### Removed

- `patches/` and its entry in `package.json`'s `files`. The patches were the
  §4(b) record and the upstream pull request in one artifact; with the runner
  forked there is no upstream original to diff against and no pull request to
  cut. `tools/repin-vendored.sh` refuses an `upstream-forked` path by name
- **BREAKING** — `SimTransportDefaults.extraArgs`. Nothing read it, so a driver
  stating it was ignored in silence ([#64])
- The adaptive observation window. It was built, guarded and shipped, then
  measured: every scenario it extended reached the cap and failed anyway
  ([#55])

### Fixed

- `cert201-tcf20-heartbeat` measures the case it claims. `TC_F_20` is *Trigger
  message - Heartbeat*: the CSMS is the system under test, its step 1 is a
  `TriggerMessageRequest`, and that step carries the case's only tool
  validation. The scenario drove a heartbeat from the station and asserted the
  answer — steps 3 and 4, and nothing the case validates — so the slice row
  claimed more than the scenario did, in the direction that reads as coverage.
  It now drives `TriggerMessage(Heartbeat)` and keeps the Heartbeat assertions
  as the trigger's consequence. Nothing could contradict the old row until the
  cases were read; `tests/oca-201-operations.sh` is the direction that now
  would ([#87])
- Four `tck/specs/OCA-201-SLICE.txt` rows whose reason the measurement
  contradicted, carrying two reasons between them. `TC_M_24`, `TC_M_26` and
  `TC_M_28` shared a reason with rows that do need a certificate operation and
  need none — they are the station asking the CSMS — and `TC_F_27`'s named a
  missing operation that is no longer missing. The reasons were written per
  group from Part 5's arrangement, which groups by profile rather than by what
  a case drives ([#87])

- **Behaviour change for `drivers/citrineos` consumers.** A CitrineOS request
  that never reached the CSMS now ends the scenario with `ERROR` instead of a
  `WARN` it carried on past. `warnOpFailed` lets `CsmsNotDispatchedError`
  through and warns about everything else, and this driver raised it nowhere —
  so a refused connection produced confident `FAIL`s about a charge point
  nobody had asked anything, which is issue #77's shape on the second driver.
  The test is whether the request became an OCPP CALL — not whether it reached
  the host. A `200` carrying `success: false` reached CitrineOS and was
  understood by it; what it never became is a message to the charge point, and
  that is what makes it a non-dispatch alongside a refused connection, a
  timeout, and any non-2xx from the message API. The last of those rests on one
  fact about CitrineOS: it answers `200` for everything that reaches its OCPP
  layer, so a status is proof that nothing did. For a records read the same
  test reads "never reached the data API".
  What the CSMS *answered* deliberately stays an ordinary failure: a stalled
  body, an unparseable one, one that is not a confirmation array, anything
  Hasura reported in-band, and a non-2xx from `/v1/metadata` — that endpoint
  reports a request it understood and refused *with* a status, where
  `/v1/graphql` reports in-band, so the same code means opposite things on the
  two. **A sweep that was green because it warned past one of the first group
  will now be red**, which is the point, but it is a red to read row by row
  rather than to assume is new ([#80])
- `cert16-tc013-hard-reset` and `cert16-tc014-soft-reset` no longer flake on
  SteVe, at 45% and 34% of sweeps. The manager-UI client is loaded once per
  process and shared by every parallel lane, and its form post was a
  read-modify-write over one cookie jar: log in — which clears the jar — then
  GET a page for its CSRF token, then POST it back. Two lanes interleaving meant
  one spent a token against a session that had replaced its own, Spring answered
  `403`, and the `Reset` never reached the wire, so the scenario reported
  failures about a charge point that was never asked. The post is now serialised
  on the instance, login included, which keeps the single session the class is
  built around. A failed signin is also reported instead of silently leaving an
  unauthenticated session behind ([#77])
- A CSMS operation the transport refused is no longer indistinguishable from one
  the CSMS answered wrongly. Drivers raise `CsmsNotDispatchedError` when a
  request never became an OCPP CALL, and scenarios let it out as an `ERROR`
  rather than warning and continuing into assertions about a charge point that
  was never asked. Twelve inline copies of that warning became one helper
  ([#77])
- `cert201-tcb21-reset-scheduled` measures its case instead of reporting its
  precondition. The station sends its OCPP 2.0.1 `Authorize` idToken with `type`
  set to `ISO14443`, and CitrineOS validates the idToken value against that
  type's format — 8 or 14 hexadecimal characters — before any lookup, so no tag
  `drivers/citrineos` seeded could start a transaction and the reset was always
  answered against an idle station. The driver now seeds `CE712001`, hexadecimal
  and stored with that type, `driver verify` checks the stored type, and
  `driver provision` repairs a row whose type has drifted. The scenario's
  `SKIPPED` path is unchanged, so a CSMS that still cannot start a transaction
  is not accused of a `Reset` non-conformance ([#75])
- An operation-name list that omits a member is now a compile error. Both
  vocabularies are covered; the 1.6 list had the same hole, and everything able
  to notice a missing name was computed from the list itself ([#70])
- A summary row about an unsupported OCPP 2.0.1 `Reset` no longer reads like
  one about a 1.6 `Reset` ([#70])
- The drive-trace extractor receives the OCPP 2.0.1 half of `DriveContext`, and
  a stub context that omits a member is refused at compile time rather than at
  regeneration time ([#70])
- The foreign-sweep guard, the red-row reading and the spec invariants no
  longer assume the `cert16-` namespace, so a scenario in any certification
  namespace is seen ([#67], [#64])
- Six assertions that matched the vendored simulator's member order rather than
  the OCPP payload ([#65])
- A reshaped spec array is refused rather than filtered out, which had kept
  whole scenario groups out of the pinned artifacts with the diff staying empty
  ([#67])
- An unusable simulator environment is refused, and a missing trace is reported
  ([#64])

## [0.2.1] - 2026-08-17

Trustworthy verdicts on OCPP 1.6 — the `v0.2` milestone, closed. An
observation-window extension was added and removed inside this release; see
[the release notes][0.2.1-notes] for why.

## [0.2.0] - 2026-08-16

A second CSMS, declared expected failures, and the answers a CSMS owes. See
[the release notes][0.2.0-notes].

## [0.1.0] - 2026-07-31

The OCPP 1.6 TCK, extracted as a standalone package. See
[the release notes][0.1.0-notes].

<!--
Releases before 0.3.0 are summarised by their own release notes rather than
restated here: this file was started during 0.3.0, and reconstructing three
releases from 141 commits would mean writing detail nobody measured.
-->

[Unreleased]: https://github.com/juherr/open-ocpp-tck/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/juherr/open-ocpp-tck/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/juherr/open-ocpp-tck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/juherr/open-ocpp-tck/releases/tag/v0.1.0
[0.2.1-notes]: https://github.com/juherr/open-ocpp-tck/releases/tag/v0.2.1
[0.2.0-notes]: https://github.com/juherr/open-ocpp-tck/releases/tag/v0.2.0
[0.1.0-notes]: https://github.com/juherr/open-ocpp-tck/releases/tag/v0.1.0
[#25]: https://github.com/juherr/open-ocpp-tck/issues/25
[#55]: https://github.com/juherr/open-ocpp-tck/pull/55
[#64]: https://github.com/juherr/open-ocpp-tck/pull/64
[#65]: https://github.com/juherr/open-ocpp-tck/pull/65
[#67]: https://github.com/juherr/open-ocpp-tck/pull/67
[#68]: https://github.com/juherr/open-ocpp-tck/pull/68
[#70]: https://github.com/juherr/open-ocpp-tck/pull/70
[#73]: https://github.com/juherr/open-ocpp-tck/pull/73
[#75]: https://github.com/juherr/open-ocpp-tck/issues/75
[#77]: https://github.com/juherr/open-ocpp-tck/issues/77
[#80]: https://github.com/juherr/open-ocpp-tck/issues/80
[#84]: https://github.com/juherr/open-ocpp-tck/issues/84
[#85]: https://github.com/juherr/open-ocpp-tck/issues/85
[#86]: https://github.com/juherr/open-ocpp-tck/issues/86
[#87]: https://github.com/juherr/open-ocpp-tck/issues/87
