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
 * UI because each covers what the others cannot. Here everything is the
 * GraphQL data API, because CitrineOS exposes no Authorization CRUD over REST
 * at all: every `@AsDataEndpoint` in the repository was read, and
 * `EVDriverDataApi` offers exactly one route, a read-only GET of the local
 * list version. The server itself asks for what it gives no way to do --
 * `sendLocalList` answers "create the Authorization before adding it to a
 * local auth list". records.ts carries the evidence that GraphQL is CitrineOS's
 * own answer to that rather than a workaround.
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
 * THE OTHER FIXTURE HERE IS THE OCPP 2.0.1 DEVICE MODEL, and it is a different
 * shape from the tags in one way worth reading before the code: half of it
 * belongs to the tenant and half to a station that does not exist until one
 * connects. `provision` writes the first half and `verify` checks it;
 * {@link CitrineProvisioner.ensureStationTopology} writes the second, per
 * station, from the prepare hook. device-model.ts says what the rows are for.
 *
 * Everything is idempotent. Re-running provision on a provisioned environment
 * must be a no-op that still exits 0, because CI reruns it and an operator
 * chasing a failure will run it twice before believing it.
 */
import { defaultCitrineConfig, type CitrineConfig } from "./config";
// Second on purpose: tsc elides this import from the .d.ts, and the header
// above travels with whichever import survives.
import { EXPIRED_FIXTURE_BACKDATE_MINUTES, inMinutes } from "../../tck/time";
import type { FetchLike } from "../../tck/driver";
import {
  COMPONENT_NAME,
  FIXTURE_EVSE_PATTERN,
  VARIABLE_NAME,
  componentInstance,
  fixtureEvseId,
  statusTargets,
  type StatusTarget,
} from "./device-model";
import { CitrineGraphQL } from "./graphql-client";
import { speaksOcpp201, stationColumn } from "./variant";

/** What `provision`, `verify` and `teardown` say instead of touching a device
 *  model on a line that declares no OCPP 2.0.1 surface. One spelling, so the
 *  three cannot describe the same decision differently. */
const NOT_ON_THIS_LINE =
  "not provisioned -- this driver declares no OCPP 2.0.1 surface for the " +
  "v1.9.1 line, where every cert201- scenario is NOT APPLICABLE and the " +
  "station columns are named differently. Set CITRINE_VARIANT=v2 for a v2 server.";

/**
 * Tags that must exist and authorize normally.
 *
 * Most of these are hard-coded in the SIMULATOR's scenario templates rather
 * than in tck/specs/, so deriving the list from this repository's sources
 * yields a set that looks complete and silently fails TC_013/014/017/018.
 * Ground truth is the pinned simulator image; drivers/steve/provision.ts
 * carries the one-liner that re-extracts it, and tck/sim.ts owns the digest.
 *
 * All of them are 1.6 tags. The 2.0.1 scenarios authorize with
 * {@link ISO14443_TAG}, which no `CERT…` spelling could stand in for.
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

/**
 * The idToken the 2.0.1 scenarios authorize with, and the one fixture here
 * whose SHAPE is load-bearing rather than arbitrary.
 *
 * Eight hexadecimal characters, because the charge point sends its 2.0.1
 * `Authorize` idToken as `ISO14443` -- the type is a literal in the pinned
 * simulator image, not a setting -- and CitrineOS validates that type's format
 * (8 or 14 hex characters, `validateIdToken` in packages/core) BEFORE any
 * lookup. Every `CERT…` tag above fails on its shape alone, and the answer is
 * a CALLERROR rather than an AuthorizeResponse, so no transaction can start.
 *
 * It is deliberately not spelled `CERT…`: `CERT` is not hexadecimal, so no tag
 * of the existing vocabulary can carry this shape. The price is that
 * `tools/extract-fixture-tags.sh` cannot see it -- all three of its greps are
 * anchored on `CERT` -- and widening them to a hex pattern was rejected rather
 * than skipped: `[0-9A-Fa-f]{8}` matches ids, colours and digest prefixes all
 * over the simulator's sources, which is the class of false positive the note
 * on that script's image grep already warns about. The tag is covered by
 * `verify()` below instead, which is the check that runs against the CSMS
 * anyway.
 */
const ISO14443_TAG = "CE712001";

/**
 * How a fixture is typed, and why the type is a field rather than a constant.
 *
 * THE TWO HANDLERS DISAGREE, which is the whole reason this is a field and not
 * a constant. CitrineOS's 1.6 Authorize handler looks a tag up by idToken
 * alone (`readAllByQuerystring({ idToken })`) and errors outright when that
 * returns more than one row, so at most one row may exist per 1.6 tag whatever
 * its type. The 2.0.1 handler matches the PAIR
 * (`readOnlyOneByQuerystring(tenantId, { idToken, type })`, which becomes
 * `where.idTokenType = …`), so a row of the wrong type is simply not found --
 * silently, with the same `Unknown` a missing row would produce.
 *
 * `Central` rather than NULL for the 1.6 tags so the value is greppable in the
 * table; `ISO14443` for {@link ISO14443_TAG} because nothing else can match.
 */
type IdTokenType = "Central" | "ISO14443";

/** Omitted is `Central`, the same shape `expiryOf` gives `FixtureExpiry`: the
 *  table declares what is exceptional about a fixture, and one fixture's type
 *  is the exception. */
function typeOf(fixture: TagFixture): IdTokenType {
  return fixture.idTokenType ?? "Central";
}

interface TagFixture {
  idToken: string;
  status: string;
  expiry: FixtureExpiry;
  idTokenType?: IdTokenType;
}

