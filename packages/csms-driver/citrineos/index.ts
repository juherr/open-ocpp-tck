// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import {
  CSMS_OPERATION_16_ACTIONS,
  CSMS_OPERATION_201_ACTIONS,
  type CsmsCapabilities,
  type CsmsOperation16,
  type CsmsOperation201,
  type FetchLike,
} from "../contracts";
import type { CsmsDriver } from "../models";
import type { CsmsConnectorApi, CsmsSessionApi } from "../models";
import type { CitrineApiConfig } from "./config";
import { CitrineMessageApi } from "./api-client";
import { toCitrineRequest, toCitrineRequest201, type CitrineRefs } from "./requests";
import { speaksOcpp201, unroutedActions, unroutedActions201 } from "./variant";

export interface CitrineOsCsmsDriverOptions {
  readonly config: CitrineApiConfig;
  readonly refs: CitrineRefs;
  readonly fetch?: FetchLike;
  readonly sessions?: CsmsSessionApi;
  readonly connectors?: CsmsConnectorApi;
}

export function citrineOsCapabilities(config: CitrineApiConfig): CsmsCapabilities {
  const unsupported16 = unroutedActions(config.variant);
  const unsupported201 = unroutedActions201(config.variant);
  return {
    operations16: new Set(CSMS_OPERATION_16_ACTIONS.filter((action) => !unsupported16.has(action))),
    ...(speaksOcpp201(config.variant)
      ? { operations201: new Set(CSMS_OPERATION_201_ACTIONS.filter((action) => !unsupported201.has(action))) }
      : {}),
  };
}

/** Creates the reusable CitrineOS operation surface without TCK lifecycle hooks. */
export function createCitrineOsCsmsDriver(options: CitrineOsCsmsDriverOptions): CsmsDriver {
  const api = new CitrineMessageApi(options.config, options.fetch);
  return {
    capabilities: citrineOsCapabilities(options.config),
    ...(options.sessions ? { sessions: options.sessions } : {}),
    ...(options.connectors ? { connectors: options.connectors } : {}),
    operations16: {
      async execute(cpId: string, operation: CsmsOperation16): Promise<string> {
        const request = await toCitrineRequest(operation, options.refs, options.config.variant);
        return api.send(cpId, request);
      },
    },
    ...(speaksOcpp201(options.config.variant)
      ? {
          operations201: {
            async execute(cpId: string, operation: CsmsOperation201): Promise<string> {
              return api.send(cpId, toCitrineRequest201(operation, options.config.variant));
            },
          },
        }
      : {}),
  };
}

export * from "./api-client";
export * from "./config";
export * from "./requests";
export * from "./variant";
