/**
 * scope.ts -- the TYPE of a driver's scope declaration, and the coverage
 * helpers that keep it honest. The DATA lives in each driver
 * (drivers/<id>/scope.ts): what a CSMS can and cannot drive is a fact about
 * that CSMS, not about this harness.
 *
 * The runner consults the active driver's table BEFORE starting any container.
 * A NOT_APPLICABLE scenario never launches docker, never touches the CSMS, and
 * is reported with its reason. Deterministic, reviewable offline, free.
 *
 * {@link UnsupportedOperationError} is the SECOND line of defence, not the
 * first. When it fires the runner records NOT APPLICABLE *and* prints that the
 * scope table is out of date -- that print is how a desynchronisation between
 * a driver's claims and its behaviour gets noticed instead of accumulating.
 *
 * RULES FOR A DRIVER AUTHOR EDITING ITS TABLE
 *  - Every `reason` cites the precise limitation: an endpoint that does not
 *    exist, a DTO member that is absent. Never a guess. If you cannot name the
 *    limitation, the row is CONDITIONAL, not NOT_APPLICABLE.
 *  - CONDITIONAL means "expressible, but whether the CSMS emits the OCPP
 *    message we need is unknown until a real run". State the exact question
 *    the first live run must answer.
 *  - NEVER demote a row to NOT_APPLICABLE to make a red scenario go away. That
 *    converts a finding about the CSMS into a silence about the harness, and
 *    it is indistinguishable from the finding never having existed.
 *  - For an OCPP 2.0.1 scenario, OPEN the reason with the feature identifier
 *    the case is conditional on -- "C-45: ...", from Part 5 §4's `Feature no.`
 *    column. That protocol makes features optional rather than cases and
 *    publishes an identifier per feature; OCPP 1.6 publishes none, so its rows
 *    are prose and stay prose. OCA-201-SELECTION.md has the provenance.
 *  - A CSMS that does not speak OCPP 2.0.1 AT ALL still needs a row per
 *    `cert201-` scenario, and those rows are PROSE -- "no OCPP 2.0.1 message
 *    endpoint" -- not a feature identifier. An identifier names the feature a
 *    CONDITIONAL case hangs on; a CSMS with no 2.0.1 surface is declining
 *    every case whatever its features, so there is nothing conditional to
 *    cite. Why there is no shorter way to say it: see the note above
 *    `scopeCoverage`.
 */
export type ScopeStatus = "DRIVABLE" | "CONDITIONAL" | "NOT_APPLICABLE";
export interface ScopeEntry {
    status: ScopeStatus;
    reason: string;
}
/** One row per registered scenario `templateId`. */
export type ScopeTable = Readonly<Record<string, ScopeEntry>>;
export declare function scopeFor(table: ScopeTable, templateId: string): ScopeEntry | undefined;
export declare function templateIdsWithStatus(table: ScopeTable, status: ScopeStatus): string[];
/**
 * Both directions of drift between a table and the scenario registry.
 *
 * `missing` -- a registered scenario with no row: the campaign would run it
 * and only discover the gap at runtime, through UnsupportedOperationError,
 * after starting a container and touching the CSMS.
 *
 * `stale` -- a row for a scenario nobody registers: usually a rename, and it
 * silently stops covering anything.
 */
export declare function scopeCoverage(table: ScopeTable, registeredTemplateIds: readonly string[]): {
    missing: string[];
    stale: string[];
};
