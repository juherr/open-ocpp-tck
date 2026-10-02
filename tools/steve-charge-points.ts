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
 * WHAT IT ASKS.
 *  1. The whole conformance check, on the real image.
 *  2. The password rule (#155), end to end over the OCPP endpoint: a station
 *     provisioned under profile 1 connects with its password and boots; after
 *     a downgrade through the adapter, an operator switching it back to
 *     profile 1 without typing a password does NOT revive the old one (401).
 *  3. The control that makes 2 mean something: the same switch-back after a
 *     downgrade that posted an EMPTY password does revive it (101). If this
 *     one stops answering 101, SteVe changed the rule and the adapter's
 *     reason to overwrite should be re-read, not the other way round.
 *  4. What a CONNECTED station sees of a downgrade: SteVe pushes
 *     ChangeConfiguration to it, and a station refusing it makes `update`
 *     throw with the row already changed -- which the adapter's header states.
 *
 * Run it against a stack with unknown-station auto-registration OFF, so the
 * boot in 2 is the provisioning working and not SteVe registering a stranger:
 *
 *   TCK_SUFFIX=-cp STEVE_PORT=18255 docker compose -f drivers/steve/compose.yaml \
 *     -f <override setting AUTO_REGISTER_UNKNOWN_STATIONS=false> up -d --wait
 *   STEVE_URL=http://127.0.0.1:18255/steve/manager \
 *   STEVE_WS_URL=ws://127.0.0.1:18255/steve/websocket/CentralSystemService \
 *     bun tools/steve-charge-points.ts --yes-isolated
 */
import { connect } from "node:net";
import { createSteveCsmsDriver } from "../packages/csms-driver/steve";
import { STEVE_CHARGE_POINT_PAGES } from "../packages/csms-driver/steve/forms";
import { SteveUiOps } from "../packages/csms-driver/steve/ui-client";
import { defaultSteveConfig } from "../drivers/steve/ui-client";
import { chargePointAdminViolations, CONFORMANCE_IDS } from "../tests/lib/charge-point-conformance";

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

const mismatches: string[] = [];
function observe(what: string, observed: unknown, expected: unknown): void {
  const ok = observed === expected;
  console.log(`${ok ? "ok  " : "DIFF"} ${what}: ${String(observed)}${ok ? "" : ` (the fake assumes ${String(expected)})`}`);
  if (!ok) mismatches.push(what);
}

function password(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(15))));
}

/** The status line SteVe answers an OCPP WebSocket upgrade with: 101, or why not. */
function handshake(cpId: string, basicAuthPassword?: string): Promise<number> {
  const url = new URL(`${cfg.wsBaseUrl}/${cpId}`);
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const auth = basicAuthPassword === undefined ? "" : `Authorization: Basic ${btoa(`${cpId}:${basicAuthPassword}`)}\r\n`;
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port || 80), url.hostname, () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Protocol: ocpp1.6\r\n${auth}\r\n`,
      );
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("handshake timed out")));
    socket.once("data", (chunk) => {
      resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(chunk.toString())?.[1] ?? 0));
      socket.destroy();
    });
    socket.once("error", reject);
  });
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
  const pk = /details\/(\d+)">/.exec(await operator.page(STEVE_CHARGE_POINT_PAGES.query(cpId)))?.[1];
  await operator.submitForm(STEVE_CHARGE_POINT_PAGES.details(Number(pk)), STEVE_CHARGE_POINT_PAGES.updateAction, "update", (fields) => {
    fields.set("securityProfile", profile);
    fields.set("authPassword", "");
  });
}

for (const id of [...CONFORMANCE_IDS, STATION]) await admin.delete(id);

// 1. The conformance check.
const violations = await chargePointAdminViolations(driver);
observe("conformance violations", violations.length === 0 ? "none" : violations.join("; "), "none");

// 2. The password rule, over the OCPP endpoint.
const original = password();
await admin.create({ id: STATION, security: { profile: 1, basicAuthPassword: original } });
observe("handshake without a password, profile 1", await handshake(STATION), 401);
const booted = await station(STATION, original, { status: "Accepted" });
observe("BootNotification of the provisioned station", booted.status, "Accepted");
booted.close();

// 4. A downgrade while the station is connected and refuses what it is told.
const connected = await station(STATION, original, { status: "Rejected" });
const outcome = await admin.update(STATION, { security: { profile: 0 } }).then(
  () => "resolved",
  (error: unknown) => `threw (${error instanceof Error ? error.message.slice(0, 160) : String(error)})`,
);
connected.close();
console.log(`     a connected station was sent: ${connected.calls.join(" | ") || "nothing"}`);
observe("update of a connected station that refuses", outcome.startsWith("threw"), true);
observe("the row after that refused update", (await admin.get(STATION))?.security.profile, 0);

await operatorSetsProfile(STATION, "Profile_1");
observe("old password after an adapter downgrade and an operator switch-back", await handshake(STATION, original), 401);

// 3. The control: an empty password on the downgrade keeps the old one.
const kept = password();
await admin.update(STATION, { security: { profile: 1, basicAuthPassword: kept } });
await operatorSetsProfile(STATION, "Profile_0");
await operatorSetsProfile(STATION, "Profile_1");
observe("control: old password after an EMPTY-password downgrade and a switch-back", await handshake(STATION, kept), 101);

await admin.delete(STATION);
observe("station after delete", await admin.get(STATION), null);

if (mismatches.length > 0) {
  console.error(`\n${mismatches.length} observation(s) differ from what the offline guard's fake assumes.`);
  process.exit(1);
}
console.log("\nThe pinned SteVe behaves as tests/fixtures/fake-steve-manager.ts models it.");
