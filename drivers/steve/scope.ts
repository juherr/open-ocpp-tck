// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * scope.ts -- what SteVe can drive: everything.
 *
 * This table is not padding. It is the regression guard on the whole
 * generalization: the scenarios were WRITTEN against SteVe, so if making the
 * harness CSMS-neutral had dropped a capability, the loss would surface here
 * as a row that has to be demoted to NOT_APPLICABLE.
 * tests/ocpp-verify-scope-coverage.sh asserts that no row ever is, which turns
 * "the refactor kept everything working" from a claim into a check.
 *
 * A driver for a CSMS with a smaller API says so row by row, citing the
 * precise limitation -- see tck/scope.ts for the rules.
 */
import type { ScopeTable } from "../../tck/scope";

const REFERENCE_CSMS =
  "SteVe exposes the operation and the observation the scenario needs " +
  "(manager UI for operations, MariaDB for records).";

export const STEVE_SCOPE: ScopeTable = {
  "cert16-reservation-basic": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc001-cold-boot": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc003-charging-plugin-first": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc004-charging-id-first": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc005-ev-side-disconnect": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc010-remote-start": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc011-remote-start-stop": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc012-remote-stop": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc013-hard-reset": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc014-soft-reset": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc017-unlock-occupied": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc018-unlock-failure": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc019-get-configuration-all": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc019-get-configuration-key": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc021-change-configuration": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc023-1-authorize-invalid": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc023-2-authorize-expired": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc023-3-authorize-blocked": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc024-lock-failure": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc026-remote-start-rejected": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc028-remote-stop-rejected": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc031-unlock-unknown-connector": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc042-1-get-local-list-version-not-supported": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc042-2-get-local-list-version-empty": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc043-1-send-local-list-not-supported": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc043-3-send-local-list-failed": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc043-4-send-local-list-full": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc043-5-send-local-list-differential": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc044-1-firmware-update": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc044-2-firmware-download-failed": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc044-3-firmware-install-failed": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc045-1-get-diagnostics": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc048-1-reserve-now-faulted": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc048-2-reserve-now-occupied": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc048-3-reserve-now-unavailable": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc048-4-reserve-now-rejected": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc051-cancel-reservation": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc052-cancel-reservation-rejected": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc054-trigger-message": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc055-trigger-message-rejected": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc056-central-smart-charging-txdefault": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc057-central-smart-charging-txprofile": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc059-remote-start-with-profile": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc061-clear-cache": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc064-data-transfer": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc066-get-composite-schedule": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
  "cert16-tc067-clear-charging-profile": {
    status: "DRIVABLE",
    reason: REFERENCE_CSMS,
  },
};
