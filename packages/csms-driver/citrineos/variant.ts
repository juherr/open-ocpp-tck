// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0

import {
  CSMS_OPERATION_201_ACTIONS,
  type CsmsEnv,
  type CsmsOperation16Action,
  type CsmsOperation201Action,
} from "../contracts";

export type CitrineVariant = "v1" | "v2";
export type Where = Record<string, unknown>;

export function resolveVariant(env: CsmsEnv): CitrineVariant {
  const raw = env.CITRINE_VARIANT;
  if (raw === undefined || raw === "" || raw === "v2") return "v2";
  if (raw === "v1") return "v1";
  throw new Error(`citrineos: CITRINE_VARIANT must be "v1" or "v2", got ${JSON.stringify(raw)}`);
}

/** Generic reason returned when a protocol operation is not routed. */
export const NO_RESERVATIONS =
  "CitrineOS has no OCPP 1.6 endpoint for ReserveNow or CancelReservation.";
const NO_LOCAL_LIST =
  "CitrineOS v1.9.1 has no OCPP 1.6 endpoint for SendLocalList or GetLocalListVersion.";
const NO_OCPP_201_ON_V1 =
  "This CitrineOS v1 driver exposes no measured OCPP 2.0.1 operations.";

const UNROUTED_16: Readonly<Record<CitrineVariant, ReadonlyMap<CsmsOperation16Action, string>>> = {
  v2: new Map([
    ["ReserveNow", NO_RESERVATIONS],
    ["CancelReservation", NO_RESERVATIONS],
  ]),
  v1: new Map([
    ["ReserveNow", NO_RESERVATIONS],
    ["CancelReservation", NO_RESERVATIONS],
    ["SendLocalList", NO_LOCAL_LIST],
    ["GetLocalListVersion", NO_LOCAL_LIST],
  ]),
};

const UNROUTED_201: Readonly<Record<CitrineVariant, ReadonlyMap<CsmsOperation201Action, string>>> = {
  v2: new Map(),
  v1: new Map(CSMS_OPERATION_201_ACTIONS.map((action) => [action, NO_OCPP_201_ON_V1])),
};

export function unroutedActions(variant: CitrineVariant): ReadonlyMap<CsmsOperation16Action, string> {
  return UNROUTED_16[variant];
}

export function unroutedActions201(variant: CitrineVariant): ReadonlyMap<CsmsOperation201Action, string> {
  return UNROUTED_201[variant];
}

export function speaksOcpp201(variant: CitrineVariant): boolean {
  return variant === "v2";
}
