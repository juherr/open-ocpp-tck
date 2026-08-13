// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * provision.ts -- the environment the 47 scenarios assume, made reproducible.
 *
 * The scenarios do not create the state they assert on: TC_023 needs three
 * idTags that are respectively unknown, expired and blocked, TC_056/066/067
 * need a TxDefaultProfile whose schedule carries an 11000 W limit, and a dozen
 * other tags must simply be valid. Upstream shipped that as a `02-provision.sh`
 * this repository deliberately did not vendor, which left the quick start
 * unrunnable. This is its replacement, reachable as `ocpp-tck driver provision`.
 *
 * Three channels, because no single one can do the job -- each claim below was
 * verified against the pinned image (see VENDOR.md), not inferred. The REST
 * channel is used wherever REST can answer, on purpose: a fixture asserted
 * through the API is a fixture an integrator could reproduce, while one
 * asserted through the tables is a claim about SteVe's private state. So the
 * two other channels are not a style choice -- each is a missing endpoint with
 * a ticket number, and the day it lands the channel goes with it.
 *
 *   REST  tags, end to end: `POST /ocppTags` to create, `GET /ocppTags` for
 *         everything `verify` checks, `DELETE /ocppTags/{pk}` for teardown.
 *   SQL   for `CERT023-EXP` alone. OcppTagForm.expiryDate carries @Future, so
 *         REST answers 400 to a past date -- and the manager UI binds the very
 *         same form, so it refuses it too. A row that must look stale can only
 *         be written behind the application.
 *
 *         Worth being clear that this is SteVe's rule and not OCPP's: 1.6
 *         defines IdTagInfo.expiryDate as an optional dateTime ("the date at
 *         which idTag should be removed from the Authorization Cache") with no
 *         constraint that it be in the future. SteVe's own read path in fact
 *         depends on past values -- comparing expiry_date against now is
 *         exactly how it decides to answer Expired, which is what TC_023.2
 *         asserts. The write path forbids the state the read path exists to
 *         report, so the SQL below is working around an input rule, not
 *         around the protocol. Raised upstream as
 *         steve-community/steve#2100.
 *
 *         What that SQL writes is deliberately the same thing the endpoint
 *         proposed there would: the tag is expired AS OF THIS RUN, from the
 *         database's own clock, never a fabricated historical date -- see
 *         EXPIRED_FIXTURE_BACKDATE_MINUTES in tck/time.ts. So if
 *         `PATCH /ocppTags/{pk}/expire` lands, this channel goes away and tags
 *         become REST-only without any fixture changing meaning.
 *   UI    for the two charging profiles. SteVe's WebAPI exposes exactly
 *         ocppTags, operations and transactions; there is no chargingProfile
 *         endpoint at all. steve-community/steve#2069 proposes adding that
 *         CRUD, noting that "a fully automated client must therefore use the
 *         manager UI or direct database access". If it lands, this channel
 *         folds into REST, and so does verify's second half and teardown's.
 *
 * Two more places reach past the API for the same reason, each with its own
 * ticket:
 *
 *   web_user.api_password  written in SQL to turn the WebAPI on at all -- no
 *         endpoint, no environment variable, and the /webusers page is not
 *         reachable. steve-community/steve#2075 (manager and API account CRUD)
 *         and #2059 (a Web UI for web-user accounts) are the two that would
 *         end it. Until then, enabling the API costs a database write.
 *   reservation.id_tag     read in SQL by teardown, to avoid deleting a tag a
 *         reservation still references. steve-community/steve#2074.
 *
 * All of these sit under the #1000 "Meta - API Endpoint" umbrella, which is
 * the one link to follow when wondering why a TCK needs database access.
 *
 * Charge points are not provisioned here on purpose: there is no REST endpoint
 * for them either (steve-community/steve#2068), and compose.yaml sets
 * AUTO_REGISTER_UNKNOWN_STATIONS=true so the roster registers itself on first
 * BootNotification.
 *
 * Everything is idempotent. Re-running provision on a provisioned environment
 * must be a no-op that still exits 0, because CI reruns it and an operator
 * chasing a failure will run it twice before believing it.
 */
import { EXPIRED_FIXTURE_BACKDATE_MINUTES } from "../../tck/time";
import { waitForCondition } from "../../tck/wait";
import {
  defaultApiConfig,
  SteveWebApi,
  type SteveApiConfig,
} from "./api-client";
import { chargingProfileForm, type ChargingProfileFields } from "./forms";
import { SteveRecords, sqlLiteral } from "./records";
import { defaultSteveConfig, SteveUiOps, type SteveConfig } from "./ui-client";

/** Per-request budget for the signin probe below; the WebAPI client owns its
 *  own, and the manager UI client owns a third. */
const SIGNIN_PROBE_TIMEOUT_MS = 15_000;
const RESTART_TIMEOUT_MS = 300_000;
const RESTART_POLL_MS = 3_000;

/**
 * Tags that must exist and authorize normally.
 *
 * These come from TWO places, and reading only the first is a trap worth
 * spelling out: most of them are hard-coded in the SIMULATOR's scenario
 * templates, not in `tck/specs/`. A tag like CERT013 appears nowhere in this
 * repository's sources -- the charge point sends it on its own -- so deriving
 * the list from the specs yields a set that looks complete and silently fails
 * TC_013/014/017/018, because an unknown tag gets Authorize:Invalid and the
 * transaction those scenarios need never starts.
 *
 * Ground truth for the first group is the pinned simulator image:
 *
 *   docker run --rm --entrypoint sh <SIM_IMAGE> \
 *     -c "grep -rhoE 'CERT[A-Za-z0-9_-]+' /app/src | sort -u"
 *
 * Re-run that when the image pin moves; `tck/sim.ts` owns the digest.
 */
const VALID_TAGS = [
  // Sent by the charge point, from the simulator's own templates.
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
  // Supplied BY the CSMS, from tck/specs/ -- RemoteStartTransaction,
  // ReserveNow and SendLocalList carry these.
  "CERT-TAG-1",
  "CERT-TAG-2",
] as const;

/** Absent from ocpp_tag entirely -- SteVe answers Invalid for an unknown tag. */
const INVALID_TAG = "CERT023-INV";
/** Present with an expiry in the past -- SteVe answers Expired. */
const EXPIRED_TAG = "CERT023-EXP";
/** Present with maxActiveTransactionCount = 0 -- SteVe answers Blocked. */
const BLOCKED_TAG = "CERT023-BLK";

/**
 * The expiry written for EXPIRED_TAG: an EXPRESSION, not a literal, so MariaDB
 * dates the row from its own clock at provisioning time rather than from this
 * process's -- the write is the one place where using the CSMS's own clock
 * costs nothing.
 *
 * The backdate is what makes every reader agree, and each is strict in its own
 * way: SteVe's `isExpired` is `now.isAfter(expiry)`, and `verify` compares the
 * instant the API reports against THIS process's clock. A minute covers the
 * gap between the two clocks and the second-granularity of `NOW()`, which
 * `provision` would otherwise trip over immediately since it verifies itself.
 * `NOW(6)` rather than `NOW()` so the written value does not lose precision
 * the margin is there to protect.
 */
const EXPIRED_AT_RUN_START = `NOW(6) - INTERVAL ${EXPIRED_FIXTURE_BACKDATE_MINUTES} MINUTE`;

/** `limitW` on the first: TC_066 asserts that exact number on the composite
 *  schedule. The field names it turns into live in forms.ts. */
const PROFILES: readonly ChargingProfileFields[] = [
  { description: "TC056 TxDefaultProfile", purpose: "TX_DEFAULT_PROFILE", limitW: 11000 },
  { description: "TC057 TxProfile", purpose: "TX_PROFILE", limitW: 11000 },
];

/**
 * SteVe's `OcppTagOverview`, narrowed to what provisioning and verification
 * read. `blocked` is SteVe's own reading of the fixture rather than ours: it is
 * derived from maxActiveTransactionCount server-side, so asserting on it checks
 * the state the Authorize path will actually see.
 */
interface OcppTagOverview {
  ocppTagPk: number;
  idTag: string;
  expiryDate: string | null;
  blocked: boolean;
  maxActiveTransactionCount: number;
}

/**
 * What "this fixture is still what we seeded" means, spelled once.
 *
 * provision and verify have to agree on it or the environment oscillates:
 * provision rebuilding a tag every run because its rule says "drifted" while
 * verify's says "clean", or verify blessing a tag provision would rebuild.
 * They used to answer the same two questions off different fields --
 * maxActiveTransactionCount here, SteVe's derived `blocked` there.
 */
function isUsable(row: OcppTagOverview): boolean {
  return !row.blocked && row.expiryDate === null;
}

function isBlocked(row: OcppTagOverview): boolean {
  return row.blocked;
}

export class SteveProvisioner {
  private readonly ui: SteveUiOps;
  private readonly db: SteveRecords;

  private readonly api: SteveWebApi;

  constructor(
    private readonly cfg: SteveConfig,
    private readonly apiCfg: SteveApiConfig,
    private readonly log: (msg: string) => void = stdout,
  ) {
    this.api = new SteveWebApi(apiCfg);
    this.ui = new SteveUiOps(cfg);
    this.db = new SteveRecords(cfg, apiCfg);
  }

  /**
   * Makes the WebAPI answer, restarting SteVe only if it does not already.
   *
   * SteVe keeps API credentials in `web_user.api_password`, a bcrypt column
   * distinct from the UI password, NULL by default -- so REST is off until
   * something writes it. Two facts make this awkward, both measured rather
   * than assumed: the row does not exist until SteVe has booted once (Flyway
   * creates the table, the app seeds the row), and the application reads that
   * column at startup and caches it, so a fresh hash is ignored until a
   * restart. There is no environment variable for it and the /webusers page
   * is not reachable, so this dance is the only way in.
   *
   * The probe-first shape is what keeps it cheap: the restart is paid once, on
   * a fresh environment, and never again.
   *
   * It will only ever write a password that was never set. Enabling API access
   * costs a credential write and a service restart, which is fine on the
   * throwaway environment compose.yaml brings up and is not fine on a SteVe
   * someone already uses: silently replacing a working admin API credential
   * with a default published in this file, then bouncing the process, is not
   * something a command called "provision" should do on its own authority. So
   * a non-null api_password that simply does not match is reported, not
   * overwritten -- the operator knows their password and this does not.
   */
  async ensureApiAccess(): Promise<void> {
    if (await this.api.reachable()) {
      this.log("api: already enabled");
      return;
    }

    // Existence and current value in one read. ROW_COUNT() after the UPDATE
    // cannot answer this: it reports rows *changed*, so it returns 0 both for
    // "no such user" and for "already had this value" -- two situations that
    // need opposite responses.
    const existing = await this.db.scalar(
      `SELECT CONCAT('row|', IFNULL(api_password, '')) FROM web_user WHERE username = ${sqlLiteral(this.apiCfg.username)};`,
    );
    if (existing === "") {
      throw new Error(
        `steve provision: no web_user row for '${this.apiCfg.username}'. ` +
          `SteVe seeds it on first boot from AUTH_USER -- is the container up, and is STEVE_API_USER the same as AUTH_USER?`,
      );
    }
    if (existing !== "row|") {
      throw new Error(
        `steve provision: '${this.apiCfg.username}' already has a WebAPI password set, and it is not the one configured. ` +
          `Refusing to overwrite a credential in use. Set STEVE_API_PASS to the existing password, or clear ` +
          `web_user.api_password for that user if this environment is disposable.`,
      );
    }

    this.log("api: enabling WebAPI access (requires one SteVe restart)");
    const hash = await Bun.password.hash(this.apiCfg.password, {
      algorithm: "bcrypt",
      cost: 10,
    });
    await this.db.scalar(
      `UPDATE web_user SET api_password = ${sqlLiteral(hash)} WHERE username = ${sqlLiteral(this.apiCfg.username)};`,
    );

    await this.restartApp();

    if (!(await this.api.reachable())) {
      throw new Error(
        "steve provision: WebAPI still refuses the credentials after a restart. " +
          "Check STEVE_API_USER/STEVE_API_PASS and STEVE_APP_CONTAINER.",
      );
    }
    this.log("api: enabled");
  }

  private async restartApp(): Promise<void> {
    const proc = Bun.spawn(["docker", "restart", this.cfg.appContainer], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `steve provision: docker restart ${this.cfg.appContainer} failed: ${stderr.trim() || "<no stderr>"}`,
      );
    }

    this.log(`api: waiting for ${this.cfg.appContainer} to come back`);
    await waitForCondition(
      () =>
        // A rejection here is "not listening yet" -- SteVe replays its
        // migrations before it binds -- so it folds into the falsy retry.
        fetch(`${this.cfg.baseUrl}/signin`, {
          redirect: "manual",
          signal: AbortSignal.timeout(SIGNIN_PROBE_TIMEOUT_MS),
        })
          .then((res) => res.status === 200)
          .catch(() => false),
      {
        timeoutMs: RESTART_TIMEOUT_MS,
        intervalMs: RESTART_POLL_MS,
        description: `${this.cfg.appContainer} to answer ${this.cfg.baseUrl}/signin`,
      },
    );
  }

  private async listTags(): Promise<Map<string, OcppTagOverview>> {
    const rows = await this.api.getJson<OcppTagOverview[]>("/ocppTags");
    return new Map(rows.map((r) => [r.idTag, r]));
  }

  private async createTag(body: Record<string, unknown>): Promise<void> {
    await this.api.send("POST", "/ocppTags", { body });
  }

  private async deleteTag(pk: number): Promise<void> {
    await this.api.send("DELETE", `/ocppTags/${pk}`);
  }

  async provisionTags(): Promise<void> {
    const existing = await this.listTags();

    for (const idTag of VALID_TAGS) {
      const row = existing.get(idTag);
      if (row && isUsable(row)) continue;
      // A tag that exists but drifted (blocked, or carrying an expiry from an
      // earlier run) is deleted rather than patched: PUT would hit the same
      // @Future validation that forbids writing the expiry in the first place.
      if (row) await this.deleteTag(row.ocppTagPk);
      await this.createTag({ idTag, note: "open-ocpp-tck fixture" });
      this.log(`tag: ${idTag} valid`);
    }

    const blocked = existing.get(BLOCKED_TAG);
    if (!blocked || !isBlocked(blocked)) {
      if (blocked) await this.deleteTag(blocked.ocppTagPk);
      await this.createTag({
        idTag: BLOCKED_TAG,
        maxActiveTransactionCount: 0,
        note: "open-ocpp-tck fixture: blocked",
      });
      this.log(`tag: ${BLOCKED_TAG} blocked`);
    }

    // Created through the API for the row, then aged through SQL: @Future makes
    // the API refuse to write a past date, but says nothing about reading one.
    if (!existing.has(EXPIRED_TAG)) {
      await this.createTag({
        idTag: EXPIRED_TAG,
        note: "open-ocpp-tck fixture: expired",
      });
    }
    // Unconditional, and that is the idempotency wanted here rather than a
    // departure from it: every provision re-expires the tag as of that run.
    // Skipping the write when the row is already expired would keep an older
    // run's instant alive for no gain.
    await this.db.scalar(
      `UPDATE ocpp_tag SET expiry_date = ${EXPIRED_AT_RUN_START} WHERE id_tag = ${sqlLiteral(EXPIRED_TAG)};`,
    );
    this.log(
      `tag: ${EXPIRED_TAG} expired ${EXPIRED_FIXTURE_BACKDATE_MINUTES} min before this run's provisioning`,
    );

    const invalid = existing.get(INVALID_TAG);
    if (invalid) {
      await this.deleteTag(invalid.ocppTagPk);
    }
    this.log(`tag: ${INVALID_TAG} absent`);
  }

  async provisionProfiles(): Promise<void> {
    for (const profile of PROFILES) {
      const pk = await this.db.chargingProfiles.refByDescription(
        profile.description,
      );
      if (pk !== "") {
        this.log(`profile: ${profile.description} already present (#${pk})`);
        continue;
      }
      await this.ui.postForm(
        "chargingProfiles/add",
        chargingProfileForm(profile),
      );
      const created = await this.db.chargingProfiles.refByDescription(
        profile.description,
      );
      if (created === "") {
        throw new Error(
          `steve provision: charging profile '${profile.description}' was posted but is not in the registry -- the form came back with validation errors.`,
        );
      }
      this.log(`profile: ${profile.description} created (#${created})`);
    }
  }

  /**
   * Read-only, and answered from the WebAPI wherever the WebAPI can answer.
   *
   * The tag half asks `GET /ocppTags`, which is what the Authorize path will
   * itself consult -- a fixture that looks right in the table but wrong through
   * the API is a fixture that will behave wrong. The profile half stays on SQL
   * because there is no charging-profile endpoint to ask
   * ([steve-community/steve#2069]); when that lands, this method becomes
   * single-channel.
   *
   * TWO PROPERTIES WERE TRADED AWAY, deliberately, and they are worth naming:
   * verify no longer works on an environment where API access was never
   * enabled -- it reports that as the first problem to fix, which is honest but
   * is not what it did before -- and "is the expiry in the past" is now decided
   * by THIS process's clock via Date.parse rather than by the database's.
   * EXPIRED_FIXTURE_BACKDATE_MINUTES is what makes the second safe: a minute of
   * backdate absorbs any skew between the two clocks, which on a local compose
   * environment is zero anyway.
   */
  async verify(): Promise<string[]> {
    const problems: string[] = [];
    const tags = await this.listTags();

    for (const idTag of VALID_TAGS) {
      const row = tags.get(idTag);
      if (!row) {
        problems.push(`${idTag}: missing`);
        continue;
      }
      if (isUsable(row)) continue;
      if (row.blocked) problems.push(`${idTag}: blocked, expected usable`);
      if (row.expiryDate !== null) {
        problems.push(`${idTag}: has expiry ${row.expiryDate}`);
      }
    }

    if (tags.has(INVALID_TAG)) {
      problems.push(`${INVALID_TAG}: present, must be absent for TC_023`);
    }

    const expired = tags.get(EXPIRED_TAG);
    if (!expired?.expiryDate) {
      problems.push(`${EXPIRED_TAG}: missing or has no expiry`);
    } else if (!(Date.parse(expired.expiryDate) < Date.now())) {
      problems.push(
        `${EXPIRED_TAG}: expiry ${expired.expiryDate} is not in the past`,
      );
    }

    const blocked = tags.get(BLOCKED_TAG);
    if (!blocked) {
      problems.push(`${BLOCKED_TAG}: missing`);
    } else if (!isBlocked(blocked)) {
      problems.push(
        `${BLOCKED_TAG}: maxActiveTransactionCount ${blocked.maxActiveTransactionCount}, expected 0`,
      );
    }

    // From here down, SQL -- there is no charging-profile endpoint to ask
    // (steve-community/steve#2069). The limit is checked, not just the name. A profile carrying the wrong
    // limit is exactly the case verify() exists to catch: TC_066 asserts
    // "limit":11000 on the composite schedule, so a profile that is present but
    // wrong turns into a scenario FAIL that reads like a CSMS defect, while
    // verify would have answered that the environment was fine.
    // LEFT JOIN so a profile with no schedule period at all is reported as a
    // wrong limit rather than silently vanishing from the result set.
    const limits = new Map<string, string[]>();
    for (const [description, limit] of await this.db.rows(
      `SELECT p.description, IFNULL(csp.power_limit, '')
       FROM charging_profile p
       LEFT JOIN charging_schedule_period csp
         ON csp.charging_profile_pk = p.charging_profile_pk
       WHERE p.description IN (${PROFILES.map((p) => sqlLiteral(p.description)).join(", ")});`,
    )) {
      const seen = limits.get(description) ?? [];
      seen.push(limit);
      limits.set(description, seen);
    }
    for (const profile of PROFILES) {
      const seen = limits.get(profile.description);
      if (!seen) {
        problems.push(`charging profile '${profile.description}': missing`);
        // decimal(15,1) renders as "11000.0", so compare as numbers.
      } else if (!seen.some((l) => l !== "" && Number(l) === profile.limitW)) {
        problems.push(
          `charging profile '${profile.description}': no schedule period with limit ${profile.limitW} (found ${seen.map((l) => l || "none").join(", ")})`,
        );
      }
    }

    return problems;
  }

  /**
   * Removes the fixtures, and nothing else. Charge points and their
   * transactions are left alone: they are runtime residue, not fixtures, and
   * `docker compose down -v` is the honest way to get a clean slate.
   *
   * The WebAPI password provision may have set is deliberately left in place.
   * Clearing it would need a second restart to take effect, and would leave
   * the environment in a state where the next provision has to restart again
   * -- paying that twice to undo something harmless. `down -v` removes it with
   * the volume, which is the only case where it matters.
   */
  async teardown(): Promise<void> {
    const wanted = [...VALID_TAGS, BLOCKED_TAG, EXPIRED_TAG, INVALID_TAG];

    // Only tags nothing refers to. `transaction_start.id_tag` and
    // `reservation.id_tag` are ON DELETE CASCADE onto ocpp_tag, so deleting a
    // used tag -- through SQL or through the API, they hit the same
    // constraint -- does not fail. It silently takes the run's transaction
    // history with it. Measured: one scenario, then teardown, and
    // transaction_start went from 1 row to 0. So the guard runs BEFORE the
    // delete, and records.ts owns which channel answers it.
    const [used, tags] = await Promise.all([
      this.db.idTagsReferenced(wanted),
      this.listTags(),
    ]);
    let kept = 0;
    for (const idTag of wanted) {
      const row = tags.get(idTag);
      if (!row) continue;
      if (used.has(idTag)) {
        kept += 1;
        continue;
      }
      await this.deleteTag(row.ocppTagPk);
    }
    this.log(
      kept === 0
        ? "tags: removed"
        : `tags: removed, ${kept} kept because transactions or reservations still reference them`,
    );

    for (const profile of PROFILES) {
      const pk = await this.db.chargingProfiles.refByDescription(
        profile.description,
      );
      if (pk === "") continue;
      // Children before parent. Two tables carry a FK to charging_profile --
      // charging_schedule_period AND connector_charging_profile, the latter
      // written when a profile is actually assigned to a connector.
      // Skipping it makes teardown work only on a profile no scenario ever
      // used, which is the opposite of when teardown is wanted.
      await this.db.scalar(
        `DELETE FROM connector_charging_profile WHERE charging_profile_pk = ${pk};`,
      );
      await this.db.scalar(
        `DELETE FROM charging_schedule_period WHERE charging_profile_pk = ${pk};`,
      );
      await this.db.scalar(
        `DELETE FROM charging_profile WHERE charging_profile_pk = ${pk};`,
      );
      this.log(`profile: ${profile.description} removed`);
    }
  }
}

function newProvisioner(): SteveProvisioner {
  const cfg = defaultSteveConfig(process.env);
  return new SteveProvisioner(cfg, defaultApiConfig(cfg, process.env));
}

function stdout(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/**
 * Turns a thrown error into the exit code a driver verb must return, in one
 * place, so no verb can grow a differently-worded failure path.
 *
 * Folding `verify()` into the same funnel is the point rather than a side
 * effect: it used to sit outside the try in provisionCommand, so the same
 * command reported an unreachable database two different ways depending on
 * which half of it failed.
 */
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
    process.stderr.write(
      `${label} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  if (problems.length > 0) {
    process.stderr.write(`${onProblems}:\n  ${problems.join("\n  ")}\n`);
    return 1;
  }
  stdout(onClean);
  return 0;
}

/** `ocpp-tck driver provision` */
export async function provisionCommand(): Promise<number> {
  const provisioner = newProvisioner();
  return runVerb(
    "provision",
    async () => {
      await provisioner.ensureApiAccess();
      await provisioner.provisionTags();
      await provisioner.provisionProfiles();
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
    async () => {
      await newProvisioner().teardown();
      return [];
    },
    "torn down",
    "teardown left problems",
  );
}
