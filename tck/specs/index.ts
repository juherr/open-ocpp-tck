/**
 * specs/index.ts -- re-exports the ported spec groups. main.ts builds its
 * own registry (GROUPS/ALL_SPECS/SPECS_BY_TEMPLATE_ID) directly from these
 * group modules; this file exists as the single public entry point for
 * the specs/ directory.
 *
 * AUTHORIZE_SPECS (issue #181's TC_023 Authorize-outcome scenarios) IS folded
 * into main.ts's "all" group, unlike upstream, so `run-all` is the whole
 * suite at 47 scenarios rather than 44 with a footnote. See the registry
 * comment in main.ts for why that divergence is worth carrying.
 */

export { CORE_SPECS } from "./core";
export { AUTHLIST_RESERVATION_SPECS } from "./authlist-reservation";
export { REMOTETRIGGER_SMARTCHARGING_SPECS } from "./remotetrigger-smartcharging";
export { FIRMWARE_SPECS } from "./firmware";
export { AUTHORIZE_SPECS } from "./authorize";
