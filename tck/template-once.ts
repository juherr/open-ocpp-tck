/**
 * template-once.ts -- run one of the simulator's built-in scenario templates
 * exactly once, on a station that may reconnect before the scenario is over.
 *
 * THE RULE THIS WORKS AROUND. The pinned simulator auto-starts a loaded
 * scenario whose `start` node is `triggerOn: "connect"` -- every `cert16-*`
 * template is -- once the station reaches Available, and since 0.7.6
 * (shiv3/ocpp-cp-simulator#253) the arm is per CONNECTION: the socket closing
 * clears it, so a completed template runs again the moment the station comes
 * back. That is the right default for a long-lived simulator whose scenario
 * answers CSMS-initiated calls; for a certification runner it is a second
 * Authorize and a second transaction after a Reset(Hard), attributed to the
 * CSMS. TC_013 measured exactly that on 0.7.9.
 *
 * Upstream's documented way to run a template once is not to hand the
 * auto-start walker an enabled definition at all: a definition loaded with
 * `enabled: false` is skipped by the walker at every Available, and
 * `run_scenario` starts what it is told regardless of `enabled`. So this
 * module loads the template's instance, reads it back, replaces it disabled,
 * and leaves the start to an explicit `run_scenario` from the runner -- after
 * its boot gate and its settle, exactly where `run_scenario_template` used to
 * be sent.
 *
 * TWO FUNCTIONS BECAUSE THE TWO HALVES BELONG ON EITHER SIDE OF `connect`.
 * `loadScenarioTemplate` kicks the walker when the station is already
 * Available, so an enabled instance that exists for the four calls between
 * load and disabled re-load would run at load, before the runner has gated on
 * the BootNotification or settled. Before `connect` the station is
 * Unavailable and the walker is a no-op; tests/template-once.ts pins both the
 * property and that ordering.
 *
 * The seam is `SimProcess.call` and nothing else, so the guard can hand it a
 * station that models the walker instead of a container.
 */

/** The half of {@link import("./sim").SimProcess} these functions need. */
export interface SimCalls {
  call(command: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Loads `templateId`'s instance for `connector` DISABLED, and returns the
 * instance id `runLoadedTemplate` starts it by.
 *
 * MUST RUN BEFORE `connect` -- see the module header. Rejects with the CLI's
 * own words when the image does not ship the template, which turns a
 * scenario naming one into an ERROR row instead of a 20-second wait for a
 * `scenario_started` that was never coming.
 */
export async function loadTemplateOnce(
  sim: SimCalls,
  connector: number,
  templateId: string,
): Promise<string> {
  const loaded = (await sim.call("load_scenario_template", {
    connector,
    templateId,
  })) as { scenarioId?: unknown } | null;
  const scenarioId = loaded?.scenarioId;
  if (typeof scenarioId !== "string" || scenarioId === "") {
    throw new Error(
      `load_scenario_template answered without a scenario id for ${templateId}: ${JSON.stringify(loaded)}`,
    );
  }
  // The instance the image built -- id, templateId, nodes, edges, evSettings
  // -- which is the only place that definition exists outside the image.
  const definition = (await sim.call("get_scenario", {
    connector,
    scenarioId,
  })) as Record<string, unknown> | null;
  if (definition === null || typeof definition !== "object") {
    throw new Error(
      `get_scenario found nothing for ${scenarioId} on connector ${connector} right after loading it`,
    );
  }
  // Remove, then load the same definition with the one member changed:
  // `enabled: false` is what the auto-start walker skips. Same id, so the
  // instance the runner starts is the one the template minted.
  await sim.call("remove_scenario", { connector, scenarioId });
  await sim.call("load_scenario", {
    connector,
    scenario: { ...definition, enabled: false },
  });
  return scenarioId;
}

/** Starts the instance {@link loadTemplateOnce} loaded. `run_scenario` does
 *  not consult `enabled`, and answers before the scenario's first node runs
 *  -- the runner still waits on `scenario_started` for that. */
export async function runLoadedTemplate(
  sim: SimCalls,
  connector: number,
  scenarioId: string,
): Promise<void> {
  await sim.call("run_scenario", { connector, scenarioId });
}
