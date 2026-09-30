// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import type { CitrineVariant } from "./variant";

/** Network settings needed by the reusable CitrineOS message API. */
export interface CitrineApiConfig {
  readonly variant: CitrineVariant;
  readonly apiUrl: string;
  readonly tenantId: number;
}
