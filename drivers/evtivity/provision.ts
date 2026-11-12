// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * provision.ts -- the fixtures every scenario assumes, put in place over the
 * REST API, read back, and removed.
 *
 * THREE KINDS OF FIXTURE:
 *
 *  - STATIONS. Registered as `POST /v1/stations {stationId, ocppProtocol:
 *    "ocpp1.6", securityProfile: 0}`. With `ocpp.registrationPolicy` open
 *    (compose.yaml seeds it) a station starts `pending` and is accepted at its
 *    first BootNotification. `provision` registers EVTIVITY_STATIONS; the
 *    prepare hook registers any other station it is handed, through the same
 *    idempotent {@link ensureStation}. `DELETE /v1/stations/{sta}` does not
 *    delete: it BLOCKS the station, whose next boot is then Rejected, so
 *    ensureStation unblocks one it finds blocked.
 *  - ONE DRIVER ACCOUNT. EVtivity stops a transaction whose token has no
 *    driver 31 ms after StartTransaction.conf, with a RemoteStopTransaction of
 *    its own ("Anonymous session … stopping", packages/ocpp/src/server/
 *    session-lifecycle/payment-gate.ts) -- an Authorize.conf Accepted
 *    notwithstanding. So every valid tag is bound to one driver this file
 *    owns, found by its e-mail. `DELETE /v1/drivers/{id}` is a soft delete
 *    that also deactivates the driver's tokens, so provision reactivates both.
 *  - TAGS. `POST /v1/tokens`, then `PATCH` to the wanted state: active and
 *    bound for the valid set, `expiresAt` in the past for Expired, `isActive:
 *    false` for Blocked, and absent for Invalid (packages/ocpp/src/
 *    authorization/authorize-token.ts, isExpired / isBlocked).
 *
 * The tag list is the same set the other bundled provisioners seed, and it
 * is kept HERE, as literals in this file, because
 * `tools/extract-fixture-tags.sh --diff` reads every `drivers/<id>/provision.ts`
 * for exactly those literals and compares them with the simulator image.
 *
 * `verify` also reads the four settings compose.yaml seeds, because each one
 * is a precondition a sweep cannot see fail: README.md, "Settings".
 */
import { EXPIRED_FIXTURE_BACKDATE_MINUTES, inMinutes } from "../../tck/time";
import { CsmsNotDispatchedError } from "../../tck/driver";
import { waitForCondition, WaitTimeoutError } from "../../tck/wait";
import { EvtivityApi, findInPages, parseJson, preview } from "./api-client";
import { defaultEvtivityConfig, type EvtivityConfig } from "./config";

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
/** Present with `isActive: false`: Blocked. */
const BLOCKED_TAG = "CERT023-BLK";

const ALL_TAGS = [...VALID_TAGS, EXPIRED_TAG, BLOCKED_TAG, INVALID_TAG];

/** 1.6 carries no token type; this is the one step 0 ran transactions with. */
const TOKEN_TYPE = "ISO14443";

/** The driver every valid tag is bound to, identified by this e-mail. */
const DRIVER = {
  firstName: "open-ocpp-tck",
  lastName: "fixtures",
  email: "fixtures@open-ocpp-tck.example",
} as const;

/** The settings compose.yaml seeds, and the value each must hold. */
export const REQUIRED_SETTINGS: Readonly<Record<string, unknown>> = {
  "ocpp.registrationPolicy": "open",
  "ocpp.offlineCommandTtlHours": 0,
  "stationMessage.enabled": false,
  "ocpp.clockAlignedInterval": 0,
};

interface StationRow {
  id: string;
  stationId: string;
  onboardingStatus: string;
  securityProfile: number;
  ocppProtocol: string | null;
}

interface TokenRow {
  id: string;
  idToken: string;
  driverId: string | null;
  isActive: boolean;
  expiresAt: string | null;
}

interface DriverRow {
  id: string;
  email: string | null;
  isActive: boolean;
}

