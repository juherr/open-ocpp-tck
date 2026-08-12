/**
 * graphql-client.ts -- CitrineOS's data API, which is Hasura.
 *
 * Two endpoints, and the split matters because only one of them is a query
 * language: `/v1/graphql` answers reads and writes, `/v1/metadata` is the
 * administrative surface that decides what `/v1/graphql` can see at all.
 * Hasura exposes nothing until a table is tracked, so `ensureTracked` below is
 * this driver's equivalent of SteVe's "write the API password and restart":
 * a one-off bootstrap that makes the API able to answer, paid by `provision`.
 *
 * WHY NOT VENDOR THEIR METADATA. CitrineOS ships `hasura-metadata/` and a
 * `.cli-migrations-v3` image that applies it at boot. Tracking from here
 * instead keeps a second schema-shaped artifact out of this repository -- one
 * that would need re-vendoring on every CitrineOS bump, and that
 * tests/vendor-integrity.sh would have to pin. The metadata API asks the
 * database what exists; a vendored copy asserts it.
 *
 * ERRORS. GraphQL answers HTTP 200 with an `errors` array, so a caller that
 * only checks the status code reads a failed query as an empty result -- and
 * an empty result is exactly what several assertions treat as "not set". Every
 * response therefore goes through `expectData`.
 */
import type { CitrineConfig } from "./config";
/** One metadata action, as `/v1/metadata` takes it. */
interface MetadataAction {
    type: string;
    args: Record<string, unknown>;
}
/** A table in the tracked source. Hasura always names both parts. */
interface SourceTable {
    schema: string;
    name: string;
}
/** What `pg_suggest_relationships` proposes, narrowed to what is used here. */
interface SuggestedRelationship {
    type: "object" | "array";
    from: {
        table: SourceTable;
        columns: string[];
    };
    to: {
        table: SourceTable;
        columns: string[];
    };
}
export declare class CitrineGraphQL {
    private readonly cfg;
    private readonly headers;
    constructor(cfg: CitrineConfig);
    /** A query or mutation. `T` is the caller's to declare: this module owns the
     *  transport, records.ts and provision.ts own the shapes. */
    query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
    /** One or more metadata actions, sent as a single `bulk` so a partial
     *  application cannot leave the source half-tracked. */
    metadata(actions: readonly MetadataAction[]): Promise<unknown>;
    /**
     * Makes the data API able to answer: every table in the source is tracked,
     * then the three relationships the queries name are created.
     *
     * EVERY table, rather than the seven this driver reads today, and that is
     * the point rather than laziness. `teardown` has to know which tables
     * reference an Authorization before it deletes one -- four do on the pinned
     * image, none of them cascading -- and it used to read that from
     * `pg_constraint`. `pg_suggest_relationships` answers the same question from
     * the same foreign keys, but only for TRACKED tables, so tracking the whole
     * source is what keeps a fifth referencing table on a future CitrineOS from
     * being silently missed.
     *
     * Idempotent by construction: re-tracking is an error Hasura reports per
     * action, and `already-tracked` / `already-exists` are the expected answer on
     * the second run, not a failure.
     */
    ensureTracked(): Promise<void>;
    /**
     * Every (table, column) that points at `target`, straight from the foreign
     * keys Hasura derived.
     *
     * Teardown's guard, and deliberately NOT expressed through relationship
     * names: `LocalListAuthorizations` references `Authorizations` twice, once
     * as `authorizationId` and once as `groupAuthorizationId`, so a name-based
     * guard would have to know which name won the disambiguation. A column is
     * unambiguous and is what the delete has to filter on anyway.
     */
    referencesTo(target: string): Promise<{
        table: string;
        column: string;
    }[]>;
    /** Every table in the source, tracked or not -- the catalog, asked through
     *  the API rather than through a connection to Postgres. */
    sourceTables(): Promise<SourceTable[]>;
    /** The foreign keys Hasura derives, which is where teardown's guards come
     *  from. Only tracked tables are considered, which is why ensureTracked
     *  tracks the whole source first. */
    suggestRelationships(tables: readonly SourceTable[]): Promise<SuggestedRelationship[]>;
    private post;
    /**
     * Applies actions one at a time, keeping the ones that fail because the work
     * was already done. A `bulk` cannot express that: Hasura aborts the whole
     * batch on the first error, so a second `provision` would fail on the first
     * already-tracked table and leave every later action unapplied.
     */
    private tolerant;
    private expectData;
}
export {};
