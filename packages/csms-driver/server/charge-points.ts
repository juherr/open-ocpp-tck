// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * The daemon's charge-point bodies: JSON to the `charge-points.ts` model and
 * back. The wire names ARE the model's names, so there is nothing to map --
 * only the shape to enforce, which the model's types cannot do for JSON.
 */
import type {
  ChargePointDefinition,
  ChargePointDetails,
  ChargePointRegistration,
  ChargePointSecurity,
  ChargePointSecurityProfile,
  ChargePointUpdate,
} from "../charge-points";
import { InvalidInputError, literals, ObjectReader, present } from "./decode";

const REGISTRATIONS = literals<ChargePointRegistration>({ Accepted: true, Pending: true, Rejected: true });
const PROFILES: readonly ChargePointSecurityProfile[] = Object.keys({
  0: true,
  1: true,
  2: true,
  3: true,
} satisfies Record<ChargePointSecurityProfile, true>).map(Number) as ChargePointSecurityProfile[];

function security(r: ObjectReader): ChargePointSecurity {
  const profile = r.oneOf("profile", PROFILES);
  if (profile === 1 || profile === 2) {
    const basicAuthPassword = r.string("basicAuthPassword");
    if (basicAuthPassword === "") throw new InvalidInputError("security.basicAuthPassword must not be empty");
    return { profile, basicAuthPassword };
  }
  // Profiles 0 and 3 carry no password; one sent anyway is refused by done().
  return { profile };
}

export function decodeChargePointDefinition(body: unknown): ChargePointDefinition {
  const r = new ObjectReader(body, "body");
  const id = r.string("id");
  if (id === "") throw new InvalidInputError("body.id must not be empty");
  const definition: ChargePointDefinition = present({
    id,
    registration: r.optOneOf("registration", REGISTRATIONS),
    security: r.optObject("security", security),
    description: r.optString("description"),
  });
  r.done();
  return definition;
}

export function decodeChargePointUpdate(body: unknown): ChargePointUpdate {
  const r = new ObjectReader(body, "body");
  const description =
    r.has("description") && r.raw("description") === null ? null : r.optString("description");
  const update: ChargePointUpdate = present({
    registration: r.optOneOf("registration", REGISTRATIONS),
    security: r.optObject("security", security),
    description,
  });
  r.done();
  return update;
}

/** The read-back, rebuilt member by member so that nothing a driver adds -- a
 *  password above all -- reaches the client. */
export function encodeChargePointDetails(details: ChargePointDetails): Record<string, unknown> {
  return present({
    id: details.id,
    registration: details.registration,
    security: { profile: details.security.profile },
    description: details.description,
  });
}
