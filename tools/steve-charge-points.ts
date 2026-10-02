// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * steve-charge-points.ts -- asks a live SteVe what the charge-point rows of
 * tests/csms-driver-charge-points.ts ask a fake one. **LIVE CSMS REQUIRED.**
 * Deliberately NOT part of `bun test`, of `tools/verify.sh` or of CI: it needs
 * a running SteVe, writes and deletes charge points, and opens OCPP
 * connections.
 *
 * WHY IT EXISTS, GIVEN THERE IS ALREADY AN OFFLINE GUARD. The guard drives
 * the SteVe adapter against tests/fixtures/fake-steve-manager.ts, and that
 * fake is a reading of the pinned image: refusals answered 200, an update that
 * overwrites every column, an empty password that changes nothing, a list
 * query that matches with LIKE. The guard is worth what that reading is
 * worth, so this is how it is re-checked whenever the SteVe pin in
 * `drivers/steve/compose.yaml` moves. It prints what it observed beside what
 * the fake assumes, and exits 1 on any difference.
 *
 * WHAT IT ASKS, in the order it asks it.
 *  1. The whole conformance check, on the real image.
 *  2. A station provisioned under profile 1 refuses a handshake without its
 *     password, and connects and boots with it.
 *  3. What a CONNECTED station sees of a downgrade: SteVe pushes
 *     ChangeConfiguration to it, and a station refusing it makes `update`
 *     throw with the row already changed -- which the adapter's header states.
 *  4. The password rule (#155), over the OCPP endpoint: after that downgrade
 *     through the adapter, an operator switching the station back to
 *     profile 1 without typing a password does NOT revive the old one (401).
 *  5. The control that makes 4 mean something: the same switch-back after a
 *     downgrade that posted an EMPTY password does revive it (101). If this
 *     one stops answering 101, SteVe changed the rule and the adapter's
 *     reason to overwrite should be re-read, not the other way round.
 *  6. An id SteVe's validator accepts that looks like markup (`LIVE&amp;155`)
 *     reads back, and the list renders it RAW -- which the fake models and
 *     the adapter's exact match depends on.
 *
 * Run it against a stack with unknown-station auto-registration OFF, so the
 * boot in 2 is the provisioning working and not SteVe registering a stranger:
 *
 *   TCK_SUFFIX=-cp STEVE_PORT=18255 docker compose -f drivers/steve/compose.yaml \
 *     -f drivers/steve/compose.no-autoregister.yaml up -d --wait
 *   STEVE_URL=http://127.0.0.1:18255/steve/manager \
 *   STEVE_WS_URL=ws://127.0.0.1:18255/steve/websocket/CentralSystemService \
 *     bun tools/steve-charge-points.ts --yes-isolated
 */
import { createSteveCsmsDriver } from "../packages/csms-driver/steve";
import { unknowablePassword } from "../packages/csms-driver/steve/charge-points";
import { chargeBoxPkOf, STEVE_CHARGE_POINT_PAGES } from "../packages/csms-driver/steve/forms";
import { SteveUiOps } from "../packages/csms-driver/steve/ui-client";
import { defaultSteveConfig } from "../drivers/steve/ui-client";
import { chargePointAdminViolations, clearConformanceStations } from "../tests/lib/charge-point-conformance";
import { handshakeStatus } from "./lib/ocpp-handshake";

const USAGE = `Usage: bun tools/steve-charge-points.ts --yes-isolated

  --yes-isolated  required. Asserts that STEVE_URL points at a stack nobody
                  else is using: this creates, rewrites and deletes charge
                  points and opens OCPP connections. Bring one up with a
                  distinct TCK_SUFFIX and STEVE_PORT -- workspaces on this
                  machine share one docker daemon. STEVE_WS_URL must be the
                  OCPP endpoint as reachable from THIS host.
`;

if (!process.argv.slice(2).includes("--yes-isolated")) {
  console.error(USAGE);
  process.exit(2);
}

const cfg = defaultSteveConfig(process.env);
const driver = createSteveCsmsDriver({ config: cfg });
const admin = driver.chargePoints;
if (!admin) throw new Error("the SteVe factory has no chargePoints surface");
const operator = new SteveUiOps(cfg);
const STATION = "LIVE-155";
/** An id the validator accepts that reads as markup: listed raw, escaped on its details page. */
const MARKUP_STATION = "LIVE&amp;155";

const mismatches: string[] = [];
function observe(what: string, observed: unknown, expected: unknown): void {
  const ok = observed === expected;
  console.log(`${ok ? "ok  " : "DIFF"} ${what}: ${String(observed)}${ok ? "" : ` (the fake assumes ${String(expected)})`}`);
  if (!ok) mismatches.push(what);
}

/** The status line SteVe answers an OCPP WebSocket upgrade with: 101, or why not. */
function handshake(cpId: string, basicAuthPassword?: string): Promise<number> {
  return handshakeStatus(cfg.wsBaseUrl, cpId, basicAuthPassword);
}

/**
 * An OCPP 1.6 station that boots and then answers every CALL SteVe sends it
 * with `answer`, recording the actions. Closed by the caller.
 */
async function station(cpId: string, basicAuthPassword: string, answer: object) {
  const calls: string[] = [];
  const ws = new WebSocket(`${cfg.wsBaseUrl}/${cpId}`, {
    protocols: ["ocpp1.6"],
    headers: { authorization: `Basic ${btoa(`${cpId}:${basicAuthPassword}`)}` },
  });
  const boot = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no BootNotification answer")), 10_000);
    ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as unknown[];
      if (frame[0] === 3 && frame[1] === "boot") {
        clearTimeout(timer);
        resolve(String((frame[2] as { status?: string }).status));
      } else if (frame[0] === 2) {
        calls.push(`${String(frame[2])} ${JSON.stringify(frame[3])}`);
        ws.send(JSON.stringify([3, frame[1], answer]));
      }
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")));
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("WebSocket refused")));
  });
  ws.send(JSON.stringify([2, "boot", "BootNotification", { chargePointVendor: "open-ocpp-tck", chargePointModel: "live-155" }]));
  return { status: await boot, calls, close: () => ws.close() };
}

