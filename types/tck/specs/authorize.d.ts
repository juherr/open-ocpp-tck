/**
 * specs/authorize.ts -- TC_023 Authorize Outcome scenarios (issue #181's
 * local-start Authorize gate, default ON: every local transaction-start
 * node now sends Authorize.req and awaits Authorize.conf BEFORE
 * StartTransaction.req). These three specs exercise the three denial
 * outcomes (Invalid/Expired/Blocked); each asserts the CP sends Authorize
 * with the tag, receives the expected idTagInfo.status (uniqueId-paired,
 * not a log-window grep), does NOT send StartTransaction.req, and that no
 * transaction row lands in SteVe's DB for that tag -- pinning the #181
 * "denial is a logged skip, not an error" design decision end-to-end
 * against a real CSMS.
 *
 * Provisioning (02-provision.sh) sets each tag's SteVe state:
 *   - CERT023-INV: NOT present in ocpp_tag (deleted after the general
 *     auto-discovery insert) -- SteVe's AuthTagServiceLocal.decideStatus()
 *     returns INVALID when `ocppTagRepository.getRecord(idTag)` is null.
 *   - CERT023-EXP: ocpp_tag.expiry_date set in the past -- decideStatus()
 *     checks isExpired() (expiry_date < now) before ACCEPTED.
 *   - CERT023-BLK: ocpp_tag.max_active_transaction_count = 0 -- decideStatus()
 *     checks isBlocked() (max_active_transaction_count == 0) first, ahead of
 *     the expiry check.
 * (See scripts/steve-verify/02-provision.sh's "TC_023 Authorize outcome
 * tags" section for the exact SQL; verified directly against SteVe's
 * OcppTagService/AuthTagServiceLocal/OcppTagActivityRecordUtils source
 * inside the running steve-app-1 container.)
 */
import type { ScenarioSpec } from "../spec-types";
export declare const tc0231AuthorizeInvalidSpec: ScenarioSpec<void>;
export declare const tc0232AuthorizeExpiredSpec: ScenarioSpec<void>;
export declare const tc0233AuthorizeBlockedSpec: ScenarioSpec<void>;
export declare const AUTHORIZE_SPECS: ScenarioSpec<any>[];
