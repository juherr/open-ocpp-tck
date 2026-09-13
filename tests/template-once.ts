// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/template-once.ts -- a scenario template runs exactly once per
 * scenario, whatever the station's connection does in between.
 *
 * PROPERTY, in five parts:
 *   1. the sequence the runner used to send -- `run_scenario_template` once the
 *      station is Available -- runs the template TWICE on a station that
 *      reconnects mid-scenario. This is the control row: it pins that the fake
 *      below reproduces the pinned image's rule, so a green row 2 means the
 *      sequence is right and not that the model is vacuous;
 *   2. `loadTemplateOnce` before `connect`, then `runLoadedTemplate` after it,
 *      runs the template exactly once across a connect AND a reconnect -- and
 *      that one run is the explicit one, not an auto-start;
 *   3. the ORDER is what carries the property: `loadTemplateOnce` on a station
 *      that is already Available runs the template at load, before the runner
 *      has gated on the boot or settled. That is why main.ts calls it before
 *      `connect`, and why this row exists -- a refactor that moves the call
 *      after the boot gate reads as tidier and reintroduces the double run;
 *   4. a template the image does not ship is REFUSED by name at load, so a
 *      scenario naming one becomes an ERROR row rather than a 20-second wait
 *      for a `scenario_started` that was never going to come;
 *   5. `parseResponse` attributes a response line to the call that made it by
 *      its `id` and nothing else: an event, another call's response and a
 *      frame log line are all "not mine", and a refused call carries its
 *      error text.
 *
 * WHY. The pinned simulator re-arms a `triggerOn: "connect"` scenario on every
 * reconnect (shiv3/ocpp-cp-simulator#253, from 0.7.6): a completed template
 * runs again the moment the station comes back. Every `cert16-*` template is
 * connect-triggered, and TC_013 reboots the station by design, so on 0.7.9 it
 * re-authorised and opened a second transaction after the hard reset -- and the
 * DB check read the newest transaction, still open, as `stop_reason ''`.
 * Upstream's documented way out is what this module does: load the definition
 * with `enabled: false`, which the auto-start walker skips, and start it with an
 * explicit `run_scenario`, which does not consult `enabled`.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. What it pins is a SEQUENCE of
 * JSON Lines commands against a rule inside the simulator, and the rule's
 * failure mode is a second run that a sweep reports as a CSMS finding. From
 * the CLI that is one reconnecting scenario per row, against a live CSMS, to
 * observe something the runner is supposed to make not happen. So the two
 * functions take their `call` seam, and the fake here models the auto-start
 * engine of `src/cli/service.ts` at the pinned digest -- `enabled === false` is
 * skipped, the arm is per connection, `run_scenario` runs regardless. That
 * model is this guard's one assumption; row 1 is what keeps it honest, and the
 * next pin move is when to re-read it.
 *
 * Offline: no container, no CSMS, no file. Every command goes to the fake.
 */

import { parseResponse } from "../tck/sim";
import { loadTemplateOnce, runLoadedTemplate } from "../tck/template-once";

let failures = 0;

function fail(what: string, detail: string): void {
  failures++;
  process.stderr.write(`FAIL: ${what}\n  ${detail}\n`);
}

function pass(what: string): void {
  process.stderr.write(`ok: ${what}\n`);
}

// ---------------------------------------------------------------------------
// The fake: the pinned image's scenario engine, reduced to the rule at stake.
// ---------------------------------------------------------------------------

interface FakeDefinition {
  id: string;
  templateId?: string;
  name: string;
  targetType: string;
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
  edges: unknown[];
  enabled?: boolean;
}

const KNOWN_TEMPLATES = new Set(["cert16-tc013-hard-reset"]);

class FakeStation {
  connected = false;
  /** `Connector.lastAutoStartedScenarioKey`: set when the walker fires, cleared
   *  when the socket closes. */
  private armed: string | null = null;
  private readonly scenarios = new Map<string, FakeDefinition>();
  private readonly running = new Set<string>();
  /** Every run, in order, labelled by what started it. */
  readonly runs: string[] = [];

  /** The JSON Lines seam `loadTemplateOnce` / `runLoadedTemplate` drive. */
  async call(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    switch (command) {
      case "connect":
        this.connected = true;
        this.autoStart();
        return undefined;
      case "load_scenario_template": {
        const templateId = String(params.templateId);
        if (!KNOWN_TEMPLATES.has(templateId)) {
          throw new Error(`Unknown template: ${templateId}`);
        }
        const definition: FakeDefinition = {
          id: `${templateId}-CERTCP1-c${params.connector}-1789217240565-5kmx68`,
          templateId,
          name: "Cert 1.6 Core: TC_013 Hard Reset",
          targetType: "connector",
          nodes: [
            { id: "start-1", type: "start", data: { triggerOn: "connect" } },
          ],
          edges: [],
          enabled: true,
        };
        return this.load(definition);
      }
      case "get_scenario": {
        const definition = this.scenarios.get(String(params.scenarioId));
        return definition ? structuredClone(definition) : null;
      }
      case "remove_scenario": {
        const removed = this.scenarios.delete(String(params.scenarioId));
        return { removed };
      }
      case "load_scenario":
        return this.load(params.scenario as FakeDefinition);
      case "run_scenario":
        this.run(String(params.scenarioId), "explicit");
        return undefined;
      case "run_scenario_template": {
        // What the runner used to send: upstream's runScenarioTemplate is
        // loadScenarioTemplate followed by runScenario, and on an Available
        // station the load auto-starts first, so the explicit run is refused.
        const { scenarioId } = (await this.call("load_scenario_template", {
          connector: params.connector,
          templateId: params.templateId,
        })) as { scenarioId: string };
        this.run(scenarioId, "explicit");
        return undefined;
      }
      default:
        throw new Error(`fake station: unknown command ${command}`);
    }
  }

  /** The socket closing and reopening -- a reboot. `teardownAfterClose`
   *  clears the arm, and the next Available runs the walker again. */
  reconnect(): void {
    this.armed = null;
    this.autoStart();
  }

  private load(definition: FakeDefinition): { scenarioId: string } {
    // `assertLoadableScenario`'s gate, so a definition this module reshapes
    // wrongly is refused the way the image refuses it.
    for (const field of ["id", "name", "targetType", "nodes", "edges"]) {
      if (!(field in definition)) {
        throw new Error(`Invalid scenario: scenario is missing required field "${field}"`);
      }
    }
    this.scenarios.set(definition.id, definition);
    // `loadScenario` kicks the walker when the station is already Available.
    if (this.connected) this.autoStart();
    return { scenarioId: definition.id };
  }

  private run(scenarioId: string, by: string): void {
    if (!this.scenarios.has(scenarioId)) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }
    if (this.running.has(scenarioId)) {
      throw new Error(`Scenario ${scenarioId} is already running`);
    }
    this.running.add(scenarioId);
    this.runs.push(`${by}:${scenarioId}`);
  }

  /** `tryAutoStartForConnector(connectorId, "connect", null)`. */
  private autoStart(): void {
    if (!this.connected) return;
    for (const definition of this.scenarios.values()) {
      if (definition.enabled === false) {
        this.armed = null;
        continue;
      }
      const start = definition.nodes.find((node) => node.type === "start");
      const triggerOn = (start?.data?.triggerOn as string | undefined) ?? "connect";
      if (triggerOn !== "connect") continue;
      const key = `${definition.id}:connect`;
      if (this.armed === key) return;
      this.armed = key;
      // The real walker fires runScenario, which is where a run already in
      // flight is refused; a completed one is not, and that is the whole bug.
      this.running.delete(definition.id);
      this.run(definition.id, "auto");
      return;
    }
  }

  /** A scenario that ran to its end node. Called by the rows where the
   *  reconnect happens after completion, which is TC_013's shape. */
  complete(): void {
    this.running.clear();
  }
}

