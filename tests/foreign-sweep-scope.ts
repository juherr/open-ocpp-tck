// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
/**
 * tests/foreign-sweep-scope.ts -- what the foreign-sweep refusal can see.
 *
 * PROPERTY, in four parts:
 *   1. a container this process did not start, driving one of OUR charge point
 *      ids, is refused WHATEVER certification namespace its scenario belongs to
 *      -- `cert16-`, `cert201-`, a `cert21-` nobody has written yet;
 *   2. attribution is on the charge point id and is case-insensitive, because
 *      `containerName` lowers the id it builds with while `OCPP_CP_IDS` and
 *      another sweep's tooling need not;
 *   3. an id that CONTAINS a hyphen is not confused with a shorter id that
 *      prefixes it -- `cp` and `cp-1` are two stations -- and where a hyphen
 *      leaves two readings with nothing to choose between them, the refusal
 *      fires rather than staying quiet;
 *   4. a container on nobody's roster is REPORTED rather than dropped: by its
 *      charge point id where the name yields one, by its container name where
 *      it does not.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A SHELL GUARD. `assertNoForeignSweep` learns
 * the names from `docker ps`, so a shell version of this guard would have to
 * start containers -- one per row, on the daemon this repository's own sweeps
 * share, to test the rule that protects that daemon. `classifyForeignSims` is
 * the rule with the daemon taken out of it, exported for exactly this, the same
 * split `tck/standing.ts` exists for. What is left in the process is
 * `docker ps --format '{{.Names}}'` and a trim.
 *
 * WHY IT IS WORTH A GUARD AT ALL. The predecessor of this rule was
 * `/^simts-(.+?)-cert16-/`, and part 1 was FALSE: a `cert201-` container was
 * invisible to it. Nothing about that failure looks like a failure -- the sweep
 * starts, the guard says nothing, and two sweeps interleave into one CSMS
 * database until an assertion fails on another scenario's id tag, which is the
 * diagnosis the doc block in `tck/sim.ts` says cost a full sweep. A guard whose
 * subject is a check that stays SILENT when it is wrong cannot be replaced by
 * watching a run.
 *
 * Offline: builds container-name strings, runs nothing, starts nothing.
 */

import { classifyForeignSims } from "../tck/sim";

interface Case {
  name: string;
  containers: string[];
  cpIds: string[];
  shared: string[];
  others: string[];
}

