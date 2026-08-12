// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * provision.ts -- the environment the scenarios assume, made reproducible.
 *
 * The scenarios do not create the state they assert on: TC_023 needs three
 * idTags that are respectively unknown, expired and blocked, and a dozen
 * others must simply authorize. drivers/steve/provision.ts is the sibling of
 * this file and explains where the tag list comes from; the list itself is
 * duplicated rather than shared because it is a property of the SIMULATOR
 * image, and a driver that imported another driver's fixtures would be
 * claiming a coupling that does not exist.
 *
 * ONE CHANNEL, NOT THREE. SteVe's provisioner uses REST, SQL and the manager
 * UI because each covers what the others cannot. Here everything is SQL,
 * because CitrineOS exposes no Authorization CRUD at all: every
 * `@AsDataEndpoint` in the repository was read, and `EVDriverDataApi` offers
 * exactly one route, a read-only GET of the local list version. The bundled
 * Hasura sidecar would offer insert mutations, at the cost of vendoring its
 * metadata -- see records.ts for why that trade was refused.
 *
 * Unlike the SteVe driver, whose every database write names the upstream
 * ticket that would replace it, THIS FILE HAS NO TICKET TO NAME: issues are
 * disabled on citrineos/citrineos-core, and the two filed against
 * citrineos/citrineos from this repository (#215, #216) are protocol defects
 * rather than the missing data API. Nothing here is waiting on a number --
 * the gap is unreported, which is a state worth writing down rather than
 * leaving as an apparent omission.
 *
 * Charging profiles are not provisioned here either, and that is not an
 * omission: OCPP 1.6 SetChargingProfile carries the profile inline, so there
 * is no CSMS-side record to create. profiles.ts holds the catalogue.
 *
 * Everything is idempotent. Re-running provision on a provisioned environment
 * must be a no-op that still exits 0, because CI reruns it and an operator
 * chasing a failure will run it twice before believing it.
 */
import { defaultCitrineConfig, type CitrineConfig } from "./config";
// Second on purpose: tsc elides this import from the .d.ts, and the header
// above travels with whichever import survives.
import { EXPIRED_FIXTURE_BACKDATE_MINUTES, inMinutes } from "../../tck/time";
import { CitrineGraphQL } from "./graphql-client";
import { stationColumn } from "./variant";

/**
 * Tags that must exist and authorize normally.
 *
 * Most of these are hard-coded in the SIMULATOR's scenario templates rather
 * than in tck/specs/, so deriving the list from this repository's sources
 * yields a set that looks complete and silently fails TC_013/014/017/018.
 * Ground truth is the pinned simulator image; drivers/steve/provision.ts
 * carries the one-liner that re-extracts it, and tck/sim.ts owns the digest.
 */
const VALID_TAGS = [
  // Sent by the charge point, from the simulator's own templates.
  "CERT003",
  "CERT004",
  "CERT005",
  "CERT010",
  "CERT011",
  "CERT012",
  "CERT013",
  "CERT014",
  "CERT017",
  "CERT018",
  "CERT028",
  "CERT056",
  "CERT057",
  "CERT059",
  "CERT-RES01",
  // Supplied BY the CSMS, from tck/specs/ -- RemoteStartTransaction and
  // SendLocalList carry these.
  "CERT-TAG-1",
  "CERT-TAG-2",
] as const;

/** Absent from Authorizations entirely -- the 1.6 Authorize handler answers
 *  Invalid when the lookup returns no row. */
const INVALID_TAG = "CERT023-INV";
/** Present, Accepted, with cacheExpiryDateTime in the past. */
const EXPIRED_TAG = "CERT023-EXP";
/** Present, stored Blocked. See BLOCKED_TAG_CAVEAT. */
const BLOCKED_TAG = "CERT023-BLK";

/**
 * The expiry written for EXPIRED_TAG: the run's own start, never a fabricated
 * historical instant. tck/time.ts owns the offset and the policy.
 *
 * IT IS THIS PROCESS'S CLOCK, where the SQL transport let Postgres date the
 * row with `NOW()`. A GraphQL mutation sends values, not expressions, so the
 * instant is computed here and the CSMS compares it against its own clock --
 * which is precisely the skew the backdate covers. On the compose environment
 * the two clocks are the same kernel's.
 *
 * The status stays `Accepted` and only the instant makes it expired, which
 * reads backwards until you follow the handler: AuthorizeRequestOcpp16Handler
 * compares `cacheExpiryDateTime` against now INSIDE the `status === Accepted`
 * branch, and every other stored status falls through to the default. A row
 * stored as `status = 'Expired'` therefore answers Invalid, not Expired.
 */
function expiredAtRunStart(): string {
  return inMinutes(-EXPIRED_FIXTURE_BACKDATE_MINUTES).toISOString();
}

/** How a fixture expires. A domain value, not a timestamp: the table below
 *  declares WHAT each tag is, and `expiryOf` decides when that is. */
type FixtureExpiry = "never" | "at-run-start";

function expiryOf(expiry: FixtureExpiry): string | null {
  return expiry === "never" ? null : expiredAtRunStart();
}

/**
 * Why CERT023-BLK is provisioned anyway, and what it does NOT achieve.
 *
 * AuthorizeRequestOcpp16Handler reaches its status mapper only through the
 * `status === Accepted` branch; a stored `Blocked` matches neither that branch
 * nor the null-status one, so the response keeps its default `Invalid`. The
 * only route to a real `Blocked` is an IAuthorizer returning it, and the
 * shipped container registers `authorizers: asValue([])`
 * (apps/ocpp-server/src/container.ts) with no configuration that changes it.
 *
 * The row is still written, for two reasons: it is the closest honest
 * expression of the fixture, and it means the scenario fails on the CSMS's
 * mapping rather than on a tag that was never there -- which is the finding
 * worth reporting upstream. scope.ts carries the same citation.
 */
const BLOCKED_TAG_CAVEAT =
  "stored status Blocked; CitrineOS's 1.6 Authorize handler maps it to Invalid";

/** CitrineOS looks tags up by idToken alone, so at most one row may exist per
 *  tag: the handler answers Invalid outright when the lookup returns more than
 *  one. `Central` rather than NULL so the value is greppable in the table. */
const ID_TOKEN_TYPE = "Central";

interface TagFixture {
  idToken: string;
  status: string;
  expiry: FixtureExpiry;
}

const FIXTURES: readonly TagFixture[] = [
  ...VALID_TAGS.map((idToken) => ({
    idToken,
    status: "Accepted",
    expiry: "never" as const,
  })),
  { idToken: EXPIRED_TAG, status: "Accepted", expiry: "at-run-start" },
  { idToken: BLOCKED_TAG, status: "Blocked", expiry: "never" },
];

/** Every tag this driver owns. Spelled once so that a fixture added to
 *  provision but not to teardown cannot leave rows behind that verify still
 *  demands. */
const ALL_TAGS = [...VALID_TAGS, BLOCKED_TAG, EXPIRED_TAG, INVALID_TAG];

interface AuthorizationRow {
  id: number;
  idToken: string;
  status: string | null;
  cacheExpiryDateTime: string | null;
}

export class CitrineProvisioner {
  private readonly gql: CitrineGraphQL;

  constructor(
    private readonly cfg: CitrineConfig,
    private readonly log: (msg: string) => void = stdout,
  ) {
    this.gql = new CitrineGraphQL(cfg);
  }

  private get tenant(): number {
    return this.cfg.tenantId;
  }

  /**
   * Makes the data API able to answer at all.
   *
   * Hasura exposes no table until one is tracked, and this compose starts it
   * with empty metadata on purpose (see compose.yaml). This is the exact
   * counterpart of the SteVe driver writing an API password and restarting the
   * container: a bootstrap that provisioning pays once so that every later
   * read is a plain HTTP query. It is idempotent, so a second run is a no-op.
   */
  async ensureApiAccess(): Promise<void> {
    await this.gql.ensureTracked();
    this.log("api: data API tracked");
  }

  /**
   * Writes every fixture, upserting by hand.
   *
   * NOT `on_conflict`, and the reason is the same one CitrineOS's own e2e
   * fixtures record: the unique index on (idToken, idTokenType, tenantId) is
   * an INDEX with no matching CONSTRAINT, so Hasura cannot resolve a conflict
   * target for it even though its enum lists the name. Read, then update or
   * insert.
   *
   * Matching on (idToken, tenantId) rather than on the full index is
   * deliberate: a row written with a different idTokenType would not collide,
   * and the table would quietly grow the second row that makes the 1.6
   * Authorize handler answer Invalid.
   *
   * One request per fixture, where the SQL sent one script for twenty. The
   * batching existed to amortise a ~350 ms `docker exec` spawn; over HTTP the
   * round trip is milliseconds, and a mutation per fixture keeps the failure
   * message pointing at the fixture that failed.
   */
  async provisionTags(): Promise<void> {
    const existing = await this.existingTags();
    const now = new Date().toISOString();

    for (const fixture of FIXTURES) {
      const expiry = expiryOf(fixture.expiry);
      const row = existing.get(fixture.idToken);
      if (row === undefined) {
        await this.gql.query(
          `mutation Seed($object: Authorizations_insert_input!) {
             insert_Authorizations_one(object: $object) { id }
           }`,
          {
            object: {
              idToken: fixture.idToken,
              idTokenType: ID_TOKEN_TYPE,
              status: fixture.status,
              cacheExpiryDateTime: expiry,
              tenantId: this.tenant,
              // Hasura sends what it is given and nothing else: these columns
              // are NOT NULL with no database default, so omitting them fails
              // the insert. CitrineOS's own token mutations set them the same
              // way.
              createdAt: now,
              updatedAt: now,
            },
          },
        );
        continue;
      }
      await this.gql.query(
        `mutation Reseed($id: Int!, $set: Authorizations_set_input!) {
           update_Authorizations(where: { id: { _eq: $id } }, _set: $set) { affected_rows }
         }`,
        {
          id: row.id,
          set: {
            status: fixture.status,
            cacheExpiryDateTime: expiry,
            updatedAt: now,
          },
        },
      );
    }

    await this.removeInvalidTag();
    this.log(
      `tags: ${VALID_TAGS.length} valid, ${EXPIRED_TAG} expired ` +
        `${EXPIRED_FIXTURE_BACKDATE_MINUTES} min before this run's provisioning, ` +
        `${BLOCKED_TAG} (${BLOCKED_TAG_CAVEAT}), ${INVALID_TAG} absent`,
    );
  }

  /** Every fixture row this driver owns, by idToken. */
  private async existingTags(): Promise<Map<string, AuthorizationRow>> {
    const data = await this.gql.query<{ Authorizations: AuthorizationRow[] }>(
      `query Fixtures($tags: [citext!]!, $tenant: Int!) {
         Authorizations(where: { idToken: { _in: $tags }, tenantId: { _eq: $tenant } }) {
           id
           idToken
           status
           cacheExpiryDateTime
         }
       }`,
      { tags: ALL_TAGS, tenant: this.tenant },
    );
    const byTag = new Map<string, AuthorizationRow>();
    for (const row of data.Authorizations) {
      // First wins, and duplicates are verify()'s to report rather than this
      // method's to hide: seeding either of two rows leaves the other behind.
      if (!byTag.has(row.idToken)) byTag.set(row.idToken, row);
    }
    return byTag;
  }

  /**
   * The unknown tag must be ABSENT, and TC_023.1 asserts no transaction was
   * ever created for it -- so nothing should reference it. The guard is there
   * for the case where something did: deleting a referenced Authorization
   * fails on a foreign key that does not cascade, and the message would name
   * a constraint rather than the situation.
   */
  private async removeInvalidTag(): Promise<void> {
    const data = await this.gql.query<{
      Authorizations: { id: number; Transactions_aggregate: { aggregate: { count: number } } }[];
    }>(
      `query Unknown($tag: citext!, $tenant: Int!) {
         Authorizations(where: { idToken: { _eq: $tag }, tenantId: { _eq: $tenant } }) {
           id
           Transactions_aggregate { aggregate { count } }
         }
       }`,
      { tag: INVALID_TAG, tenant: this.tenant },
    );
    const removable = data.Authorizations.filter(
      (row) => row.Transactions_aggregate.aggregate.count === 0,
    ).map((row) => row.id);
    if (removable.length === 0) return;
    await this.gql.query(
      `mutation DropUnknown($ids: [Int!]!) {
         delete_Authorizations(where: { id: { _in: $ids } }) { affected_rows }
       }`,
      { ids: removable },
    );
  }

  /**
   * Does the running server's schema match the variant we were told to expect?
   *
   * variant.ts declares rather than detects, so that the scope table stays
   * readable offline -- which leaves exactly one way for the declaration to be
   * wrong: pointing a `v2` driver at a `v1.9.1` server, or the reverse. The
   * symptom without this check is silent and expensive: every record read
   * filters on a field the schema does not have, so the data API rejects the
   * query and a dozen scenarios report the CSMS as empty. One query converts
   * that into a sentence.
   *
   * The discriminator is `ocppConnectionName`, never `stationId`: `stationId`
   * exists on `Transactions` in BOTH lines -- `character varying` holding the
   * OCPP name on v1.9.1, an `integer` foreign key on v2 -- so its presence
   * proves nothing. Both facts were read off running containers.
   *
   * Asked of the GraphQL schema rather than of `information_schema`, which
   * Hasura does not expose: the generated type mirrors the table's columns, so
   * introspection answers the same question the catalog query did -- and
   * answers it about the fields the queries below will actually use.
   */
  private async verifySchema(): Promise<string[]> {
    const data = await this.gql.query<{
      __type: { fields: { name: string }[] } | null;
    }>(`{ __type(name: "Transactions") { fields { name } } }`);
    if (data.__type === null) {
      return [
        "schema mismatch: the data API exposes no `Transactions` type. " +
          "Run `ocpp-tck driver provision` to track the tables, and check that " +
          "CITRINE_GRAPHQL_URL points at this server's graphql-engine.",
      ];
    }
    const present = data.__type.fields.some(
      (field) => field.name === "ocppConnectionName",
    );
    const expected = this.cfg.variant === "v2";
    if (present === expected) return [];
    return [
      `schema mismatch: CITRINE_VARIANT=${this.cfg.variant} expects ` +
        `Transactions."${stationColumn(this.cfg.variant)}", but the server ` +
        `${present ? "has" : "does not have"} ocppConnectionName. ` +
        `Set CITRINE_VARIANT=${present ? "v2" : "v1"} for this server.`,
    ];
  }

  /**
   * Read-only, and answered by the data API rather than by the database that
   * backs it -- the same rule the SteVe driver follows: what a fixture looks
   * like through the interface the CSMS publishes is what the Authorize path
   * will see.
   */
  async verify(): Promise<string[]> {
    // First, and returning early -- not because the checks below depend on it
    // (they read `Authorizations`, which has no station column) but because of
    // how a mismatch READS. Pointing a v2 driver at a v1.9.1 server makes every
    // record query target a column that does not exist, and the sweep that
    // follows would report twenty absent fixtures. One sentence about the
    // variant is the useful answer; twenty about fixtures is not.
    const schema = await this.verifySchema();
    if (schema.length > 0) return schema;

    const problems: string[] = [];

    // One request for every fixture, and the duplicate check counts rows in
    // this process rather than in a GROUP BY -- GraphQL has no grouping, and
    // twenty rows are twenty rows.
    //
    // "Is the expiry in the past" is decided HERE, against this process's
    // clock, where the SQL asked Postgres. The instant the CSMS compares
    // against is its own, so the two clocks must agree to within the fixture's
    // backdate -- which is what EXPIRED_FIXTURE_BACKDATE_MINUTES exists for.
    const data = await this.gql.query<{ Authorizations: AuthorizationRow[] }>(
      `query Fixtures($tags: [citext!]!, $tenant: Int!) {
         Authorizations(where: { idToken: { _in: $tags }, tenantId: { _eq: $tenant } }) {
           id
           idToken
           status
           cacheExpiryDateTime
         }
       }`,
      { tags: ALL_TAGS, tenant: this.tenant },
    );

    const tags = new Map<string, AuthorizationRow>();
    const counts = new Map<string, number>();
    for (const row of data.Authorizations) {
      counts.set(row.idToken, (counts.get(row.idToken) ?? 0) + 1);
      if (!tags.has(row.idToken)) tags.set(row.idToken, row);
    }

    // A duplicate is not cosmetic: the 1.6 Authorize handler answers Invalid
    // outright when an idToken resolves to more than one row, so this check is
    // the difference between a diagnosable environment fault and twelve
    // scenarios failing on an unexplained denial.
    for (const [idToken, count] of counts) {
      if (count !== 1) {
        problems.push(`${idToken}: ${count} rows, expected 1 (the handler answers Invalid for more)`);
      }
    }

    for (const idTag of VALID_TAGS) {
      const row = tags.get(idTag);
      if (!row) {
        problems.push(`${idTag}: missing`);
        continue;
      }
      if (row.status !== "Accepted") {
        problems.push(`${idTag}: status ${row.status ?? "<null>"}, expected Accepted`);
      }
      if (row.cacheExpiryDateTime !== null) {
        problems.push(`${idTag}: has cacheExpiryDateTime ${row.cacheExpiryDateTime}, expected none`);
      }
    }

    if (tags.has(INVALID_TAG)) {
      problems.push(`${INVALID_TAG}: present, must be absent for TC_023.1`);
    }

    const expired = tags.get(EXPIRED_TAG);
    if (!expired?.cacheExpiryDateTime) {
      problems.push(`${EXPIRED_TAG}: missing or has no cacheExpiryDateTime`);
    } else if (expired.status !== "Accepted") {
      // The trap expiredAtRunStart's comment describes, checked rather than
      // merely documented: any other status makes the handler answer Invalid
      // and the expiry is never consulted.
      problems.push(
        `${EXPIRED_TAG}: status ${expired.status}, expected Accepted -- only the ` +
          "Accepted branch consults cacheExpiryDateTime",
      );
    } else if (!(Date.parse(expired.cacheExpiryDateTime) < Date.now())) {
      problems.push(
        `${EXPIRED_TAG}: expiry ${expired.cacheExpiryDateTime} is not in the past`,
      );
    }

    const blocked = tags.get(BLOCKED_TAG);
    if (!blocked) {
      problems.push(`${BLOCKED_TAG}: missing`);
    } else if (blocked.status !== "Blocked") {
      problems.push(`${BLOCKED_TAG}: status ${blocked.status ?? "<null>"}, expected Blocked`);
    }

    return problems;
  }

  /**
   * Which tables reference an Authorization, asked of the schema rather than
   * written out here.
   *
   * There are four foreign keys onto `Authorizations` on the pinned image --
   * `Transactions.authorizationId`, `LocalListAuthorizations.authorizationId`,
   * `LocalListAuthorizations.groupAuthorizationId`, and the self-reference
   * `Authorizations.groupAuthorizationId` -- and none of them cascades. An
   * earlier version guarded only the first, which is the one a
   * transaction-only run exercises; any scenario that had sent a SendLocalList
   * then aborted the DELETE on a constraint violation, removing nothing and
   * saying nothing.
   *
   * Asking is what keeps that fixed: a fifth referencing table on a future
   * CitrineOS is picked up rather than silently reintroducing the same
   * failure. The foreign keys come from Hasura's own relationship derivation,
   * which reads them from the same catalog the SQL used to query directly --
   * and `ensureApiAccess` tracks every table in the source precisely so that
   * none of them is invisible here.
   */
  private async references(): Promise<{ table: string; column: string }[]> {
    const refs = await this.gql.referencesTo("Authorizations");
    if (refs.length === 0) {
      throw new Error(
        "citrineos teardown: no foreign keys onto Authorizations found -- " +
          "either the schema is not what this driver was written against, or the " +
          "tables are not tracked. Refusing to delete.",
      );
    }
    return refs;
  }

  /**
   * Removes the fixtures, and nothing else. Charge points, their connectors
   * and their transactions are runtime residue rather than fixtures, and
   * `docker compose -f drivers/citrineos/compose.yaml down -v` is the honest
   * way to get a clean slate.
   */
  async teardown(): Promise<void> {
    const refs = await this.references();

    // One query asking, per fixture row, how many rows point at it from each
    // referencing column. The aliases are what let a single request cover a
    // set of tables discovered at runtime.
    const counts = refs
      .map(
        (ref, i) =>
          `r${i}: ${ref.table}_aggregate(where: { ${ref.column}: { _eq: $id } }) { aggregate { count } }`,
      )
      .join("\n           ");

    const mine = await this.gql.query<{ Authorizations: { id: number }[] }>(
      `query Mine($tags: [citext!]!, $tenant: Int!) {
         Authorizations(where: { idToken: { _in: $tags }, tenantId: { _eq: $tenant } }) { id }
       }`,
      { tags: ALL_TAGS, tenant: this.tenant },
    );

    const removable: number[] = [];
    let kept = 0;
    for (const row of mine.Authorizations) {
      const referenced = await this.gql.query<
        Record<string, { aggregate: { count: number } }>
      >(`query Referenced($id: Int!) { ${counts} }`, { id: row.id });
      const total = Object.values(referenced).reduce(
        (sum, entry) => sum + entry.aggregate.count,
        0,
      );
      if (total === 0) removable.push(row.id);
      else kept += 1;
    }

    if (removable.length > 0) {
      await this.gql.query(
        `mutation Remove($ids: [Int!]!) {
           delete_Authorizations(where: { id: { _in: $ids } }) { affected_rows }
         }`,
        { ids: removable },
      );
    }
    this.log(
      kept === 0
        ? "tags: removed"
        : `tags: removed, ${kept} kept because scenario records still reference them`,
    );
  }
}

function newProvisioner(): CitrineProvisioner {
  return new CitrineProvisioner(defaultCitrineConfig(process.env));
}

function stdout(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** Turns a thrown error into the exit code a driver verb must return, in one
 *  place, so no verb can grow a differently-worded failure path. */
async function runVerb(
  label: string,
  fn: () => Promise<string[]>,
  onClean: string,
  onProblems: string,
): Promise<number> {
  let problems: string[];
  try {
    problems = await fn();
  } catch (err) {
    process.stderr.write(
      `${label} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  if (problems.length > 0) {
    process.stderr.write(`${onProblems}:\n  ${problems.join("\n  ")}\n`);
    return 1;
  }
  stdout(onClean);
  return 0;
}

/** `ocpp-tck driver provision` */
export async function provisionCommand(): Promise<number> {
  const provisioner = newProvisioner();
  return runVerb(
    "provision",
    async () => {
      await provisioner.ensureApiAccess();
      await provisioner.provisionTags();
      return provisioner.verify();
    },
    "provisioned",
    "provision ran but the environment is still wrong",
  );
}

/** `ocpp-tck driver verify` */
export async function verifyCommand(): Promise<number> {
  return runVerb(
    "verify",
    () => newProvisioner().verify(),
    "environment matches what the scenarios assume",
    "not provisioned",
  );
}

/** `ocpp-tck driver teardown` */
export async function teardownCommand(): Promise<number> {
  return runVerb(
    "teardown",
    async () => {
      await newProvisioner().teardown();
      return [];
    },
    "torn down",
    "teardown left problems",
  );
}
