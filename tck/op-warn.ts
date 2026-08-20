// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * op-warn.ts -- what a scenario does when a CSMS operation it asked for fails.
 *
 * Most scenarios drive an operation and then measure what the CHARGE POINT did
 * about it. A CSMS that refuses the operation is therefore not automatically
 * the scenario's answer: the assertions below the call are still the finding,
 * and a refusal is worth a line on stderr and nothing more. That is why this
 * warns and continues, and it is the right default.
 *
 * IT IS NOT THE RIGHT DEFAULT FOR ONE CASE, which is the whole reason this file
 * exists rather than a `process.stderr.write` per call site. A
 * {@link CsmsNotDispatchedError} says the request never became an OCPP CALL --
 * the transport refused it, so the charge point was never asked. Warning and
 * continuing there produces a scenario that reports several confident FAILs
 * about a charge point that did nothing wrong, and whose real cause is three
 * steps upstream in the driver. Issue #77 is that failure, and it cost a
 * preserved wire trace and 91 archived sweep artifacts to read, because the
 * only clue on the surface was a WARN that looked like all the others.
 *
 * So this rethrows that one class and warns about everything else. Letting it
 * out makes the scenario ERROR, which already means "it never got that far"
 * (see `tck/standing.ts`), rather than inventing a verdict for it.
 *
 * Twelve copies of the warning used to sit inline across the spec files, which
 * is what let the distinction be missing everywhere at once.
 */
import { CsmsNotDispatchedError } from "./driver";

export function warnOpFailed(op: string, err: unknown): void {
  if (err instanceof CsmsNotDispatchedError) throw err;
  process.stderr.write(
    `[runner] WARN: CSMS operation ${op} failed (continuing): ${err instanceof Error ? err.message : String(err)}\n`,
  );
}
