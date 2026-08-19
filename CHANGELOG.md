# Changelog

## 0.3.0 - 2026-08-19

_Not tagged yet. The date above is when this entry was written, and is to be
corrected when `v0.3.0` is cut — the documented install ref already points at
that tag, so `tests/documented-install-ref.sh` is the thing that will notice._

_This file starts here. Releases before `0.3.0` are readable through the git
history and the GitHub releases page; reconstructing them after the fact would
mean writing summaries nobody measured._

### Changed

- **Breaking:** Rename the OCPP 1.6 operation vocabulary so it says which
  protocol it is: `CsmsOperation` → `CsmsOperation16`, `CsmsOperationAction` →
  `CsmsOperation16Action`, `CsmsOperations` → `CsmsOperations16`,
  `ResetType` → `ResetType16`, `CSMS_OPERATION_ACTIONS` →
  `CSMS_OPERATION_16_ACTIONS`, `CsmsDriverParts.operations` and
  `CsmsCapabilities.operations` → `operations16`, `DriveContext.csms` →
  `csms16`. A driver updates its imports and renames those members; no
  behaviour changes and no signature changes shape
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- **Breaking:** Move the OCPP version from the driver's transport defaults to
  `SimConfig`, where it is a property of the scenario rather than of the CSMS
  ([#64](https://github.com/juherr/open-ocpp-tck/pull/64))
- **Breaking:** Drop `SimTransportDefaults.extraArgs`. Nothing read it, so a
  driver stating it was ignored in silence
  ([#64](https://github.com/juherr/open-ocpp-tck/pull/64))
- Judge a scenario on the simulator's JSONL wire trace, with the log as the
  floor rather than the source of truth
  ([#65](https://github.com/juherr/open-ocpp-tck/pull/65))
- Derive `Verdict` from `VERDICTS` so the list cannot lose a member without the
  typecheck saying so
  ([#65](https://github.com/juherr/open-ocpp-tck/pull/65))

### Added

- A second, opt-in operation vocabulary for OCPP 2.0.1 — `CsmsOperation201`
  with `Reset`, `GetVariables` and `SetVariables`; `operations201?` on
  `CsmsDriverParts` and `CsmsCapabilities`; `csms201` on `DriveContext`. A
  driver that speaks only OCPP 1.6 declares nothing and compiles untouched
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- Report which OCPP 2.0.1 operations a driver drives, in `check-driver` and in
  its `--json` summary, answerable offline and without a container
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- Keep the simulator's JSONL wire trace beside its log, per scenario
  ([#64](https://github.com/juherr/open-ocpp-tck/pull/64))
- Document the rule deciding which OCPP 2.0.1 certification cases this suite
  may implement at all, in `OCA-201-SELECTION.md`
  ([#68](https://github.com/juherr/open-ocpp-tck/pull/68))
- Give an OCPP 2.0.1 scope `reason` a feature identifier to cite
  ([#68](https://github.com/juherr/open-ocpp-tck/pull/68))

### Fixed

- Make an operation-name list a compile error when it omits a member. Both
  vocabularies are covered; the 1.6 list had the same hole, and everything able
  to notice a missing name was computed from the list itself
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- Name the protocol when an OCPP 2.0.1 operation is unsupported, so a summary
  row about a 2.0.1 `Reset` does not read like one about a 1.6 `Reset`
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- Give the drive-trace extractor the OCPP 2.0.1 half of `DriveContext`, and
  refuse a stub context that omits a member at compile time rather than at
  regeneration time
  ([#70](https://github.com/juherr/open-ocpp-tck/pull/70))
- Unbind the foreign-sweep guard, the red-row reading and the spec invariants
  from the `cert16-` namespace, so a scenario in any certification namespace is
  seen ([#67](https://github.com/juherr/open-ocpp-tck/pull/67),
  [#64](https://github.com/juherr/open-ocpp-tck/pull/64))
- Unpin six assertions that were matching the vendored simulator's member order
  rather than the OCPP payload
  ([#65](https://github.com/juherr/open-ocpp-tck/pull/65))
- Refuse a reshaped spec array instead of filtering it out, which had kept
  whole scenario groups out of the pinned artifacts with the diff staying empty
  ([#67](https://github.com/juherr/open-ocpp-tck/pull/67))
- Refuse an unusable simulator environment, and report a missing trace
  ([#64](https://github.com/juherr/open-ocpp-tck/pull/64))

### Removed

- Revert the adaptive observation window. It was built, guarded and shipped,
  then measured: every scenario it extended reached the cap and failed anyway
  ([#55](https://github.com/juherr/open-ocpp-tck/pull/55))
