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
import { type CitrineConfig } from "./config";
import type { FetchLike } from "../../tck/driver";
export declare class CitrineProvisioner {
    private readonly cfg;
    private readonly log;
    private readonly gql;
    /** `fetchImpl` is the {@link FetchLike} seam
     *  `tests/citrineos-device-model-fixture.ts` drives: what this class writes
     *  is only observable as a sequence of requests, and a CSMS answers the same
     *  way whether the fixture is right or wrong. */
    constructor(cfg: CitrineConfig, log?: (msg: string) => void, fetchImpl?: FetchLike);
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
    private removeUnreferenced;
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
    teardown(): Promise<void>;
    /**
     * Seeds the tenant-scoped half: one EVSE type per target, one component per
     * target, one variable for all of them, and the join rows.
     *
     * Read-then-insert-or-update by hand, for the reason `provisionTags` gives:
     * the unique indexes here are indexes with no matching constraint, so Hasura
     * has no conflict target to offer `on_conflict`.
     */
    provisionDeviceModel(): Promise<void>;
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
    private syncDeviceModel;
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
    private readOrSeed;
    /** The EVSE type the handler's component query joins through. Matched on the
     *  PAIR, because `(tenantId, id, connectorId)` is the unique index and an
     *  EVSE type with the right id and a different connector is a different row. */
    private ensureEvseType;
    /** One row for every target, and it is shared: the handler filters variables
     *  by name alone, and the unique index on `(tenantId, name)` where the
     *  instance is null means there can only be one anyway. */
    private ensureVariable;
    /**
     * The component the handler looks the target up through.
     *
     * FOUND IN ORDER TO BE REPAIRED, the same half `provisionTags` calls out: a
     * component whose `evseDatabaseId` has drifted -- a `compose down -v` that
     * renumbered the EVSE types, an operator editing one -- is not a duplicate
     * and would never collide, it just silently stops joining. The update below
     * points it back at the row this run resolved.
     */
    private ensureComponent;
    /** The join row. Its primary key IS the pair, so there is nothing to repair
     *  -- it exists or it does not. */
    private ensureComponentVariable;
    /**
     * Reports each missing piece separately, because they fail differently: no
     * EVSE type and the component cannot join, no component and the status has
     * nowhere to go, no join row and the handler's own filter drops the component
     * it just found. One line saying "device model missing" would send a reader
     * to re-derive which.
     */
    private verifyDeviceModel;
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
    ensureStationTopology(cpId: string): Promise<void>;
    private ensureChargingStation;
    /** Matched on `(stationId, evseTypeId)`, which is the unique index -- and NOT
     *  on the marker, so a station that already has an EVSE numbered this way is
     *  adopted rather than duplicated. The marker is what teardown reads. */
    private ensureEvse;
    /**
     * The connector under it.
     *
     * `status` and `timestamp` are left to the CSMS: the handler upserts this row
     * on every StatusNotification, and seeding a status would put a state the
     * station never reported in front of anyone reading the database before the
     * first one arrives. What the fixture owes is the row's IDENTITY -- which
     * EVSE it belongs to and which connector it is -- because that is the part
     * the handler cannot work out for a 2.0.1 station.
     */
    private ensureConnector;
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
    private teardownDeviceModel;
}
/** `ocpp-tck driver provision` */
export declare function provisionCommand(): Promise<number>;
/** `ocpp-tck driver verify` */
export declare function verifyCommand(): Promise<number>;
/** `ocpp-tck driver teardown` */
export declare function teardownCommand(): Promise<number>;
