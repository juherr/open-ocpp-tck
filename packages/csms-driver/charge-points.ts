// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * Charge-point administration: registering a station with a CSMS before it
 * connects, and maintaining that registration.
 *
 * Administrative provisioning, not OCPP -- nothing here becomes a CALL, which
 * is why it is a surface of its own rather than an arm of the operation
 * vocabularies. The model is CSMS-neutral: it names what OCPP and its security
 * profiles define, and leaves every CSMS's own form fields to its driver.
 */

/** OCPP `RegistrationStatus`: what the CSMS answers to the station's BootNotification. */
export type ChargePointRegistration = "Accepted" | "Pending" | "Rejected";

/** The OCPP security profiles, 0 (none) to 3 (TLS with client certificate). */
export type ChargePointSecurityProfile = 0 | 1 | 2 | 3;

/**
 * How the station authenticates. Profiles 1 and 2 use HTTP Basic, so they
 * carry its password; 0 has none, and 3 authenticates by client certificate,
 * whose PKI is the CSMS's configuration rather than a station's record.
 */
export type ChargePointSecurity =
  | { readonly profile: 0 | 3 }
  | { readonly profile: 1 | 2; readonly basicAuthPassword: string };

export interface ChargePointDefinition {
  /** The OCPP identity the station connects with. Stable: it is the key. */
  readonly id: string;
  /** Omitted means `Accepted`. */
  readonly registration?: ChargePointRegistration;
  /** Omitted means profile 0. */
  readonly security?: ChargePointSecurity;
  readonly description?: string;
}

/** What `get` reads back. The Basic Auth password is write-only and never returned. */
export interface ChargePointDetails {
  readonly id: string;
  readonly registration: ChargePointRegistration;
  readonly security: { readonly profile: ChargePointSecurityProfile };
  readonly description?: string;
}

/**
 * A partial update: an omitted member is left unchanged. `security` replaces
 * the whole block, because the password belongs to the profile -- so a
 * `security` of profile 0 or 3 discards any stored Basic Auth password. A
 * `description` of `null` clears it.
 */
export interface ChargePointUpdate {
  readonly registration?: ChargePointRegistration;
  readonly security?: ChargePointSecurity;
  readonly description?: string | null;
}

/**
 * The optional administration surface of a `CsmsDriver`, present exactly when
 * `capabilities.chargePoints` is declared.
 *
 * | call     | missing id                                | existing id                                  |
 * |----------|-------------------------------------------|----------------------------------------------|
 * | `create` | creates                                   | throws {@link ChargePointAlreadyExistsError} |
 * | `get`    | `null`                                    | its details, never the password              |
 * | `update` | throws {@link ChargePointNotFoundError}   | changes only the members it names            |
 * | `delete` | resolves                                  | deletes                                      |
 *
 * A security profile outside `capabilities.chargePoints.securityProfiles` is
 * refused with `UnsupportedOperationError`, by `create` and by `update`.
 *
 * Idempotent provisioning is `get`, then `create` or `update`.
 */
// TRIED AND REJECTED, here because here is where it gets re-proposed: `create`
// as an upsert, or as a no-op when the station already matches. The password
// is write-only, so whether an existing station "matches" is undecidable --
// and an upsert silently rewrites a station someone else registered, turning a
// `Rejected` into an `Accepted`. `delete` of a missing id resolves because
// "absent afterwards" is unambiguous; "present as defined" is not.
export interface CsmsChargePointAdmin {
  create(definition: ChargePointDefinition): Promise<void>;
  get(cpId: string): Promise<ChargePointDetails | null>;
  update(cpId: string, patch: ChargePointUpdate): Promise<void>;
  delete(cpId: string): Promise<void>;
}

/** What a driver can administer, declared without creating a client. */
export interface CsmsChargePointCapabilities {
  /** The profiles `create` and `update` accept. Never empty. */
  readonly securityProfiles: ReadonlySet<ChargePointSecurityProfile>;
}

/** `create` was asked for an id the CSMS already has. Nothing was changed. */
export class ChargePointAlreadyExistsError extends Error {
  constructor(readonly cpId: string) {
    super(`charge point ${cpId} already exists`);
    this.name = "ChargePointAlreadyExistsError";
  }
}

/** `update` was asked for an id the CSMS does not have. Nothing was created. */
export class ChargePointNotFoundError extends Error {
  constructor(readonly cpId: string) {
    super(`charge point ${cpId} does not exist`);
    this.name = "ChargePointNotFoundError";
  }
}