const cases: Case[] = [
  {
    name: "an idle daemon shares nothing",
    containers: [],
    cpIds: ["CERTCP1"],
    shared: [],
    others: [],
  },
  {
    // The case the previous rule covered, and the only one it covered.
    name: "a foreign cert16- container on our station is refused",
    containers: ["simts-certcp1-cert16-tc001-cold-boot"],
    cpIds: ["CERTCP1"],
    shared: ["CERTCP1"],
    others: [],
  },
  {
    // THE ONE THAT WAS BROKEN. Same station, a 2.0.1 scenario's namespace.
    name: "a foreign cert201- container on our station is refused too",
    containers: ["simts-certcp1-cert201-tcb01-boot"],
    cpIds: ["CERTCP1"],
    shared: ["CERTCP1"],
    others: [],
  },
  {
    // And the namespace after that one, which is the point of not naming any:
    // this row passes without the guard, the code or the docs being touched.
    name: "a namespace nobody has written yet is refused as well",
    containers: ["simts-certcp1-cert21-tcxyz-something"],
    cpIds: ["CERTCP1"],
    shared: ["CERTCP1"],
    others: [],
  },
  {
    name: "the roster is matched case-insensitively",
    containers: ["simts-certcp1-cert201-tcb01-boot"],
    cpIds: ["CertCp1"],
    shared: ["CertCp1"],
    others: [],
  },
  {
    // The other direction of the same rule: docker accepts an upper-case
    // container name, and the sweep that started it need not be this code.
    name: "an upper-case container name is matched too",
    containers: ["simts-CERTCP1-cert16-tc001-cold-boot"],
    cpIds: ["certcp1"],
    shared: ["certcp1"],
    others: [],
  },
  {
    // `OCPP_CP_IDS=cp,cp-1` is legal, and `simts-cp-` prefixes `cp-1`'s
    // containers as well as `cp`'s. What separates them is the second half of
    // the attribution rule: what follows the station has to open like a
    // template id, and `1-cert16-…` does not.
    name: "a hyphenated id is not confused with the id that prefixes it",
    containers: ["simts-cp-1-cert16-tc001-cold-boot"],
    cpIds: ["cp"],
    shared: [],
    others: ["cp-1"],
  },
  {
    // The reading that has no resolution, recorded as the direction it is
    // resolved in: `cp` + template `cert16-x-cert201-y`, or station
    // `cp-cert16-x` + template `cert201-y`? Refuse. A wait costs less than a
    // sweep spent attributing another sweep's rows to the CSMS.
    name: "an id that itself opens a namespace errs towards refusing",
    containers: ["simts-cp-cert16-x-cert201-y"],
    cpIds: ["cp"],
    shared: ["cp"],
    others: [],
  },
  {
    // The container of a station whose id ends where a template id starts is
    // still attributed to the station that actually owns it.
    name: "...and the station that owns it is caught by its own id",
    containers: ["simts-cp-cert16-x-cert201-y"],
    cpIds: ["cp-cert16-x"],
    shared: ["cp-cert16-x"],
    others: [],
  },
  {
    name: "...and the hyphenated id itself is still caught",
    containers: ["simts-cp-1-cert16-tc001-cold-boot"],
    cpIds: ["cp-1"],
    shared: ["cp-1"],
    others: [],
  },
  {
    // The legitimate case the refusal must NOT swallow: another sweep, its own
    // stations, its own CSMS. Reported, not refused.
    name: "another sweep on other stations is reported, not refused",
    containers: [
      "simts-nycp1-cert16-tc001-cold-boot",
      "simts-nycp2-cert201-tcb01-boot",
    ],
    cpIds: ["CERTCP1", "CERTCP2"],
    shared: [],
    others: ["nycp1", "nycp2"],
  },
  {
    // Both at once: one of ours plus one of theirs. The refusal names only
    // ours, and it fires.
    name: "a shared station is refused even beside unrelated ones",
    containers: [
      "simts-nycp1-cert16-tc001-cold-boot",
      "simts-certcp1-cert201-tcb01-boot",
    ],
    cpIds: ["certcp1"],
    shared: ["certcp1"],
    others: ["nycp1"],
  },
  {
    // ONE ROW FOR ONE BRANCH, and it has two origins worth naming:
    // `containerName` caps the name at 63 characters, so a long enough charge
    // point id truncates the template id -- and with it the delimiter -- away;
    // and a container named by something that is not this harness at all still
    // matches `docker ps --filter name=simts-`. The rule cannot tell them
    // apart, so a row each would be one branch printing two FAILs to triage.
    // Unattributable is not "ignore": whoever is about to start a sweep is the
    // person who can recognise the name.
    name: "a name carrying no template id is reported by its container name",
    containers: ["simts-a-very-long-station-id-with-no-scenario-left"],
    cpIds: ["certcp1"],
    shared: [],
    others: ["simts-a-very-long-station-id-with-no-scenario-left"],
  },
  {
    // One station, two containers of its own: reported once, refused once.
    name: "two containers on one foreign station collapse to one entry",
    containers: [
      "simts-nycp1-cert16-tc001-cold-boot",
      "simts-nycp1-cert16-tc003-charging-plugin-first",
    ],
    cpIds: ["certcp1"],
    shared: [],
    others: ["nycp1"],
  },
];

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

let failures = 0;
for (const testCase of cases) {
  const got = classifyForeignSims(testCase.containers, testCase.cpIds);
  if (same(got.shared, testCase.shared) && same(got.others, testCase.others)) {
    continue;
  }
  failures++;
  process.stderr.write(
    `FAIL: ${testCase.name}\n` +
      `  containers: ${JSON.stringify(testCase.containers)}\n` +
      `  roster:     ${JSON.stringify(testCase.cpIds)}\n` +
      `  expected shared=${JSON.stringify(testCase.shared)} ` +
      `others=${JSON.stringify(testCase.others)}\n` +
      `  got      shared=${JSON.stringify(got.shared)} ` +
      `others=${JSON.stringify(got.others)}\n`,
  );
}

if (failures > 0) {
  process.stderr.write(
    `\nthe foreign-sweep refusal no longer sees what it claims to ` +
      `(${failures}/${cases.length} rows wrong). Read the header: a refusal ` +
      `that misses a container is silent, and what it costs is a sweep spent ` +
      `attributing another sweep's rows to the CSMS under test.\n`,
  );
  process.exit(1);
}

process.stdout.write(`classifyForeignSims: ${cases.length} rows OK\n`);