async function findStation(api: EvtivityApi, cpId: string): Promise<StationRow | undefined> {
  // `search` is a case-insensitive substring match.
  return findInPages<StationRow>(api, "/v1/stations", { search: cpId }, (row) => row.stationId === cpId);
}

/** What {@link endLeftoverSessions} needs besides the sessions to end. */
export interface EndLeftoverOptions {
  /** The station's still-active sessions, read past the response cache
   *  (records.ts `openSessions`). */
  stillOpen: () => Promise<readonly string[]>;
  warn?: (line: string) => void;
  timeoutMs?: number;
  intervalMs?: number;
}

/** How long an accepted end may take: the publish path is milliseconds, the
 *  sweep that backs it a minute, which a prepare hook does not wait for. */
const END_WAIT_MS = 10_000;
const END_POLL_MS = 250;

/**
 * Ends the sessions an interrupted run left active on a station, without the
 * station: `POST /v1/sessions/{ses}/end`. EVtivity answers the next Authorize
 * or StartTransaction of that tag ConcurrentTx while one is (authorize-token.ts).
 *
 * Two 409s, which are not alike (packages/api/src/routes/sessions.ts):
 *  - SESSION_NOT_ACTIVE: it ended since it was listed, which a station
 *    ending it on its own can do at any moment -- expected, and quiet;
 *  - STATION_ONLINE: the route refuses while the station is connected, so the
 *    session stays active and the scenario about to run will meet
 *    ConcurrentTx. Not an error the hook can fix -- the station connected is
 *    another process's -- but one the run must name, so it warns with the
 *    station and the session.
 * Any other refusal is a non-dispatch, as for every REST call.
 *
 * AN ACCEPTED END IS NOT AN ENDED SESSION. The route records the request and
 * publishes it; the OCPP server ends the session when it reads the message,
 * or at its next sweep, a minute later, if the publish failed
 * (packages/api/src/lib/session-end.ts, packages/ocpp/src/server/
 * csms-session-end.ts). ConcurrentTx keys on `status = 'active'` alone, so the
 * hook polls `stillOpen` until every session it ended has left it, and a
 * session still active at the bound is warned about like a refused one: the
 * hook cannot do more, and the scenario about to run may not use that tag.
 */
export async function endLeftoverSessions(
  api: EvtivityApi,
  cpId: string,
  sessions: readonly string[],
  options: EndLeftoverOptions,
): Promise<void> {
  const warn = options.warn ?? ((line: string) => process.stderr.write(line));
  const accepted: string[] = [];
  for (const ses of sessions) {
    const path = `/v1/sessions/${ses}/end`;
    const res = await api.raw("POST", path, {});
    if (res.status >= 200 && res.status <= 299) {
      accepted.push(ses);
      continue;
    }
    const code = (parseJson(res.text) as { code?: unknown } | undefined)?.code;
    if (res.status === 409 && code === "SESSION_NOT_ACTIVE") continue;
    if (res.status === 409) {
      warn(
        `[evtivity] WARN: ${cpId} still has active session ${ses}, which ` +
          `POST ${path} refused (409 ${String(code)}): its tag will be ` +
          `answered ConcurrentTx until it ends: ${preview(res.text)}\n`,
      );
      continue;
    }
    throw new CsmsNotDispatchedError(`evtivity: POST ${path}`, `returned ${res.status}: ${preview(res.text)}`);
  }
  if (accepted.length === 0) return;
  const timeoutMs = options.timeoutMs ?? END_WAIT_MS;
  try {
    await waitForCondition(
      async () => {
        const open = await options.stillOpen();
        return accepted.every((ses) => !open.includes(ses));
      },
      {
        timeoutMs,
        intervalMs: options.intervalMs ?? END_POLL_MS,
        description: `${cpId}'s ended sessions to leave the active list`,
      },
    );
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    warn(
      `[evtivity] WARN: ${cpId} still has active session(s) ${accepted.join(", ")} ` +
        `${timeoutMs} ms after the CSMS accepted ending them: their tags will be ` +
        "answered ConcurrentTx until the OCPP server ends them\n",
    );
  }
}

