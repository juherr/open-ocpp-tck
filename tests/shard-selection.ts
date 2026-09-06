/**
 * The n shards of a sweep partition it: every scenario in exactly one, none
 * invented, order kept.
 *
 * WHY THIS IS A GUARD AND NOT A SWEEP. The way sharding fails is by DROPPING
 * scenarios, and a dropped scenario is not a red row -- it is a job that goes
 * green having measured less than it says. Reaching that from the CLI means one
 * container per scenario per shard count, on a daemon this repository's own
 * sweeps share, to observe an absence. `selectShard` is pure for exactly that
 * reason, the same split `tck/standing.ts` and `tck/states-201.ts` are.
 *
 * THE ROW THAT MATTERS IS THE UNION. A shard that is merely balanced, or merely
 * in range, can still lose the last item of an odd-length list to nobody: an
 * off-by-one in the modulus reads correctly, distributes evenly, and silently
 * runs 82 of 83 scenarios. So the check is set equality against the input, at
 * every shard count from 1 to more shards than there are items -- not a spot
 * check on the count.
 *
 * BALANCE IS CHECKED TOO, and it is the weaker claim. It does not have to hold
 * for the build to be correct; it has to hold for the wall-clock argument in
 * `tck/shard.ts`'s header to be true, and a partition that put 80 of 83 in one
 * shard would satisfy every other row here while leaving the 45-minute job
 * exactly where it was.
 */
import {
  describeShard,
  parseShard,
  selectShard,
  type Shard,
} from "../tck/shard";

let failures = 0;

function fail(what: string, detail: string): void {
  failures += 1;
  process.stderr.write(`FAIL: ${what}\n      ${detail}\n`);
}

function pass(what: string): void {
  process.stdout.write(`  ok: ${what}\n`);
}

/** Stand-ins for scenarios: what `selectShard` sees is a list, and it may not
 *  look at what is in it. Strings make a disagreement readable. */
function items(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i}`);
}

// 1. THE PARTITION. Every item in exactly one shard, nothing invented, for a
//    spread of list lengths against a spread of shard counts -- including more
//    shards than items, which is the shape a workflow reaches by growing its
//    matrix and not its suite.
{
  let broken: string | null = null;
  for (const size of [0, 1, 2, 3, 5, 8, 47, 83, 194]) {
    const all = items(size);
    for (let total = 1; total <= 6 && broken === null; total++) {
      const seen: string[] = [];
      for (let index = 1; index <= total; index++) {
        seen.push(...selectShard(all, { index, total }));
      }
      if (seen.length !== all.length) {
        broken = `${size} item(s) over ${total} shard(s) produced ${seen.length}`;
      } else if ([...seen].sort().join(",") !== [...all].sort().join(",")) {
        broken = `${size} item(s) over ${total} shard(s) produced a different set`;
      }
    }
  }
  if (broken) fail("the partition", broken);
  else pass("every item lands in exactly one shard, at every count tried");
}

// 2. ORDER IS KEPT WITHIN A SHARD. The sweep assigns stations by position and
//    the summary is read top to bottom; a shard that reordered would make two
//    runs of the same shard incomparable.
{
  const all = items(20);
  const shard: Shard = { index: 2, total: 3 };
  const got = selectShard(all, shard);
  const expected = all.filter((_, i) => i % 3 === 1);
  if (got.join(",") !== expected.join(",")) {
    fail("the order", `got ${got.join(",")}`);
  } else {
    pass("a shard keeps the input order");
  }
}

// 3. ROUND-ROBIN AND NOT CONTIGUOUS. The header's wall-clock argument rests on
//    it: cost correlates with position, so blocks would put the expensive
//    neighbourhood in one shard. Asserted by a property no block partition has
//    -- consecutive items land in DIFFERENT shards.
{
  const all = items(9);
  const first = selectShard(all, { index: 1, total: 3 });
  if (first.join(",") !== "s0,s3,s6") {
    fail("round-robin", `shard 1 of 3 over 9 items was ${first.join(",")}`);
  } else {
    pass("shards interleave rather than taking contiguous blocks");
  }
}

// 4. BALANCE. Sizes differ by at most one, which is what makes the wall-clock
//    argument hold. Weaker than the partition row and here for that reason.
{
  let broken: string | null = null;
  for (const size of [7, 47, 83, 194]) {
    const all = items(size);
    for (let total = 2; total <= 5 && broken === null; total++) {
      const sizes = Array.from({ length: total }, (_, i) =>
        selectShard(all, { index: i + 1, total }).length,
      );
      if (Math.max(...sizes) - Math.min(...sizes) > 1) {
        broken = `${size} over ${total} gave sizes ${sizes.join(",")}`;
      }
    }
  }
  if (broken) fail("balance", broken);
  else pass("shard sizes differ by at most one");
}

// 5. NO SHARD MEANS EVERYTHING, and it must be the same list rather than a
//    copy-shaped near-miss: a full sweep is the case every archived run is, and
//    a filter applied to it would be a behaviour change nothing asked for.
{
  const all = items(11);
  const got = selectShard(all, undefined);
  if (got.length !== all.length || got.join(",") !== all.join(",")) {
    fail("no shard", `got ${got.length} of ${all.length}`);
  } else {
    pass("an absent shard selects the whole list");
  }
}

// 6. THE PARSER REFUSES WHAT WOULD SILENTLY RUN HALF THE SUITE. `2x/3` is the
//    one worth the row: parseInt would read it as 2 and the build would go
//    green having run a third of what the author asked for.
{
  const bad: [string, string][] = [
    ["1-3", "not k/n"],
    ["2x/3", "not an integer"],
    ["1/0", "no shards"],
    ["0/3", "below range"],
    ["4/3", "above range"],
    ["1/2/3", "three parts"],
    ["", "empty"],
    ["1.5/3", "fractional"],
  ];
  const wrong = bad.filter(([raw]) => typeof parseShard(raw) !== "string");
  if (wrong.length > 0) {
    fail("the parser", `accepted ${wrong.map(([r]) => JSON.stringify(r)).join(", ")}`);
  } else if (typeof parseShard("2/3") === "string") {
    fail("the parser", `refused "2/3", which is valid`);
  } else {
    pass("the parser refuses every malformed shard and accepts a good one");
  }
}

// 7. A PARTIAL RUN SAYS SO, and a full one does not acquire a line saying it is
//    full -- every archived summary would then look like it was missing
//    something. This is #89's closing requirement, and it is the only row here
//    about words rather than arithmetic.
{
  const note = describeShard({ index: 2, total: 3 }, 28, 83);
  const missing = ["Shard 2 of 3", "28 of 83", "PARTITION, NOT A SWEEP", "55"]
    .filter((needle) => !note?.includes(needle));
  if (missing.length > 0) {
    fail("the disclosure", `the note omits ${missing.join(", ")}: ${note}`);
  } else if (describeShard(undefined, 83, 83) !== null) {
    fail("the disclosure", "a full sweep was given a shard line");
  } else {
    pass("a sharded run says what it left out; a full one says nothing");
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n${failures} failure(s). Sharding fails by DROPPING scenarios, and a ` +
      `dropped scenario is not a red row -- it is a green job that measured ` +
      `less than its table claims. The partition row is the one that catches ` +
      `that; the rest keep the wall-clock argument and the disclosure honest.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "Shard selection: OK (a partition, order kept, balanced, and a partial run says so)\n",
);
