// Accept/reject per case, decided by the SPECIFICATION's own validator.
//
// Run from inside a clone of open-ocpp-trace/specification, where `ajv` and
// `ajv-formats` are its dependencies -- this file deliberately imports them
// from there rather than adding them here, because the whole point is to ask
// the document's toolchain rather than one of our own choosing.
//
// Usage: node <this> <schema.json> <cases.json>   ->  "<name>\t<accept|reject>"
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [, , schemaPath, casesPath] = process.argv;
if (!schemaPath || !casesPath) {
  console.error("usage: trace-format-ajv-verdicts.mjs <schema> <cases>");
  process.exit(2);
}

const require = createRequire(`${process.cwd()}/`);
const Ajv = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));

for (const c of JSON.parse(readFileSync(casesPath, "utf8")).cases) {
  process.stdout.write(`${c.name}\t${validate(c.record) ? "accept" : "reject"}\n`);
}