/**
 * Registers one station on security profile 0 for OCPP 1.6, or unblocks it
 * when a teardown left it blocked. Idempotent, and safe for two lanes racing
 * on one id: a 409 from the create means the other one won.
 */
export async function ensureStation(api: EvtivityApi, cpId: string): Promise<void> {
  let station = await findStation(api, cpId);
  if (!station) {
    await api.request(
      "POST",
      "/v1/stations",
      { stationId: cpId, ocppProtocol: "ocpp1.6", securityProfile: 0 },
      [409],
    );
    station = await findStation(api, cpId);
  }
  if (station?.onboardingStatus === "blocked") {
    await api.request("POST", `/v1/stations/${station.id}/unblock`, {}, [409]);
  }
}

async function findToken(api: EvtivityApi, idTag: string): Promise<TokenRow | undefined> {
  // `search` is a substring match: CERT01 would find CERT010 to CERT018.
  return findInPages<TokenRow>(api, "/v1/tokens", { search: idTag }, (row) => row.idToken === idTag);
}

class Provisioner {
  constructor(
    private readonly cfg: EvtivityConfig,
    private readonly api: EvtivityApi,
  ) {}

  private async findDriver(): Promise<DriverRow | undefined> {
    return findInPages<DriverRow>(this.api, "/v1/drivers", { search: DRIVER.email }, (row) => row.email === DRIVER.email);
  }

  /** The fixture driver's id, created or reactivated as needed. */
  private async ensureDriver(): Promise<string> {
    let driver = await this.findDriver();
    if (!driver) {
      // 409 DUPLICATE_EMAIL: another lane created it first.
      await this.api.request("POST", "/v1/drivers", DRIVER, [409]);
      driver = await this.findDriver();
      if (!driver) throw new Error(`evtivity: driver ${DRIVER.email} was created but cannot be read back`);
    }
    if (!driver.isActive) {
      await this.api.request("PATCH", `/v1/drivers/${driver.id}`, { isActive: true });
    }
    return driver.id;
  }

  /** Creates the tag when absent, then PATCHes it to `state`. */
  private async ensureToken(idTag: string, state: Record<string, unknown>): Promise<void> {
    let token = await findToken(this.api, idTag);
    if (!token) {
      await this.api.request("POST", "/v1/tokens", { idToken: idTag, tokenType: TOKEN_TYPE }, [409]);
      token = await findToken(this.api, idTag);
      if (!token) throw new Error(`evtivity: tag ${idTag} was created but cannot be read back`);
    }
    await this.api.request("PATCH", `/v1/tokens/${token.id}`, state);
  }

  async provision(): Promise<void> {
    for (const cpId of this.cfg.stations) {
      await ensureStation(this.api, cpId);
    }
    const driverId = await this.ensureDriver();
    for (const idTag of VALID_TAGS) {
      await this.ensureToken(idTag, { driverId, isActive: true, expiresAt: null });
    }
    await this.ensureToken(EXPIRED_TAG, {
      isActive: true,
      expiresAt: inMinutes(-EXPIRED_FIXTURE_BACKDATE_MINUTES).toISOString(),
    });
    await this.ensureToken(BLOCKED_TAG, { isActive: false, expiresAt: null });
    const invalid = await findToken(this.api, INVALID_TAG);
    if (invalid) await this.api.request("DELETE", `/v1/tokens/${invalid.id}`, undefined, [404]);
  }

