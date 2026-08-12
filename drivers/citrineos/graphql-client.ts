// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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

const HTTP_TIMEOUT_MS = 15_000;

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string }[];
}

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
  from: { table: SourceTable; columns: string[] };
  to: { table: SourceTable; columns: string[] };
}

export class CitrineGraphQL {
  private readonly headers: Record<string, string>;

  constructor(private readonly cfg: CitrineConfig) {
    this.headers = {
      "content-type": "application/json",
      // Omitted rather than sent empty: Hasura treats a present but wrong
      // secret as an auth failure, so a blank one would turn "no secret
      // configured" into 401 on a server that wants none.
      ...(cfg.adminSecret === ""
        ? {}
        : { "x-hasura-admin-secret": cfg.adminSecret }),
    };
  }

  /** A query or mutation. `T` is the caller's to declare: this module owns the
   *  transport, records.ts and provision.ts own the shapes. */
  async query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const body = await this.post("/v1/graphql", { query: document, variables });
    return this.expectData<T>(body, document);
  }

  /** One or more metadata actions, sent as a single `bulk` so a partial
   *  application cannot leave the source half-tracked. */
  async metadata(actions: readonly MetadataAction[]): Promise<unknown> {
    if (actions.length === 0) return undefined;
    return this.post("/v1/metadata", {
      type: "bulk",
      args: actions,
    });
  }

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
  async ensureTracked(): Promise<void> {
    const tables = await this.sourceTables();
    await this.tolerant(
      tables.map((table) => ({
        type: "pg_track_table",
        args: { source: "default", table },
      })),
    );

    await this.tolerant(
      RELATIONSHIPS.map((rel) => ({
        type:
          rel.kind === "object"
            ? "pg_create_object_relationship"
            : "pg_create_array_relationship",
        args: {
          source: "default",
          table: { schema: "public", name: rel.on },
          name: rel.name,
          using: rel.using,
        },
      })),
    );
  }

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
  async referencesTo(
    target: string,
  ): Promise<{ table: string; column: string }[]> {
    const tables = await this.sourceTables();
    return (await this.suggestRelationships(tables))
      .filter((rel) => rel.type === "array" && rel.from.table.name === target)
      .map((rel) => ({ table: rel.to.table.name, column: rel.to.columns[0]! }));
  }

  /** Every table in the source, tracked or not -- the catalog, asked through
   *  the API rather than through a connection to Postgres. */
  async sourceTables(): Promise<SourceTable[]> {
    const body = (await this.post("/v1/metadata", {
      type: "pg_get_source_tables",
      args: { source: "default" },
    })) as SourceTable[];
    return body.filter((t) => t.schema === "public");
  }

  /** The foreign keys Hasura derives, which is where teardown's guards come
   *  from. Only tracked tables are considered, which is why ensureTracked
   *  tracks the whole source first. */
  async suggestRelationships(
    tables: readonly SourceTable[],
  ): Promise<SuggestedRelationship[]> {
    const body = (await this.post("/v1/metadata", {
      type: "pg_suggest_relationships",
      args: { source: "default", tables },
    })) as { relationships?: SuggestedRelationship[] };
    return body.relationships ?? [];
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.graphqlUrl}${path}`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(
        `citrineos graphql: ${path} unreachable at ${this.cfg.graphqlUrl} ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `Is the graphql-engine service up? CITRINE_GRAPHQL_URL points at it.`,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `citrineos graphql: ${path} returned ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text) as unknown;
  }

  /**
   * Applies actions one at a time, keeping the ones that fail because the work
   * was already done. A `bulk` cannot express that: Hasura aborts the whole
   * batch on the first error, so a second `provision` would fail on the first
   * already-tracked table and leave every later action unapplied.
   */
  private async tolerant(actions: readonly MetadataAction[]): Promise<void> {
    for (const action of actions) {
      try {
        await this.post("/v1/metadata", action);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/already[- ](tracked|exists)|already defined/i.test(message)) {
          throw err;
        }
      }
    }
  }

  private expectData<T>(body: unknown, document: string): T {
    const parsed = body as GraphQLResponse<T>;
    if (parsed.errors && parsed.errors.length > 0) {
      const operation = /(?:query|mutation)?\s*{?\s*(\w+)/.exec(document)?.[1];
      throw new Error(
        `citrineos graphql: ${operation ?? "operation"} failed: ` +
          parsed.errors.map((e) => e.message ?? "<no message>").join("; ") +
          ". If the field is unknown, the tables are not tracked yet -- run `ocpp-tck driver provision`.",
      );
    }
    if (parsed.data === undefined) {
      throw new Error(
        `citrineos graphql: response carried neither data nor errors: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return parsed.data;
  }
}

/**
 * The relationships the driver's queries name, and only those.
 *
 * `pg_suggest_relationships` proposes one for every foreign key in the source
 * -- over a hundred here -- and creating them all was a mistake worth
 * recording: several are one-to-one shapes whose key lives on the OTHER table,
 * which needs a different `using` form, so the batch failed on
 * `Transactions.StartTransaction` with "no foreign constraint exists on the
 * given column(s)". Nothing in this driver reads those. Three relationships
 * carry every query below, they are the three the SQL used to JOIN, and
 * spelling them out means a rename upstream fails here with the name in the
 * message rather than somewhere inside a generated batch.
 *
 * Teardown's guard does NOT go through this list -- it reads the foreign keys
 * themselves, through `referencesTo`, so a fifth referencing table is still
 * picked up.
 */
const RELATIONSHIPS: readonly {
  on: string;
  name: string;
  kind: "object" | "array";
  using: Record<string, unknown>;
}[] = [
  {
    on: "Transactions",
    name: "Authorization",
    kind: "object",
    using: { foreign_key_constraint_on: "authorizationId" },
  },
  {
    on: "Transactions",
    name: "StopTransactions",
    kind: "array",
    using: {
      foreign_key_constraint_on: {
        table: { schema: "public", name: "StopTransactions" },
        column: "transactionDatabaseId",
      },
    },
  },
  {
    on: "Authorizations",
    name: "Transactions",
    kind: "array",
    using: {
      foreign_key_constraint_on: {
        table: { schema: "public", name: "Transactions" },
        column: "authorizationId",
      },
    },
  },
];

