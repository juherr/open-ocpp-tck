/**
 * variant.ts -- the two CitrineOS lines this driver speaks, in one place.
 *
 * CitrineOS restructured between the v1.x stable line and the v2 line, and
 * two of those changes reach this driver:
 *
 *  1. THE OCPP CONNECTION NAME MOVED, TWICE. On v1.9.1 `Transactions`,
 *     `LocalListVersions` and `SendLocalLists` carry it as a string
 *     `stationId`. The v2 prereleases (beta1..beta4) renamed it
 *     `ocppConnectionName` and added an integer `stationId` foreign key to
 *     `ChargingStations.id` beside it. The v2.0.0 GA then DROPPED the name
 *     from every table that has the integer key -- `Transactions`, `Evses`,
 *     `Connectors`, `VariableAttributes` and twelve more (citrineos-core
 *     #1058, the `20260914*-drop-ocpp-connection-name-*` migrations) -- and
 *     kept it on the tables that never got one, `LocalListVersions` and
 *     `SendLocalLists` among them. So on the GA the name is one column on
 *     some tables and a join through `ChargingStations` on others, which is
 *     why this module hands out a `where` per table family rather than a
 *     column name. All three shapes were read off running containers, the
 *     GA's after its migrations at the tag.
 *  2. THE 1.6 LOCAL AUTH LIST ENDPOINTS DID NOT EXIST YET. v1.9.1 advertises
 *     16 `/ocpp/1.6/` paths, v2.0.0-beta1 advertises 18; the two extra are
 *     `evdriver/sendLocalList` and `evdriver/getLocalListVersion`.
 *
 * `v2` MEANS THE GA, which is what `compose.yaml` pins. The prereleases are
 * not a third line: their scope and capabilities are the GA's, only the
 * schema differs, and a line kept for a prerelease nobody should still be
 * running would cost a second v2 schema in every guard. `driver verify`
 * refuses one by name instead -- see {@link schemaOf}.
 *
 * WHY THIS IS DECLARED AND NOT DETECTED
 * -------------------------------------
 * Detecting the column from information_schema would be easy and would even be
 * unambiguous -- see the trap below. But the scope table and the capability
 * set have to be readable with NO running server and NO credentials, because
 * that is the promise `ocpp-tck check-driver` and the pre-flight rest on. A
 * driver that had to connect to Postgres before it could say which scenarios
 * it can drive would break that promise.
 *
 * So the variant is declared once, drives all three things, and
 * `driver verify` then asserts that the running server agrees. Declare, then
 * check -- rather than two sources of truth free to disagree in silence.
 *
 * THE TRAP, recorded because it is the obvious wrong detection: `stationId`
 * exists on `Transactions` in ALL THREE shapes. On v1.9.1 it is `character
 * varying` and holds the OCPP name; on the prereleases and the GA it is an
 * `integer` foreign key. Testing for its presence is therefore always true and
 * always useless -- and so, since the GA, is testing for the ABSENCE of
 * `ocppConnectionName`, which v1.9.1 and the GA share. It takes both facts:
 * see {@link schemaOf}.
 */
import type { CitrineVariant } from "../../packages/csms-driver/citrineos/variant";
export { DEFAULT_VARIANT, NO_LOCAL_LIST, NO_OCPP_201_ON_V1, NO_RESERVATIONS, resolveVariant, speaksOcpp201, unroutedActions, unroutedActions201, } from "../../packages/csms-driver/citrineos/variant";
export type { CitrineVariant } from "../../packages/csms-driver/citrineos/variant";
/** A Hasura `where` fragment. */
export type Where = Record<string, unknown>;
/**
 * The tables that carry the integer station key on the GA and lost the OCPP
 * name with it, so they reach a station through the `ChargingStation`
 * relationship. ONE LIST, TWO READERS: {@link stationWhere} walks the
 * relationship and graphql-client.ts creates it for exactly these tables, so a
 * table added here cannot be queried through a relationship nobody created.
 */
export declare const STATION_JOINED_TABLES: readonly ["Transactions", "Connectors", "VariableAttributes"];
/** Every table this driver scopes to a station. `LocalListVersions` and
 *  `SendLocalLists` never got the integer key, so the GA left their name
 *  column in place -- and a relationship they do not carry would fail the
 *  whole query. */
export type StationScopedTable = (typeof STATION_JOINED_TABLES)[number] | "LocalListVersions" | "SendLocalLists";
/**
 * Scopes `table` to one charge point on the declared line.
 *
 * v1.9.1 carries the name as a string `stationId` on every one of them. On v2
 * the tables in {@link STATION_JOINED_TABLES} go through `ChargingStation`,
 * which kept the name with its `(ocppConnectionName, tenantId)` unique key;
 * filtering their integer column directly would cost a lookup of the
 * station's id first, and a station the CSMS has not created yet would have to
 * be told apart from one with no rows -- the join answers both as "no rows".
 */
export declare function stationWhere(variant: CitrineVariant, table: StationScopedTable, cpId: string): Where;
/**
 * A field of the `Transactions` type, as GraphQL introspection spells it --
 * one wrapper deep, because a column is `T` or `T!` and never a list.
 */
