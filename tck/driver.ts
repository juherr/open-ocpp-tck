// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/** TCK-specific driver lifecycle and assertion record contracts. */
import type { ExpectedFailureTable } from "./expected";
import type { ScopeTable } from "./scope";
import type { ScenarioOcppVersion } from "./spec-types";
import type {
  CsmsCapabilities,
  CsmsDriver,
  CsmsEnv,
  ChargingProfileRef,
  ReservationRef,
  TransactionRef,
} from "../packages/csms-driver";
export * from "../packages/csms-driver";

/** TCK-only observations exposed by a driver's assertion record adapters. */
export interface CsmsTckCapabilities extends CsmsCapabilities {
  readonly reservations: boolean;
  readonly chargingProfiles: boolean;
  readonly deviceModel: boolean;
}

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

/**
 * The library's driver surface minus its declaration -- which the TCK module
 * states itself, offline -- plus what only the TCK needs. Extending rather
 * than restating it is what lets a surface added to `CsmsDriver` reach a TCK
 * driver without a second edit here.
 */
export interface CsmsDriverParts extends Omit<CsmsDriver, "capabilities"> {
  records: Omit<CsmsRecords, "reservations" | "chargingProfiles" | "deviceModel"> & {
    reservations?: CsmsReservationRecords;
    chargingProfiles?: CsmsChargingProfileRecords;
    deviceModel?: CsmsDeviceModelRecords;
  };
  prepareStation?(cpId: string): Promise<void>;
  simTransport?(cpId: string): Promise<SimTransportDefaults>;
  close?(): Promise<void>;
}

export interface CsmsDriverModule {
  readonly id: string;
  readonly displayName: string;
  readonly scope?: EnvDependent<ScopeTable>;
  readonly protocols?: EnvDependent<readonly ScenarioOcppVersion[]>;
  readonly capabilities?: EnvDependent<CsmsTckCapabilities>;
  readonly expectedFailures?: EnvDependent<ExpectedFailureTable>;
  create(env: CsmsEnv): Promise<CsmsDriverParts> | CsmsDriverParts;
  readonly commands?: Readonly<Record<string, CsmsDriverCommand>>;
  readonly envHelp?: string;
}

export function driverScope(module: CsmsDriverModule, env: CsmsEnv): ScopeTable | undefined {
  const value = module.scope;
  return typeof value === "function" ? value(env) : value;
}

export function driverProtocols(
  module: CsmsDriverModule,
  env: CsmsEnv,
): readonly ScenarioOcppVersion[] | undefined {
  const value = module.protocols;
  const protocols = typeof value === "function" ? value(env) : value;
  if (protocols === undefined) return undefined;
  if (!Array.isArray(protocols) || protocols.length === 0) {
    throw new Error("Driver protocols must declare at least one supported protocol.");
  }
  const seen = new Set<string>();
  for (const protocol of protocols as readonly unknown[]) {
    if (protocol !== "OCPP-1.6J" && protocol !== "OCPP-2.0.1") {
      throw new Error(`Driver protocols contains unsupported protocol ${JSON.stringify(protocol)}.`);
    }
    if (seen.has(protocol)) {
      throw new Error(`Driver protocols contains duplicate protocol '${protocol}'.`);
    }
    seen.add(protocol);
  }
  return protocols;
}

export function driverCapabilities(module: CsmsDriverModule, env: CsmsEnv): CsmsTckCapabilities | undefined {
  const value = module.capabilities;
  return typeof value === "function" ? value(env) : value;
}

export function driverExpectedFailures(module: CsmsDriverModule, env: CsmsEnv): ExpectedFailureTable | undefined {
  const value = module.expectedFailures;
  return typeof value === "function" ? value(env) : value;
}
