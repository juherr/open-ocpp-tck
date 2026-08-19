# Feedback for the specification

Findings from writing a reader against `open-ocpp-trace/specification` and
running it in a real consumer. Each one needs a change to the **document**, not
to this code — which is why they are here rather than in an issue that would be
closed by a commit.

Measured against `schema/trace-v1.schema.json` and `conformance/README.md`.

---

## 1. There is no word for "valid, but unusable for my purpose"

**The rule today.** `conformance/README.md` says a conformant consumer must
"accept any record that validates against the schema and ignore unknown
fields."

**The problem.** `raw` is optional. `messageId` is optional. `payload` is
optional. So a record can validate perfectly and still be unusable by a given
consumer — not because anything is wrong with it, but because that consumer
needs a member the format does not require.

The worked example is real, and it is the first consumer of this library. A
conformance suite judges an OCPP session by parsing the wire frames out of
`raw`; its assertions quote those bytes. Handed a record with `payload` and no
`raw` it has three options, and the rules only permit the worst one:

| | |
|---|---|
| Accept and synthesise the frame from `payload` | Re-serialises. Every failure it then reports claims to quote the wire and quotes its own re-encoding instead. |
| Accept and judge on nothing | Reports a false verdict about a session it could not read. |
| **Refuse the trace and say why** | What it does. And this makes it, by the letter of the rules, **non-conformant.** |

The same applies to a record with no `messageId`: correlation is undefined for
it, so a consumer that correlates cannot honestly accept it.

**What the document is missing** is not permission to refuse — it is the
vocabulary to distinguish two things it currently collapses:

- **invalid** — the record violates the schema. The producer is wrong.
- **unusable for a purpose** — the record satisfies the schema and lacks a
  member *this* consumer requires. Nobody is wrong; the consumer simply cannot
  answer its question from this trace.

**Suggested shape.** Let a consumer declare the optional members it requires,
and define conformance as: accept every record that validates *and* carries the
members you declared; for the rest, refuse explicitly and say which member was
missing. A consumer that declares nothing is exactly the consumer the current
rule describes, so this is backwards compatible.

This library implements the distinction already, in the only way it can without
the document: a record that validates produces **no diagnostic**, and the
refusal is the caller's, under the caller's own name. See `README.md`, "No error
policy". The first consumer spells its version `payload-only`.

---

## 2. `raw` being optional deserves a stated consequence

Following from 1, and worth saying in the document rather than leaving each
consumer to discover it.

Two consumer families read this format, and the split is clean:

- those that read **`payload`** — timeline UIs, failure detectors, report
  generators;
- those that read **`raw`** — anything that must quote or re-parse the wire
  bytes: conformance suites, protocol linters, replay tools that re-send.

A producer that emits only one of the two silently excludes the other family.
The schema permits it and the conformance rules do not mention it, so a
producer has no way to know it made that choice.

**Suggested shape.** A producer recommendation — emit both when the original
bytes are available, and document which you emit when they are not — plus a
fixture in the corpus carrying `payload` and no `raw`, so that consumers
discover the case in CI rather than in the field. There is currently no such
fixture: all 16 carry `raw`, so a `raw`-requiring reader passes the whole
corpus and still breaks on a conformant producer.

---

## 3. The correlation rule's third clause needs a fixture

**The rule today**, from `conformance/README.md`: a response correlates with
"the most recent preceding CALL" that has the same `messageId`, travels in the
opposite direction, and "is not already correlated with an earlier response".

**The problem.** The third clause is unobservable in the corpus. Every fixture
uses unique `messageId`s, so an implementation that drops the clause entirely
reproduces all 16 `expected.json` files. It is a normative rule that the
conformance suite cannot fail anyone for getting wrong.

This is not hypothetical. The consumer this library was extracted from
correlated by scanning *forward* from each CALL to the first matching response
— which is the same rule minus that clause. It passed every real trace for as
long as it existed, because real producers generate UUIDs. It was found by
reading the specification, not by running anything.

**Suggested shape.** A fixture with one `messageId` reused across two
exchanges:

```
0  CALL        cp-to-csms  id=X
1  CALL        cp-to-csms  id=X
2  CALLRESULT  csms-to-cp  id=X   -> correlatesWith 1
3  CALLRESULT  csms-to-cp  id=X   -> correlatesWith 0
```

An implementation missing the clause maps both responses onto index 1 and
reports index 0 unanswered.

A second fixture would pin the **opposite-direction** clause, which has the
same problem for the same reason — every fixture has all CALLs travelling one
way. It needs the nearer candidate to be the wrong-direction one:

```
0  CALL        cp-to-csms  id=Y
1  CALL        csms-to-cp  id=Y
2  CALLRESULT  csms-to-cp  id=Y   -> correlatesWith 0, not 1
```

Both cases were caught here by mutation-testing the guard rather than by the
corpus — and the second only after the first attempt at that guard passed while
the clause was removed.

---

## 4. What does "the same `messageId`" mean when neither record has one?

`messageId` is optional, and the correlation rule says a response correlates
with the most recent preceding CALL that has "the same `messageId`". The
reference consumer implements that as `c.messageId === r.messageId`, so a CALL
with no id and a response with no id **do** correlate — `undefined === undefined`.

That may well be intended, but nothing says so, and it is the kind of clause
two implementations will read differently: the obvious defensive reading is
that a record with no id correlates with nothing. This library reproduces the
reference deliberately rather than guessing, and a review of it flagged the
absence of the guard as a bug — which is the evidence that the document is
ambiguous, not that either behaviour is wrong.

**Suggested shape.** One sentence saying which it is, and a fixture carrying
two id-less records in an exchange so the corpus can fail an implementation
that chose the other reading. No fixture exercises it today.

## 5. Smaller notes

- **`conformance/validate.mjs` is a second implementation of the rules.** It
  compiles the schema with ajv and open-codes `buildConsumerView`, so the
  document's own CI proves the fixtures self-consistent rather than proving any
  shipped reader correct. `conformance.ts` in this library is offered as a
  replacement: same checks, expressed over the reader consumers actually
  import.
- **`timestamp` is `required`.** Worth a line in the prose — it is the only
  member of a derived event that is not recoverable from `raw`, which makes it
  load-bearing in a way its position in the `required` list does not convey.
- **Leap seconds.** `format: date-time` admits `23:59:60`. Consumers building a
  `Date` from it will silently normalise. Probably worth a note.
