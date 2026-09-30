// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * citrineos-device-model-fixture.ts -- the rows `driver provision` and the
 * prepare hook write so a 2.0.1 StatusNotification reaches the CSMS's device
 * model, and the rows they refuse to remove.
 *
 * PROPERTY, in 14 parts:
 *  1. THE STATION-SCOPE TARGET IS PROVISIONED. A station reports `(evseId 0,
 *     connectorId 0)` for itself as well as one pair per connector, and a
 *     fixture covering only the connectors leaves half the failure exactly
 *     where it was -- two of the four warnings issue #86 measured. Asserted as
 *     "an EVSE type numbered 0 with connector 0 was written", because the pair
 *     is what the CSMS's own lookup filters on and an EVSE type numbered 0 with
 *     a null connector is a different row that does not match it.
 *  2. EACH TARGET GETS ITS OWN COMPONENT, WITH A DISTINCT NON-NULL INSTANCE.
 *     The components table carries a unique index on `(tenantId, name)`
 *     restricted to rows with a null instance, so a second `Connector`
 *     component with no instance is an insert that fails against an index whose
 *     name mentions neither this fixture nor this driver.
 *  3. `verify` NAMES EACH MISSING PIECE, AND NAMES NONE ONCE PROVISIONED. Both
 *     directions, because a check that cannot go green is not a check and one
 *     that cannot go red is worse.
 *  4. `teardown` KEEPS WHAT A SCENARIO LEFT POINTING AT A FIXTURE. A component
 *     acquires the variable attribute the CSMS wrote when a status finally
 *     landed; that is runtime residue hanging off a fixture, and removing the
 *     fixture under it is a foreign-key violation naming neither. Asserted with
 *     its negative: the rows nothing points at DO go.
 *  5. THE PREPARE HOOK RE-ASSERTS THE TENANT HALF. `findOrCreateEvseAndComponent`
 *     on the pinned image resolves a component's EVSE with
 *     `connectorId ? connectorId : null`, and `0` is falsy -- so filing the
 *     station-scope status repoints that component at an EVSE type with a null
 *     connector, and the NEXT status's lookup no longer matches. Provisioning
 *     once is therefore not a state this fixture can be left in, and the hook
 *     pointing it back is the only reason a second run is as clean as the
 *     first. It is one call, it looks redundant, and deleting it costs nothing
 *     until the second scenario.
 *  6. A LOSING INSERT IS A NO-OP, NOT AN ERROR. The tenant-scoped rows are the
 *     only thing in this driver several lanes write at once -- the prepare hook
 *     runs per scenario and a parallel sweep runs one lane per station, three
 *     in this repository's own CI -- and the unique indexes make the loser
 *     fail. The row it wanted exists; it is simply not the one it wrote. An
 *     insert that fails for any OTHER reason must still be reported, or the
 *     fixture silently does not exist, so both directions are asserted.
 *  7. NOTHING IS WRITTEN ON A LINE THAT DECLARES NO OCPP 2.0.1 SURFACE. The
 *     v1.9.1 line never got the column rename: it has no `ocppConnectionName`
 *     and its `Connector.stationId` is a STRING holding the OCPP name, so
 *     every write here would fail against a schema that does not expose the
 *     field. The prepare hook runs before EVERY scenario, so that is one
 *     failure per scenario on a line where eighteen of them still run -- and
 *     no offline check sees it, because the scope check is static and no CI
 *     lane sweeps v1.
 *  8. AN ADOPTED EVSE IS MARKED. CitrineOS creates EVSEs of its own accord, so
 *     on a database that saw traffic before this fixture existed the row is
 *     already there, unmarked. Teardown finds connectors only through marked
 *     EVSEs, so the connector written under an unmarked one would survive
 *     every teardown. The marker therefore means "this fixture owns it", not
 *     "this fixture created it".
 *  9. THE FIXTURE FOLLOWS THE COUNT IT IS HANDED rather than a default it
 *     reaches for. Only `DEFAULT_CONNECTORS` is passed today -- a
 *     multi-connector 2.0.1 station is not representable on this CSMS, see
 *     `statusTargets` -- so what this holds is that the count is a parameter in
 *     fact and not just in the signature, which is the half a reader cannot
 *     check by looking.
 * 10. EVERY ADDRESSABLE EVSE ALSO GETS A ROW WITH NO CONNECTOR, and EVSE 0
 *     does not. The status handler resolves an EVSE type by the
 *     `(id, connectorId)` pair; the SmartCharging endpoints resolve one by
 *     `connectorId IS NULL`, so the row part 1 writes does not answer them and
 *     a charging-profile request for that EVSE is refused inside the CSMS with
 *     nothing on the websocket -- issue #86's shape with an empty frame log
 *     instead of four warnings. Asserted in both directions, because the
 *     negative is the delicate half: EVSE 0's connector-less row is the CSMS's
 *     OWN, written the first time it files the station-scope status, so
 *     seeding it here would put a fixture where residue lives and teardown
 *     could not tell them apart afterwards. The lookup itself is spelled
 *     `_is_null` rather than `_eq: null`, and that is not cosmetic: Hasura
 *     drops a clause whose comparison value is null, so the wrong spelling
 *     reads back the PAIRED row, finds it, and never seeds the one that was
 *     missing.
 * 11. THE SCHEMA CHECK TELLS THREE SHAPES APART, not two. `Transactions`
 *     carries `ocppConnectionName` on the v2 prereleases only; the GA dropped
 *     it, and v1.9.1 never had it -- so its absence, which is what the check
 *     used to read as "v1", is shared by the GA and v1.9.1, and a v2 driver
 *     pointed at the image `compose.yaml` pins was told to switch lines.
 *     `stationId`'s TYPE is the other half: Int on the GA, String on v1.9.1.
 *     A prerelease is refused BY NAME, because `CITRINE_VARIANT=v2` follows
 *     the pin and no declaration makes that schema drivable. And a shape none
 *     of the three has -- a `stationId` of another scalar, or none -- is
 *     refused as unknown on either declaration, rather than read as whichever
 *     line a fallback picks: that would pass verify and fail every scenario.
 * 12. NO STATION-SCOPED WRITE NAMES A COLUMN THE GA DROPPED. `Evses` and
 *     `Connectors` lost `ocppConnectionName` and keep the integer station key
 *     alone; Hasura's insert type refuses the field before Postgres sees it,
 *     so the fake refuses it the same way. Every part that writes the
 *     topology rides on this, which is why a regression here CRASHES part 4
 *     with the field named rather than failing only its own row.
 * 13. EACH READER SCOPES A STATION THE WAY ITS TABLE SPELLS IT. On the GA the
 *     name is a join through `ChargingStation` for `Transactions`,
 *     `Connectors` and `VariableAttributes`, and still a column on
 *     `LocalListVersions` and `SendLocalLists`, which never got the integer
 *     key. One spelling for all five is wrong on one side or the other, and
 *     `Residue` asks three of them in a single query, so either mistake
 *     fails every `prepareStation`. v1.9.1 keeps one string column
 *     throughout. Held on the `where` each reader SENDS, offline: live, a
 *     wrong spelling is a validation error in every scenario that reads a
 *     transaction, which only a sweep would find.
 * 14. THE RELATIONSHIPS THOSE READERS WALK EXIST ON THE SCHEMA THEY WALK. The
 *     GA partitions `Transactions` on `createdAt`, so the key
 *     `StopTransactions` holds onto it is a pair and a single-column
 *     `foreign_key_constraint_on` names no constraint -- the metadata call
 *     fails, and `provision` with it. The mapping is upstream's own. The
 *     three `ChargingStation` relationships part 13 walks are created on v2
 *     and on v2 only, since v1.9.1 has no integer key to hang them on.
 *
 * WHAT IT DOES NOT ASSERT is that these rows make CitrineOS behave -- that the
 * four warnings stop. No offline guard can: it is a property of a CSMS reading
 * them, and the measurement lives in issue #86 with the log lines either side.
 * What is held here is that the fixture keeps its shape, which is the half that
 * rots silently.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD, and why it is not a live check.
 * Every claim above is about a SEQUENCE of writes -- what was inserted, what
 * was pointed back, what was left alone -- and a CSMS answers a correct fixture
 * and a wrong one identically: a `StatusNotificationResponse` is empty, so the
 * wire says nothing, and the rows that would say something are the ones under
 * test. Handing the provisioner its `fetch` is the way in, the same seam
 * `citrineos-transport-classification.ts` rides and for the same reason --
 * and part 13 hands the records reader the same one, because the `where` a
 * reader sends is printed nowhere else.
 *
 * Offline: answers every request from an in-memory store. Opens no socket,
 * starts nothing.
 */
