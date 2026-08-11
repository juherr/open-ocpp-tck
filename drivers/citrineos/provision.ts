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
 * Charging profiles are not provisioned here either, and that is not an
 * omission: OCPP 1.6 SetChargingProfile carries the profile inline, so there
 * is no CSMS-side record to create. profiles.ts holds the catalogue.
 *
 * Everything is idempotent. Re-running provision on a provisioned environment
 * must be a no-op that still exits 0, because CI reruns it and an operator
 * chasing a failure will run it twice before believing it.
 */
import { defaultCitrineConfig, type CitrineConfig } from "./config";
import { CitrineRecords, sqlLiteral } from "./records";
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
 * The expiry written for EXPIRED_TAG. Fixed rather than "now minus a day" so
 * that a provisioned environment is identical between runs, which is what lets
 * `verify` tell "expired on purpose" from "expired by accident".
 *
 * The status stays `Accepted` and only the instant makes it expired, which
 * reads backwards until you follow the handler: AuthorizeRequestOcpp16Handler
 * compares `cacheExpiryDateTime` against now INSIDE the `status === Accepted`
 * branch, and every other stored status falls through to the default. A row
 * stored as `status = 'Expired'` therefore answers Invalid, not Expired.
 */
const PAST_EXPIRY = "2020-01-01T00:00:00Z";

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
  /** ISO instant, or null for "never expires". */
  expiry: string | null;
}

const FIXTURES: readonly TagFixture[] = [
  ...VALID_TAGS.map((idToken) => ({ idToken, status: "Accepted", expiry: null })),
  { idToken: EXPIRED_TAG, status: "Accepted", expiry: PAST_EXPIRY },
  { idToken: BLOCKED_TAG, status: "Blocked", expiry: null },
];

/** Every tag this driver owns. Spelled once so that a fixture added to
 *  provision but not to teardown cannot leave rows behind that verify still
 *  demands. */
const ALL_TAGS = [...VALID_TAGS, BLOCKED_TAG, EXPIRED_TAG, INVALID_TAG];

/** A SQL timestamptz literal, or NULL. Free of `this`, so it lives beside
 *  sqlLiteral rather than on the class. */
function nullableInstant(value: string | null): string {
  return value === null ? "NULL" : `${sqlLiteral(value)}::timestamptz`;
}

export class CitrineProvisioner {
  private readonly db: CitrineRecords;

  constructor(
    private readonly cfg: CitrineConfig,
    private readonly log: (msg: string) => void = stdout,
  ) {
    this.db = new CitrineRecords(cfg);
  }

  private get tenant(): string {
    return String(this.cfg.tenantId);
  }

  /**
   * Writes every fixture in ONE psql invocation.
   *
   * Upsert by hand rather than `ON CONFLICT`, because the unique index is on
   * (idToken, idTokenType, tenantId) and Postgres treats NULLs as distinct --
   * so a row written with a different idTokenType would not conflict, and the
   * table would quietly grow the second row that makes the handler answer
   * Invalid. Matching on (idToken, tenantId) enforces the invariant the
   * handler actually needs, whatever else is in the table.
   */
  async provisionTags(): Promise<void> {
    const statements: string[] = [];

    for (const fixture of FIXTURES) {
      const idToken = sqlLiteral(fixture.idToken);
      const where = `"idToken" = ${idToken} AND "tenantId" = ${this.tenant}`;
      statements.push(
        `UPDATE "Authorizations"
            SET "status" = ${sqlLiteral(fixture.status)},
                "cacheExpiryDateTime" = ${nullableInstant(fixture.expiry)},
                "updatedAt" = NOW()
          WHERE ${where};`,
        `INSERT INTO "Authorizations"
            ("idToken", "idTokenType", "status", "cacheExpiryDateTime", "tenantId", "createdAt", "updatedAt")
          SELECT ${idToken}, ${sqlLiteral(ID_TOKEN_TYPE)}, ${sqlLiteral(fixture.status)},
                 ${nullableInstant(fixture.expiry)}, ${this.tenant}, NOW(), NOW()
          WHERE NOT EXISTS (SELECT 1 FROM "Authorizations" WHERE ${where});`,
      );
    }

    // The unknown tag must be ABSENT, and TC_023.1 asserts no transaction was
    // ever created for it -- so nothing should reference it. The guard is
    // there for the case where something did: a foreign key violation would
    // abort the whole script, taking the other fixtures with it.
    statements.push(
      `DELETE FROM "Authorizations" a
        WHERE a."idToken" = ${sqlLiteral(INVALID_TAG)} AND a."tenantId" = ${this.tenant}
          AND NOT EXISTS (SELECT 1 FROM "Transactions" t WHERE t."authorizationId" = a.id);`,
    );

    await this.db.scalar(statements.join("\n"));
    this.log(
      `tags: ${VALID_TAGS.length} valid, ${EXPIRED_TAG} expired at ${PAST_EXPIRY}, ` +
        `${BLOCKED_TAG} (${BLOCKED_TAG_CAVEAT}), ${INVALID_TAG} absent`,
    );
  }

