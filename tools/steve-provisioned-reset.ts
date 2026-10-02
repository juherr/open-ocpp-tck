// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * steve-provisioned-reset.ts -- the vertical flow the csms-driver library
 * exists for (#153), against a live SteVe: a charge point is provisioned
 * through the driver BEFORE the simulator connects, and a remote operation
 * then reaches it through SteVe. **LIVE CSMS REQUIRED.** Not part of
 * `bun test` or `tools/verify.sh`; CI runs it in its own `provisioning` job,
 * on a stack of its own.
 *
 * WHY THE STACK MATTERS MORE THAN THE STEPS. drivers/steve/compose.yaml lets
 * SteVe register any station that connects, so on that stack every step below
 * goes green with the provisioning deleted. This runs against
 * drivers/steve/compose.no-autoregister.yaml, and it checks that it is: a
 * station nothing provisioned must be refused before anything else is asked.
 * That control is the red half of the test, kept in every run rather than in
 * a commit message -- it is what fails when the stack falls back to
 * auto-registration, and the `get` before the simulator starts is what fails
 * when the provisioning is removed.
 *
 * WHAT IT ASKS, one phase per half that can break. A failure prints
 * `FAIL [<phase>]` and exits 1, so the line names which half it was:
 *  environment       an unprovisioned id is refused at the WebSocket
 *                    handshake, and SteVe holds no row for it afterwards.
 *  provisioning      the target is absent, `chargePoints.create` registers it
 *                    Accepted, `chargePoints.get` reads it back, and the
 *                    endpoint that refused the control lets it in -- all
 *                    before the simulator exists.
 *  connection/boot   the simulator container, started as the runner starts
 *                    one, connects under that id and its BootNotification is
 *                    answered Accepted.
 *  remote operation  `operations16.execute` dispatches Reset(Soft) through
 *                    SteVe, the station receives that CALL, and the station's
 *                    own CALLRESULT answers it Accepted. Soft, because the
 *                    pinned simulator answers a Hard reset with no CALLRESULT
 *                    at all (tck/specs/core.ts, TC_013).
 *
 * The evidence is the station's wire, never the driver's word:
 * `operations16.execute` resolves once SteVe accepts the form, which says
 * nothing about the station (packages/csms-driver/contracts.ts).
 *
 * Bring up an isolated stack -- workspaces on one machine share one docker
 * daemon. STEVE_WS_URL is the OCPP endpoint as reachable from THIS host, for
 * the control handshake; SIM_WS_URL and STEVE_NETWORK are the endpoint and
 * network the simulator container dials it on:
 *
 *   TCK_SUFFIX=-p157 STEVE_PORT=18257 docker compose -f drivers/steve/compose.yaml \
 *     -f drivers/steve/compose.no-autoregister.yaml up -d --wait
 *   STEVE_URL=http://127.0.0.1:18257/steve/manager \
 *   STEVE_WS_URL=ws://127.0.0.1:18257/steve/websocket/CentralSystemService \
 *   SIM_WS_URL=ws://steve:8180/steve/websocket/CentralSystemService/ \
 *   STEVE_NETWORK=steve-p157_steve-internal \
 *     bun tools/steve-provisioned-reset.ts --yes-isolated
 */
import { csmsDriver } from "../drivers/steve/index";
import { defaultSteveConfig } from "../drivers/steve/ui-client";
import { settleBoot } from "../tck/boot-quiet";
import { mergeSimTransport } from "../tck/sim-transport";
import { findCall, findResponseFor, parseLog, type Frame } from "../tck/ocpp";
import { defaultSimConfig, startSim, type SimProcess } from "../tck/sim";
import { sleep } from "../tck/util";
import { handshakeStatus } from "./lib/ocpp-handshake";

const USAGE = `Usage: bun tools/steve-provisioned-reset.ts --yes-isolated

  --yes-isolated  required. Asserts that STEVE_URL points at a stack nobody
                  else is using, brought up with
                  drivers/steve/compose.no-autoregister.yaml: this creates and
                  deletes charge points and starts a simulator container.
                  STEVE_WS_URL must be the OCPP endpoint as reachable from
                  THIS host; SIM_WS_URL and STEVE_NETWORK as reachable from
                  the simulator container.
`;

if (!process.argv.slice(2).includes("--yes-isolated")) {
  console.error(USAGE);
  process.exit(2);
}

type Phase = "environment" | "provisioning" | "connection/boot" | "remote operation";

class PhaseFailure extends Error {}

const TARGET = "E2E-PROVISIONED";
/** Random, so a row an earlier run's auto-registering stack left behind cannot answer for this one. */
const CONTROL = `E2E-UNPROVISIONED-${crypto.randomUUID().slice(0, 8)}`;
const SIM_TEMPLATE = "provisioned-reset";

const env = process.env;
const steve = defaultSteveConfig(env);
const parts = await csmsDriver.create(env);
const admin = parts.chargePoints;
if (!admin) throw new Error("the SteVe driver has no chargePoints surface");

let phase: Phase = "environment";
let sim: SimProcess | undefined;

function ok(evidence: string): void {
  console.log(`ok   [${phase}] ${evidence}`);
}

function fail(message: string): never {
  throw new PhaseFailure(message);
}

function frames(): Frame[] {
  return parseLog(sim?.lines.join("\n") ?? "");
}

/** The simulator's last lines, for a failure that happened on its wire. */
function simTail(): string {
  const tail = sim?.lines.slice(-8) ?? [];
  return tail.length === 0 ? "" : `\n  last simulator lines:\n    ${tail.join("\n    ")}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let exitCode = 0;
try {
  // -- environment ----------------------------------------------------------
  const status = await handshakeStatus(steve.wsBaseUrl, CONTROL);
  if (status === 101) {
    fail(
      `SteVe accepted the WebSocket of ${CONTROL}, which nothing provisioned (HTTP 101): ` +
        "this stack registers unknown stations, so a boot below would prove nothing about provisioning. " +
        "Bring it up with -f drivers/steve/compose.no-autoregister.yaml.",
    );
  }
  ok(`${CONTROL}, never provisioned, is refused at the handshake (HTTP ${status})`);
  if ((await admin.get(CONTROL)) !== null) fail(`SteVe holds a row for ${CONTROL} after refusing it`);
  ok(`SteVe holds no row for ${CONTROL}`);

  // -- provisioning ---------------------------------------------------------
  phase = "provisioning";
  await admin.delete(TARGET);
  if ((await admin.get(TARGET)) !== null) fail(`${TARGET} is still present after delete`);
  ok(`${TARGET} is absent`);
  await admin.create({ id: TARGET, registration: "Accepted", description: "tools/steve-provisioned-reset.ts" });
  const row = await admin.get(TARGET);
  if (row === null) {
    fail(`${TARGET} is absent before the simulator starts: nothing provisioned it, and this stack will refuse it`);
  }
  if (row.registration !== "Accepted") fail(`${TARGET} reads back registration ${row.registration}, not Accepted`);
  ok(`${TARGET} is provisioned, registration Accepted, before the simulator starts`);
  // The control's refusal means something only if the same URL lets a known
  // station in: a mistyped STEVE_WS_URL answers 404 for every id, and on an
  // auto-registering stack would pass the control for the wrong reason.
  const known = await handshakeStatus(steve.wsBaseUrl, TARGET);
  if (known !== 101) {
    fail(`${steve.wsBaseUrl} refuses the provisioned ${TARGET} too (HTTP ${known}), so refusing ${CONTROL} proved nothing`);
  }
  ok(`the same endpoint lets the provisioned ${TARGET} in (HTTP 101)`);

  // -- connection/boot ------------------------------------------------------
  phase = "connection/boot";
  const simCfg = mergeSimTransport(defaultSimConfig(env), await parts.simTransport?.(TARGET), env);
  sim = await startSim(TARGET, SIM_TEMPLATE, simCfg);
  await sim.send({ command: "connect" });
  const settled = await settleBoot(sim, {
    bootGateMs: 30_000,
    bootWaitMs: 1_000,
    quietTimeoutMs: 30_000,
    staleAfterMs: 25_000,
    hardCapMs: 60_000,
    sleep,
    onBootGateTimeout: () => {},
  });
  const bootWire = frames();
  const boot = findCall(bootWire, "sent", "BootNotification");
  const bootAnswer = boot && findResponseFor(bootWire, boot);
  const bootStatus = bootAnswer?.kind === "callresult" ? (bootAnswer.payload as { status?: unknown }).status : undefined;
  if (!settled.bootAccepted || bootStatus !== "Accepted") {
    fail(`${TARGET} did not see its BootNotification answered Accepted within 30s${simTail()}`);
  }
  ok(`${TARGET} sent BootNotification and SteVe answered it Accepted`);
  if (settled.kind === "unsettled") fail(`SteVe left the station's boot-time CALLs unanswered${simTail()}`);

  // -- remote operation -----------------------------------------------------
  phase = "remote operation";
  const from = sim.lines.length;
  const receipt = await parts.operations16
    .execute(TARGET, { action: "Reset", type: "Soft" })
    .catch((error: unknown) =>
      fail(`SteVe did not dispatch Reset(Soft): ${error instanceof Error ? error.message : String(error)}`),
    );
  ok(`SteVe accepted Reset(Soft) for dispatch (${receipt})`);
  await sim.waitForLine(/Received: \[2,"[^"]*","Reset"/, 30_000, from).catch(() => {
    fail(`no Reset CALL reached ${TARGET} within 30s of SteVe accepting it${simTail()}`);
  });
  const reset = findCall(frames(), "received", "Reset");
  if (reset === undefined) fail(`a Reset line arrived that does not parse as a CALL${simTail()}`);
  const type = (reset.payload as { type?: unknown }).type;
  if (type !== "Soft") fail(`${TARGET} received Reset with type ${JSON.stringify(type)}, not "Soft"`);
  ok(`${TARGET} received Reset(Soft) from SteVe (uniqueId ${reset.uniqueId})`);
  await sim
    .waitForLine(new RegExp(`Sent: \\[[34],"${escapeRegExp(reset.uniqueId)}"`), 10_000)
    .catch(() => fail(`${TARGET} sent no answer to Reset ${reset.uniqueId} within 10s${simTail()}`));
  // findResponseFor locates the CALL by identity, so both come from one parse.
  const wire = frames();
  const call = findCall(wire, "received", "Reset");
  const answer = call && findResponseFor(wire, call);
  if (answer === undefined) fail(`no response correlates with Reset ${reset.uniqueId}${simTail()}`);
  if (answer.kind !== "callresult") fail(`${TARGET} answered Reset with a CALLERROR: ${answer.raw}`);
  const answered = (answer.payload as { status?: unknown }).status;
  if (answered !== "Accepted") fail(`${TARGET} answered Reset ${JSON.stringify(answered)}, not "Accepted"`);
  ok(`${TARGET} answered Reset ${reset.uniqueId} with CALLRESULT Accepted`);

  console.log(`\nProvisioned before boot, booted Accepted, and Reset went through SteVe to the station.`);
} catch (error) {
  exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL [${phase}] ${error instanceof PhaseFailure ? "" : "unexpected error: "}${message}`);
} finally {
  await sim?.stop();
  for (const cpId of [TARGET, CONTROL]) {
    await admin.delete(cpId).catch((error: unknown) => {
      console.error(`WARN: could not delete ${cpId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
process.exit(exitCode);