import type { FetchLike } from "../tck/driver";
import { defaultCitrineConfig } from "../drivers/citrineos/config";
import {
  COMPONENT_NAME,
  DEFAULT_CONNECTORS,
  FIXTURE_EVSE_PREFIX,
  VARIABLE_NAME,
  componentInstance,
  profileEvseIds,
  statusTargets,
} from "../drivers/citrineos/device-model";
import { CitrineProvisioner } from "../drivers/citrineos/provision";
import { CitrineRecords } from "../drivers/citrineos/records";
import type { CitrineSchema } from "../drivers/citrineos/variant";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

function check(what: string, ok: boolean, detail: string): void {
  if (!ok) fail(what, detail);
}

const CP_ID = "CERTCP1";
const TENANT = 1;

/** Resolved, not hand-built, for the reason the sibling guard gives: a literal
 *  would be a second declaration of what the driver actually uses. */
const CFG = defaultCitrineConfig({
  CITRINE_GRAPHQL_URL: "http://citrine.test:8090",
});
const V1_CFG = defaultCitrineConfig({
  CITRINE_GRAPHQL_URL: "http://citrine.test:8090",
  CITRINE_VARIANT: "v1",
});

type Row = Record<string, unknown>;

/**
 * A CitrineOS-shaped store that answers by OPERATION NAME.
 *
 * Dispatching on the name rather than parsing the document is deliberate on
 * two counts. It keeps this guard out of the business of implementing GraphQL,
 * and it makes every operation the provisioner sends a named thing: a mutation
 * renamed without a matching arm here stops the guard rather than quietly
 * changing what it observed.
 *
 * The store is not a database. It enforces no index, so part 2 has to look at
 * what was WRITTEN rather than at an insert that failed -- which is the honest
 * shape anyway: the index lives in CitrineOS and this guard is about the rows
 * the driver sends it.
 */
class FakeCitrine {
  /** Which schema `Transactions` introspects as, and which columns the
   *  station-scoped inserts accept. Part 11 and 12. */
  constructor(readonly schema: FakeSchema = "v2") {}

  readonly evseTypes: Row[] = [];
  readonly variables: Row[] = [];
  readonly components: Row[] = [];
  readonly componentVariables: Row[] = [];
  readonly stations: Row[] = [];
  readonly evses: Row[] = [];
  readonly connectors: Row[] = [];

  /** Every named GraphQL operation and its variables, in order. Part 13. */
  readonly operations: { name: string; variables: Row }[] = [];
  /** Every metadata call, in order. Part 14. */
  readonly metadataCalls: { type?: string; args?: Row }[] = [];

  /** Every `delete_<Table>` the provisioner asked for, in order. */
  readonly deletes: { table: string; ids: number[] }[] = [];
  /** Ids the fake reports as still referenced, per target table. Part 4. */
  readonly stillReferenced = new Map<string, number[]>();

  private nextId = 1;
  private lastReferenceTarget = "";

  /** Seed operations to refuse. `race` also writes the row, standing in for the
   *  lane that won it; `hard` refuses and writes nothing. Part 6. */
  readonly refuseSeed = new Map<string, "race" | "hard">();

  private id(): number {
    return this.nextId++;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
      variables?: Row;
      type?: string;
      args?: { tables?: { name: string }[] };
    };
    if (url.endsWith("/v1/metadata")) {
      this.metadataCalls.push(payload as { type?: string; args?: Row });
      return json(this.metadata(payload));
    }

    // Part 6, and it is an HTTP 200 carrying `errors` rather than a rejected
    // fetch on purpose: that is how Hasura reports a constraint violation, and
    // the driver's transport classifies the two differently -- a status or a
    // refused socket is a NON-DISPATCH, an in-band error is an ordinary
    // failure. Refusing the wrong way would exercise a branch this is not
    // about. See tests/citrineos-transport-classification.ts.
    const operation =
      /(?:query|mutation)\s+(\w+)/.exec(payload.query ?? "")?.[1] ?? "";
    // Part 12. What Hasura answers an insert naming a column the table does
    // not have -- in-band, like every other GraphQL refusal.
    const dropped = this.droppedColumn(operation, payload.variables ?? {});
    if (dropped !== undefined) return json({ errors: [{ message: dropped }] });

    const refusal = this.refuseSeed.get(operation);
    if (refusal !== undefined) {
      // Consumed, so the retry is answered normally: a fake that refused
      // forever would be testing whether the driver gives up, which is a
      // different claim.
      this.refuseSeed.delete(operation);
      // `race` writes the row FIRST and then refuses, which is what losing a
      // unique index looks like from the loser's side: its insert failed, and
      // what it wanted is there.
      if (refusal === "race") this.graphql(payload);
      return json({
        errors: [
          {
            message:
              'Uniqueness violation. duplicate key value violates unique constraint "evse_types_tenantId_id_connectorId"',
          },
        ],
      });
    }