  /**
   * Read-only. Two queries rather than one per fixture: each db call is a
   * `docker exec` process spawn, so asking about twenty tags one at a time
   * costs seconds of pure process startup -- and verify() runs twice in CI.
   */
  /**
   * Does the running server's schema match the variant we were told to expect?
   *
   * variant.ts declares rather than detects, so that the scope table stays
   * readable offline -- which leaves exactly one way for the declaration to be
   * wrong: pointing a `v2` driver at a `v1.9.1` server, or the reverse. The
   * symptom without this check is silent and expensive: every record read
   * targets a column that does not exist, `psql` fails, and a dozen scenarios
   * report the CSMS as empty. One query converts that into a sentence.
   *
   * The discriminator is `ocppConnectionName`, never `stationId`: `stationId`
   * exists on `Transactions` in BOTH lines -- `character varying` holding the
   * OCPP name on v1.9.1, an `integer` foreign key on v2 -- so its presence
   * proves nothing. Both facts were read off running containers.
   */
  private async verifySchema(): Promise<string[]> {
    const present =
      (await this.db.scalar(
        `SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Transactions'
            AND column_name = 'ocppConnectionName';`,
      )) !== "0";
    const expected = this.cfg.variant === "v2";
    if (present === expected) return [];
    return [
      `schema mismatch: CITRINE_VARIANT=${this.cfg.variant} expects ` +
        `Transactions."${stationColumn(this.cfg.variant)}", but the server ` +
        `${present ? "has" : "does not have"} ocppConnectionName. ` +
        `Set CITRINE_VARIANT=${present ? "v2" : "v1"} for this server.`,
    ];
  }

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

    // "Is the expiry in the past" is asked of Postgres rather than of
    // Date.parse: the CSMS compares against its own clock, not this process's,
    // and that is the comparison the scenario depends on.
    const rows = await this.db.rows(
      `SELECT "idToken", COUNT(*), MIN("status"),
              COALESCE(MIN("cacheExpiryDateTime")::text, ''),
              CASE WHEN MIN("cacheExpiryDateTime") < NOW() THEN 'past' ELSE 'future' END
         FROM "Authorizations"
        WHERE "tenantId" = ${this.tenant}
          AND "idToken" IN (${ALL_TAGS.map(sqlLiteral).join(", ")})
        GROUP BY "idToken";`,
    );
    const tags = new Map(rows.map((row) => [row[0], row]));

    // A duplicate is not cosmetic: the 1.6 Authorize handler answers Invalid
    // outright when an idToken resolves to more than one row, so this check is
    // the difference between a diagnosable environment fault and twelve
    // scenarios failing on an unexplained denial.
    for (const [idToken, row] of tags) {
      if (row[1] !== "1") {
        problems.push(`${idToken}: ${row[1]} rows, expected 1 (the handler answers Invalid for more)`);
      }
    }

