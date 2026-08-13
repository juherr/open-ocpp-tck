/**
 * requests.ts -- one CsmsOperation, one CitrineOS message-API call.
 *
 * CitrineOS's outbound surface is generated from the OCPP schemas themselves:
 * `AbstractModuleApi._toMessagePath` builds
 * `/ocpp/1.6/<modulePrefix>/<actionCamelLower>` and validates the body against
 * `OCPP1_6.<Action>RequestSchema` before dispatching. So the mapping below is
 * almost the identity -- the request bodies ARE the OCPP payloads, which is
 * exactly the shape the neutral vocabulary was derived from.
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
import { type CsmsOperation, type TransactionRef } from "../../tck/driver";
import { type CitrineVariant } from "./variant";
/** The endpointPrefix values CitrineOS's shipped `docker` config declares. */
export type CitrineModule = "configuration" | "evdriver" | "reporting" | "smartcharging";
export interface CitrineRequest {
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
export declare function toCitrineRequest(op: CsmsOperation, refs: CitrineRefs, variant: CitrineVariant): Promise<CitrineRequest>;