    return json({ data: this.graphql(payload) });
  };

  /**
   * The GA dropped `ocppConnectionName` from `Evses` and `Connectors`
   * (citrineos-core `20260914160000-drop-ocpp-connection-name-evses-connectors`),
   * so an insert still naming it is refused -- by the generated input type,
   * before anything reaches Postgres. The prerelease had the column, which is
   * why the refusal is keyed on the schema rather than unconditional.
   */
  private droppedColumn(operation: string, vars: Row): string | undefined {
    if (this.schema !== "v2") return undefined;
    const table = GA_DROPPED_NAME_ON[operation];
    if (table === undefined) return undefined;
    const object = (vars.object ?? {}) as Row;
    return "ocppConnectionName" in object
      ? `field 'ocppConnectionName' not found in type: '${table}_insert_input'`
      : undefined;
  }

  private metadata(payload: { type?: string; args?: unknown }): unknown {
    if (payload.type === "pg_get_source_tables") return [];
    if (payload.type === "export_metadata") return { sources: [] };
    if (payload.type === "pg_suggest_relationships") {
      const args = payload.args as { tables?: { name: string }[] } | undefined;
      this.lastReferenceTarget = args?.tables?.[0]?.name ?? "";
      // One referencing table is enough to satisfy `references`'s refusal, and
      // which one it is never matters: teardown filters on the ids that come
      // back, not on where they came from.
      return {
        relationships: [
          {
            type: "array",
            from: { table: { schema: "public", name: this.lastReferenceTarget } },
            to: {
              table: { schema: "public", name: `${this.lastReferenceTarget}Users` },
              columns: ["ownerId"],
            },
          },
        ],
      };
    }
    return { message: "success" };
  }

  private graphql(payload: { query?: string; variables?: Row }): Row {
    const document = payload.query ?? "";
    const vars = payload.variables ?? {};
    const operation = /(?:query|mutation)\s+(\w+)/.exec(document)?.[1] ?? "";
    if (operation !== "") this.operations.push({ name: operation, variables: vars });

    switch (operation) {
      // -- the tag half, answered emptily on purpose: part 3 asserts that the
      // -- device-model problems are PRESENT, never that they are the whole
      // -- list, so the tag table does not have to be restated here.
      case "Fixtures":
      case "Unknown":
      case "Mine":
        return { Authorizations: [] };

      case "EvseTypeFixture":
        return {
          EvseTypes: this.evseTypes.filter(
            (row) => row.id === vars.id && row.connectorId === vars.connector,
          ),
        };
      case "SeedEvseType": {
        const object = vars.object as Row;
        const row = { ...object, databaseId: this.id() };
        this.evseTypes.push(row);
        return { insert_EvseTypes_one: { databaseId: row.databaseId } };
      }

      // Part 10, and this arm READS THE DOCUMENT where every other one reads
      // only the variables. It has to: what is under test is the spelling of
      // one clause, and Hasura's rule about it is the thing a store answering
      // by intent would paper over -- `{ _eq: null }` there is not "is null",
      // it is NO CLAUSE, so the query answers with the paired row and the
      // seeder concludes the connector-less one already exists. `null` and
      // `undefined` are still told apart below, because the store holds what
      // the seeder WROTE and a row with no `connectorId` key at all is not the
      // row an `IS NULL` lookup answers.
      case "ProfileEvseTypeFixture": {
        const isNull = /connectorId:\s*\{\s*_is_null:\s*true\s*\}/.test(
          document,
        );
        return {
          EvseTypes: this.evseTypes.filter(
            (row) =>
              row.id === vars.id && (isNull ? row.connectorId === null : true),
          ),
        };
      }
      case "SeedProfileEvseType": {
        const object = vars.object as Row;
        const row = { ...object, databaseId: this.id() };
        this.evseTypes.push(row);
        return { insert_EvseTypes_one: { databaseId: row.databaseId } };
      }

      case "VariableFixture":
        return {
          Variables: this.variables.filter((row) => row.name === vars.name),
        };
      case "SeedVariable": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.variables.push(row);
        return { insert_Variables_one: { id: row.id } };
      }

      case "ComponentFixture":
        return {
          Components: this.components.filter(
            (row) => row.name === vars.name && row.instance === vars.instance,
          ),
        };
      case "SeedComponent": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.components.push(row);
        return { insert_Components_one: { id: row.id } };
      }
      case "RepointComponent": {
        const set = vars.set as Row;
        for (const row of this.components) {
          if (row.id === vars.id) row.evseDatabaseId = set.evseDatabaseId;
        }
        return { update_Components: { affected_rows: 1 } };
      }

      case "ComponentVariableFixture":
        return {
          ComponentVariables: this.componentVariables.filter(
            (row) =>
              row.componentId === vars.component &&
              row.variableId === vars.variable,
          ),
        };
      case "SeedComponentVariable": {
        const row = vars.object as Row;
        this.componentVariables.push(row);
        return { insert_ComponentVariables_one: { componentId: row.componentId } };
      }

      case "StationFixture":
        return {
          ChargingStations: this.stations.filter(
            (row) => row.ocppConnectionName === vars.name,
          ),
        };
      case "SeedStation": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.stations.push(row);
        return { insert_ChargingStations_one: { id: row.id } };
      }

      case "EvseFixture":
        return {
          Evses: this.evses.filter(
            (row) =>
              row.stationId === vars.station && row.evseTypeId === vars.evseTypeId,
          ),
        };
      case "AdoptEvse": {
        const set = vars.set as Row;
        for (const row of this.evses) {
          if (row.id === vars.id) row.evseId = set.evseId;
        }
        return { update_Evses: { affected_rows: 1 } };
      }
      case "SeedEvse": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.evses.push(row);
        return { insert_Evses_one: { id: row.id } };
      }

      case "ConnectorFixture":
        return {
          Connectors: this.connectors.filter(
            (row) =>
              row.stationId === vars.station &&
              row.connectorId === vars.connectorId,
          ),
        };
      case "SeedConnector": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.connectors.push(row);
        return { insert_Connectors_one: { id: row.id } };
      }

      case "FixtureEvses": {
        const prefix = String(vars.pattern).replace(/%$/, "");
        return {
          Evses: this.evses.filter((row) =>
            String(row.evseId).startsWith(prefix),
          ),
        };
      }
      case "FixtureConnectors": {
        const evseIds = vars.evses as number[];
        return {
          Connectors: this.connectors.filter((row) =>
            evseIds.includes(row.evseId as number),
          ),
        };
      }
      case "FixtureDeviceModel": {
        return {
          Components: this.components.filter(
            (row) =>
              row.name === vars.name &&
              row.instance !== undefined &&
              row.instance !== null,
          ),
          Variables: this.variables.filter((row) => row.name === vars.variable),
        };
      }
      case "FixtureEvseTypes": {
        const pairs = vars.pairs as {
          id: { _eq: number };
          connectorId: { _eq?: number; _is_null?: boolean };
        }[];
        return {
          EvseTypes: this.evseTypes.filter((row) =>
            pairs.some(
              (pair) =>
                pair.id._eq === row.id &&
                // `_is_null` rather than `_eq: null`, because that is what the
                // driver has to send: Hasura reads a null comparison value as
                // no clause at all, so the two spellings select different rows
                // and only one of them is the fixture's.
                (pair.connectorId._is_null === true
                  ? row.connectorId === null
                  : pair.connectorId._eq === row.connectorId),
            ),
          ),
        };
      }
      case "DropComponentVariables": {
        const ids = vars.ids as number[];
        remove(this.componentVariables, (row) =>
          ids.includes(row.componentId as number),
        );
        return { delete_ComponentVariables: { affected_rows: ids.length } };
      }

      // -- the records half, answered emptily: part 13 is about the `where`
      // -- each reader SENDS, which the log above holds, not about what comes
      // -- back.
      case "Newest":
        return { Transactions: [] };
      case "Residue":
        return { Transactions: [], LocalListVersions: [], SendLocalLists: [] };
      case "CountForTag":
        return { Transactions_aggregate: { aggregate: { count: 0 } } };
      case "ConnectorState":
        return { Connectors: [] };
      case "DeviceModelState":
        return { VariableAttributes: [] };

      case "Referenced": {
        const kept = this.stillReferenced.get(this.lastReferenceTarget) ?? [];
        const asked = vars.ids as number[];
        return {
          r0: kept.filter((id) => asked.includes(id)).map((id) => ({ ownerId: id })),
        };
      }
      case "Remove": {
        const table = /delete_(\w+)/.exec(document)?.[1] ?? "";
        const ids = vars.ids as number[];
        this.deletes.push({ table, ids });
        remove(this.rowsOf(table), (row) =>
          ids.includes((row.databaseId ?? row.id) as number),
        );
        return { [`delete_${table}`]: { affected_rows: ids.length } };
      }
    }

    // The variant check, which has no operation name because it is an
    // anonymous introspection query. Answered in the shape of the schema this
    // fake was built with -- part 11.
    if (document.includes("__type")) {
      return { __type: { fields: TRANSACTIONS_FIELDS[this.schema] } };
    }
    throw new Error(`guard: no arm for GraphQL operation ${operation || document}`);
  }

  private rowsOf(table: string): Row[] {
    switch (table) {
      case "EvseTypes":
        return this.evseTypes;
      case "Variables":
        return this.variables;
      case "Components":
        return this.components;
      case "Evses":
        return this.evses;
      case "Connectors":
        return this.connectors;
      default:
        return [];
    }
  }
}