  /** Every way the environment differs from what the scenarios assume. */
  async verify(): Promise<string[]> {
    const problems: string[] = [];

    const settings = await this.api.get<Record<string, unknown>>("/v1/settings");
    for (const [key, wanted] of Object.entries(REQUIRED_SETTINGS)) {
      const actual = settings?.[key];
      if (actual !== wanted) {
        problems.push(
          `setting ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)} ` +
            "(seeded by drivers/evtivity/compose.yaml; the ocpp service caches settings for 60 s)",
        );
      }
    }

    for (const cpId of this.cfg.stations) {
      const station = await findStation(this.api, cpId);
      if (!station) {
        problems.push(`station ${cpId} is not registered`);
        continue;
      }
      if (station.onboardingStatus === "blocked" || station.onboardingStatus === "rejected") {
        problems.push(`station ${cpId} is ${station.onboardingStatus}; its boot would be Rejected`);
      }
      if (station.securityProfile !== 0 || station.ocppProtocol !== "ocpp1.6") {
        problems.push(
          `station ${cpId} is ${String(station.ocppProtocol)} on security profile ` +
            `${station.securityProfile}; the simulator needs ocpp1.6 on profile 0`,
        );
      }
    }

    const driver = await this.findDriver();
    if (!driver?.isActive) problems.push(`driver ${DRIVER.email} is missing or inactive`);
    const now = Date.now();
    for (const idTag of VALID_TAGS) {
      const row = await findToken(this.api, idTag);
      if (!row) problems.push(`tag ${idTag} is missing`);
      else if (!row.isActive) problems.push(`tag ${idTag} is inactive`);
      else if (row.expiresAt && Date.parse(row.expiresAt) <= now) problems.push(`tag ${idTag} has expired`);
      else if (driver === undefined || row.driverId !== driver.id) {
        problems.push(
          `tag ${idTag} is not bound to ${DRIVER.email}; EVtivity stops a transaction ` +
            "whose token has no driver",
        );
      }
    }
    const expired = await findToken(this.api, EXPIRED_TAG);
    if (!expired?.isActive || !expired.expiresAt || Date.parse(expired.expiresAt) > now) {
      problems.push(`tag ${EXPIRED_TAG} must be active with expiresAt in the past`);
    }
    const blocked = await findToken(this.api, BLOCKED_TAG);
    if (!blocked || blocked.isActive) {
      problems.push(`tag ${BLOCKED_TAG} must exist with isActive=false`);
    }
    if (await findToken(this.api, INVALID_TAG)) {
      problems.push(`tag ${INVALID_TAG} must be absent`);
    }
    return problems;
  }

  /**
   * Removes what `provision` put in place, and nothing else: the tags of
   * ALL_TAGS, the stations of EVTIVITY_STATIONS and the fixture driver. A
   * station is BLOCKED rather than deleted -- the API has no hard delete --
   * and the driver is soft-deleted; `provision` undoes both. A 409 is the
   * server refusing because a session is still open on the tag or the
   * station; it is reported, not forced. Forcing includes the driver:
   * deleting it deactivates every token it holds (packages/api/src/routes/
   * drivers.ts, DELETE /drivers/:id, at v0.1.51), the held one too, so a
   * held tag keeps the driver.
   */
  async teardown(): Promise<string[]> {
    const problems: string[] = [];
    let held = false;
    for (const idTag of ALL_TAGS) {
      const token = await findToken(this.api, idTag);
      if (!token) continue;
      const res = await this.api.request("DELETE", `/v1/tokens/${token.id}`, undefined, [404, 409]);
      if (res.status === 409) {
        held = true;
        problems.push(`tag ${idTag} is held by an open session`);
      }
    }
    for (const cpId of this.cfg.stations) {
      const station = await findStation(this.api, cpId);
      if (!station || station.onboardingStatus === "blocked") continue;
      const res = await this.api.request("DELETE", `/v1/stations/${station.id}`, undefined, [404, 409]);
      if (res.status === 409) problems.push(`station ${cpId} has an open session`);
    }
    const driver = await this.findDriver();
    if (driver?.isActive && held) {
      problems.push(`driver ${DRIVER.email} kept: deleting it would deactivate the held tags`);
    } else if (driver?.isActive) {
      await this.api.request("DELETE", `/v1/drivers/${driver.id}`, undefined, [404]);
    }
    return problems;
  }
}

/** `teardown` against a given client and configuration -- the seam
 *  tests/evtivity-adapter.ts reaches it through. */
export function teardownFixtures(api: EvtivityApi, cfg: EvtivityConfig): Promise<string[]> {
  return new Provisioner(cfg, api).teardown();
}

function newProvisioner(): Provisioner {
  const cfg = defaultEvtivityConfig(process.env);
  return new Provisioner(cfg, new EvtivityApi(cfg));
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
