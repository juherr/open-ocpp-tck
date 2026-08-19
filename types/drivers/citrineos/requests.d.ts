/**
 * requests.ts -- one CsmsOperation, one CitrineOS message-API call. Both
 * vocabularies: {@link toCitrineRequest} for OCPP 1.6, and
 * {@link toCitrineRequest201} for the 2.0.1 half.
 *
 * CitrineOS's outbound surface is generated from the OCPP schemas themselves:
 * `AbstractModuleApi._toMessagePath` builds
 * `/ocpp/<version>/<modulePrefix>/<actionCamelLower>` and validates the body
 * against `<Action>RequestSchema` for that version before dispatching. So the
 * mapping below is almost the identity -- the request bodies ARE the OCPP
 * payloads, which is exactly the shape the neutral vocabulary was derived from.
 *
 * Almost. Three places need real work, and each is a fact about CitrineOS:
 *
 *  - THE MODULE PREFIX IS NOT DERIVABLE FROM THE ACTION. RemoteStart/Stop and
 *    UnlockConnector live under `evdriver` rather than `transactions`;
 *    GetDiagnostics lives under `reporting`. There is no rule, only a table
 *    (apps/ocpp-server/src/config/envs/docker.ts), so it is spelled out here.
 *  - REFS ARE NOT WIRE VALUES. A TransactionRef is this driver's own row key
 *    and has to be resolved to the OCPP integer transactionId; a
 *    ChargingProfileRef expands to the whole inline profile. See
 *    {@link CitrineRefs}.
 *  - RESERVATIONS DO NOT EXIST HERE AT ALL. See the two throwing cases.
 */
import { type CsmsOperation16, type CsmsOperation201, type TransactionRef } from "../../tck/driver";
import { type CitrineVariant } from "./variant";
/** The endpointPrefix values CitrineOS's shipped `docker` config declares. */
export type CitrineModule = "configuration" | "evdriver" | "monitoring" | "reporting" | "smartcharging";
/** The version segment of a message-API path, spelled as CitrineOS spells it.
 *  Not `SimOcppVersion`: that type is the simulator CLI's spelling
 *  (`OCPP-2.0.1`) of a different thing -- which protocol a charge point
 *  speaks, not which route a CSMS registered. */
type CitrineOcppVersion = "1.6" | "2.0.1";
export interface CitrineRequest {
    ocppVersion: CitrineOcppVersion;
    module: CitrineModule;
    /** The path segment, i.e. the OCPP action with a lowercased first letter. */
    action: string;
    body: Record<string, unknown>;
}
/**
 * How an opaque ref becomes something CitrineOS will accept.
 *
 * `ocppTransactionId` is async because it is a database lookup: this driver's
 * TransactionRef is `Transactions.id`, the serial primary key, while the wire
 * carries `Transactions.transactionId`, the value CitrineOS handed the charge
 * point in StartTransaction.conf. The two are different columns and, unlike
 * SteVe's, different numbers.
 */
export interface CitrineRefs {
    ocppTransactionId(ref: TransactionRef): Promise<number>;
}
/**
 * STAMPED ONCE PER PROTOCOL, not once per arm. Twenty-one arms each repeating
 * `ocppVersion: "1.6"` is twenty-one chances to write the other one, and the
 * failure would be silent in the worst way: a 2.0.1 payload POSTed to a 1.6
 * route is a 404 with a hint about an unrouted action, which reads as a
 * capability gap in the CSMS rather than as a typo here.
 */
export declare function toCitrineRequest(op: CsmsOperation16, refs: CitrineRefs, variant: CitrineVariant): Promise<CitrineRequest>;
/**
 * The same for {@link CsmsOperation201}, and a SECOND function rather than a
 * widened first one -- the two vocabularies are two closed unions for the
 * reason tck/driver.ts gives beside `CsmsOperation201`'s `Reset` arm, and
 * `Reset` being an action name in both is exactly what a shared switch would
 * lose. It needs no `refs`: nothing in the 2.0.1 slice carries an opaque ref,
 * so there is no database round-trip to hand it, and no `variant` either --
 * see `capabilitiesFor`, where the v1 line declares no 2.0.1 surface at all
 * rather than declaring one with holes in it.
 *
 * The module for each action is CitrineOS's, not the OCPP specification's:
 * `Reset` is Configuration's and the two device-model actions are
 * Monitoring's, read off the `@AsMessageEndpoint` decorators in
 * `packages/core/src/modules/{Configuration,Monitoring}/src/module/2/MessageApi.ts`.
 * There is no rule to derive it from, the same way there is none for 1.6.
 */
export declare function toCitrineRequest201(op: CsmsOperation201): CitrineRequest;
export {};
