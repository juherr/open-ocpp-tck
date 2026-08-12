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
import { type CitrineConfig } from "./config";
export declare class CitrineProvisioner {
    private readonly cfg;
    private readonly log;
    private readonly db;
    constructor(cfg: CitrineConfig, log?: (msg: string) => void);
    private get tenant();
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
    provisionTags(): Promise<void>;
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
    private verifySchema;
    /**
     * Read-only. Two queries rather than one per fixture: each db call is a
     * `docker exec` process spawn, so asking about twenty tags one at a time
     * costs seconds of pure process startup -- and verify() runs twice in CI.
     */
    verify(): Promise<string[]>;
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
    private guards;
    /**
     * Removes the fixtures, and nothing else. Charge points, their connectors
     * and their transactions are runtime residue rather than fixtures, and
     * `docker compose -f drivers/citrineos/compose.yaml down -v` is the honest
     * way to get a clean slate.
     */
    teardown(): Promise<void>;
}
/** `ocpp-tck driver provision` */
export declare function provisionCommand(): Promise<number>;
/** `ocpp-tck driver verify` */
export declare function verifyCommand(): Promise<number>;
/** `ocpp-tck driver teardown` */
export declare function teardownCommand(): Promise<number>;