/**
 * The three `Transactions` shapes, as GraphQL introspection spells them. Only
 * the two fields the discriminator reads are listed, plus `id` so that a
 * check reading "the first field" rather than a named one does not pass by
 * accident.
 *
 *  - v2 is the GA: `ocppConnectionName` dropped, `stationId` an integer FK.
 *  - v2-prerelease is beta1..beta4: both columns, `stationId` an integer.
 *  - v1 is v1.9.1: no name column, `stationId` a STRING holding the name.
 */
/**
 * The shapes the fake can answer as: the three `schemaOf` names, and two it
 * must NOT name -- a `stationId` of a scalar no line has, and no `stationId`
 * at all. Those two are what `verify`'s fourth branch is for: a CSMS this
 * driver was never read against, which must be refused rather than read as
 * whichever line a fallback happens to pick.
 */
type FakeSchema = CitrineSchema | "stationId-uuid" | "no-stationId";

/** The station-scoped inserts, by the table the GA dropped the name from. */
const GA_DROPPED_NAME_ON: Record<string, string | undefined> = {
  SeedEvse: "Evses",
  SeedConnector: "Connectors",
};
const INT = { kind: "SCALAR", name: "Int", ofType: null };
const STRING = { kind: "SCALAR", name: "String", ofType: null };
const nonNull = (type: Row) => ({ kind: "NON_NULL", name: null, ofType: type });
const TRANSACTIONS_FIELDS: Record<FakeSchema, Row[]> = {
  v2: [
    { name: "id", type: nonNull(INT) },
    { name: "stationId", type: INT },
  ],
  "v2-prerelease": [
    { name: "id", type: nonNull(INT) },
    { name: "ocppConnectionName", type: STRING },
    { name: "stationId", type: INT },
  ],
  v1: [
    { name: "id", type: nonNull(INT) },
    { name: "stationId", type: nonNull(STRING) },
  ],
  "stationId-uuid": [
    { name: "id", type: nonNull(INT) },
    { name: "stationId", type: { kind: "SCALAR", name: "uuid", ofType: null } },
  ],
  "no-stationId": [{ name: "id", type: nonNull(INT) }],
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function remove(rows: Row[], predicate: (row: Row) => boolean): void {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (predicate(rows[i]!)) rows.splice(i, 1);
  }
}

function provisionerOn(csms: FakeCitrine, cfg = CFG): CitrineProvisioner {
  return new CitrineProvisioner(cfg, () => {}, csms.fetch);
}

/** Every problem `verify` reported that is about the device model rather than
 *  about a tag the fake deliberately does not carry. */
function deviceModelProblems(problems: string[]): string[] {
  return problems.filter(
    (problem) =>
      problem.includes("evseId") ||
      problem.includes(COMPONENT_NAME) ||
      problem.includes(VARIABLE_NAME),
  );
}

const CONNECTORS = DEFAULT_CONNECTORS;
const TARGETS = statusTargets(CONNECTORS);

// ---------------------------------------------------------------------------
// Part 1 and 2: what provisioning writes
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  await provisionerOn(csms).provisionDeviceModel();

  check(
    "part 1: the station-scope target is provisioned",
    csms.evseTypes.some((row) => row.id === 0 && row.connectorId === 0),
    "no EvseTypes row with id 0 AND connectorId 0 was written. A station " +
      "reports its own availability as (evseId 0, connectorId 0); the CSMS's " +
      "lookup filters on the pair, so an EVSE type numbered 0 with a null " +
      `connector does not answer it. Written: ${JSON.stringify(csms.evseTypes)}`,
  );
  check(
    "part 1: every target the station reports is provisioned",
    TARGETS.every((target) =>
      csms.evseTypes.some(
        (row) =>
          row.id === target.evseId && row.connectorId === target.connectorId,
      ),
    ),
    `statusTargets() is ${JSON.stringify(TARGETS)}, written ${JSON.stringify(csms.evseTypes)}`,
  );

  check(
    "part 2: one component per target",
    csms.components.length === TARGETS.length,
    `${csms.components.length} component(s) for ${TARGETS.length} target(s): ` +
      JSON.stringify(csms.components),
  );
  const instances = csms.components.map((row) => row.instance);
  check(
    "part 2: every component instance is set and distinct",
    instances.every((instance) => typeof instance === "string" && instance !== "") &&
      new Set(instances).size === instances.length,
    "the components table's unique index on (tenantId, name) applies only to " +
      "rows whose instance is null, so at most one component may leave it " +
      `unset. Instances written: ${JSON.stringify(instances)}`,
  );
  check(
    "part 2: each component points at its own target's EVSE type",
    TARGETS.every((target) => {
      const evseType = csms.evseTypes.find(
        (row) =>
          row.id === target.evseId && row.connectorId === target.connectorId,
      );
      return csms.components.some(
        (row) => row.evseDatabaseId === evseType?.databaseId,
      );
    }),
    `components ${JSON.stringify(csms.components)} against EVSE types ` +
      JSON.stringify(csms.evseTypes),
  );
  check(
    "part 2: every component carries the variable",
    csms.componentVariables.length === TARGETS.length &&
      csms.variables.length === 1,
    `${csms.componentVariables.length} join row(s) and ` +
      `${csms.variables.length} variable(s) for ${TARGETS.length} target(s)`,
  );
}