const FIXTURES: readonly TagFixture[] = [
  ...VALID_TAGS.map((idToken) => ({
    idToken,
    status: "Accepted",
    expiry: "never" as const,
  })),
  {
    idToken: ISO14443_TAG,
    status: "Accepted",
    expiry: "never",
    idTokenType: "ISO14443",
  },
  { idToken: EXPIRED_TAG, status: "Accepted", expiry: "at-run-start" },
  { idToken: BLOCKED_TAG, status: "Blocked", expiry: "never" },
];

/** Every tag this driver owns: every fixture, plus the one that must be
 *  ABSENT. Derived rather than spelled, so a fixture added to provision but
 *  not to teardown cannot leave rows behind that verify still demands. */
const ALL_TAGS = [...FIXTURES.map((fixture) => fixture.idToken), INVALID_TAG];

interface AuthorizationRow {
  id: number;
  idToken: string;
  status: string | null;
  cacheExpiryDateTime: string | null;
  idTokenType: string | null;
}

export class CitrineProvisioner {
  private readonly gql: CitrineGraphQL;

  /** `fetchImpl` is the {@link FetchLike} seam
   *  `tests/citrineos-device-model-fixture.ts` drives: what this class writes
   *  is only observable as a sequence of requests, and a CSMS answers the same
   *  way whether the fixture is right or wrong. */
  constructor(
    private readonly cfg: CitrineConfig,
    private readonly log: (msg: string) => void = stdout,
    fetchImpl?: FetchLike,
  ) {
    this.gql = new CitrineGraphQL(cfg, fetchImpl);
  }

  private get tenant(): number {
    return this.cfg.tenantId;
  }

