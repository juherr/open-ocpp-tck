// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/** TCK-specific driver lifecycle and assertion record contracts. */
import type { ExpectedFailureTable } from "./expected";
import type { ScopeTable } from "./scope";
import type {
  CsmsCapabilities,
  CsmsEnv,
  CsmsOperations16,
  CsmsOperations201,
  CsmsSessionApi,
  CsmsConnectorApi,
  ChargingProfileRef,
  ReservationRef,
  TransactionRef,
} from "../packages/csms-driver";
export * from "../packages/csms-driver";

/** Assertion-oriented observations used by TCK scenarios. */
export interface CsmsRecords {
  latestTransaction(cpId: string): Promise<TransactionRef>;
  waitForActiveTransaction(cpId: string, idTag: string, timeoutSecs?: number): Promise<TransactionRef>;
  transactionIdTag(tx: TransactionRef): Promise<string>;
  transactionStopTimestamp(tx: TransactionRef): Promise<string>;
  transactionStopReason(tx: TransactionRef): Promise<string>;
  transactionCountForIdTag(cpId: string, idTag: string): Promise<string>;
  reservations: CsmsReservationRecords;
  chargingProfiles: CsmsChargingProfileRecords;
  deviceModel: CsmsDeviceModelRecords;
}

export interface CsmsReservationRecords {
  latest(cpId: string): Promise<ReservationRef>;
  status(reservation: ReservationRef): Promise<string>;
}

export interface CsmsChargingProfileRecords {
  refByDescription(description: string): Promise<ChargingProfileRef>;
}

export interface CsmsDeviceModelRecords {
  connectorStatus(cpId: string, evseId: number, connectorId: number): Promise<string>;
  availabilityState(cpId: string, evseId: number, connectorId: number): Promise<string>;
}

export interface SimTransportDefaults {
  wsUrl?: string;
  appendCpIdToWsPath?: boolean;
  basicAuthUser?: string;
  basicAuthPass?: string;
  network?: string;
}

export type CsmsDriverCommand = (argv: string[]) => Promise<number>;
export type EnvDependent<T> = T | ((env: CsmsEnv) => T);

export interface CsmsDriverParts {
  operations16: CsmsOperations16;
  operations201?: CsmsOperations201;
  records: Omit<CsmsRecords, "reservations" | "chargingProfiles" | "deviceModel"> & {
    reservations?: CsmsReservationRecords;
    chargingProfiles?: CsmsChargingProfileRecords;
    deviceModel?: CsmsDeviceModelRecords;
  };
  /** Generic typed reads are available to non-TCK consumers as well. */
  sessions?: CsmsSessionApi;
  connectors?: CsmsConnectorApi;
  prepareStation?(cpId: string): Promise<void>;
  simTransport?(cpId: string): Promise<SimTransportDefaults>;
  close?(): Promise<void>;
}

export interface CsmsDriverModule {
  readonly id: string;
  readonly displayName: string;
  readonly scope?: EnvDependent<ScopeTable>;
  readonly capabilities?: EnvDependent<CsmsCapabilities>;
  readonly expectedFailures?: EnvDependent<ExpectedFailureTable>;
  create(env: CsmsEnv): Promise<CsmsDriverParts> | CsmsDriverParts;
  readonly commands?: Readonly<Record<string, CsmsDriverCommand>>;
  readonly envHelp?: string;
}

export function driverScope(module: CsmsDriverModule, env: CsmsEnv): ScopeTable | undefined {
  const value = module.scope;
  return typeof value === "function" ? value(env) : value;
}

export function driverCapabilities(module: CsmsDriverModule, env: CsmsEnv): CsmsCapabilities | undefined {
  const value = module.capabilities;
  return typeof value === "function" ? value(env) : value;
}

export function driverExpectedFailures(module: CsmsDriverModule, env: CsmsEnv): ExpectedFailureTable | undefined {
  const value = module.expectedFailures;
  return typeof value === "function" ? value(env) : value;
}