// ---------------------------------------------------------------------------
// Part 3: verify, both directions
// ---------------------------------------------------------------------------

{
  const bare = new FakeCitrine();
  const before = deviceModelProblems(await provisionerOn(bare).verify());
  check(
    "part 3: verify names the missing device model",
    before.length > 0,
    "verify reported nothing about the device model against a CSMS carrying " +
      "none of it. A fixture nothing checks is a fixture that can stop being " +
      "written without anything going red.",
  );
  check(
    "part 3: verify names each missing target separately",
    TARGETS.every((target) =>
      before.some((problem) => problem.includes(`evseId ${target.evseId}`)),
    ),
    `targets ${JSON.stringify(TARGETS)} against problems ${JSON.stringify(before)}`,
  );

  const seeded = new FakeCitrine();
  const provisioner = provisionerOn(seeded);
  await provisioner.provisionDeviceModel();
  // Once, into a local. `check`'s detail is evaluated eagerly, so a second
  // `verify()` inside it would describe a different run from the one that
  // failed -- and would run on every green pass for nothing.
  const after = deviceModelProblems(await provisioner.verify());
  check(
    "part 3: verify is silent once provisioned",
    after.length === 0,
    `verify still reports ${JSON.stringify(after)} against what it just wrote`,
  );
}

// ---------------------------------------------------------------------------
// Part 4: teardown keeps what a scenario left behind
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  const provisioner = provisionerOn(csms);
  await provisioner.provisionDeviceModel();
  await provisioner.ensureStationTopology(CP_ID, CONNECTORS);

  // The variable attribute the CSMS wrote when a status finally landed points
  // at the first component. That is runtime residue on a fixture, and it is
  // the case a foreign key would otherwise turn into an aborted teardown.
  const held = csms.components[0]!.id as number;
  csms.stillReferenced.set("Components", [held]);

  const survivors = csms.components.map((row) => row.id);
  await provisioner.teardown();

  check(
    "part 4: a referenced component is kept",
    csms.components.some((row) => row.id === held),
    `component ${held} was deleted although something still points at it. ` +
      `Deletes: ${JSON.stringify(csms.deletes)}`,
  );
  check(
    "part 4: the referenced fixture, and only it, survives",
    csms.components.length === 1 &&
      csms.evses.length === 0 &&
      csms.connectors.length === 0,
    "teardown is wrong in one of the two directions -- it kept rows nothing " +
      "points at, or it took the one something does. Components " +
      `${JSON.stringify(csms.components)} (of ${JSON.stringify(survivors)}), ` +
      `evses ${JSON.stringify(csms.evses)}, connectors ${JSON.stringify(csms.connectors)}`,
  );
  check(
    "part 4: the charging station row is not removed",
    csms.stations.length === 1,
    "teardown removed the charging station, which is what the CSMS creates " +
      "for anything that connects -- its status notifications, messages and " +
      "transactions would go with it. This file's fixture/residue line says " +
      "runtime residue stays.",
  );
}

