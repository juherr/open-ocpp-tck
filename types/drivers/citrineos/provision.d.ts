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
 * Everything is idempotent. Re-running provision on a provisioned environment
 * must be a no-op that still exits 0, because CI reruns it and an operator
 * chasing a failure will run it twice before believing it.
 */
import { type CitrineConfig } from "./config";
export declare class CitrineProvisioner {
    private readonly cfg;
    private readonly log;
    private readonly gql;
    constructor(cfg: CitrineConfig, log?: (msg: string) => void);
    private get tenant();
    /**
     * Makes the data API able to answer at all.
     *
     * Hasura exposes no table until one is tracked, and this compose starts it
     * with empty metadata on purpose (see compose.yaml). This is the exact
     * counterpart of the SteVe driver writing an API password and restarting the
     * container: a bootstrap that provisioning pays once so that every later
     * read is a plain HTTP query. It is idempotent, so a second run is a no-op.
     */
    ensureApiAccess(): Promise<void>;
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
    provisionTags(): Promise<void>;
    /**
     * Every row this driver's fixtures occupy. One document, because provisioning
     * and verification ask the same question of the same columns -- a second copy
     * would let the seeder write a field the check never looks at.
     */
    private fixtureRows;
    /** The fixture rows by idToken. First wins, and duplicates are verify()'s to
     *  report rather than this method's to hide: seeding either of two rows
     *  leaves the other behind. */
    private existingTags;
    /**
     * The unknown tag must be ABSENT, and TC_023.1 asserts no transaction was
     * ever created for it -- so nothing should reference it. The guard is there
     * for the case where something did: deleting a referenced Authorization
     * fails on a foreign key that does not cascade, and the message would name
     * a constraint rather than the situation.
     */
    private removeInvalidTag;
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
    private verifySchema;
    /**
     * Read-only, and answered by the data API rather than by the database that
     * backs it -- the same rule the SteVe driver follows: what a fixture looks
     * like through the interface the CSMS publishes is what the Authorize path
     * will see.
     */
    verify(): Promise<string[]>;
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
    private references;
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
