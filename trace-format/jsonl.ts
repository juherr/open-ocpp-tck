/**
 * jsonl.ts -- a trace file's text, split into one JSON value per record.
 *
 * BLANK LINES ARE SKIPPED, NOT REFUSED. A trailing newline is a property of
 * appending to a file, not a malformed record, and the format is written by
 * appending.
 *
 * A BAD LINE LEAVES A HOLE rather than closing the gap. Everything downstream
 * -- diagnostics, the consumer view's `index`, `correlatesWith` -- addresses
 * records by position, and the normative correlation rule is "the most recent
 * PRECEDING call", so positions are load-bearing rather than cosmetic. Dropping
 * an unreadable line would renumber every record after it, which turns one
 * broken line into a whole file of indices that point at the wrong record and
 * says nothing about it. `undefined` at that position keeps every other index
 * true and puts the fact in a diagnostic.
 */

import type { Diagnostic } from "./diagnostics";

/**
 * One entry per non-blank line, in file order, `undefined` where the line was
 * not JSON.
 */
export interface SplitTrace {
  readonly values: readonly (unknown | undefined)[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Splits a JSONL trace into one JSON value per non-blank line. */
export function splitJsonl(text: string): SplitTrace {
  const values: (unknown | undefined)[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const index = values.length;
    try {
      values.push(JSON.parse(line));
    } catch {
      values.push(undefined);
      diagnostics.push({
        index,
        code: "line-not-json",
        detail: "line is not JSON",
      });
    }
  }

  return { values, diagnostics };
}
