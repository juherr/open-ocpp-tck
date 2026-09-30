// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import { CSMS_OPERATION_16_ACTIONS, type CsmsCapabilities, type CsmsOperation16 } from "../contracts";
import type { FetchLike } from "../contracts";
import type { CsmsDriver } from "../models";
import type { CsmsConnectorApi, CsmsSessionApi } from "../models";
import { cpSelect, toSteveForm } from "./forms";
import { SteveUiOps, type SteveUiConfig } from "./ui-client";

export interface SteveCsmsDriverOptions {
  readonly config: SteveUiConfig;
  readonly fetch?: FetchLike;
  readonly sessions?: CsmsSessionApi;
  readonly connectors?: CsmsConnectorApi;
}

export const STEVE_CAPABILITIES: CsmsCapabilities = {
  operations16: new Set(CSMS_OPERATION_16_ACTIONS),
  reservations: true,
  chargingProfiles: true,
  deviceModel: false,
};

/** Creates the reusable SteVe operation surface without TCK lifecycle hooks. */
export function createSteveCsmsDriver(options: SteveCsmsDriverOptions): CsmsDriver {
  const ui = new SteveUiOps(options.config, options.fetch);
  return {
    capabilities: STEVE_CAPABILITIES,
    ...(options.sessions ? { sessions: options.sessions } : {}),
    ...(options.connectors ? { connectors: options.connectors } : {}),
    operations16: {
      async execute(cpId: string, operation: CsmsOperation16): Promise<string> {
        const { opPath, fields } = toSteveForm(operation);
        return ui.op(opPath, { chargePointSelectList: cpSelect(cpId), ...fields });
      },
    },
  };
}

export * from "./api-client";
export * from "./forms";
export * from "./ui-client";