  /**
   * Whether the device-model fixture belongs on the line this driver is
   * pointed at. THE SAME PREDICATE THE CAPABILITY USES, and for a reason that
   * is not symmetry.
   *
   * The v1.9.1 line has no `ocppConnectionName`: it never got the rename
   * migration, and its `Connector.stationId` is a STRING holding the OCPP
   * name. Every write below spells `ocppConnectionName` literally -- correctly
   * for v2, and as a field the v1 schema does not expose -- so an ungated
   * `ensureStationTopology` fails on every scenario of a line where eighteen
   * of them are still drivable. Nothing offline sees it: the scope check is
   * static, and no CI lane sweeps v1.
   *
   * There is also nothing for the fixture to buy there. `capabilities` declares
   * no OCPP 2.0.1 surface for v1 and every `cert201-` row is NOT_APPLICABLE,
   * so seeding a 2.0.1 device model would be claiming a measurement nobody
   * took -- which is what variant.ts exists to refuse.
   */
  private get speaks201(): boolean {
    return speaksOcpp201(this.cfg.variant);
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
   * FOUND IN ORDER TO BE REPAIRED, which is the half that used to be missing.
   * The update below rewrites idTokenType too, so a row whose type has drifted
   * from the fixture is corrected rather than merely not duplicated -- and the
   * distinction is not academic now that a fixture carries a type the 2.0.1
   * lookup filters on. teardown() KEEPS a row a Transactions row still points
   * at, so a wrong-typed row can outlive a teardown, and nothing short of
   * `compose down -v` would otherwise get rid of it.
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
              idTokenType: typeOf(fixture),
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
            // Rewritten, not left alone: see the note on the match key above.
            // If the drifted row's counterpart of the RIGHT type also exists,
            // this raises the (idToken, idTokenType, tenantId) violation
            // instead of leaving two rows for verify() to find later, which is
            // the diagnosable failure of the two.
            idTokenType: typeOf(fixture),
            cacheExpiryDateTime: expiry,
            updatedAt: now,
          },
        },
      );
    }

    await this.removeInvalidTag();
    this.log(
      // Counted off FIXTURES, not off VALID_TAGS: the census and the table are
      // the two spellings of one set, and that is what drifts.
      `tags: ${FIXTURES.length} seeded, ${ISO14443_TAG} typed ISO14443, ` +
        `${EXPIRED_TAG} expired ` +
        `${EXPIRED_FIXTURE_BACKDATE_MINUTES} min before this run's provisioning, ` +
        `${BLOCKED_TAG} (${BLOCKED_TAG_CAVEAT}), ${INVALID_TAG} absent`,
    );
  }

  /**
   * Every row this driver's fixtures occupy. One document, because provisioning
   * and verification ask the same question of the same columns -- a second copy
   * would let the seeder write a field the check never looks at.
   */
  private async fixtureRows(): Promise<AuthorizationRow[]> {
    const data = await this.gql.query<{ Authorizations: AuthorizationRow[] }>(
      `query Fixtures($tags: [citext!]!, $tenant: Int!) {
         Authorizations(where: { idToken: { _in: $tags }, tenantId: { _eq: $tenant } }) {
           id
           idToken
           status
           cacheExpiryDateTime
           idTokenType
         }
       }`,
      { tags: ALL_TAGS, tenant: this.tenant },
    );
    return data.Authorizations;
  }

  /** The fixture rows by idToken. First wins, and duplicates are verify()'s to
   *  report rather than this method's to hide: seeding either of two rows
   *  leaves the other behind. */
  private async existingTags(): Promise<Map<string, AuthorizationRow>> {
    const byTag = new Map<string, AuthorizationRow>();
    for (const row of await this.fixtureRows()) {
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
   *
   * IT CHECKS WHAT `provision` WROTE, WHICH IS NOT ALL OF WHAT A SCENARIO
   * NEEDS. The device model's station-scoped half -- an EVSE and a connector
   * per charge point -- is written by {@link ensureStationTopology} from a
   * charge point id the runner supplies scenario by scenario, and nothing in
   * this driver's environment lists those ids. So a green `verify` says the
   * tenant-scoped fixtures are in place, and says nothing at all about any
   * particular station. Stated here rather than left to be inferred, because a
   * check that appears to cover something it cannot is worse than one that
   * does not cover it.
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
    const tags = new Map<string, AuthorizationRow>();
    const counts = new Map<string, number>();
    for (const row of await this.fixtureRows()) {
      counts.set(row.idToken, (counts.get(row.idToken) ?? 0) + 1);
      if (!tags.has(row.idToken)) tags.set(row.idToken, row);
    }

    // A duplicate is not cosmetic, and it is not cosmetic in two different
    // ways: the 1.6 Authorize handler answers Invalid outright when an idToken
    // resolves to more than one row, and 2.0.1's readOnlyOneByQuery THROWS on
    // the same condition. Either way this check is the difference between a
    // diagnosable environment fault and twelve scenarios failing on an
    // unexplained denial.
    for (const [idToken, count] of counts) {
      if (count !== 1) {
        problems.push(
          `${idToken}: ${count} rows, expected 1 (1.6 answers Invalid for more, 2.0.1 throws)`,
        );
      }
    }

    // ONE PASS, AND THE TABLE IS WHAT IT CHECKS AGAINST. Every column FIXTURES
    // declares is read back from the row that carries it, so a fixture added
    // there is verified by having been declared -- where three per-constant
    // blocks used to check the tags someone had remembered to write a block
    // for, and a fourth field (the type) would have needed a fourth block.
    //
    // The status is the subtle one, and expiredAtRunStart's comment has the
    // argument: the 1.6 handler consults cacheExpiryDateTime only INSIDE its
    // `status === Accepted` branch, so a row stored `Expired` answers Invalid
    // and its expiry is never looked at. That is why the expired fixture is
    // declared Accepted and only its instant makes it expired -- and why a
    // drifted status has to be reported before the instant is judged.
    for (const fixture of FIXTURES) {
      const row = tags.get(fixture.idToken);
      if (!row) {
        problems.push(`${fixture.idToken}: missing`);
        continue;
      }
      if (row.status !== fixture.status) {
        problems.push(
          `${fixture.idToken}: status ${row.status ?? "<null>"}, expected ${fixture.status}`,
        );
      }
      // Invisible in every other column: the 2.0.1 lookup filters on the pair,
      // so a wrong type answers the same Unknown a missing row does.
      if (row.idTokenType !== typeOf(fixture)) {
        problems.push(
          `${fixture.idToken}: idTokenType ${row.idTokenType ?? "<null>"}, expected ` +
            `${typeOf(fixture)} (the 2.0.1 lookup matches idToken AND type)`,
        );
      }
      if (fixture.expiry === "never") {
        if (row.cacheExpiryDateTime !== null) {
          problems.push(
            `${fixture.idToken}: has cacheExpiryDateTime ${row.cacheExpiryDateTime}, expected none`,
          );
        }
      } else if (!row.cacheExpiryDateTime) {
        problems.push(`${fixture.idToken}: has no cacheExpiryDateTime, expected one in the past`);
      } else if (!(Date.parse(row.cacheExpiryDateTime) < Date.now())) {
        problems.push(
          `${fixture.idToken}: expiry ${row.cacheExpiryDateTime} is not in the past`,
        );
      }
    }

    if (tags.has(INVALID_TAG)) {
      problems.push(`${INVALID_TAG}: present, must be absent for TC_023.1`);
    }

    problems.push(...(await this.verifyDeviceModel()));

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
  private async references(
    target: string,
  ): Promise<{ table: string; column: string }[]> {
    const refs = await this.gql.referencesTo(target);
    if (refs.length === 0) {
      throw new Error(
        `citrineos teardown: no foreign keys onto ${target} found -- ` +
          "either the schema is not what this driver was written against, or the " +
          "tables are not tracked. Refusing to delete.",
      );
    }
    return refs;
  }

  /**
   * Deletes the given rows of `table`, KEEPING every one something still points
   * at, and answers how many were kept.
   *
   * The rule the tags teardown was written for, applied to six tables instead
   * of one -- a fixture EVSE acquires a transaction, a fixture component
   * acquires the variable attribute the CSMS wrote when the status finally
   * landed. Those are runtime residue hanging off a fixture, and this is the
   * line between the two: the fixture goes, what a scenario produced stays, and
   * the count says so out loud rather than the delete failing on a constraint
   * whose name mentions neither.
   *
   * `table` and `idColumn` are interpolated because GraphQL cannot parameterise
   * a field name -- the same reason variant.ts's station column is. Both come
   * from literals in this file and never from input.
   */
  private async removeUnreferenced(
    table: string,
    ids: readonly number[],
    idColumn = "id",
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const refs = await this.references(table);

    // One request for the whole question: which of these ids does anything
    // still point at? An alias per referencing table, each returning the
    // pointing column, and the answer is the union of what comes back. The
    // aliases are what let a single document cover a set of tables discovered
    // at runtime.
    const selections = refs
      .map(
        (ref, i) =>
          `r${i}: ${ref.table}(where: { ${ref.column}: { _in: $ids } }, ` +
          `distinct_on: ${ref.column}) { ${ref.column} }`,
      )
      .join("\n           ");
    const rows = await this.gql.query<
      Record<string, Record<string, number | null>[]>
    >(`query Referenced($ids: [Int!]!) { ${selections} }`, { ids });
    const referenced = new Set<number>();
    for (const [alias, hits] of Object.entries(rows)) {
      const column = refs[Number(alias.slice(1))]?.column;
      if (column === undefined) continue;
      for (const hit of hits) {
        const id = hit[column];
        if (typeof id === "number") referenced.add(id);
      }
    }

    const removable = ids.filter((id) => !referenced.has(id));
    if (removable.length > 0) {
      await this.gql.query(
        `mutation Remove($ids: [Int!]!) {
           delete_${table}(where: { ${idColumn}: { _in: $ids } }) { affected_rows }
         }`,
        { ids: removable },
      );
    }
    return ids.length - removable.length;
  }

  /**
   * Removes the fixtures, and nothing else. A charge point row and its
   * transactions are runtime residue rather than fixtures, and
   * `docker compose -f drivers/citrineos/compose.yaml down -v` is the honest
   * way to get a clean slate.
   *
   * CONNECTORS ARE NOW ON BOTH SIDES OF THAT LINE, which is why the sentence
   * above no longer names them. The rows a 2.0.1 station needs are written by
   * {@link ensureStationTopology} and are fixtures; the ones a 1.6 station's
   * first status makes the CSMS commission for itself are residue. The marker
   * on the EVSE that owns them is what tells the two apart -- see
   * device-model.ts.
   */
  async teardown(): Promise<void> {
    const mine = await this.gql.query<{ Authorizations: { id: number }[] }>(
      `query Mine($tags: [citext!]!, $tenant: Int!) {
         Authorizations(where: { idToken: { _in: $tags }, tenantId: { _eq: $tenant } }) { id }
       }`,
      { tags: ALL_TAGS, tenant: this.tenant },
    );
    const kept = await this.removeUnreferenced(
      "Authorizations",
      mine.Authorizations.map((row) => row.id),
    );
    this.log(
      kept === 0
        ? "tags: removed"
        : `tags: removed, ${kept} kept because scenario records still reference them`,
    );
    await this.teardownDeviceModel();
  }

  // -------------------------------------------------------------------------
  // The OCPP 2.0.1 device model. device-model.ts says what these rows are for
  // and where their identity comes from; this half is only how they are
  // written, read back and removed.
  //
  // TWO SCOPES, AND THE SPLIT IS THE SCHEMA'S RATHER THAN A CHOICE. The four
  // tables below carry no station column at all -- they belong to the tenant --
  // so they are a fixture in the same sense the tags are: provisioned once,
  // verified, torn down. The other half of what a status needs, an EVSE and a
  // connector, hangs off a charging station row that does not exist until a
  // station has connected, and `provision` has no roster to name one with. That
  // half is {@link ensureStationTopology}, called per station from the prepare
  // hook, and `verify` cannot see it -- see its header.
  // -------------------------------------------------------------------------

  /**
   * Seeds the tenant-scoped half: one EVSE type per target, one component per
   * target, one variable for all of them, and the join rows.
   *
   * Read-then-insert-or-update by hand, for the reason `provisionTags` gives:
   * the unique indexes here are indexes with no matching constraint, so Hasura
   * has no conflict target to offer `on_conflict`.
   */
  async provisionDeviceModel(): Promise<void> {
    if (!this.speaks201) {
      this.log(`device model: ${NOT_ON_THIS_LINE}`);
      return;
    }
    await this.syncDeviceModel();
    const targets = statusTargets();
    this.log(
      `device model: ${COMPONENT_NAME}/${VARIABLE_NAME} seeded for ` +
        `${targets.map(describeTarget).join(", ")} ` +
        `(${targets.length} target(s), one component each); ` +
        "the EVSEs and connectors are written per station by prepareStation",
    );
  }

  /**
   * The same work, silent, and it runs before EVERY scenario rather than once
   * -- because the CSMS un-does part of it on every status it files.
   *
   * THE REPAIR IS NOT DEFENSIVE, IT IS LOAD-BEARING, and the reason is a defect
   * in the pinned image rather than a race. `findOrCreateEvseAndComponent`
   * (`packages/core/src/dal/layers/sequelize/repository/DeviceModel.ts`)
   * resolves a component's EVSE with
   *
   *     connectorId: componentType.evse.connectorId ? componentType.evse.connectorId : null
   *
   * and `0` is falsy. So filing the STATION-SCOPE status -- the one addressed
   * to `(evseId 0, connectorId 0)` -- creates a second EVSE type numbered 0
   * with a null connector and repoints the component at it, and the next
   * status's lookup, which filters on the pair, no longer matches. Measured:
   * the four warnings are gone on the first run and one is back on the second.
   *
   * Re-asserting the join costs `1 + 3n` reads and no writes when nothing
   * moved -- seven for the two targets a one-connector station reports -- which
   * is what a per-scenario hook has to cost. The alternative, dropping the
   * station-scope target, would leave two of the four warnings standing and is
   * the thing this fixture exists to remove.
   */
  private async syncDeviceModel(): Promise<void> {
    const now = new Date().toISOString();
    const variableId = await this.ensureVariable(now);
    for (const target of statusTargets()) {
      const evseTypeDatabaseId = await this.ensureEvseType(target, now);
      const componentId = await this.ensureComponent(
        target,
        evseTypeDatabaseId,
        now,
      );
      await this.ensureComponentVariable(componentId, variableId, now);
    }
  }

  /**
   * Read a fixture row, create it if it is not there, and read it AGAIN if the
   * create failed -- because it may have failed by losing a race.
   *
   * WHY THIS EXISTS, and it is a consequence of where the device model is
   * written rather than of anything wrong with the rows. `prepareStation` runs
   * this before every scenario, and a parallel sweep runs one lane per station
   * -- three, in this repository's own CI -- so several lanes reach these
   * inserts at the same moment. The tenant-scoped rows are SHARED between them,
   * where every other write in this file is per station or per tag, and the
   * unique indexes are what make the loser fail rather than duplicate.
   *
   * The re-read is what turns that into a no-op instead of an ERROR: the row
   * the loser wanted exists, it is simply not the one it wrote. If the second
   * read still finds nothing, the original error is rethrown -- the insert
   * failed for a reason that is not a race, and swallowing it would be this
   * file's fixtures silently not existing.
   *
   * On the common path -- `driver provision` ran, the rows are there -- the
   * first read answers and neither the insert nor its guard is reached.
   */
  private async readOrSeed<T>(
    read: () => Promise<T | undefined>,
    seed: () => Promise<T>,
  ): Promise<T> {
    const existing = await read();
    if (existing !== undefined) return existing;
    try {
      return await seed();
    } catch (err) {
      const raced = await read();
      if (raced !== undefined) return raced;
      throw err;
    }
  }

  /** The EVSE type the handler's component query joins through. Matched on the
   *  PAIR, because `(tenantId, id, connectorId)` is the unique index and an
   *  EVSE type with the right id and a different connector is a different row. */
  private async ensureEvseType(
    target: StatusTarget,
    now: string,
  ): Promise<number> {
    return this.readOrSeed(
      async () => {
        const found = await this.gql.query<{
          EvseTypes: { databaseId: number }[];
        }>(
          `query EvseTypeFixture($id: Int!, $connector: Int!, $tenant: Int!) {
             EvseTypes(where: {
               id: { _eq: $id }, connectorId: { _eq: $connector }, tenantId: { _eq: $tenant }
             }) { databaseId }
           }`,
          {
            id: target.evseId,
            connector: target.connectorId,
            tenant: this.tenant,
          },
        );
        return found.EvseTypes[0]?.databaseId;
      },
      async () => {
        const created = await this.gql.query<{
          insert_EvseTypes_one: { databaseId: number };
        }>(
          `mutation SeedEvseType($object: EvseTypes_insert_input!) {
             insert_EvseTypes_one(object: $object) { databaseId }
           }`,
          {
            object: {
              id: target.evseId,
              connectorId: target.connectorId,
              tenantId: this.tenant,
              createdAt: now,
              updatedAt: now,
            },
          },
        );
        return created.insert_EvseTypes_one.databaseId;
      },
    );
  }

  /** One row for every target, and it is shared: the handler filters variables
   *  by name alone, and the unique index on `(tenantId, name)` where the
   *  instance is null means there can only be one anyway. */
  private async ensureVariable(now: string): Promise<number> {
    return this.readOrSeed(
      async () => {
        const found = await this.gql.query<{ Variables: { id: number }[] }>(
          `query VariableFixture($name: String!, $tenant: Int!) {
             Variables(where: {
               name: { _eq: $name }, instance: { _is_null: true }, tenantId: { _eq: $tenant }
             }) { id }
           }`,
          { name: VARIABLE_NAME, tenant: this.tenant },
        );
        return found.Variables[0]?.id;
      },
      async () => {
        const created = await this.gql.query<{
          insert_Variables_one: { id: number };
        }>(
          `mutation SeedVariable($object: Variables_insert_input!) {
             insert_Variables_one(object: $object) { id }
           }`,
          {
            object: {
              name: VARIABLE_NAME,
              tenantId: this.tenant,
              createdAt: now,
              updatedAt: now,
            },
          },
        );
        return created.insert_Variables_one.id;
      },
    );
  }

  /**
   * The component the handler looks the target up through.
   *
   * FOUND IN ORDER TO BE REPAIRED, the same half `provisionTags` calls out: a
   * component whose `evseDatabaseId` has drifted -- a `compose down -v` that
   * renumbered the EVSE types, an operator editing one -- is not a duplicate
   * and would never collide, it just silently stops joining. The update below
   * points it back at the row this run resolved.
   */
  private async ensureComponent(
    target: StatusTarget,
    evseDatabaseId: number,
    now: string,
  ): Promise<number> {
    const instance = componentInstance(target);
    const read = async (): Promise<
      { id: number; evseDatabaseId: number | null } | undefined
    > => {
      const found = await this.gql.query<{
        Components: { id: number; evseDatabaseId: number | null }[];
      }>(
        `query ComponentFixture($name: String!, $instance: String!, $tenant: Int!) {
           Components(where: {
             name: { _eq: $name }, instance: { _eq: $instance }, tenantId: { _eq: $tenant }
           }) { id evseDatabaseId }
         }`,
        { name: COMPONENT_NAME, instance, tenant: this.tenant },
      );
      return found.Components[0];
    };
    const existing = await this.readOrSeed(read, async () => {
      const created = await this.gql.query<{
        insert_Components_one: { id: number };
      }>(
        `mutation SeedComponent($object: Components_insert_input!) {
           insert_Components_one(object: $object) { id }
         }`,
        {
          object: {
            name: COMPONENT_NAME,
            instance,
            evseDatabaseId,
            tenantId: this.tenant,
            createdAt: now,
            updatedAt: now,
          },
        },
      );
      return { id: created.insert_Components_one.id, evseDatabaseId };
    });
    // AFTER the seed rather than only on the read path, because a component
    // this call created already points at the right EVSE type and one it found
    // -- whether it was there or a racing lane wrote it -- may not.
    if (existing.evseDatabaseId !== evseDatabaseId) {
      await this.gql.query(
        `mutation RepointComponent($id: Int!, $set: Components_set_input!) {
           update_Components(where: { id: { _eq: $id } }, _set: $set) { affected_rows }
         }`,
        {
          id: existing.id,
          set: { evseDatabaseId, updatedAt: now },
        },
      );
    }
    return existing.id;
  }

  /** The join row. Its primary key IS the pair, so there is nothing to repair
   *  -- it exists or it does not. */
  private async ensureComponentVariable(
    componentId: number,
    variableId: number,
    now: string,
  ): Promise<void> {
    await this.readOrSeed(
      async () => {
        const found = await this.gql.query<{
          ComponentVariables: { componentId: number }[];
        }>(
          `query ComponentVariableFixture($component: Int!, $variable: Int!) {
             ComponentVariables(where: {
               componentId: { _eq: $component }, variableId: { _eq: $variable }
             }) { componentId }
           }`,
          { component: componentId, variable: variableId },
        );
        return found.ComponentVariables.length > 0 ? true : undefined;
      },
      async () => {
        await this.gql.query(
          `mutation SeedComponentVariable($object: ComponentVariables_insert_input!) {
             insert_ComponentVariables_one(object: $object) { componentId }
           }`,
          {
            object: {
              componentId,
              variableId,
              tenantId: this.tenant,
              createdAt: now,
              updatedAt: now,
            },
          },
        );
        return true;
      },
    );
  }

  /**
   * Reports each missing piece separately, because they fail differently: no
   * EVSE type and the component cannot join, no component and the status has
   * nowhere to go, no join row and the handler's own filter drops the component
   * it just found. One line saying "device model missing" would send a reader
   * to re-derive which.
   */
  private async verifyDeviceModel(): Promise<string[]> {
    // Nothing to check where nothing is seeded, and NOT a problem to report:
    // a v1 environment with no 2.0.1 device model is correct rather than
    // unprovisioned. See {@link speaks201}.
    if (!this.speaks201) return [];

    const problems: string[] = [];

    const variables = await this.gql.query<{ Variables: { id: number }[] }>(
      `query VariableCheck($name: String!, $tenant: Int!) {
         Variables(where: {
           name: { _eq: $name }, instance: { _is_null: true }, tenantId: { _eq: $tenant }
         }) { id }
       }`,
      { name: VARIABLE_NAME, tenant: this.tenant },
    );
    const variableId = variables.Variables[0]?.id;
    if (variableId === undefined) {
      problems.push(
        `${VARIABLE_NAME}: no variable row, so no status can reach the device model`,
      );
    }

    for (const target of statusTargets()) {
      const where = describeTarget(target);
      const evseTypes = await this.gql.query<{
        EvseTypes: { databaseId: number }[];
      }>(
        `query EvseTypeCheck($id: Int!, $connector: Int!, $tenant: Int!) {
           EvseTypes(where: {
             id: { _eq: $id }, connectorId: { _eq: $connector }, tenantId: { _eq: $tenant }
           }) { databaseId }
         }`,
        {
          id: target.evseId,
          connector: target.connectorId,
          tenant: this.tenant,
        },
      );
      const evseType = evseTypes.EvseTypes[0];
      if (evseType === undefined) {
        problems.push(`${where}: no EvseTypes row`);
        continue;
      }

      const instance = componentInstance(target);
      const components = await this.gql.query<{
        Components: { id: number; evseDatabaseId: number | null }[];
      }>(
        `query ComponentCheck($name: String!, $instance: String!, $tenant: Int!) {
           Components(where: {
             name: { _eq: $name }, instance: { _eq: $instance }, tenantId: { _eq: $tenant }
           }) { id evseDatabaseId }
         }`,
        { name: COMPONENT_NAME, instance, tenant: this.tenant },
      );
      const component = components.Components[0];
      if (component === undefined) {
        problems.push(`${where}: no ${COMPONENT_NAME} component`);
        continue;
      }
      if (component.evseDatabaseId !== evseType.databaseId) {
        problems.push(
          `${where}: the ${COMPONENT_NAME} component points at EVSE type ` +
            `${component.evseDatabaseId ?? "<null>"}, expected ${evseType.databaseId}`,
        );
      }
      if (variableId === undefined) continue;
      const link = await this.gql.query<{
        ComponentVariables: { componentId: number }[];
      }>(
        `query ComponentVariableCheck($component: Int!, $variable: Int!) {
           ComponentVariables(where: {
             componentId: { _eq: $component }, variableId: { _eq: $variable }
           }) { componentId }
         }`,
        { component: component.id, variable: variableId },
      );
      if (link.ComponentVariables.length === 0) {
        problems.push(
          `${where}: the ${COMPONENT_NAME} component carries no ${VARIABLE_NAME} variable`,
        );
      }
    }

    return problems;
  }

  /**
   * The station-scoped half, written per station because that is the only
   * granularity a charge point id arrives at.
   *
   * It CREATES the charging station row when there is none, which is not the
   * overreach it looks like: the hook runs before the simulator container
   * starts, so on a station's first ever scenario the CSMS has nothing to hang
   * an EVSE off yet. CitrineOS's own connect path reads the row by
   * `(ocppConnectionName, tenantId)` and updates it, and that pair is a unique
   * index, so a row written here is the row the connect finds rather than a
   * second one.
   *
   * Idempotent to the point of being cheap on the common path: a handful of
   * reads and no writes once a station is set up, which is what a per-scenario
   * hook has to cost.
   *
   * It re-asserts the TENANT half first, which reads like the wrong scope until
   * you read {@link syncDeviceModel}: the CSMS breaks one of those joins every
   * time it files a status, so "provisioned once" is not a state this fixture
   * can be left in.
   */
  async ensureStationTopology(cpId: string): Promise<void> {
    // Before anything, and silently: this runs ahead of EVERY scenario, so on
    // v1 it would otherwise be one failed write per scenario on a line where
    // eighteen of them still run. See {@link speaks201}.
    if (!this.speaks201) return;
    await this.syncDeviceModel();
    const now = new Date().toISOString();
    const stationId = await this.ensureChargingStation(cpId, now);
    for (const target of statusTargets()) {
      const evseRowId = await this.ensureEvse(cpId, stationId, target, now);
      await this.ensureConnector(cpId, stationId, evseRowId, target, now);
    }
  }

  private async ensureChargingStation(
    cpId: string,
    now: string,
  ): Promise<number> {
    const found = await this.gql.query<{ ChargingStations: { id: number }[] }>(
      `query StationFixture($name: String!, $tenant: Int!) {
         ChargingStations(where: {
           ocppConnectionName: { _eq: $name }, tenantId: { _eq: $tenant }
         }) { id }
       }`,
      { name: cpId, tenant: this.tenant },
    );
    const existing = found.ChargingStations[0];
    if (existing) return existing.id;
    const created = await this.gql.query<{
      insert_ChargingStations_one: { id: number };
    }>(
      `mutation SeedStation($object: ChargingStations_insert_input!) {
         insert_ChargingStations_one(object: $object) { id }
       }`,
      {
        object: {
          ocppConnectionName: cpId,
          tenantId: this.tenant,
          createdAt: now,
          updatedAt: now,
        },
      },
    );
    return created.insert_ChargingStations_one.id;
  }

  /**
   * Matched on `(stationId, evseTypeId)`, which is the unique index -- and NOT
   * on the marker, so a station that already has an EVSE numbered this way is
   * adopted rather than duplicated.
   *
   * AN ADOPTED ROW IS MARKED, which makes the marker mean "this fixture owns
   * it" rather than "this fixture created it", and the difference is a leak
   * rather than a nuance. CitrineOS creates an EVSE of its own accord -- the
   * transaction repository does `readOrCreateByQuery` on
   * `(ocppConnectionName, evseTypeId)` -- so on a database that saw traffic
   * before this fixture existed, the row is already there and unmarked. The
   * connector written under it would then be invisible to teardown, which
   * finds connectors only through marked EVSEs, and would survive every
   * teardown until a `down -v`.
   */
  private async ensureEvse(
    cpId: string,
    stationId: number,
    target: StatusTarget,
    now: string,
  ): Promise<number> {
    const marker = fixtureEvseId(cpId, target.evseId);
    const found = await this.gql.query<{
      Evses: { id: number; evseId: string | null }[];
    }>(
      `query EvseFixture($station: Int!, $evseTypeId: Int!) {
         Evses(where: {
           stationId: { _eq: $station }, evseTypeId: { _eq: $evseTypeId }
         }) { id evseId }
       }`,
      { station: stationId, evseTypeId: target.evseId },
    );
    const existing = found.Evses[0];
    if (existing) {
      if (existing.evseId !== marker) {
        await this.gql.query(
          `mutation AdoptEvse($id: Int!, $set: Evses_set_input!) {
             update_Evses(where: { id: { _eq: $id } }, _set: $set) { affected_rows }
           }`,
          { id: existing.id, set: { evseId: marker, updatedAt: now } },
        );
      }
      return existing.id;
    }
    const created = await this.gql.query<{ insert_Evses_one: { id: number } }>(
      `mutation SeedEvse($object: Evses_insert_input!) {
         insert_Evses_one(object: $object) { id }
       }`,
      {
        object: {
          stationId,
          ocppConnectionName: cpId,
          evseTypeId: target.evseId,
          evseId: marker,
          tenantId: this.tenant,
          createdAt: now,
          updatedAt: now,
        },
      },
    );
    return created.insert_Evses_one.id;
  }

  /**
   * The connector under it.
   *
   * `status` and `timestamp` are left to the CSMS: the handler upserts this row
   * on every StatusNotification, and seeding a status would put a state the
   * station never reported in front of anyone reading the database before the
   * first one arrives. What the fixture owes is the row's IDENTITY -- which
   * EVSE it belongs to and which connector it is -- because that is the part
   * the handler cannot work out for a 2.0.1 station.
   *
   * `evseTypeConnectorId` IS THE OCPP CONNECTOR NUMBER, NOT A DATABASE ID, and
   * that is worth stating because the model says otherwise. The column carries
   * `@ForeignKey(() => EvseType)` and there is NO foreign key behind it in the
   * database -- the decorator is unbacked -- while the column's own comment
   * says "the serial int starting at 1 used in OCPP 2.0.1 to refer to the
   * connector, unique per EVSE". Every CitrineOS path agrees with the comment:
   * the transaction repository looks a connector up with
   * `evseTypeConnectorId: value.evse.connectorId` and creates one with
   * `connectorId: value.evse.connectorId`.
   *
   * Writing an EVSE type's key here instead was measured, and the failure is
   * not the one it sounds like. `TransactionEvent` then finds no connector, so
   * it creates one -- and THAT insert collides with this fixture on
   * `(stationId, connectorId)`, which the station sees as
   * `CALLERROR InternalError: Failed handling message: Validation error` and
   * the suite as an unanswered TransactionEvent.
   */
  private async ensureConnector(
    cpId: string,
    stationId: number,
    evseRowId: number,
    target: StatusTarget,
    now: string,
  ): Promise<void> {
    const found = await this.gql.query<{ Connectors: { id: number }[] }>(
      `query ConnectorFixture($station: Int!, $connectorId: Int!) {
         Connectors(where: {
           stationId: { _eq: $station }, connectorId: { _eq: $connectorId }
         }) { id }
       }`,
      { station: stationId, connectorId: target.connectorId },
    );
    if (found.Connectors.length > 0) return;
    await this.gql.query(
      `mutation SeedConnector($object: Connectors_insert_input!) {
         insert_Connectors_one(object: $object) { id }
       }`,
      {
        object: {
          stationId,
          ocppConnectionName: cpId,
          connectorId: target.connectorId,
          evseId: evseRowId,
          evseTypeConnectorId: target.connectorId,
          tenantId: this.tenant,
          createdAt: now,
          updatedAt: now,
        },
      },
    );
  }

  /**
   * Removes both halves, keeping whatever a scenario left pointing at them.
   *
   * BOTH HALVES, where `verify` sees one, and the asymmetry is deliberate
   * rather than sloppy: teardown can find the station rows without a roster
   * because they carry a marker, and a check that cannot enumerate what it is
   * checking would have nothing to say. The charging station row itself is NOT
   * removed -- the CSMS creates one for anything that connects, and taking it
   * would take its status notifications, its messages and its transactions with
   * it, which is the runtime residue this file's teardown promises to leave
   * alone.
   */
  private async teardownDeviceModel(): Promise<void> {
    if (!this.speaks201) {
      this.log(`device model: ${NOT_ON_THIS_LINE}`);
      return;
    }
    const evses = await this.gql.query<{
      Evses: { id: number }[];
    }>(
      `query FixtureEvses($pattern: String!, $tenant: Int!) {
         Evses(where: { evseId: { _like: $pattern }, tenantId: { _eq: $tenant } }) { id }
       }`,
      { pattern: FIXTURE_EVSE_PATTERN, tenant: this.tenant },
    );
    const evseIds = evses.Evses.map((row) => row.id);

    // Connectors first: they point AT the EVSEs, so removing them is what lets
    // an unused EVSE go in the same run rather than one teardown later.
    let connectorIds: number[] = [];
    if (evseIds.length > 0) {
      const connectors = await this.gql.query<{ Connectors: { id: number }[] }>(
        `query FixtureConnectors($evses: [Int!]!, $tenant: Int!) {
           Connectors(where: { evseId: { _in: $evses }, tenantId: { _eq: $tenant } }) { id }
         }`,
        { evses: evseIds, tenant: this.tenant },
      );
      connectorIds = connectors.Connectors.map((row) => row.id);
    }
    const keptConnectors = await this.removeUnreferenced(
      "Connectors",
      connectorIds,
    );
    const keptEvses = await this.removeUnreferenced("Evses", evseIds);

    const targets = statusTargets();
    const instances = targets.map(componentInstance);
    const components = await this.gql.query<{
      Components: { id: number }[];
      Variables: { id: number }[];
      EvseTypes: { databaseId: number }[];
    }>(
      // The EVSE types are matched on the PAIR rather than on the id, and the
      // extra clause is the fixture/residue line again. Filing the
      // station-scope status makes CitrineOS create its own EVSE type numbered
      // 0 with a NULL connector -- see syncDeviceModel -- and `id: { _in: … }`
      // would take that one too. It is a row the CSMS wrote, so it stays.
      `query FixtureDeviceModel($name: String!, $instances: [String!]!, $variable: String!, $pairs: [EvseTypes_bool_exp!]!, $tenant: Int!) {
         Components(where: {
           name: { _eq: $name }, instance: { _in: $instances }, tenantId: { _eq: $tenant }
         }) { id }
         Variables(where: {
           name: { _eq: $variable }, instance: { _is_null: true }, tenantId: { _eq: $tenant }
         }) { id }
         EvseTypes(where: { _or: $pairs, tenantId: { _eq: $tenant } }) { databaseId }
       }`,
      {
        name: COMPONENT_NAME,
        instances,
        variable: VARIABLE_NAME,
        pairs: targets.map((target) => ({
          id: { _eq: target.evseId },
          connectorId: { _eq: target.connectorId },
        })),
        tenant: this.tenant,
      },
    );

    // The join rows go unguarded, and they are the only ones that may: nothing
    // in the schema points at a join table, so `removeUnreferenced` would ask
    // `references` a question with no answer and be refused.
    const componentIds = components.Components.map((row) => row.id);
    if (componentIds.length > 0) {
      await this.gql.query(
        `mutation DropComponentVariables($ids: [Int!]!) {
           delete_ComponentVariables(where: { componentId: { _in: $ids } }) { affected_rows }
         }`,
        { ids: componentIds },
      );
    }
    const keptComponents = await this.removeUnreferenced(
      "Components",
      componentIds,
    );
    const keptEvseTypes = await this.removeUnreferenced(
      "EvseTypes",
      components.EvseTypes.map((row) => row.databaseId),
      "databaseId",
    );
    const keptVariables = await this.removeUnreferenced(
      "Variables",
      components.Variables.map((row) => row.id),
    );

    const kept =
      keptConnectors +
      keptEvses +
      keptComponents +
      keptEvseTypes +
      keptVariables;
    this.log(
      kept === 0
        ? "device model: removed"
        : `device model: removed, ${kept} row(s) kept because scenario records still reference them`,
    );
  }
}

/** How a target reads in a log line or a problem. One spelling, so the seeder
 *  and the check cannot describe the same row differently. */
function describeTarget(target: StatusTarget): string {
  return `(evseId ${target.evseId}, connectorId ${target.connectorId})`;
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
      await provisioner.provisionDeviceModel();
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
