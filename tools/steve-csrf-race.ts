// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * steve-csrf-race.ts -- fires N manager-UI form posts at once and counts what
 * comes back. **LIVE CSMS REQUIRED.** Deliberately NOT part of `bun test`, of
 * `tools/verify.sh` or of CI: it needs a running SteVe, and it writes rows to
 * its database.
 *
 * WHY IT EXISTS, GIVEN THERE IS ALREADY AN OFFLINE GUARD.
 * `tests/steve-ui-session-race.ts` proves the client serialises correctly
 * against a FAKE SteVe, and that fake is a reading of Spring Security's
 * defaults -- session-scoped CSRF token, BREACH re-masking per render,
 * `changeSessionId` at authentication. The guard is only worth as much as that
 * reading. This script is how the reading gets re-checked against the real
 * image, which is a thing to do whenever the SteVe pin in
 * `drivers/steve/compose.yaml` moves. It prints the two observations that
 * settle it: how many distinct sessions the server handed out, and whether the
 * `_csrf` string varied between GETs of one session.
 *
 * HOW TO GET A BEFORE/AFTER. The fix is a lock, so remove the lock and measure:
 *
 *   tools/mutate.sh drivers/steve/ui-client.ts \
 *     's/return this\.serialise\(\(\) => this\.postFormExclusive\(path, fields\)\);/return this.postFormExclusive(path, fields);/' \
 *     -- bun tools/steve-csrf-race.ts --yes-isolated
 *
 * then run it again unmutated. Refused should go from "several" to zero.
 *
 * WHAT IT POSTS, AND WHY THAT FORM. `chargingProfiles/add` -- the same form
 * provisioning uses, and the only manager form that needs no charge point to be
 * connected, since SteVe has no REST controller for stored charging profiles.
 * Each round leaves rows behind, which is why the isolation flag is mandatory.
 */
import { chargingProfileForm } from "../drivers/steve/forms";
import {
  CSRF_RE,
  defaultSteveConfig,
  type FetchLike,
  SteveUiOps,
} from "../drivers/steve/ui-client";
import { CsmsNotDispatchedError } from "../tck/driver";

const USAGE = `Usage: bun tools/steve-csrf-race.ts --yes-isolated [--lanes N] [--rounds R]

  --yes-isolated  required. Asserts that STEVE_URL points at a stack nobody
                  else is using: this drives real form posts and writes rows.
                  Bring one up with a distinct TCK_SUFFIX and STEVE_PORT --
                  workspaces on this machine share one docker daemon.
  --lanes N       concurrent postForms per round (default 8)
  --rounds R      rounds (default 20)
`;

interface Options {
  lanes: number;
  rounds: number;
}

function parseArgs(argv: readonly string[]): Options | string {
  let lanes = 8;
  let rounds = 20;
  let isolated = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes-isolated") {
      isolated = true;
    } else if (arg === "--lanes" || arg === "--rounds") {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        return `${arg} needs a positive integer, got ${raw ?? "nothing"}`;
      }
      if (arg === "--lanes") lanes = value;
      else rounds = value;
    } else {
      return `unknown argument ${arg}`;
    }
  }
  if (!isolated) return "refusing to run without --yes-isolated";
  return { lanes, rounds };
}

interface Seen {
  sessions: Set<string>;
  tokens: Set<string>;
  gets: number;
}

/** Wraps the real fetch to watch what the server does, without changing it. */
function instrument(seen: Seen): FetchLike {
  return async (input, init) => {
    const res = await fetch(input, init);
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const found = /JSESSIONID=([^;]+)/.exec(raw);
      if (found) seen.sessions.add(found[1]!);
    }
    if ((init?.method ?? "GET").toUpperCase() === "GET") {
      seen.gets++;
      const body = await res.clone().text().catch(() => "");
      const found = CSRF_RE.exec(body);
      if (found) seen.tokens.add(found[1]!);
    }
    return res;
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (typeof opts === "string") {
    process.stderr.write(`${opts}\n\n${USAGE}`);
    return 2;
  }

  const cfg = defaultSteveConfig(process.env);
  const seen: Seen = { sessions: new Set(), tokens: new Set(), gets: 0 };
  const ui = new SteveUiOps(cfg, instrument(seen));

  let ok = 0;
  let refused = 0;
  const others: string[] = [];

  process.stdout.write(
    `${opts.lanes} concurrent postForms x ${opts.rounds} rounds against ${cfg.baseUrl}\n`,
  );
  const started = Date.now();

  for (let round = 0; round < opts.rounds; round++) {
    const results = await Promise.allSettled(
      Array.from({ length: opts.lanes }, (_, lane) =>
        ui.postForm(
          "chargingProfiles/add",
          chargingProfileForm({
            description: `csrf-race-r${round}-l${lane}`,
            purpose: "TX_PROFILE",
            limitW: 11000,
          }),
        ),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") ok++;
      else if (result.reason instanceof CsmsNotDispatchedError) refused++;
      else others.push(String(result.reason));
    }
  }

  const wall = Date.now() - started;
  const total = opts.lanes * opts.rounds;
  process.stdout.write(
    `\nposts      ${total}\n` +
      `  accepted ${ok}\n` +
      `  refused  ${refused}   <- never reached the wire (CsmsNotDispatchedError)\n` +
      `  other    ${others.length}\n` +
      `wall       ${wall}ms (${Math.round(wall / total)}ms/post, serialised by\n` +
      `           design -- a latency figure, not a throughput one)\n\n` +
      `sessions   ${seen.sessions.size} distinct JSESSIONID(s) over ${seen.gets} GETs\n` +
      `tokens     ${seen.tokens.size} distinct _csrf string(s)\n` +
      `           more tokens than sessions is BREACH re-masking, not rotation:\n` +
      `           it is why this defect reads as a token race when it is a\n` +
      `           session race. One session throughout is the fix holding.\n`,
  );
  for (const other of others.slice(0, 5)) {
    process.stdout.write(`  other: ${other.slice(0, 200)}\n`);
  }

  return refused === 0 && others.length === 0 ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
