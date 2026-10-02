/**
 * sim-transport.ts -- where a simulator container dials, once a driver and
 * the operator have both had their say.
 *
 * A module of its own rather than a function of the runner's, because one
 * more caller starts a station outside a scenario: tools/steve-provisioned-reset.ts,
 * which has to dial the CSMS with the same precedence the runner applies.
 * Exporting it from tck/main.ts would have put it on the `./runner` subpath,
 * which is public API; this file is on no subpath.
 */
import type { CsmsEnv, SimTransportDefaults } from "./driver";
import type { SimConfig } from "./sim";

/**
 * Driver transport defaults under operator overrides.
 *
 * Precedence is explicit `SIM_*` environment > driver default > harness
 * default, and it is enforced by only filling a field the environment left
 * unset. An operator who exported SIM_WS_URL to chase a handshake problem must
 * not have it silently replaced by what the driver believes the URL should be.
 *
 * THE ORDERING ABOVE IS THIS FUNCTION'S, NOT ALL OF `SimConfig`'S. Exactly one
 * field has a fourth source that outranks the environment, and it is not one
 * this function sees: `ocppVersion`, which a SCENARIO may declare. The
 * exception is stated at the call site, where the scenario is in scope; the
 * rule here is unchanged for every field a driver contributes, which is what
 * this function is about. A field added here with a scenario-level opinion
 * belongs in both places or in neither.
 */
export function mergeSimTransport(
  base: SimConfig,
  fromDriver: SimTransportDefaults | undefined,
  env: CsmsEnv = process.env,
): SimConfig {
  if (!fromDriver) return base;
  const keep = <T>(envVar: string, driverValue: T | undefined, current: T): T =>
    env[envVar] ? current : (driverValue ?? current);
  return {
    ...base,
    wsUrl: keep("SIM_WS_URL", fromDriver.wsUrl, base.wsUrl),
    network: keep("SIM_NETWORK", fromDriver.network, base.network),
    appendCpIdToWsPath: keep(
      "SIM_WS_APPEND_CP_ID",
      fromDriver.appendCpIdToWsPath,
      base.appendCpIdToWsPath,
    ),
    basicAuthUser: keep(
      "SIM_WS_BASIC_USER",
      fromDriver.basicAuthUser,
      base.basicAuthUser,
    ),
    basicAuthPass: keep(
      "SIM_WS_BASIC_PASS",
      fromDriver.basicAuthPass,
      base.basicAuthPass,
    ),
  };
}
