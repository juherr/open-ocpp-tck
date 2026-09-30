/**
 * Accept/reject per case, decided by THIS repository's transcription.
 *
 * The other half of the differential in `tools/trace-conformance.sh`. Prints
 * the same `<name>\t<accept|reject>` shape as
 * `tools/trace-format-ajv-verdicts.mjs`, so the two are a `diff`.
 *
 * "Accept" is `record !== undefined`, which is exactly the contract
 * `validate.ts` opens with: a record comes back if and only if the value
 * satisfies the schema. Diagnostics that come back WITH a record -- an
 * unreadable `schemaVersion` major, a `raw` that contradicts its envelope --
 * are not schema facts and are deliberately not part of this comparison.
 */
import { readFileSync } from "node:fs";

import { validateRecord } from "../packages/trace-format";

const casesPath = process.argv[2];
if (!casesPath) {
  process.stderr.write("usage: trace-format-our-verdicts.ts <cases>\n");
  process.exit(2);
}

interface Case {
  name: string;
  record: unknown;
}

const { cases } = JSON.parse(readFileSync(casesPath, "utf8")) as {
  cases: Case[];
};
for (const c of cases) {
  const accepted = validateRecord(c.record, 0).record !== undefined;
  process.stdout.write(`${c.name}\t${accepted ? "accept" : "reject"}\n`);
}