export interface IntrospectedField {
    name: string;
    type: {
        name: string | null;
        ofType: {
            name: string | null;
        } | null;
    } | null;
}
/** The schema shapes `schemaOf` can recognise. `v2-prerelease` is refused. */
export type CitrineSchema = CitrineVariant | "v2-prerelease";
/** How `verify` names a line's `stationId`. */
export declare function describeStationId(variant: CitrineVariant): string;
/**
 * Which line a server's `Transactions` belongs to, or `undefined` for a shape
 * none of the three has.
 *
 *  - `ocppConnectionName` present: a v2 prerelease. The GA dropped it, and a
 *    refused shape is not a line, which is why it is not a row of
 *    {@link STATION_ID}.
 *  - otherwise `stationId`'s scalar type, looked up in {@link STATION_ID}.
 *
 * Pure; its one caller is `verify`, which asks the introspection query, and
 * `tests/citrineos-device-model-fixture.ts` part 11 reaches it through that
 * caller with a fake answering each shape.
 */
export declare function schemaOf(fields: readonly IntrospectedField[]): CitrineSchema | undefined;
/**
 * Scenarios the OCPP 2.0.1 declaration covers, and which v1 therefore demotes.
 * Named here rather than in scope.ts for the same reason
 * {@link V1_LOCAL_LIST_SCENARIOS} is: one list, and the table cannot drift from
 * {@link speaksOcpp201}.
 *
 * ONE DIRECTION OF THAT IS OUTSIDE `scopeCoverage`, and it is worth knowing
 * which and where it is checked instead. `scopeCoverage` catches a row that is
 * missing and a row that is stale; it cannot catch a row that is present and
 * NOT demoted, because a demotion is not a row. So a `cert201-` scenario added
 * without a line here still gets its v2 row -- the coverage check forces that
 * -- and `v1Scope()` would inherit it unchanged, leaving the v1 table claiming
 * exactly what the comment above that function calls wrong. That direction is
 * `tests/cert201-scope-rows.sh`'s: it holds this list and the registered
 * `cert201-` scenarios to each other, both ways round.
 *
 * THAT IS NOT HYPOTHETICAL: it happened. `cert201-tcb06-get-variables` and
 * `cert201-tcb09-set-variables` were registered while this list still named
 * five ids, and for that whole time `check:driver:citrineos-v1` reported them
 * DRIVABLE -- green, on a line whose `capabilities.operations201` is absent.
 * The list is exhaustive over the registry by hand; keep it that way when a
 * scenario is added.
 *
 * Unlike {@link V1_LOCAL_LIST_SCENARIOS}, this list cannot be derived from
 * anything the driver can see: a scenario's declared protocol lives on its
 * `ScenarioSpec` and never reaches a driver. Whatever changes that is what
 * deletes this list.
 */
export declare const CERT_201_SCENARIOS: readonly ["cert201-tcb01-cold-boot", "cert201-tcb06-get-variables", "cert201-tcb09-set-variables", "cert201-tcb20-reset-accepted", "cert201-tcb21-reset-scheduled", "cert201-tcb22-reset-rejected", "cert201-tcb42-set-network-profile", "cert201-tcb44-set-network-profile-refused", "cert201-tcc02-authorize-invalid", "cert201-tce10-start-authorized", "cert201-tcf20-heartbeat", "cert201-tcf27-trigger-not-implemented", "cert201-tcg03-evse-inoperative", "cert201-tcg04-evse-operative", "cert201-tcg05-station-inoperative", "cert201-tcg06-station-operative", "cert201-tcg07-connector-inoperative", "cert201-tcg08-connector-operative", "cert201-tcj01-clock-aligned-meter-values", "cert201-tck01-set-tx-default-profile", "cert201-tck03-set-station-max-profile", "cert201-tck04-replace-profile", "cert201-tck05-clear-reported-profile", "cert201-tck06-clear-profile-by-criteria", "cert201-tck08-clear-unknown-profile", "cert201-tck10-set-default-profile-all-evses", "cert201-tck19-set-recurring-profile", "cert201-tck29-profiles-in-transaction", "cert201-tck30-profiles-evse", "cert201-tck32-profiles-by-id", "cert201-tck33-profiles-by-stack-level", "cert201-tck34-profiles-by-limit-source", "cert201-tck35-profiles-by-purpose", "cert201-tck36-profiles-by-purpose-stack", "cert201-tck43-composite-schedule-evse", "cert201-tck44-composite-schedule-station", "cert201-tck60-set-tx-profile", "cert201-tck70-stack-profiles", "cert201-tcm01-install-csms-root", "cert201-tcm02-install-manufacturer-root", "cert201-tcm03-install-v2g-root", "cert201-tcm04-install-mo-root", "cert201-tcm05-install-refused", "cert201-tcm13-installed-ids-manufacturer-root", "cert201-tcm14-installed-ids-v2g-root", "cert201-tcm15-installed-ids-v2g-chain", "cert201-tcm16-installed-ids-mo-root", "cert201-tcm18-installed-ids-all-types", "cert201-tcm19-installed-ids-not-found"];
/** Scenarios the local-auth-list gap costs on v1. Named here rather than in
 *  scope.ts so the two cannot drift from {@link unroutedActions}. */
export declare const V1_LOCAL_LIST_SCENARIOS: readonly ["cert16-tc042-1-get-local-list-version-not-supported", "cert16-tc042-2-get-local-list-version-empty", "cert16-tc043-1-send-local-list-not-supported", "cert16-tc043-3-send-local-list-failed", "cert16-tc043-4-send-local-list-full", "cert16-tc043-5-send-local-list-differential"];