    for (const idTag of VALID_TAGS) {
      const row = tags.get(idTag);
      if (!row) {
        problems.push(`${idTag}: missing`);
        continue;
      }
      if (row[2] !== "Accepted") {
        problems.push(`${idTag}: status ${row[2] || "<null>"}, expected Accepted`);
      }
      if (row[3] !== "") {
        problems.push(`${idTag}: has cacheExpiryDateTime ${row[3]}, expected none`);
      }
    }

    if (tags.has(INVALID_TAG)) {
      problems.push(`${INVALID_TAG}: present, must be absent for TC_023.1`);
    }

    const expired = tags.get(EXPIRED_TAG);
    if (!expired || expired[3] === "") {
      problems.push(`${EXPIRED_TAG}: missing or has no cacheExpiryDateTime`);
    } else if (expired[2] !== "Accepted") {
      // The trap PAST_EXPIRY's comment describes, checked rather than merely
      // documented: any other status makes the handler answer Invalid and the
      // expiry is never consulted.
      problems.push(
        `${EXPIRED_TAG}: status ${expired[2]}, expected Accepted -- only the ` +
          "Accepted branch consults cacheExpiryDateTime",
      );
    } else if (expired[4] !== "past") {
      problems.push(`${EXPIRED_TAG}: expiry ${expired[3]} is not in the past`);
    }

    const blocked = tags.get(BLOCKED_TAG);
    if (!blocked) {
      problems.push(`${BLOCKED_TAG}: missing`);
    } else if (blocked[2] !== "Blocked") {
      problems.push(`${BLOCKED_TAG}: status ${blocked[2] || "<null>"}, expected Blocked`);
    }

    return problems;
  }

  /**
   * Every `NOT EXISTS` guard needed to delete an Authorization safely, read
   * from the live catalog rather than written out here.
   *
   * There are four foreign keys onto `Authorizations` on the pinned image --
   * `Transactions.authorizationId`, `LocalListAuthorizations.authorizationId`,
   * `LocalListAuthorizations.groupAuthorizationId`, and the self-reference
   * `Authorizations.groupAuthorizationId` -- and none of them cascades. An
   * earlier version of this method guarded only the first, which is the one a
   * transaction-only run exercises; any scenario that had sent a SendLocalList
   * then aborted the DELETE on a constraint violation, and because psql runs a
   * semicolon-separated script in ONE implicit transaction with ON_ERROR_STOP,
   * that abort rolled the whole teardown back. It removed nothing and said
   * nothing.
   *
   * Asking the catalog instead of listing four names is what keeps that fixed:
   * a fifth referencing table on a future CitrineOS is picked up rather than
   * silently reintroducing the same failure. Table and column names come from
   * pg_constraint, so they are the database's own identifiers.
   */
  private async guards(): Promise<string> {
    const rows = await this.db.rows(
      `SELECT c.conrelid::regclass::text, a.attname
         FROM pg_constraint c
         JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND c.confrelid = '"Authorizations"'::regclass
        ORDER BY 1, 2;`,
    );
    if (rows.length === 0) {
      throw new Error(
        "citrineos teardown: no foreign keys onto Authorizations found -- " +
          "the schema is not what this driver was written against, refusing to delete.",
      );
    }
    return rows
      .map(([table, column]) =>
        `NOT EXISTS (SELECT 1 FROM ${table} r WHERE r."${column}" = a.id)`,
      )
      .join("\n          AND ");
  }

  /**
   * Removes the fixtures, and nothing else. Charge points, their connectors
   * and their transactions are runtime residue rather than fixtures, and
   * `docker compose -f drivers/citrineos/compose.yaml down -v` is the honest
   * way to get a clean slate.
   */
  async teardown(): Promise<void> {
    const tags = ALL_TAGS.map(sqlLiteral).join(", ");
    const mine = `a."idToken" IN (${tags}) AND a."tenantId" = ${this.tenant}`;
    const unreferenced = await this.guards();

    const kept = await this.db.scalar(
      `SELECT COUNT(*) FROM "Authorizations" a
        WHERE ${mine} AND NOT (${unreferenced});`,
    );
    await this.db.scalar(
      `DELETE FROM "Authorizations" a WHERE ${mine} AND ${unreferenced};`,
    );
    this.log(
      kept === "0"
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