// ---------------------------------------------------------------------------
// 1. The control: the old sequence runs twice on a reconnecting station.
// ---------------------------------------------------------------------------

{
  const station = new FakeStation();
  await station.call("connect");
  try {
    await station.call("run_scenario_template", {
      connector: 1,
      templateId: "cert16-tc013-hard-reset",
    });
  } catch {
    // "already running" -- the response the runner used to ignore.
  }
  station.complete();
  station.reconnect();
  if (station.runs.length === 2 && station.runs.every((r) => r.startsWith("auto:"))) {
    pass("control: run_scenario_template after connect runs the template again on reconnect (the fake reproduces #253)");
  } else {
    fail(
      "control: run_scenario_template after connect runs the template again on reconnect",
      `expected two auto-starts, got ${JSON.stringify(station.runs)} -- the fake no longer models the rule, so nothing below is measuring it`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. loadTemplateOnce before connect + runLoadedTemplate after: exactly one run.
// ---------------------------------------------------------------------------

{
  const station = new FakeStation();
  const scenarioId = await loadTemplateOnce(station, 1, "cert16-tc013-hard-reset");
  await station.call("connect");
  const afterConnect = station.runs.length;
  // Caught rather than left to crash the guard: an instance that auto-started
  // at connect makes run_scenario answer "already running", and that refusal
  // IS the finding, named under this row.
  let refused: string | undefined;
  try {
    await runLoadedTemplate(station, 1, scenarioId);
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  station.complete();
  station.reconnect();
  const loaded = (await station.call("get_scenario", { connector: 1, scenarioId })) as FakeDefinition | null;
  if (afterConnect !== 0 || refused !== undefined) {
    fail(
      "no run before the runner asks for one",
      `connect alone started ${afterConnect} run(s): ${JSON.stringify(station.runs)}${refused ? `; run_scenario then refused: ${refused}` : ""}`,
    );
  } else if (station.runs.length !== 1 || station.runs[0] !== `explicit:${scenarioId}`) {
    fail("exactly one run across connect and reconnect, the explicit one", `got ${JSON.stringify(station.runs)}`);
  } else if (!loaded || loaded.enabled !== false || loaded.templateId !== "cert16-tc013-hard-reset") {
    fail("the loaded definition is the template's instance, disabled", `got ${JSON.stringify(loaded)}`);
  } else {
    pass("loadTemplateOnce before connect + runLoadedTemplate: one explicit run, none on reconnect, definition disabled");
  }
}

// ---------------------------------------------------------------------------
// 3. The order carries the property: loading on an Available station runs it.
// ---------------------------------------------------------------------------

{
  const station = new FakeStation();
  await station.call("connect");
  await loadTemplateOnce(station, 1, "cert16-tc013-hard-reset");
  if (station.runs.length >= 1 && station.runs[0].startsWith("auto:")) {
    pass("order: loadTemplateOnce on an Available station auto-starts at load -- which is why main.ts calls it before connect");
  } else {
    fail(
      "order: loadTemplateOnce on an Available station auto-starts at load",
      `expected an auto-start, got ${JSON.stringify(station.runs)} -- if the image stopped auto-starting at load, the pre-connect placement is no longer load-bearing and this row should say so`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. An unknown template is refused by name, at load.
// ---------------------------------------------------------------------------

{
  const station = new FakeStation();
  let refused: string | undefined;
  try {
    await loadTemplateOnce(station, 1, "cert16-tc999-no-such-case");
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  if (refused?.includes("cert16-tc999-no-such-case")) {
    pass("an unknown template is refused by name at load");
  } else {
    fail("an unknown template is refused by name at load", `got ${refused ?? "no rejection"}`);
  }
}

// ---------------------------------------------------------------------------
// 5. parseResponse attributes by id and nothing else.
// ---------------------------------------------------------------------------

{
  const rows: Array<[string, string, ReturnType<typeof parseResponse>]> = [
    ['{"id":"tck-1","ok":true,"data":{"scenarioId":"x"}}', "tck-1", { ok: true, data: { scenarioId: "x" } }],
    ['{"id":"tck-1","ok":true}', "tck-1", { ok: true, data: undefined }],
    ['{"id":"tck-1","ok":false,"error":"Unknown template: nope"}', "tck-1", { ok: false, error: "Unknown template: nope" }],
    ['{"id":"tck-2","ok":true}', "tck-1", undefined],
    ['{"id":null,"ok":true}', "tck-1", undefined],
    ['{"event":"scenario_started","data":{"id":"tck-1"},"timestamp":"t"}', "tck-1", undefined],
    ['[2026-09-12T12:47:16.553Z] [INFO] [WebSocket] Sent: [2,"tck-1","Heartbeat",{}]', "tck-1", undefined],
    ["not json at all", "tck-1", undefined],
  ];
  let wrong = 0;
  for (const [line, id, expected] of rows) {
    const got = parseResponse(line, id);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      wrong++;
      fail("parseResponse attributes by id", `line ${line} for ${id}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
  }
  if (wrong === 0) pass(`parseResponse attributes by id and nothing else (${rows.length} lines)`);
}

if (failures > 0) {
  process.stderr.write(`\n${failures} failure(s)\n`);
  process.exit(1);
}
process.stderr.write("template once: OK\n");
