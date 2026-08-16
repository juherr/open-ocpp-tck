# SteVe driver

The reference target: `bun run e2e` runs the full suite against it, and every
scenario is `DRIVABLE`. Where `drivers/citrineos/README.md` is mostly a list of
what its CSMS cannot do, this page has one row — which is the point of keeping
both.

## Gaps

One row per source fact, the same shape as the CitrineOS page.

| Gap | Effect | Source |
|---|---|---|
| **Concurrent `StatusNotification` deadlocks on `insert into evse`.** When several charge points send their first `StatusNotification(connectorId=0)` within the same few milliseconds, `Ocpp1ConnectorEvseBridge.insertIgnoreConnector` loses a MariaDB row-lock race (error 1213). SteVe does not retry the deadlock victim — although 1213 is retryable by contract — and returns it to the charge point as `[4,…,"InternalError",…]`. | A parallel lane FAILs `every StatusNotification.req answered with a StatusNotification.conf`. Adjudicated as a flake by `--retry-failed-isolated`, since a sequential re-run has nothing to contend with, so it does not fail the sweep. | Upstream [steve-community/steve#2107](https://github.com/steve-community/steve/issues/2107). Root-caused from the CSMS container log; see this repository's issue #35. |

### Why this is not an `expectedFailures` entry

An expected-failure entry describes what a CSMS **answers**, deterministically —
`tck/expected.ts` exists so a known finding stops being news. This is a race
that most runs win. Declaring it would make every run that does *not* deadlock
an `unexpected-pass`, which **fails the sweep** by design (`tck/standing.ts`),
turning an intermittent CSMS defect into a guaranteed red build.

The isolated retry already models this correctly: a parallel FAIL that passes
sequentially is contention, not a finding. Nothing in the suite needs to change,
and this row exists so that "nothing changed" is a recorded decision rather than
an omission.

### How it was found

Not by reading the code. The parallel attempt's wire log used to be overwritten
by the isolated retry's, and the CSMS's own log was never captured, so a
reproducible flake had survived ~119 archived sweeps undiagnosed. Both were
fixed (#52, #54); the first red run afterwards carried the stack trace, and
three charge points arriving 718 µs apart explained the rest.
