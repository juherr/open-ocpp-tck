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
 *    the case is conditional on -- "C-45: ...". That protocol makes features
 *    optional rather than cases and publishes an identifier per feature;
 *    OCPP 1.6 publishes none, so its rows are prose and stay prose.
 *    OCA-201-SELECTION.md is where that vocabulary comes from.
 */
export type ScopeStatus = "DRIVABLE" | "CONDITIONAL" | "NOT_APPLICABLE";
/**
 * TRIED AND NOT BUILT, here because here is where it gets re-proposed: typing
 * `reason`'s feature identifier as a closed union, so a typo is a build error
 * the way V1_LOCAL_LIST makes one in drivers/citrineos/scope.ts. It is
 * premature twice. No scenario of the protocol that HAS those identifiers is
 * registered yet, so the union would be written against zero rows -- and the
 * complete enumeration it needs is a reproduction of a no-derivatives table
 * rather than the citation of one, which is the whole reason the identifiers
 * are quotable in the first place.
 *
 * The day both change, the union is a two-line addition and every existing
 * row stays valid, since prose is what a 1.6 row is supposed to be.
 */
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
