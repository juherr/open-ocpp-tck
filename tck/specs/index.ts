/**
 * specs/index.ts -- re-exports the ported spec groups. main.ts builds its
 * own registry (GROUPS/ALL_SPECS/SPECS_BY_TEMPLATE_ID) directly from these
 * group modules; this file exists as the single public entry point for
 * the specs/ directory.
 *
 * AUTHORIZE_SPECS (issue #181's TC_023 Authorize-outcome scenarios) IS folded
 * into main.ts's "all" group, unlike upstream, so `run-all` is the whole
 * suite rather than most of it with a footnote. See the registry comment in
 * main.ts for why that divergence is worth carrying.
 *
 * CORE_201_SPECS has no upstream counterpart at all: it is the OCPP 2.0.1
 * slice, written here rather than ported, and it is in "all" for the reason
 * the same comment gives -- a group outside it under-declares coverage and
 * reports "no failures" for scenarios that never ran.
 */

export { CORE_SPECS } from "./core";
export { CORE_201_SPECS } from "./core-201";
export { AUTHLIST_RESERVATION_SPECS } from "./authlist-reservation";
export { REMOTETRIGGER_SMARTCHARGING_SPECS } from "./remotetrigger-smartcharging";
export { FIRMWARE_SPECS } from "./firmware";
export { AUTHORIZE_SPECS } from "./authorize";
