// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * observation-window.ts -- when the runner stops watching the wire, offline.
 *
 * THE PROPERTY, in five parts:
 *   1. a scenario whose assertions all pass at the floor adds NOTHING -- the
 *      fixed-window behaviour, unchanged, for every green scenario;
 *   2. one that is still short waits, and closes the window the moment it
 *      becomes satisfiable -- not at the cap, and not one poll later;
 *   3. one that never becomes satisfiable stops at the cap, having added
 *      exactly the cap and not a poll more;
 *   4. an assert() that THROWS counts as not satisfied and is waited through,
 *      rather than ending the window on an exception the runner would then
 *      re-raise from a state it never gave time to settle -- EXCEPT an
 *      `UnsupportedOperationError`, which is a driver saying the CSMS cannot
 *      do this at all, and which therefore ends the window at once instead of
 *      spending the cap to report the same answer;
 *   5. a cap of 0 restores the fixed window exactly, and a cap that is not a
 *      non-negative number warns and falls back rather than disabling the
 *      extension in silence.
 *
 * PARTS 1 AND 2 ARE ONE COMPARISON AT TWO INPUTS, and they share a mutation:
 * every edit that stops the window closing early stops it closing at the floor
 * too. Recorded rather than papered over with a third mutation that would only
 * be the second one spelled differently.
 *
 * WHY IT IS A GUARD AND NOT A SWEEP. Reaching any of these through the runner
 * means a docker image, a live CSMS, and -- for the rows that matter -- a CSMS
 * engineered to answer LATE by a chosen number of seconds, which is not a thing
 * anybody will stand up for a loop that is one comparison away from either
 * never extending or always extending to the cap. Both mistakes are invisible
 * in a green sweep: the first restores the bug, the second adds the cap to
 * every failing scenario and reads as "the CSMS got slower".
 *
 * WHY IT IS TYPESCRIPT, like tests/expected-failure-standing.ts: `tck/hold.ts`
 * is a module of its own precisely so this file can drive it with a fake wire
 * and a fake clock, and nothing about a fake clock is reachable from the CLI.
 *
 * WHAT IT DOES NOT CHECK: that the runner sleeps the floor before calling in.
 * That is one line in `runScenario` and the counting here would not see it --
 * stated so the next reader does not mistake this file for a proof of the
 * whole window.
 */
import type { AssertContext, ScenarioSpec } from "../tck/spec-types";
import { UnsupportedOperationError } from "../tck/driver";
import {
  DEFAULT_MAX_EXTRA_HOLD_SECS,
  HOLD_POLL_SECS,
  extendObservationWindow,
  maxExtraHoldSecs,
} from "../tck/hold";

const failures: string[] = [];

function check(condition: boolean, failure: string): void {
  if (!condition) failures.push(failure);
}

/** The context every spec below ignores; the window's decision is a function
 *  of the assertions, and these fields only have to exist. */
const CTX = {
  cpId: "CERTCP1",
  connector: 1,
  records: {} as AssertContext<void>["records"],
  driveState: undefined,
};

/** A wire whose captured lines grow as the fake clock advances, so a spec can
 *  become satisfiable at a chosen second the way a real CSMS does. */
class FakeWire {
  lines: string[] = [];
  elapsed = 0;
}

/** parseLog's stand-in. The window passes frames through to the spec and never
 *  reads them itself, so a spec that ignores them needs nothing real here. */
const noFrames = (): AssertContext<void>["frames"] => [];

/**
 * Drive the window with a fake clock. Returns what it added and how many times
 * it asked -- the second number is what tells "closed as soon as it could"
 * from "closed at the cap and happened to be satisfiable there".
 */
async function run(
  satisfiedAfterSecs: number | "never",
  maxExtraSecs: number,
  behaviour: "record" | "throw" | "unsupported" = "record",
): Promise<{ added: number; attempts: number }> {
  const wire = new FakeWire();
  let attempts = 0;
  const spec: ScenarioSpec<void> = {
    templateId: "fake",
    assert({ rec }) {
      attempts += 1;
      const satisfied =
        satisfiedAfterSecs !== "never" && wire.elapsed >= satisfiedAfterSecs;
      if (satisfied) return;
      if (behaviour === "unsupported") {
        throw new UnsupportedOperationError("ReserveNow", "no such registry");
      }
      if (behaviour === "throw") throw new Error("the row is not there yet");
      rec.fail("the frame has not arrived", "still short");
    },
  };
  const added = await extendObservationWindow(
    spec,
    CTX,
    wire,
    noFrames,
    maxExtraSecs,
    async (ms) => {
      wire.elapsed += ms / 1000;
    },
  );
  return { added, attempts };
}

// --- 1. a green scenario is not slowed down -------------------------------
{
  const { added, attempts } = await run(0, 30);
  check(
    added === 0,
    `a scenario satisfiable at the floor added ${added}s. It must add 0: every ` +
      "green scenario in every sweep pays this, and the fixed window is what " +
      "each spec's holdSecs was tuned against.",
  );
  check(
    attempts === 1,
    `the window asked ${attempts} times before closing on an already-satisfied ` +
      "scenario; one attempt is the whole cost it is allowed.",
  );
}

