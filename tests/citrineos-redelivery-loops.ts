/**
 * The CSMS-log reader that counts redelivery loops answers "none" only when
 * there were none.
 *
 * WHY THIS IS A GUARD AND NOT A SWEEP. Its subject is a 1.5 GB log produced
 * once, by a CI run in which the CSMS collapsed -- an input no offline run can
 * make and no live run can be asked for, since the way to reproduce it is to
 * break the server. So the reader takes an iterable of lines and this file hands
 * it fixtures, the same seam `tck/standing.ts` and
 * `drivers/citrineos/api-client.ts` are split on.
 *
 * THE CLAIM THAT MATTERS IS THE REFUSAL. The envelope pattern is bound to one
 * deployment's log format, key order included, so the way this reader fails is
 * by matching NOTHING and reporting a healthy sweep -- green, with the CSMS
 * looping exactly as before. Two of the five rows below are about telling
 * "nothing matched" from "nothing was there", and they are the two worth having:
 * a threshold that drifts makes a number wrong, a reader that stopped matching
 * makes every future number a lie.
 *
 * WHAT IT DOES NOT CLAIM: that a loop is a defect of this repository, or which
 * request started one. The reader reports a count and a lead; the reading of
 * that lead lives in the issue, and the fix lives upstream.
 */
import {
  LOOP_THRESHOLD,
  describeLoops,
  findRedeliveryLoops,
  type LoopScan,
} from "../drivers/citrineos/redelivery-loops";

let failures = 0;

function fail(what: string, detail: string): void {
  failures += 1;
  process.stderr.write(`FAIL: ${what}\n      ${detail}\n`);
}

function pass(what: string): void {
  process.stdout.write(`  ok: ${what}\n`);
}

/** One dispatch envelope as the pinned image writes it, inside the noise a
 *  docker-compose log puts around it. The prefix is deliberate: the reader must
 *  find the envelope as a SUBSTRING, because that is how it arrives. */
function envelope(action: string, station: string, id: string): string {
  return (
    `citrine          | 2026-09-05T20:23:25.435642989Z } ` +
    `{"origin":"csms","eventGroup":"configuration","action":"${action}",` +
    `"context":{"ocppConnectionName":"${station}","correlationId":"${id}",` +
    `"tenantId":1},"state":1,"protocol":"ocpp2.0.1","payload":{}}`
  );
}

function repeat(line: string, times: number): string[] {
  return Array.from({ length: times }, () => line);
}

const NOISE = [
  "citrine          | 2026-09-05T20:23:25.434229000Z   payload: {",
  "citrine-amqp     | 2026-09-05T20:24:21.844113326Z [error] Channel error",
  "citrine-db       | 2026-09-05T20:11:02.000000000Z LOG:  database ready",
];

async function scan(lines: string[]): Promise<LoopScan> {
  return await findRedeliveryLoops(lines);
}

// 1. A message over the threshold is a loop; one at it is not. The boundary is
//    asserted from BOTH sides, because a reader that reported every dispatched
//    message would also be "green on the run that died" -- unusably, but green.
{
  const looping = envelope("Reset", "CERTCP3", "aaaaaaaa-0000-0000-0000-000000000001");
  const ordinary = envelope("GetVariables", "CERTCP1", "bbbbbbbb-0000-0000-0000-000000000002");
  const result = await scan([
    ...NOISE,
    ...repeat(looping, LOOP_THRESHOLD + 1),
    ...repeat(ordinary, LOOP_THRESHOLD),
  ]);
  if ("unreadable" in result) {
    fail("the threshold", `refused a log it should have read: ${result.unreadable}`);
  } else if (result.loops.length !== 1) {
    fail(
      "the threshold",
      `expected exactly the over-threshold message, got ${result.loops.length}: ` +
        result.loops.map((l) => `${l.action}x${l.logged}`).join(", "),
    );
  } else if (result.loops[0].action !== "Reset" || result.loops[0].station !== "CERTCP3") {
    fail("the threshold", `reported ${result.loops[0].action} -> ${result.loops[0].station}`);
  } else if (result.loops[0].logged !== LOOP_THRESHOLD + 1) {
    fail("the threshold", `counted ${result.loops[0].logged} occurrences`);
  } else if (result.envelopes !== 2 * LOOP_THRESHOLD + 1) {
    fail("the threshold", `counted ${result.envelopes} envelopes`);
  } else {
    pass("a message over the threshold is a loop, one at it is not");
  }
}