// ---------------------------------------------------------------------------
// Part 5: the prepare hook re-asserts the tenant half
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  const provisioner = provisionerOn(csms);
  await provisioner.provisionDeviceModel();

  // The station-scope target by name, not by position: this part is about the
  // repoint, and which component carries it is part 1's claim.
  const instance = componentInstance({ evseId: 0, connectorId: 0 });
  const stationScope = csms.components.find(
    (row) => row.instance === instance,
  );
  const pointedAt = stationScope?.evseDatabaseId;
  if (stationScope === undefined) {
    // Reported, then not dereferenced: a part that CRASHES reads as a broken
    // guard where a part that fails reads as a broken rule, and the difference
    // matters most when another part is already red.
    fail(
      "part 5: the station-scope component is addressable",
      `no component with instance "${instance}" among ` +
        `${JSON.stringify(csms.components)} -- the repoint cannot be staged`,
    );
  } else {
    // What the CSMS does to it on the first status it files, reproduced: a
    // second EVSE type numbered 0 with a NULL connector, and the component
    // repointed at it. `connectorId ? connectorId : null` and 0 is falsy.
    const drifted = {
      databaseId: 9_000,
      id: 0,
      connectorId: null,
      tenantId: TENANT,
    };
    csms.evseTypes.push(drifted);
    stationScope.evseDatabaseId = drifted.databaseId;
  }

  // Outside the branch above so the marker claim stands on its own: it is
  // about what the hook WRITES, not about the repoint it also does.
  await provisioner.ensureStationTopology(CP_ID, CONNECTORS);

  if (stationScope !== undefined) {
    check(
      "part 5: the prepare hook points the component back",
      stationScope.evseDatabaseId === pointedAt,
      "the station-scope component still points at the EVSE type with a null " +
        "connector, so the next status's lookup will not match it and the " +
        "warning this fixture removes is back on the second scenario. " +
        `Expected ${String(pointedAt)}, got ${String(stationScope.evseDatabaseId)}`,
    );
  }

  // Not the join it looks like. `Connectors.evseTypeConnectorId` carries
  // `@ForeignKey(() => EvseType)` with no foreign key behind it, and every
  // CitrineOS path treats it as the OCPP connector number -- the transaction
  // repository looks a connector up by `evseTypeConnectorId: evse.connectorId`.
  // Writing an EVSE type's key made that lookup miss, so the CSMS created its
  // own connector, and THAT insert collided with this fixture on
  // `(stationId, connectorId)`: one CALLERROR per transaction, measured.
  check(
    "part 5: a connector's evseTypeConnectorId is the OCPP connector number",
    TARGETS.every((target) =>
      csms.connectors.some(
        (row) =>
          row.connectorId === target.connectorId &&
          row.evseTypeConnectorId === target.connectorId,
      ),
    ),
    "a connector carries something other than its own OCPP connector number " +
      "in evseTypeConnectorId, so TransactionEvent will not find it and will " +
      `insert a colliding row. Written: ${JSON.stringify(csms.connectors)}`,
  );

  check(
    "part 5: the station topology carries the fixture marker",
    csms.evses.every((row) =>
      String(row.evseId).startsWith(FIXTURE_EVSE_PREFIX),
    ) && csms.evses.length === TARGETS.length,
    "teardown finds fixture EVSEs by that prefix and by nothing else -- it " +
      "has no roster to ask instead. " +
      `Written: ${JSON.stringify(csms.evses)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 6: a losing insert is a no-op, a failing one is not
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  // The row lands, and this lane's insert is refused: another lane got there
  // between this one's read and its write.
  csms.refuseSeed.set("SeedEvseType", "race");
  let raced: unknown;
  try {
    await provisionerOn(csms).provisionDeviceModel();
  } catch (err) {
    raced = err;
  }
  check(
    "part 6: losing the race to another lane is not an error",
    raced === undefined,
    "provisioning threw although the row it wanted exists. A parallel sweep " +
      "runs one lane per station and every one of them reaches these shared " +
      `rows before its first scenario. Threw: ${String(raced)}`,
  );
  check(
    "part 6: and the fixture is complete afterwards",
    deviceModelProblems(await provisionerOn(csms).verify()).length === 0,
    "the losing lane carried on with a row it never resolved: " +
      JSON.stringify(await provisionerOn(csms).verify()),
  );
}

{
  const csms = new FakeCitrine();
  // The insert is refused and nothing is written -- not a race, a fault.
  csms.refuseSeed.set("SeedVariable", "hard");
  let reported: unknown;
  try {
    await provisionerOn(csms).provisionDeviceModel();
  } catch (err) {
    reported = err;
  }
  check(
    "part 6: an insert that fails for any other reason is still reported",
    reported !== undefined,
    "provisioning swallowed a refused insert and reported success. The " +
      "fixture would then not exist, and the only thing that would say so is " +
      "a scenario failing several minutes later.",
  );
}

// ---------------------------------------------------------------------------
// Part 7: the v1.9.1 line is left alone
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine("v1");
  const v1 = provisionerOn(csms, V1_CFG);
  await v1.provisionDeviceModel();
  await v1.ensureStationTopology(CP_ID, CONNECTORS);
  await v1.teardown();

  const written =
    csms.evseTypes.length +
    csms.variables.length +
    csms.components.length +
    csms.componentVariables.length +
    csms.stations.length +
    csms.evses.length +
    csms.connectors.length;
  check(
    "part 7: nothing is written on the line that declares no 2.0.1 surface",
    written === 0,
    "the v1.9.1 schema keys a station by a STRING stationId holding the " +
      "OCPP name, so these writes fail there -- once per scenario, " +
      "because the prepare hook runs before every one of them. " +
      `Wrote ${written} row(s): ${JSON.stringify({
        evseTypes: csms.evseTypes,
        evses: csms.evses,
        connectors: csms.connectors,
      })}`,
  );
  const v1Problems = deviceModelProblems(await v1.verify());
  check(
    "part 7: and verify reports it as correct rather than as unprovisioned",
    v1Problems.length === 0,
    "verify reported a missing device model on a line that must not have " +
      `one: ${JSON.stringify(v1Problems)}`,
  );

  // The reader and the capability boolean are two spellings of one fact, and
  // substitution keys off the PARTS. They diverged once: the capability said
  // false on v1 while the reader was built unconditionally, so the runner would
  // have handed a spec queries naming a column v1.9.1 does not have.
  check(
    "part 7: and the driver offers no device-model reader there",
    new CitrineRecords(V1_CFG).deviceModel === undefined,
    "the parts carry a reader on a line whose capability says false, so " +
      "nothing substitutes the stub and a spec would run v2-shaped queries " +
      "against a v1 schema",
  );
  check(
    "part 7: and it offers one on the line that has it",
    new CitrineRecords(CFG).deviceModel !== undefined,
    "the reader is missing on v2, where every cert201- scenario needs it",
  );
}

// ---------------------------------------------------------------------------
// Part 8: an EVSE the CSMS already created is adopted AND marked
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  const provisioner = provisionerOn(csms);
  await provisioner.provisionDeviceModel();

  // The station and one EVSE already exist, unmarked -- what a database that
  // saw a transaction before this fixture existed looks like.
  const stationId = 900;
  csms.stations.push({ id: stationId, ocppConnectionName: CP_ID, tenantId: TENANT });
  const strayEvseId = 901;
  csms.evses.push({
    id: strayEvseId,
    stationId,
    evseTypeId: TARGETS[TARGETS.length - 1]!.evseId,
    evseId: "US*TST*C*00000001*0",
    tenantId: TENANT,
  });

  await provisioner.ensureStationTopology(CP_ID, CONNECTORS);

  const adopted = csms.evses.find((row) => row.id === strayEvseId);
  check(
    "part 8: the CSMS's own EVSE is adopted rather than duplicated",
    csms.evses.filter(
      (row) =>
        row.stationId === stationId &&
        row.evseTypeId === TARGETS[TARGETS.length - 1]!.evseId,
    ).length === 1,
    `duplicated: ${JSON.stringify(csms.evses)}`,
  );
  check(
    "part 8: and it carries the marker afterwards",
    String(adopted?.evseId).startsWith(FIXTURE_EVSE_PREFIX),
    "teardown finds a connector only through a marked EVSE, so the connector " +
      "written under this one would survive every teardown. " +
      `Marker is now ${JSON.stringify(adopted?.evseId)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 9: the fixture follows the connector count it is handed
// ---------------------------------------------------------------------------

{
  const TWO = 2;
  const csms = new FakeCitrine();
  const provisioner = provisionerOn(csms);
  // The real sequence, and the one that makes the claim bite: `driver
  // provision` seeded for the default, and only then does a wider run arrive.
  // Provisioning for two up front would let the hook ignore its argument and
  // still find everything in place.
  await provisioner.provisionDeviceModel();
  await provisioner.ensureStationTopology(CP_ID, TWO);

  const expected = statusTargets(TWO);
  check(
    "part 9: a second connector adds its own target",
    expected.length === TARGETS.length + 1 &&
      expected.some((t) => t.evseId === 2 && t.connectorId === 1),
    `statusTargets(2) is ${JSON.stringify(expected)}; the simulator's own ` +
      "projection reports (2, 1) for a second connector",
  );
  check(
    "part 9: every target of the wider topology is seeded",
    expected.every((target) =>
      csms.evseTypes.some(
        (row) =>
          row.id === target.evseId && row.connectorId === target.connectorId,
      ),
    ) && csms.components.length === expected.length,
    "the fixture ignored the count it was handed, so a --connector 2 run " +
      "reports a status the CSMS was never given anywhere to put. " +
      `EVSE types ${JSON.stringify(csms.evseTypes)}`,
  );
  check(
    "part 9: and the station carries the extra EVSE and connector",
    csms.evses.length === expected.length &&
      csms.connectors.some((row) => row.connectorId === 1) &&
      csms.evses.some((row) => row.evseTypeId === 2),
    `evses ${JSON.stringify(csms.evses)}, connectors ${JSON.stringify(csms.connectors)}`,
  );
  check(
    "part 9: and verify checks the topology it is asked about",
    deviceModelProblems(await provisioner.verify(TWO)).length === 0,
    JSON.stringify(deviceModelProblems(await provisioner.verify(TWO))),
  );
}

// ---------------------------------------------------------------------------
// Part 10: the connector-less EVSE rows a charging profile is addressed to
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine();
  const provisioner = provisionerOn(csms);
  await provisioner.provisionDeviceModel();

  const addressable = profileEvseIds(CONNECTORS);
  check(
    "part 10: every addressable EVSE has a row with a null connector",
    addressable.length > 0 &&
      addressable.every((evseId) =>
        csms.evseTypes.some(
          (row) => row.id === evseId && row.connectorId === null,
        ),
      ),
    "the SmartCharging endpoints resolve an EVSE with `connectorId IS NULL`, " +
      "so the paired row part 1 writes does not answer them and every " +
      "charging-profile request for that EVSE is refused inside the CSMS " +
      `with nothing on the websocket. Addressable ${JSON.stringify(addressable)}, ` +
      `written ${JSON.stringify(csms.evseTypes)}`,
  );
  check(
    "part 10: EVSE 0 gets none",
    !csms.evseTypes.some((row) => row.id === 0 && row.connectorId === null),
    "the grid connection point is the one address both endpoints skip the " +
      "lookup for, and the CSMS writes that row itself the first time it " +
      "files the station-scope status. Seeding it puts a fixture where " +
      "residue lives, and teardown could not tell them apart afterwards. " +
      `Written: ${JSON.stringify(csms.evseTypes)}`,
  );
  check(
    "part 10: verify names a missing one",
    deviceModelProblems(await provisionerOn(new FakeCitrine()).verify()).some(
      (problem) => problem.includes("null connector"),
    ),
    "verify said nothing about the row a charging-profile request needs, so " +
      "the pre-flight passes and the scenario fails with an empty frame log.",
  );
  check(
    "part 10: and is silent once provisioned",
    deviceModelProblems(await provisioner.verify()).length === 0,
    JSON.stringify(deviceModelProblems(await provisioner.verify())),
  );

  // Teardown, and it is the direction the `_is_null` spelling decides: a
  // teardown that matched `connectorId: { _eq: null }` selects nothing on
  // Hasura and leaves the row forever.
  await provisioner.ensureStationTopology(CP_ID, CONNECTORS);
  await provisioner.teardown();
  check(
    "part 10: teardown removes them",
    !csms.evseTypes.some(
      (row) => addressable.includes(row.id as number) && row.connectorId === null,
    ),
    "the connector-less rows survived teardown, so a second provision finds " +
      `them and the fixture is never actually removed: ${JSON.stringify(csms.evseTypes)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 11: the schema check tells the three shapes apart
// ---------------------------------------------------------------------------

/** The schema half of `verify`, without the fixture half: every problem that
 *  is a mismatch sentence rather than a missing row. */
async function schemaProblems(
  cfg: typeof CFG,
  schema: FakeSchema,
): Promise<string[]> {
  const problems = await provisionerOn(new FakeCitrine(schema), cfg).verify();
  return problems.filter((problem) => problem.startsWith("schema mismatch"));
}

/**
 * Each declared line against each server shape: accepted, or refused with a
 * sentence that points at the line to set. The prerelease points at none --
 * no declaration drives it.
 */
const SCHEMA_ROWS: {
  declared: typeof CFG;
  server: FakeSchema;
  refusal: string | undefined;
  why: string;
}[] = [
  {
    declared: CFG,
    server: "v2",
    refusal: undefined,
    why: "the declared line and the pinned image agree",
  },
  {
    declared: V1_CFG,
    server: "v1",
    refusal: undefined,
    why: "the declared line and the v1.9.1 image agree",
  },
  {
    declared: CFG,
    server: "v2-prerelease",
    refusal: "prerelease",
    why:
      "a beta1..beta4 server still carries ocppConnectionName on " +
      "Transactions, Evses and Connectors, so every station-scoped read and " +
      "write of the GA port targets the wrong shape",
  },
  {
    declared: V1_CFG,
    server: "v2",
    refusal: "CITRINE_VARIANT=v2",
    why:
      "the GA and v1.9.1 both lack ocppConnectionName on Transactions, so a " +
      "check reading only that column cannot tell them apart -- stationId's " +
      "TYPE is what does",
  },
  {
    declared: CFG,
    server: "v1",
    refusal: "CITRINE_VARIANT=v1",
    why: "stationId is a string on v1.9.1, and every v2 read would miss",
  },
  // The fourth branch, on both lines: a shape none of the three has must be
  // refused as unknown. A fallback that read it as the DECLARED line would
  // pass verify and fail every scenario instead, which is the silent,
  // expensive symptom verifySchema exists to turn into one sentence.
  {
    declared: CFG,
    server: "stationId-uuid",
    refusal: "matches no CitrineOS line",
    why: "a stationId of a scalar no line has is not the GA's Int",
  },
  {
    declared: V1_CFG,
    server: "stationId-uuid",
    refusal: "matches no CitrineOS line",
    why: "nor v1.9.1's String",
  },
  {
    declared: CFG,
    server: "no-stationId",
    refusal: "matches no CitrineOS line",
    why: "a Transactions with no station column at all is no line's",
  },
];

for (const row of SCHEMA_ROWS) {
  const problems = await schemaProblems(row.declared, row.server);
  check(
    `part 11: ${row.declared.variant} against a ${row.server} server is ` +
      (row.refusal === undefined ? "accepted" : `refused, naming ${row.refusal}`),
    row.refusal === undefined
      ? problems.length === 0
      : problems.length === 1 && problems[0]!.includes(row.refusal),
    `${row.why}. Reported: ${JSON.stringify(problems)}`,
  );
}

{
  const prerelease = await schemaProblems(CFG, "v2-prerelease");
  check(
    "part 11: and the prerelease refusal does not send the operator to v1",
    prerelease.every((problem) => !problem.includes("CITRINE_VARIANT=v1")),
    "the old check read ocppConnectionName's ABSENCE as v1, so a v2 server on " +
      "either side of the GA was told to switch to a line it is not. " +
      `Reported: ${JSON.stringify(prerelease)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 12: no station-scoped write names a column the GA dropped
// ---------------------------------------------------------------------------

{
  const csms = new FakeCitrine("v2");
  const provisioner = provisionerOn(csms);
  await provisioner.provisionDeviceModel();
  let refused: unknown;
  try {
    await provisioner.ensureStationTopology(CP_ID, CONNECTORS);
  } catch (err) {
    refused = err;
  }
  check(
    "part 12: the station topology is written against the GA schema",
    refused === undefined &&
      csms.evses.length === TARGETS.length &&
      csms.connectors.length === TARGETS.length,
    "an Evses or Connectors insert was refused -- the GA keys both by the " +
      "integer stationId alone, and naming ocppConnectionName fails the " +
      `insert type before Postgres sees it. Threw: ${String(refused)}`,
  );
  check(
    "part 12: and every row is keyed by the station's integer id",
    [...csms.evses, ...csms.connectors].every(
      (row) => row.stationId === csms.stations[0]?.id,
    ),
    `stations ${JSON.stringify(csms.stations)}, evses ${JSON.stringify(csms.evses)}, ` +
      `connectors ${JSON.stringify(csms.connectors)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 13: each reader scopes a station the way its table spells it
// ---------------------------------------------------------------------------

/** Every `where` a records call sent, by operation. `Residue` carries three. */
function wheresOf(csms: FakeCitrine, name: string): Row[] {
  return csms.operations
    .filter((op) => op.name === name)
    .flatMap((op) =>
      name === "Residue"
        ? [op.variables.open, op.variables.versions, op.variables.sends]
        : [op.variables.where],
    ) as Row[];
}

const BY_RELATIONSHIP = { ChargingStation: { ocppConnectionName: { _eq: CP_ID } } };
const BY_NAME = { ocppConnectionName: { _eq: CP_ID } };
const BY_V1_COLUMN = { stationId: { _eq: CP_ID } };

/** Whether `where` scopes the station exactly as `scope` does, and names no
 *  other station column beside it. */
function scopedBy(where: Row | undefined, scope: Row): boolean {
  if (where === undefined) return false;
  const station = ["ChargingStation", "ocppConnectionName", "stationId"].filter(
    (key) => key in where,
  );
  const [key] = Object.keys(scope);
  return (
    station.length === 1 &&
    station[0] === key &&
    JSON.stringify(where[key!]) === JSON.stringify(scope[key!])
  );
}

{
  const csms = new FakeCitrine("v2");
  const records = new CitrineRecords(CFG, csms.fetch);
  await records.latestTransaction(CP_ID);
  await records.transactionCountForIdTag(CP_ID, "TAG");
  await records.prepareStation(CP_ID);
  await records.deviceModel!.connectorStatus(CP_ID, 1, 1);
  await records.deviceModel!.availabilityState(CP_ID, 1, 1);

  const [open, versions, sends] = wheresOf(csms, "Residue");
  check(
    "part 13: on the GA, Transactions are scoped through the station row",
    [...wheresOf(csms, "Newest"), ...wheresOf(csms, "CountForTag"), open].every(
      (where) => scopedBy(where, BY_RELATIONSHIP),
    ),
    "the GA dropped Transactions.ocppConnectionName and keeps only the " +
      "integer stationId, so the OCPP name is reachable only through " +
      `ChargingStation. Sent: ${JSON.stringify(csms.operations)}`,
  );
  check(
    "part 13: and so are Connectors and VariableAttributes",
    [
      ...wheresOf(csms, "ConnectorState"),
      ...wheresOf(csms, "DeviceModelState"),
    ].every((where) => scopedBy(where, BY_RELATIONSHIP)),
    `Sent: ${JSON.stringify(csms.operations)}`,
  );
  check(
    "part 13: while the local-list tables keep the name column",
    scopedBy(versions, BY_NAME) && scopedBy(sends, BY_NAME),
    "LocalListVersions and SendLocalLists were not in the GA's drop -- " +
      "they never had the integer stationId -- so routing them through a " +
      "relationship they do not carry fails the whole Residue query. " +
      `Sent: ${JSON.stringify({ versions, sends })}`,
  );
}

{
  const csms = new FakeCitrine("v1");
  const records = new CitrineRecords(V1_CFG, csms.fetch);
  await records.latestTransaction(CP_ID);
  await records.transactionCountForIdTag(CP_ID, "TAG");
  await records.prepareStation(CP_ID);
  check(
    "part 13: on v1.9.1, every table is scoped by the string stationId",
    [
      ...wheresOf(csms, "Newest"),
      ...wheresOf(csms, "CountForTag"),
      ...wheresOf(csms, "Residue"),
    ].every((where) => scopedBy(where, BY_V1_COLUMN)),
    `Sent: ${JSON.stringify(csms.operations)}`,
  );
}

// ---------------------------------------------------------------------------
// Part 14: the relationships the readers walk exist on the schema they walk
// ---------------------------------------------------------------------------

/** The `using` of every relationship `provision` created, by `Table.name`. */
function relationshipsCreated(csms: FakeCitrine): Map<string, unknown> {
  const created = new Map<string, unknown>();
  for (const call of csms.metadataCalls) {
    if (!/^pg_create_(object|array)_relationship$/.test(call.type ?? "")) continue;
    const args = call.args as { table: { name: string }; name: string; using: unknown };
    created.set(`${args.table.name}.${args.name}`, args.using);
  }
  return created;
}

{
  const csms = new FakeCitrine("v2");
  await provisionerOn(csms).ensureApiAccess();
  const created = relationshipsCreated(csms);
  check(
    "part 14: on the GA, StopTransactions is joined on the partition key too",
    JSON.stringify(created.get("Transactions.StopTransactions")) ===
      JSON.stringify({
        manual_configuration: {
          remote_table: { schema: "public", name: "StopTransactions" },
          column_mapping: { id: "transactionDatabaseId", createdAt: "transactionCreatedAt" },
        },
      }),
    "Transactions is partitioned on the GA with a composite key, so the " +
      "StopTransactions foreign key is (transactionDatabaseId, " +
      "transactionCreatedAt) and a single-column foreign_key_constraint_on " +
      "matches no constraint -- the metadata call fails and provision with it. " +
      `Created: ${JSON.stringify(created.get("Transactions.StopTransactions"))}`,
  );
  check(
    "part 14: and every table part 13 scopes through ChargingStation has it",
    ["Transactions", "Connectors", "VariableAttributes"].every(
      (table) =>
        JSON.stringify(created.get(`${table}.ChargingStation`)) ===
        JSON.stringify({ foreign_key_constraint_on: "stationId" }),
    ),
    `Created: ${JSON.stringify([...created.keys()])}`,
  );
}

{
  const csms = new FakeCitrine("v1");
  await provisionerOn(csms, V1_CFG).ensureApiAccess();
  const created = relationshipsCreated(csms);
  check(
    "part 14: on v1.9.1, the relationships are the ones it always had",
    ![...created.keys()].some((key) => key.endsWith(".ChargingStation")) &&
      JSON.stringify(created.get("Transactions.StopTransactions")) ===
        JSON.stringify({
          foreign_key_constraint_on: {
            table: { schema: "public", name: "StopTransactions" },
            column: "transactionDatabaseId",
          },
        }),
    "v1.9.1's Transactions is neither partitioned nor keyed by an integer " +
      `stationId. Created: ${JSON.stringify([...created.entries()])}`,
  );
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). What these rows buy is measured rather than ` +
      `argued: with them, a 2.0.1 station's StatusNotifications reach the ` +
      `CSMS's device model and the four StatusNotificationService warnings ` +
      `issue #86 named are gone; without them the CSMS answers every request ` +
      `and stores nothing, which no assertion on the wire can see.\n`,
  );
  process.exit(1);
}
process.stdout.write("CitrineOS device-model fixture: OK\n");
