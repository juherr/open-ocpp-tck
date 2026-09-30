import type { TransactionRef } from "./contracts";
/** A typed, CSMS-side charging session. */
export interface CsmsSession {
    /** Opaque handle accepted by this driver's operations. */
    readonly id: TransactionRef;
    readonly stationId: string;
    readonly idTag?: string;
    readonly active: boolean;
    readonly endedAt?: string;
    readonly stopReason?: string;
}
/** A station's view of one connector. Status values retain the CSMS vocabulary. */
export interface CsmsConnector {
    readonly stationId: string;
    readonly evseId: number;
    readonly connectorId: number;
    readonly status?: string;
    readonly availability?: string;
}
/** Read APIs shared by CSMS implementations that expose session data. */
export interface CsmsSessionApi {
    getActiveSession(stationId: string): Promise<CsmsSession | null>;
    getSession(stationId: string, id: TransactionRef): Promise<CsmsSession | null>;
}
/** Read API for connector state where the CSMS stores it. */
export interface CsmsConnectorApi {
    getConnector(stationId: string, evseId: number, connectorId: number): Promise<CsmsConnector | null>;
}
/** The reusable portions returned by a vendor driver factory. */
export interface CsmsDriver {
    readonly operations16: import("./contracts").CsmsOperations16;
    readonly operations201?: import("./contracts").CsmsOperations201;
    readonly sessions?: CsmsSessionApi;
    readonly connectors?: CsmsConnectorApi;
    readonly capabilities: import("./contracts").CsmsCapabilities;
}