// 2. Worst first. The report is read by a human looking for the lead, and the
//    order is the whole of what makes eleven rows usable.
{
  const small = envelope("Reset", "CERTCP1", "cccccccc-0000-0000-0000-000000000003");
  const large = envelope("ChangeAvailability", "CERTCP2", "dddddddd-0000-0000-0000-000000000004");
  const result = await scan([...repeat(small, 20), ...repeat(large, 50)]);
  if ("unreadable" in result) {
    fail("the ordering", "refused a log it should have read");
  } else if (result.loops.map((l) => l.logged).join(",") !== "50,20") {
    fail("the ordering", `got ${result.loops.map((l) => l.logged).join(",")}`);
  } else {
    pass("loops are reported worst first");
  }
}

// 3. Two messages are two messages. The count keys on the correlationId, and an
//    action or a station read from a NEIGHBOURING envelope would pair a request
//    with another request's station -- the reason the pattern is one regex and
//    not three lookups.
{
  const a = envelope("Reset", "CERTCP1", "eeeeeeee-0000-0000-0000-000000000005");
  const b = envelope("SetChargingProfile", "CERTCP3", "ffffffff-0000-0000-0000-000000000006");
  const result = await scan([...repeat(a, 30), ...repeat(b, 40)]);
  if ("unreadable" in result) {
    fail("two messages", "refused a log it should have read");
  } else {
    const seen = result.loops.map((l) => `${l.action}->${l.station}`).sort().join(" ");
    if (seen !== "Reset->CERTCP1 SetChargingProfile->CERTCP3") {
      fail("two messages", `got ${seen}`);
    } else {
      pass("each loop carries the action and station of its own envelope");
    }
  }
}

// 4. THE ONE THAT MATTERS. A log full of lines and empty of envelopes is the
//    shape an upstream rename leaves behind, and it must not read as a healthy
//    sweep. The fixture is real log noise with every envelope removed.
{
  const result = await scan([...NOISE, ...repeat(NOISE[0], 500)]);
  if (!("unreadable" in result)) {
    fail(
      "the refusal",
      `a log with ${result.envelopes} envelopes and 500+ lines was reported as ` +
        `"${describeLoops(result)}" instead of being refused`,
    );
  } else {
    pass("a log with no recognisable envelope is refused, not called healthy");
  }
}

// 5. And its other side: an EMPTY log is not a broken reader. A sweep that
//    captured nothing -- the CSMS never started, the capture step ran before the
//    stack was up -- is a different fact, and refusing it would train a reader to
//    ignore the refusal that matters.
{
  const result = await scan([]);
  if ("unreadable" in result) {
    fail("the empty log", "refused an empty log, which is not a broken reader");
  } else if (result.loops.length !== 0 || result.envelopes !== 0) {
    fail("the empty log", `found ${result.loops.length} loop(s) in nothing`);
  } else {
    pass("an empty log reports nothing rather than refusing");
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). This reader is the only thing that puts a number ` +
      `on a CSMS collapse the verdict table cannot see: the sweep that died ` +
      `with eleven loops still exited 0. Wrong in the loud direction costs a ` +
      `false lead; wrong in the quiet one -- an envelope this no longer matches ` +
      `-- costs every future sweep the signal, with nothing to notice it by.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `CitrineOS redelivery-loop reader: OK (threshold ${LOOP_THRESHOLD}, ` +
    `refuses a log it cannot recognise)\n`,
);
