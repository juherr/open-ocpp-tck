# SteVe driver

The reference target: the scenarios were written against it, and every one of
them is `DRIVABLE`.

## Gaps

One row per source fact, the same shape as `drivers/citrineos/README.md`.

| Gap | Effect | Source |
|---|---|---|
| **Concurrent `StatusNotification` deadlocks on `insert into evse`.** When several charge points send their first `StatusNotification(connectorId=0)` within the same few milliseconds, `Ocpp1ConnectorEvseBridge.insertIgnoreConnector` loses a MariaDB row-lock race (error 1213). SteVe does not retry the deadlock victim — although 1213 is retryable by contract — and returns it to the charge point as `[4,…,"InternalError",…]`. | A parallel lane FAILs `every StatusNotification.req answered with a StatusNotification.conf`. Adjudicated as a flake by `--retry-failed-isolated`, since a sequential re-run has nothing to contend with, so it does not fail the sweep. | Upstream [steve-community/steve#2107](https://github.com/steve-community/steve/issues/2107). Root-caused from the CSMS container log; see this repository's issue #35. |

### Why this is not an `expectedFailures` entry

The rule is CONTRIBUTING.md's — never declare a flake, there is deliberately no
"expected flaky" status — so this only records how it lands here, which is worse
than it first looks.

Declaring the row would fail the sweep on **every** run, not merely on the
majority that win the race. A run that does *not* deadlock is an
`unexpected-pass`. And a run that *does* is adjudicated a flake by
`--retry-failed-isolated` — a sequential re-run has nothing to contend with —
so `effectivelyFailed` is false and it is an `unexpected-pass` too. There is no
outcome under which the entry would be satisfied.

The isolated retry already models this correctly. Nothing in the suite needs to
change, and this row exists so that "nothing changed" is a recorded decision
rather than an omission.

### How it was found

Not by reading the code. The parallel attempt's wire log used to be overwritten
by the isolated retry's, and the CSMS's own log was never captured, so a
reproducible flake had survived ~119 archived sweeps undiagnosed. Both were
fixed (#52, #54); the first red run afterwards carried the stack trace, and
three charge points arriving 718 µs apart explained the rest.
