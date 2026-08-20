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
 * `/v1/graphql` response therefore goes through `expectData`. The metadata
 * calls do not, and do not need to: that endpoint reports a failure with a
 * status rather than in-band, which is the same difference {@link QUERY_PATH}
 * turns into a classification below.
 *
 * WHICH THROWS ARE NON-DISPATCHES. Two of the reads here are wrapped in
 * `warnOpFailed` by the specs -- `waitForActiveTransaction`, in TC028 and TC057
 * -- which warns and continues on every error but {@link CsmsNotDispatchedError}.
 * Continuing past a read that never ran means asserting on a transaction nobody
 * could look up, so a failure that kept the answer out of reach must ERROR
 * rather than warn. {@link CsmsNotDispatchedError} states the rule and both
 * halves of it; the CitrineOS fact that decides where this file's failures fall
 * is the endpoint asymmetry above. Issue #80.
 */
import { CsmsNotDispatchedError, type FetchLike } from "../../tck/driver";
import type { CitrineConfig } from "./config";
import { errorBody, readAnsweredBody } from "./http";

const HTTP_TIMEOUT_MS = 15_000;

/**
 * The two endpoints, as constants because `post` classifies a status by which
 * one answered it.
 *
 * `/v1/graphql` reports everything it understood in-band -- HTTP 200 with an
 * `errors` array -- so a status from it means the query never ran: auth, or an
 * engine that cannot serve. `/v1/metadata` reports a request it understood and
 * refused WITH a status, so the same 400 there is the server answering.
 */
const QUERY_PATH = "/v1/graphql";
const METADATA_PATH = "/v1/metadata";

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string }[];
}

/** A table in the tracked source. Hasura always names both parts. */
interface SourceTable {
  schema: string;
  name: string;
}

/** A tracked table as `export_metadata` reports it, narrowed to what is used
 *  here. Absent keys mean "none defined". */
interface TrackedTable {
  table: SourceTable;
  object_relationships?: { name: string }[];
  array_relationships?: { name: string }[];
}

/** What `pg_suggest_relationships` proposes, narrowed to what is used here. */
interface SuggestedRelationship {
  type: "object" | "array";
  from: { table: SourceTable; columns: string[] };
  to: { table: SourceTable; columns: string[] };
}

export class CitrineGraphQL {
  private readonly headers: Record<string, string>;

  /** The {@link FetchLike} seam, driven by
   *  `tests/citrineos-transport-classification.ts`: the branches below need an
   *  engine that refuses a chosen way, which no CSMS here can be asked for. */
  constructor(
    private readonly cfg: CitrineConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
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
    const body = await this.post(QUERY_PATH, { query: document, variables });
    return this.expectData<T>(body, document);
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
   * WHAT IS ALREADY THERE IS LEFT ALONE, which is the same rule the SteVe
   * driver's `ensureApiAccess` follows: read the current metadata, act on the
   * difference, and do nothing at all when there is none. A re-provision costs
   * two reads and no writes. It also means this is safe against a CitrineOS
   * that applied its own `hasura-metadata`: a relationship someone else
   * defined keeps its definition rather than being overwritten or throwing.
   */
  async ensureTracked(): Promise<void> {
    const [tables, tracked] = await Promise.all([
      this.sourceTables(),
      this.trackedTables(),
    ]);

    const known = new Set(
      tracked.map((entry) => `${entry.table.schema}.${entry.table.name}`),
    );
    const untracked = tables.filter((t) => !known.has(`${t.schema}.${t.name}`));
    if (untracked.length > 0) {
      // One request for the lot. `pg_track_tables` answers "all tables failed"
      // if none can be tracked, which is why only the difference is sent --
      // an already-tracked table is not in it.
      await this.post(METADATA_PATH, {
        type: "pg_track_tables",
        args: {
          tables: untracked.map((table) => ({ source: "default", table })),
          allow_warnings: true,
        },
      });
    }

    const defined = new Set<string>();
    for (const entry of tracked) {
      for (const rel of [
        ...(entry.object_relationships ?? []),
        ...(entry.array_relationships ?? []),
      ]) {
        defined.add(`${entry.table.name}.${rel.name}`);
      }
    }
    for (const rel of RELATIONSHIPS) {
      if (defined.has(`${rel.on}.${rel.name}`)) continue;
      await this.post(METADATA_PATH, {
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
      });
    }
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
    // Asked about the one table, not the whole source: the answer is the same
    // -- suggestions are rooted at the table given -- and it comes back as a
    // handful rather than the hundred-odd the source carries.
    const suggestions = (await this.post(METADATA_PATH, {
      type: "pg_suggest_relationships",
      args: { source: "default", tables: [{ schema: "public", name: target }] },
    })) as { relationships?: SuggestedRelationship[] };
    return (suggestions.relationships ?? [])
      .filter((rel) => rel.type === "array" && rel.from.table.name === target)
      .map((rel) => ({ table: rel.to.table.name, column: rel.to.columns[0]! }));
  }

  /** Every table in the source, tracked or not -- the catalog, asked through
   *  the API rather than through a connection to Postgres. */
  private async sourceTables(): Promise<SourceTable[]> {
    const body = (await this.post(METADATA_PATH, {
      type: "pg_get_source_tables",
      args: { source: "default" },
    })) as SourceTable[];
    return body.filter((t) => t.schema === "public");
  }

  /** What the source already exposes: the tracked tables and, per table, the
   *  relationships someone has defined on them. */
  private async trackedTables(): Promise<TrackedTable[]> {
    const body = (await this.post(METADATA_PATH, {
      type: "export_metadata",
      args: {},
    })) as { sources?: { name: string; tables?: TrackedTable[] }[] };
    const source = (body.sources ?? []).find((s) => s.name === "default");
    return source?.tables ?? [];
  }

  /**
   * `path` is the union rather than `string` on purpose: the status branch
   * below reads it as a classification, and a third endpoint typed in as
   * `string` would quietly take the "the server answered" side without anyone
   * deciding that it should.
   */
  private async post(
    path: typeof QUERY_PATH | typeof METADATA_PATH,
    payload: unknown,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.graphqlUrl}${path}`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CsmsNotDispatchedError(
        `citrineos graphql: ${path}`,
        `${this.cfg.graphqlUrl} did not answer ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `Is the graphql-engine service up? CITRINE_GRAPHQL_URL points at it.`,
      );
    }

    const what = `citrineos graphql: ${path}`;
    if (!res.ok) {
      const detail = `returned ${res.status}: ${await errorBody(res)}`;
      if (path === QUERY_PATH) {
        throw new CsmsNotDispatchedError(what, detail);
      }
      throw new Error(`${what} ${detail}`);
    }

    // Both of these used to escape unclassified -- the body read sat outside
    // the try and JSON.parse had no guard -- so a stalled stream or a non-JSON
    // 200 arrived as a raw abort or SyntaxError naming neither endpoint nor
    // URL. http.ts is now the one place that says what an answered body means.
    return (await readAnsweredBody(res, what)).parsed;
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

