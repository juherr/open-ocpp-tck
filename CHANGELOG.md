# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Released as `0.3.0`. The documented install ref already points at that tag, so
`tests/documented-install-ref.sh` is what notices when it is cut.

### Added

- A second, opt-in operation vocabulary for OCPP 2.0.1 — `CsmsOperation201`
  with `Reset`, `GetVariables` and `SetVariables`; `operations201?` on
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

- **BREAKING** — `SimTransportDefaults.extraArgs`. Nothing read it, so a driver
  stating it was ignored in silence ([#64])
- The adaptive observation window. It was built, guarded and shipped, then
  measured: every scenario it extended reached the cap and failed anyway
  ([#55])

### Fixed

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
[#55]: https://github.com/juherr/open-ocpp-tck/pull/55
[#64]: https://github.com/juherr/open-ocpp-tck/pull/64
[#65]: https://github.com/juherr/open-ocpp-tck/pull/65
[#67]: https://github.com/juherr/open-ocpp-tck/pull/67
[#68]: https://github.com/juherr/open-ocpp-tck/pull/68
[#70]: https://github.com/juherr/open-ocpp-tck/pull/70
[#73]: https://github.com/juherr/open-ocpp-tck/pull/73
