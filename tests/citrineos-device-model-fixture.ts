// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * citrineos-device-model-fixture.ts -- the rows `driver provision` and the
 * prepare hook write so a 2.0.1 StatusNotification reaches the CSMS's device
 * model, and the rows they refuse to remove.
 *
 * PROPERTY, in 8 parts:
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
 * `citrineos-transport-classification.ts` rides and for the same reason.
 *
 * Offline: answers every request from an in-memory store. Opens no socket,
 * starts nothing.
 */
import type { FetchLike } from "../tck/driver";
import { defaultCitrineConfig } from "../drivers/citrineos/config";
import {
  COMPONENT_NAME,
  FIXTURE_EVSE_PREFIX,
  VARIABLE_NAME,
  componentInstance,
  statusTargets,
} from "../drivers/citrineos/device-model";
import { CitrineProvisioner } from "../drivers/citrineos/provision";

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
  readonly evseTypes: Row[] = [];
  readonly variables: Row[] = [];
  readonly components: Row[] = [];
  readonly componentVariables: Row[] = [];
  readonly stations: Row[] = [];
  readonly evses: Row[] = [];
  readonly connectors: Row[] = [];

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

    switch (operation) {
      // -- the tag half, answered emptily on purpose: part 3 asserts that the
      // -- device-model problems are PRESENT, never that they are the whole
      // -- list, so the tag table does not have to be restated here.
      case "Fixtures":
      case "Unknown":
      case "Mine":
        return { Authorizations: [] };

      case "EvseTypeFixture":
      case "EvseTypeCheck":
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

      case "VariableFixture":
      case "VariableCheck":
        return {
          Variables: this.variables.filter((row) => row.name === vars.name),
        };
      case "SeedVariable": {
        const row = { ...(vars.object as Row), id: this.id() };
        this.variables.push(row);
        return { insert_Variables_one: { id: row.id } };
      }

      case "ComponentFixture":
      case "ComponentCheck":
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
      case "ComponentVariableCheck":
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
        const instances = vars.instances as string[];
        const pairs = vars.pairs as {
          id: { _eq: number };
          connectorId: { _eq: number };
        }[];
        return {
          Components: this.components.filter(
            (row) =>
              row.name === vars.name && instances.includes(String(row.instance)),
          ),
          Variables: this.variables.filter((row) => row.name === vars.variable),
          EvseTypes: this.evseTypes.filter((row) =>
            pairs.some(
              (pair) =>
                pair.id._eq === row.id &&
                pair.connectorId._eq === row.connectorId,
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
    // anonymous introspection query. Answered as v2, which is what CFG says.
    if (document.includes("__type")) {
      return { __type: { fields: [{ name: "ocppConnectionName" }] } };
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function remove(rows: Row[], predicate: (row: Row) => boolean): void {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (predicate(rows[i]!)) rows.splice(i, 1);
  }
}

function provisionerOn(csms: FakeCitrine): CitrineProvisioner {
  return new CitrineProvisioner(CFG, () => {}, csms.fetch);
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

const TARGETS = statusTargets();

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
  await provisioner.ensureStationTopology(CP_ID);

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
  await provisioner.ensureStationTopology(CP_ID);

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
  const csms = new FakeCitrine();
  const v1 = new CitrineProvisioner(
    defaultCitrineConfig({
      CITRINE_GRAPHQL_URL: "http://citrine.test:8090",
      CITRINE_VARIANT: "v1",
    }),
    () => {},
    csms.fetch,
  );
  await v1.provisionDeviceModel();
  await v1.ensureStationTopology(CP_ID);
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
    "the v1.9.1 schema exposes no ocppConnectionName and spells its station " +
      "column differently, so these writes fail there -- once per scenario, " +
      "because the prepare hook runs before every one of them. " +
      `Wrote ${written} row(s): ${JSON.stringify({
        evseTypes: csms.evseTypes,
        evses: csms.evses,
        connectors: csms.connectors,
      })}`,
  );
  check(
    "part 7: and verify reports it as correct rather than as unprovisioned",
    deviceModelProblems(await v1.verify()).length === 0,
    "verify reported a missing device model on a line that must not have " +
      `one: ${JSON.stringify(deviceModelProblems(await v1.verify()))}`,
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
    ocppConnectionName: CP_ID,
    evseTypeId: TARGETS[TARGETS.length - 1]!.evseId,
    evseId: "US*TST*C*00000001*0",
    tenantId: TENANT,
  });

  await provisioner.ensureStationTopology(CP_ID);

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
