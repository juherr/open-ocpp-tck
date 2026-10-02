// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * charge-points.ts -- `CsmsChargePointAdmin` for SteVe, through the manager UI.
 *
 * SteVe has no REST controller for charge points (steve-community/steve#2068),
 * so this drives the pages an operator would: the list page to find a
 * station's internal `chargeBoxPk`, its details form to read and update it,
 * the add form to create it, the row's delete form to remove it. Every form
 * is read off its page and posted back whole -- html-form.ts says why a
 * partial one is not an option.
 *
 * SteVe answers a refused form with a 200 page rather than a status: a
 * validation list, or the exception its controller advice rendered. Those
 * become plain `Error`s carrying the page's error text, since the CSMS did
 * answer. Two of them are the contract's own errors instead: a duplicate id,
 * decided before anything is posted and again after a refused add (another
 * create may have won the race in between -- SteVe's duplicate page is a
 * constraint-violation trace, not a stable signal, so the list is asked), and
 * an update of an id it does not have. A POST bounced to sign-in is a
 * non-dispatch, not an acceptance (ui-client.ts). Every write is read back and compared with what it
 * set, because SteVe redirects the same way whether or not a row changed.
 *
 * THE PASSWORD IS OVERWRITTEN, NOT CLEARED. The contract says a security
 * update to profile 0 or 3 discards the stored Basic Auth password. SteVe
 * cannot do that from its UI: an empty `authPassword` means "leave it
 * unchanged" (ChargePointRepositoryImpl#updateChargePoint), and no page clears
 * the column. Under profiles 0 and 3 the handshake ignores it -- but an
 * operator who later switches the station back to profile 1 without typing a
 * password passes SteVe's validator BECAUSE a hash is stored, and the old
 * password authenticates again. Measured on the pinned image: downgraded with
 * an empty field, the old password got 101 after the switch back; downgraded
 * through this adapter, 401. So a downgrade posts a random password nobody
 * holds, which is "discarded" in the only sense that matters -- it no longer
 * authenticates the station.
 *
 * A CONNECTED STATION IS TOLD. After a security change commits, SteVe pushes
 * it to a connected station as `ChangeConfiguration` (`SecurityProfile`, and
 * `AuthorizationKey` for a new password), and reports a refusal on an error
 * page although the row has already changed -- so `update` throws with the
 * record changed. Measured: a station refusing the `SecurityProfile` of a
 * downgrade, as OCPP's security profiles tell it to, is sent nothing else.
 * Provisioning happens before a station connects, which is the case this
 * surface is for.
 */
import {
  ChargePointAlreadyExistsError,
  ChargePointNotFoundError,
  type ChargePointDetails,
  type ChargePointSecurity,
  type ChargePointSecurityProfile,
  type CsmsChargePointAdmin,
} from "../charge-points";
import { CsmsNotDispatchedError, UnsupportedOperationError } from "../contracts";
import {
  chargeBoxPkOf,
  chargePointFromForm,
  fillChargePointForm,
  STEVE_CHARGE_POINT_PAGES as PAGES,
  steveStoredDescription,
  type ChargePointFormChange,
} from "./forms";
import { readForm } from "./html-form";
import type { SteveUiOps } from "./ui-client";

/** Every profile SteVe's form offers. 2 and 3 need TLS on the OCPP endpoint,
 *  which is the deployment's concern; the record accepts them regardless. */
export const STEVE_CHARGE_POINT_PROFILES: ReadonlySet<ChargePointSecurityProfile> = new Set([0, 1, 2, 3]);

/**
 * A password nobody holds: 15 random bytes, base64url, so 20 characters --
 * the top of the 16-to-20 range SteVe's form validates.
 */
export function unknowablePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * The form's security fields. A profile without a password posts
 * `withoutPassword()`: nothing on a new row, which has none to discard, and a
 * password nobody holds on an existing one, which may.
 */
function steveSecurity(
  security: ChargePointSecurity,
  withoutPassword: () => string,
): NonNullable<ChargePointFormChange["security"]> {
  return {
    profile: security.profile,
    authPassword: "basicAuthPassword" in security ? security.basicAuthPassword : withoutPassword(),
  };
}

export function steveChargePoints(ui: SteveUiOps): CsmsChargePointAdmin {
  const refuseUndeclared = (method: string, profile: ChargePointSecurityProfile): void => {
    if (!STEVE_CHARGE_POINT_PROFILES.has(profile)) {
      throw new UnsupportedOperationError(`chargePoints.${method}`, `security profile ${profile} is not supported`);
    }
  };
  const pkOf = async (cpId: string): Promise<number | undefined> =>
    chargeBoxPkOf(await ui.page(PAGES.query(cpId)), cpId);
  const details = async (cpId: string, chargeBoxPk: number): Promise<ChargePointDetails> => {
    const form = readForm(await ui.page(PAGES.details(chargeBoxPk)), PAGES.updateAction);
    const read = form && chargePointFromForm(form);
    if (!read || read.id !== cpId) {
      throw new Error(`steve: the details page of ${cpId} (chargeBoxPk ${chargeBoxPk}) does not read as a charge point`);
    }
    return read;
  };
  const get = async (cpId: string): Promise<ChargePointDetails | null> => {
    const chargeBoxPk = await pkOf(cpId);
    return chargeBoxPk === undefined ? null : details(cpId, chargeBoxPk);
  };
  /**
   * SteVe redirects an update that matched no row exactly as it redirects one
   * that did, so a write is only done when the members it set read back.
   */
  const readBack = async (cpId: string, method: string, change: ChargePointFormChange, chargeBoxPk?: number): Promise<void> => {
    const read = chargeBoxPk === undefined ? await get(cpId) : await details(cpId, chargeBoxPk);
    if (read === null) {
      throw new Error(`steve: chargePoints.${method} of ${cpId} was accepted, but the station cannot be read back`);
    }
    const differs =
      (change.registration !== undefined && read.registration !== change.registration) ||
      (change.security !== undefined && read.security.profile !== change.security.profile) ||
      (change.description !== undefined && read.description !== steveStoredDescription(change.description));
    if (differs) {
      throw new Error(`steve: chargePoints.${method} of ${cpId} was accepted, but the station does not read back as written`);
    }
  };

  return {
    get,

    async create(definition) {
      // `security` omitted is profile 0, which needs no password and stores none.
      const security = definition.security ?? { profile: 0 };
      refuseUndeclared("create", security.profile);
      if ((await pkOf(definition.id)) !== undefined) throw new ChargePointAlreadyExistsError(definition.id);
      const change: ChargePointFormChange = {
        chargeBoxId: definition.id,
        registration: definition.registration ?? "Accepted",
        security: steveSecurity(security, () => ""),
        description: definition.description ?? null,
      };
      try {
        await ui.submitForm(PAGES.add, PAGES.addAction, { submitter: "add", fill: (fields) => fillChargePointForm(fields, change) });
      } catch (error) {
        // Refused, and the id exists now: another create won the race past
        // the check above. Asked of the list rather than of the refusal page,
        // whose duplicate is a constraint-violation trace.
        if (!(error instanceof CsmsNotDispatchedError) && (await pkOf(definition.id)) !== undefined) {
          throw new ChargePointAlreadyExistsError(definition.id);
        }
        throw error;
      }
      await readBack(definition.id, "create", change);
    },

    async update(cpId, patch) {
      if (patch.security) refuseUndeclared("update", patch.security.profile);
      const chargeBoxPk = await pkOf(cpId);
      if (chargeBoxPk === undefined) throw new ChargePointNotFoundError(cpId);
      const change: ChargePointFormChange = {
        registration: patch.registration,
        security: patch.security && steveSecurity(patch.security, unknowablePassword),
        description: patch.description,
      };
      if (Object.values(change).every((member) => member === undefined)) return;
      await ui.submitForm(PAGES.details(chargeBoxPk), PAGES.updateAction, {
        submitter: "update",
        fill: (fields) => fillChargePointForm(fields, change),
      });
      await readBack(cpId, "update", change, chargeBoxPk);
    },

    async delete(cpId) {
      const chargeBoxPk = await pkOf(cpId);
      if (chargeBoxPk === undefined) return;
      await ui.submitForm(PAGES.query(cpId), PAGES.deleteAction(chargeBoxPk));
      if ((await pkOf(cpId)) !== undefined) {
        throw new Error(`steve: chargePoints.delete of ${cpId} was accepted, but the station is still listed`);
      }
    },
  };
}