// --- 2. it closes the moment the scenario becomes satisfiable -------------
{
  const target = HOLD_POLL_SECS * 2;
  const { added, attempts } = await run(target, 30);
  check(
    added === target,
    `a scenario satisfiable at +${target}s closed at +${added}s. Closing later ` +
      "would spend a sweep's wall clock on a scenario that was already " +
      "answerable; closing earlier would be the bug this module exists for.",
  );
  check(
    attempts === 3,
    `it asked ${attempts} times to reach +${target}s at a ${HOLD_POLL_SECS}s ` +
      "poll; 3 is one at the floor plus one per poll. A different count means " +
      "the loop asks on a schedule nobody wrote down.",
  );
}

// --- 3. it stops at the cap ------------------------------------------------
{
  const cap = 12;
  const { added } = await run("never", cap);
  check(
    added === cap,
    `a scenario that never becomes satisfiable added ${added}s against a ${cap}s ` +
      "cap. Over the cap is an unbounded sweep; under it is a cap that is not " +
      "the number it says it is.",
  );
  // The cap is not a multiple of the poll, on purpose: the last step has to be
  // clipped to it. A loop that always sleeps a whole poll overshoots here and
  // nowhere else, which is why the number above is 12 and not 10.
  check(
    cap % HOLD_POLL_SECS !== 0,
    "this row stopped testing the clipped final step -- pick a cap that is " +
      "not a multiple of the poll interval.",
  );
}

// --- 4. a throwing assert() is waited through, not treated as satisfied ----
{
  const { added } = await run("never", 10, "throw");
  check(
    added === 10,
    `an assert() that throws every time added ${added}s instead of the 10s cap. ` +
      "A throw is a scenario reaching for a row that has not been written yet " +
      "-- exactly the state worth waiting through -- and treating it as a " +
      "clean close would hand the runner an error from a state it never gave " +
      "time to settle.",
  );
  const late = await run(HOLD_POLL_SECS, 30, "throw");
  check(
    late.added === HOLD_POLL_SECS,
    `an assert() that throws once and then passes added ${late.added}s rather ` +
      `than ${HOLD_POLL_SECS}s, so a recovered throw does not close the window.`,
  );

  // "Never", not "not yet". A driver reporting the CSMS cannot do this at all
  // has answered on the first attempt, and waiting the cap out only delays the
  // identical error -- so the window must let it through rather than swallow
  // it into another poll.
  let raised: unknown;
  try {
    await run("never", 30, "unsupported");
  } catch (err) {
    raised = err;
  }
  check(
    raised instanceof UnsupportedOperationError,
    `an UnsupportedOperationError from assert() was ${
      raised === undefined ? "swallowed into another poll" : "replaced by " + String(raised)
    }. It is a permanent answer, and burning the cap on it delays an error the ` +
      "runner is going to report unchanged.",
  );
}

// --- 5. the cap is a knob, and a broken knob says so ----------------------
{
  const { added, attempts } = await run("never", 0);
  check(
    added === 0 && attempts === 0,
    `a cap of 0 added ${added}s over ${attempts} attempt(s). It must do nothing ` +
      "at all -- not even ask -- or a sweep measuring the fixed window would " +
      "be measuring one assert() pass it did not ask for.",
  );
}

{
  check(
    maxExtraHoldSecs({}) === DEFAULT_MAX_EXTRA_HOLD_SECS,
    "an unset OCPP_TCK_MAX_EXTRA_HOLD_SECS no longer means the default.",
  );
  check(
    maxExtraHoldSecs({ OCPP_TCK_MAX_EXTRA_HOLD_SECS: "0" }) === 0,
    "0 must be honoured as 0, not read as unset. It is how a run restores the " +
      "fixed window, and an `||` in the wrong place turns it back into 30.",
  );
  // Whitespace-only, not " 45 ": `Number(" 45 ")` is 45 with or without the
  // trim, so a padded number cannot tell whether the trim is there. A blank
  // value can -- untrimmed it is truthy and `Number("   ")` is 0, which
  // disables the extension while looking like an unset variable.
  check(
    maxExtraHoldSecs({ OCPP_TCK_MAX_EXTRA_HOLD_SECS: "   " }) ===
      DEFAULT_MAX_EXTRA_HOLD_SECS,
    "a blank OCPP_TCK_MAX_EXTRA_HOLD_SECS does not mean the default, so a " +
      "variable set to nothing silently disables the extension instead of " +
      "reading as unset.",
  );
  const warnings: string[] = [];
  const fallback = maxExtraHoldSecs(
    { OCPP_TCK_MAX_EXTRA_HOLD_SECS: "soon" },
    (message) => warnings.push(message),
  );
  check(
    fallback === DEFAULT_MAX_EXTRA_HOLD_SECS && warnings.length === 1,
    `a nonsense cap resolved to ${fallback}s with ${warnings.length} warning(s). ` +
      "It must fall back AND say so: falling back in silence reads, from the " +
      "log, exactly like an extension that never happened.",
  );
  const negative: string[] = [];
  check(
    maxExtraHoldSecs(
      { OCPP_TCK_MAX_EXTRA_HOLD_SECS: "-5" },
      (message) => negative.push(message),
    ) === DEFAULT_MAX_EXTRA_HOLD_SECS && negative.length === 1,
    "a negative cap is a number and would disable the extension silently; it " +
      "has to be refused like any other nonsense.",
  );
}

if (failures.length > 0) {
  process.stderr.write("FAIL: the observation window does not hold.\n");
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  "Observation window holds: a satisfiable scenario closes at the floor, one " +
    "that is short closes the moment it can, one that never can stops at the " +
    "cap, a throwing assert() is waited through, and the cap is a knob that " +
    "refuses nonsense out loud.\n",
);
