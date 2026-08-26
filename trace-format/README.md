# trace-format

A reader for the [open-ocpp-trace][spec] interchange format: JSONL in,
validated records and the normative consumer view out.

**This directory is destined for the `open-ocpp-trace` organisation.** It lives
here because it was extracted from a real consumer rather than designed against
the document alone, and because the strictest consumer is the one that finds
the format's soft spots. Until it moves it depends on nothing outside itself
and `node:*`, which is what makes the move a move rather than a rewrite;
`tests/trace-format-standalone.sh` enforces that, and it is not a courtesy —
one import of `../tck/ocpp` would silently make this a TCK-internal module
again.

[spec]: https://github.com/open-ocpp-trace/specification

## What it does

| module | |
|---|---|
| `record.ts` | `TraceRecord` — a transcription of `schema/trace-v1.schema.json` |
| `jsonl.ts` | `splitJsonl(text)` — one JSON value per non-blank line, holes preserved |
| `validate.ts` | `validateRecord` / `validateRecords` — the schema's rules, plus `raw` fidelity |
| `consumer-view.ts` | `consumerView(records)` — the normative derivation, and the one cross-record producer rule |
| `read.ts` | `readTraceText(text)` — the two halves composed |
| `conformance.ts` | `checkFixtures(dir)` — the corpus self-check, meant to replace `conformance/validate.mjs` |

`SPEC-FEEDBACK.md` beside this file collects what writing the reader turned up
about the **document** — three things that need spec text rather than code,
including the one this library's whole API shape is a workaround for.

## Two rules it is built on

**No domain model.** The library never invents a frame, an event or a session.
It returns validated records and the consumer view the specification defines,
and the caller maps those onto whatever it already has. Its two consumers
already have incompatible models — a conformance suite's OCPP-J frame, a
debugger's timeline event — and a third would tax both to serve neither.

**No error policy.** A diagnostic states a fact; it carries no severity,
because severity is the caller's answer and the two callers give opposite ones.
A conformance suite refuses a whole file rather than judge a run on frames it
is unsure of; a debugging UI shows what it can and annotates the rest. Encoding
either one here would make the other wrong, silently, since both would still
compile.

The corollary is the part worth stating: **a record that satisfies the schema
produces no diagnostic, however unusable a given consumer finds it.** A record
with `payload` and no `raw` is valid — both are optional — and a consumer that
needs wire bytes must refuse it *on its own account*, under its own name. The
conformance rules oblige a consumer to "accept any record that validates
against the schema", and the distinction between *valid* and *usable for my
purpose* is one the specification does not yet have a word for. It should —
that is finding 1 in `SPEC-FEEDBACK.md`, and this API shape is what standing in
for it looks like.

Two consequences that are easy to get wrong in the other direction:

- `validateRecords` is **total** — every input value gets a record or a
  diagnostic. An unexplained hole is the one thing a lenient consumer cannot
  annotate, so it must not be reachable.
- `readTraceText` is the only place allowed to suppress a diagnostic, and it
  suppresses exactly one: it does not re-validate a line `splitJsonl` already
  reported as not-JSON, because "record is absent, not an object" would be true
  and would not be what happened.

## The contract worth remembering

`validateRecord` returns a `record` **if and only if** the value satisfies the
JSON Schema. Everything else — an unreadable `schemaVersion` major, a `raw`
that contradicts the members beside it — comes back *with* the record. So:

- a strict caller refuses on `records[i] === undefined`, or on any diagnostic;
- a lenient caller takes every record it got and shows the diagnostics;
- neither has to know what the other would have done.

## Verifying it

The schema is not vendored here, so a transcription can drift from the document
it transcribes and nothing offline would notice. `tools/trace-conformance.sh`
is the answer: it runs this reader over the specification's own fixtures and
compares the derived view to each `expected.json`. That is the only check that
compares this code against the thing it claims to implement — run it after any
change to `validate.ts` or `consumer-view.ts`.

`tests/trace-format.ts` guards the rules offline, one mutation per claim.
