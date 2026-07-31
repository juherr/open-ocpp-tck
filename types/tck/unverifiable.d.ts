/**
 * unverifiable.ts -- the sentinel a driver returns when it cannot answer an
 * observation, and the only honest alternative to inventing a value.
 *
 * A CsmsRecords method whose result flows straight into assertEq or
 * assertNonEmpty may return `unverifiable("<why>")`. Those helpers recognise
 * the prefix and record the check as SKIPPED, which yields a PARTIAL verdict
 * instead of a FAIL. A check you cannot evaluate is neither green nor red.
 *
 * The prefix itself is re-exported from assert.ts rather than redeclared: the
 * two must be `===` or a driver's sentinel silently stops being recognised and
 * every SKIPPED becomes a FAIL. One declaration, no synchronisation to forget.
 *
 * Do NOT use this for a value consumed any other way -- assigned, compared,
 * interpolated, or fed back into an operation field. A sentinel string that
 * reaches a request body asks the CSMS to act on the word "unverifiable".
 * Throw UnsupportedOperationError there instead.
 */
export { UNVERIFIABLE_PREFIX } from "./assert";
/** Marks a value as unanswerable by this driver, carrying the reason. */
export declare function unverifiable(reason: string): string;
export declare function isUnverifiable(value: string): boolean;
/** The reason out of a sentinel value, or "" if it is not one. */
export declare function unverifiableReason(value: string): string;
