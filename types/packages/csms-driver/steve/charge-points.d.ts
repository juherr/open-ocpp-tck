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
 * answer. Two of them are the contract's own errors instead, decided before
 * anything is posted: a duplicate id (`get` first, because SteVe's duplicate
 * page is a constraint-violation trace, not a stable signal) and an update of
 * an id it does not have. Every write is read back and compared with what it
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
import { type ChargePointSecurityProfile, type CsmsChargePointAdmin } from "../charge-points";
import type { SteveUiOps } from "./ui-client";
/** Every profile SteVe's form offers. 2 and 3 need TLS on the OCPP endpoint,
 *  which is the deployment's concern; the record accepts them regardless. */
export declare const STEVE_CHARGE_POINT_PROFILES: ReadonlySet<ChargePointSecurityProfile>;
export declare function steveChargePoints(ui: SteveUiOps): CsmsChargePointAdmin;
