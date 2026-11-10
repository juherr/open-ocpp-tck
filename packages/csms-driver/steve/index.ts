// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import { CSMS_OPERATION_16_ACTIONS, type CsmsCapabilities, type CsmsOperation16 } from "../contracts";
import type { FetchLike } from "../contracts";
import type { CsmsDriver } from "../models";
import type { CsmsConnectorApi, CsmsSessionApi } from "../models";
import { STEVE_CHARGE_POINT_PROFILES, steveChargePoints } from "./charge-points";
import { cpSelect, toSteveForm } from "./forms";
import { SteveUiOps, type SteveUiConfig } from "./ui-client";

export interface SteveCsmsDriverOptions {
  readonly config: SteveUiConfig;
  readonly fetch?: FetchLike;
  readonly sessions?: CsmsSessionApi;
  readonly connectors?: CsmsConnectorApi;
  /**
   * The parent SteVe stores for an OCPP tag, null for none. Only a ReserveNow
   * carrying a `parentIdTag` asks it: SteVe sends the reserved tag's stored
   * parent and has no field for another one, so without this lookup such a
   * request is refused as unsupported rather than posted with its parent
   * dropped. The manager UI cannot answer it; SteVe's WebAPI can
   * (`GET /ocppTags` reports `parentIdTag`).
   */
  readonly ocppTagParent?: (idTag: string) => Promise<string | null>;
}

export const STEVE_CAPABILITIES: CsmsCapabilities = {
  operations16: new Set(CSMS_OPERATION_16_ACTIONS),
  chargePoints: { securityProfiles: STEVE_CHARGE_POINT_PROFILES },
};

/**
 * Creates the reusable SteVe operation and charge-point administration
 * surfaces, without TCK lifecycle hooks. Both share one manager-UI session.
 */
export function createSteveCsmsDriver(options: SteveCsmsDriverOptions): CsmsDriver {
  const ui = new SteveUiOps(options.config, options.fetch);
  return {
    capabilities: STEVE_CAPABILITIES,
    ...(options.sessions ? { sessions: options.sessions } : {}),
    ...(options.connectors ? { connectors: options.connectors } : {}),
    chargePoints: steveChargePoints(ui),
    operations16: {
      async execute(cpId: string, operation: CsmsOperation16): Promise<string> {
        const reservedTagParent =
          operation.action === "ReserveNow" &&
          operation.parentIdTag !== undefined &&
          options.ocppTagParent
            ? await options.ocppTagParent(operation.idTag)
            : undefined;
        const { opPath, fields } = toSteveForm(operation, { reservedTagParent });
        return ui.op(opPath, { chargePointSelectList: cpSelect(cpId), ...fields });
      },
    },
  };
}

export * from "./api-client";
export * from "./forms";
export * from "./ui-client";
