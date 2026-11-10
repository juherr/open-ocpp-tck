// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * provision.ts -- the fixtures every scenario assumes, put in place over the
 * admin API, read back, and removed.
 *
 * TWO KINDS OF FIXTURE, and they differ in who may create them:
 *
 *  - STATIONS. This server refuses the WebSocket handshake of a station it has
 *    not registered (HTTP 401), so a charge point the simulator starts must
 *    exist first, and must be on security profile 0 to connect without a
 *    password -- which also needs the server started with
 *    OCPP_ALLOW_UNAUTHENTICATED=true, as compose.yaml does. `provision`
 *    registers EVSL_STATIONS; the prepare hook registers any other station it
 *    is handed, through the same idempotent {@link ensureStation}, because a
 *    sweep's roster is the runner's to choose and this is the one place the
 *    contract hands a driver a charge point id.
 *  - TAGS. Seeded through `POST /api/v1/tokens`, which is an upsert keyed by
 *    `uid` and needs no user: Accepted for the valid set, a past `expiresAt`
 *    for Expired, `enabled: false` for Blocked, and absent for Invalid
 *    (OcppService#permit and #authorize).
 *
 * The tag list is the same set the other bundled provisioners seed, and it
 * is kept HERE, as literals in this file, because
 * `tools/extract-fixture-tags.sh --diff` reads every `drivers/<id>/provision.ts`
 * for exactly those literals and compares them with the simulator image.
 */
import { EXPIRED_FIXTURE_BACKDATE_MINUTES, inMinutes } from "../../tck/time";
import { EvslApi } from "./api-client";
import { defaultEvslConfig, type EvslConfig } from "./config";

/**
 * Tags that must exist and authorize normally. Most are sent by the CHARGE
 * POINT from the simulator's own templates, not named anywhere in tck/specs/;
 * re-extract them with `bash tools/extract-fixture-tags.sh` when the image pin
 * in tck/sim.ts moves. The last two are supplied BY the CSMS -- in
 * RemoteStartTransaction, ReserveNow and SendLocalList.
 */
const VALID_TAGS = [
  "CERT003",
  "CERT004",
  "CERT005",
  "CERT010",
  "CERT011",
  "CERT012",
  "CERT013",
  "CERT014",
  "CERT017",
  "CERT018",
  "CERT028",
  "CERT056",
  "CERT057",
  "CERT059",
  "CERT-RES01",
  "CERT-TAG-1",
  "CERT-TAG-2",
] as const;

/** Absent: the server answers Invalid for an unknown tag. */
const INVALID_TAG = "CERT023-INV";
/** Present with `expiresAt` in the past: Expired. */
const EXPIRED_TAG = "CERT023-EXP";
/** Present with `enabled: false`: Blocked. */
const BLOCKED_TAG = "CERT023-BLK";

const ALL_TAGS = [...VALID_TAGS, EXPIRED_TAG, BLOCKED_TAG, INVALID_TAG];

/** StationResponse, narrowed (snake_case on the wire). */
interface StationRow {
  id: string;
  enabled: boolean;
  security_profile: number;
}

/** ChargingTokenResponse, narrowed. */
interface TokenRow {
  uid: string;
  enabled: boolean;
  expires_at: string | null;
}

function stationPath(cpId: string): string {
  return `/api/v1/stations/${encodeURIComponent(cpId)}`;
}

/**
 * Registers one station on security profile 0, or leaves it as it is when it
 * already is. Idempotent, and safe for two lanes racing on one id: a 409 from
 * the create means the other one won.
 *
 * `sendToStation: false` on the profile change, although lowering 1 -> 0
 * queues nothing today (StationSecurityService#changeProfile only queues a
 * ChangeConfiguration when RAISING): a command queued here would reach the
 * station unprompted the moment it connects, in the middle of a scenario.
 */
export async function ensureStation(api: EvslApi, cpId: string): Promise<void> {
  let station = await api.get<StationRow>(stationPath(cpId), [404]);
  if (!station) {
    await api.request("POST", "/api/v1/stations", { id: cpId, name: cpId }, [409]);
    station = await api.get<StationRow>(stationPath(cpId));
  }
  if (station?.security_profile !== 0) {
    await api.request("PUT", `${stationPath(cpId)}/security`, {
      securityProfile: 0,
      sendToStation: false,
    });
  }
}

class Provisioner {
  constructor(
    private readonly cfg: EvslConfig,
    private readonly api: EvslApi,
  ) {}

  async provision(): Promise<void> {
    for (const cpId of this.cfg.stations) {
      await ensureStation(this.api, cpId);
    }
    for (const uid of VALID_TAGS) {
      await this.api.request("POST", "/api/v1/tokens", { uid, enabled: true });
    }
    await this.api.request("POST", "/api/v1/tokens", {
      uid: EXPIRED_TAG,
      enabled: true,
      expiresAt: inMinutes(-EXPIRED_FIXTURE_BACKDATE_MINUTES).toISOString(),
    });
    await this.api.request("POST", "/api/v1/tokens", { uid: BLOCKED_TAG, enabled: false });
    await this.api.request("DELETE", `/api/v1/tokens/${INVALID_TAG}`, undefined, [404]);
  }

  /** Every way the environment differs from what the scenarios assume. */
  async verify(): Promise<string[]> {
    const problems: string[] = [];
    for (const cpId of this.cfg.stations) {
      const station = await this.api.get<StationRow>(stationPath(cpId), [404]);
      if (!station) {
        problems.push(`station ${cpId} is not registered`);
      } else if (!station.enabled || station.security_profile !== 0) {
        problems.push(
          `station ${cpId} is enabled=${station.enabled} on security profile ` +
            `${station.security_profile}; the simulator needs enabled on profile 0`,
        );
      }
    }

    const page = await this.api.get<{ items: TokenRow[] }>("/api/v1/tokens?search=CERT&limit=500");
    const tokens = new Map((page?.items ?? []).map((row) => [row.uid, row]));
    const now = Date.now();
    for (const uid of VALID_TAGS) {
      const row = tokens.get(uid);
      if (!row) problems.push(`tag ${uid} is missing`);
      else if (!row.enabled) problems.push(`tag ${uid} is disabled`);
      else if (row.expires_at && Date.parse(row.expires_at) <= now) {
        problems.push(`tag ${uid} has expired`);
      }
    }
    const expired = tokens.get(EXPIRED_TAG);
    if (!expired?.enabled || !expired.expires_at || Date.parse(expired.expires_at) > now) {
      problems.push(`tag ${EXPIRED_TAG} must be enabled with expiresAt in the past`);
    }
    const blocked = tokens.get(BLOCKED_TAG);
    if (!blocked || blocked.enabled) {
      problems.push(`tag ${BLOCKED_TAG} must exist with enabled=false`);
    }
    if (tokens.has(INVALID_TAG)) {
      problems.push(`tag ${INVALID_TAG} must be absent`);
    }
    return problems;
  }

  /**
   * Removes the tags and the stations. A 409 is the server refusing because a
   * transaction is still open on the tag or the station; it is reported, not
   * forced, since forcing it would mean closing a session nobody asked to close.
   */
  async teardown(): Promise<string[]> {
    const problems: string[] = [];
    for (const uid of ALL_TAGS) {
      const res = await this.api.request("DELETE", `/api/v1/tokens/${uid}`, undefined, [404, 409]);
      if (res.status === 409) problems.push(`tag ${uid} is held by an open transaction`);
    }
    for (const cpId of this.cfg.stations) {
      const res = await this.api.request("DELETE", stationPath(cpId), undefined, [404, 409]);
      if (res.status === 409) problems.push(`station ${cpId} has an open transaction`);
    }
    return problems;
  }
}

function newProvisioner(): Provisioner {
  const cfg = defaultEvslConfig(process.env);
  return new Provisioner(cfg, new EvslApi(cfg));
}

async function runVerb(
  label: string,
  fn: () => Promise<string[]>,
  onClean: string,
  onProblems: string,
): Promise<number> {
  let problems: string[];
  try {
    problems = await fn();
  } catch (err) {
    process.stderr.write(`${label} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (problems.length > 0) {
    process.stderr.write(`${onProblems}:\n  ${problems.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write(`${onClean}\n`);
  return 0;
}

/** `ocpp-tck driver provision` */
export async function provisionCommand(): Promise<number> {
  const provisioner = newProvisioner();
  return runVerb(
    "provision",
    async () => {
      await provisioner.provision();
      return provisioner.verify();
    },
    "provisioned",
    "provision ran but the environment is still wrong",
  );
}

/** `ocpp-tck driver verify` */
export async function verifyCommand(): Promise<number> {
  return runVerb(
    "verify",
    () => newProvisioner().verify(),
    "environment matches what the scenarios assume",
    "not provisioned",
  );
}

/** `ocpp-tck driver teardown` */
export async function teardownCommand(): Promise<number> {
  return runVerb(
    "teardown",
    () => newProvisioner().teardown(),
    "torn down",
    "teardown left problems",
  );
}