/** What an operator does in the manager UI: open the details page, set the profile, leave the password empty. */
async function operatorSetsProfile(cpId: string, profile: string): Promise<void> {
  const pk = chargeBoxPkOf(await operator.page(STEVE_CHARGE_POINT_PAGES.query(cpId)), cpId);
  if (pk === undefined) throw new Error(`${cpId} is not listed`);
  await operator.submitForm(STEVE_CHARGE_POINT_PAGES.details(pk), STEVE_CHARGE_POINT_PAGES.updateAction, {
    submitter: "update",
    fill: (fields) => {
      fields.set("securityProfile", profile);
      fields.set("authPassword", "");
    },
  });
}

await clearConformanceStations(admin);
await admin.delete(STATION);
await admin.delete(MARKUP_STATION);

// 1. The conformance check.
const violations = await chargePointAdminViolations(driver);
observe("conformance violations", violations.length === 0 ? "none" : violations.join("; "), "none");

// 2. The provisioned station connects with its password, and only with it.
const original = unknowablePassword();
await admin.create({ id: STATION, security: { profile: 1, basicAuthPassword: original } });
observe("handshake without a password, profile 1", await handshake(STATION), 401);
const booted = await station(STATION, original, { status: "Accepted" });
observe("BootNotification of the provisioned station", booted.status, "Accepted");
booted.close();

// 3. A downgrade while the station is connected and refuses what it is told.
const connected = await station(STATION, original, { status: "Rejected" });
const outcome = await admin.update(STATION, { security: { profile: 0 } }).then(
  () => "resolved",
  (error: unknown) => `threw (${error instanceof Error ? error.message.slice(0, 160) : String(error)})`,
);
connected.close();
console.log(`     a connected station was sent: ${connected.calls.join(" | ") || "nothing"}`);
observe("update of a connected station that refuses", outcome.startsWith("threw"), true);
observe("the row after that refused update", (await admin.get(STATION))?.security.profile, 0);

// 4. The operator switches it back to profile 1 without typing a password.
await operatorSetsProfile(STATION, "Profile_1");
observe("old password after an adapter downgrade and an operator switch-back", await handshake(STATION, original), 401);

// 5. The control: an empty password on the downgrade keeps the old one.
const kept = unknowablePassword();
await admin.update(STATION, { security: { profile: 1, basicAuthPassword: kept } });
await operatorSetsProfile(STATION, "Profile_0");
await operatorSetsProfile(STATION, "Profile_1");
observe("control: old password after an EMPTY-password downgrade and a switch-back", await handshake(STATION, kept), 101);

await admin.delete(STATION);
observe("station after delete", await admin.get(STATION), null);

// 6. An id that looks like markup round-trips through the list and the details page.
await admin.create({ id: MARKUP_STATION, registration: "Pending" });
observe(`${MARKUP_STATION} read back`, (await admin.get(MARKUP_STATION))?.id, MARKUP_STATION);
const listed = await operator.page(STEVE_CHARGE_POINT_PAGES.query(MARKUP_STATION));
observe(`${MARKUP_STATION} as the list renders it`, listed.includes(`>${MARKUP_STATION}</a>`) ? "raw" : "escaped", "raw");
await admin.delete(MARKUP_STATION);
observe(`${MARKUP_STATION} after delete`, await admin.get(MARKUP_STATION), null);

if (mismatches.length > 0) {
  console.error(`\n${mismatches.length} observation(s) differ from what the offline guard's fake assumes.`);
  process.exit(1);
}
console.log("\nThe pinned SteVe behaves as tests/fixtures/fake-steve-manager.ts models it.");
