/**
 * shard.ts -- cutting one sweep into jobs, without cutting what it measures.
 *
 * WHY THIS IS NOT A SELECTION MECHANISM, which is the distinction #89 turns on.
 * `--group` NAMES a subset and is a taxonomy question (#34); a shard names
 * nothing. It partitions whatever selection is already in effect, so it composes
 * with the taxonomy instead of competing with it, and the milestone after this
 * one does not inherit two ways to say which scenarios to run. That is also why
 * it lives here and not in the group table: a shard is arithmetic on a list,
 * with no opinion about what is in the list.
 *
 * WHY IT HAD TO EXIST NOW. The e2e job's wall is 45 minutes. Measured on this
 * repository's own CI at 83 registered scenarios: a healthy CitrineOS job is
 * 26m33s, and the same job on a run where the CSMS degraded took 45m34s and was
 * killed at the wall with its sweep step still red. The margin was under four
 * minutes, and the suite is going to 147 OCPP 2.0.1 cases on top of 47 OCPP 1.6
 * ones. The failure this prevents is not "slow": it is a job that stops
 * finishing, on the runs that had the most to say.
 *
 * ROUND-ROBIN AND NOT CONTIGUOUS BLOCKS, for two reasons and neither is
 * aesthetic. Scenario cost correlates with POSITION -- the firmware scenarios
 * are slow and adjacent, the 2.0.1 charging-profile ones each install a profile
 * and wait -- so contiguous blocks would put the expensive neighbourhood in one
 * shard and the wall back where it was. And every shard boots its own CSMS, so
 * round-robin also spreads a block's scenarios across stacks, which is the
 * direction that makes cross-scenario contamination LESS likely rather than
 * more: nothing here relies on a neighbour having run, and several rows rely on
 * a neighbour NOT having run (`TC_K_08` needs its profile id to be one no other
 * scenario installed).
 *
 * A PARTITION, NOT A SAMPLE, and the difference has to survive into the report.
 * #89's last line is the requirement: a run that covers less than the full set
 * must say so, because a bounded sweep that prints like a complete one reads as
 * coverage that was not measured. {@link describeShard} is what the summary and
 * the runner's own output print, and it says the count both ways.
 *
 * ONE-BASED, because `--shard 1/3` is what a person writes and `--shard 0/3` is
 * what they then get wrong. The internal arithmetic subtracts the one.
 */
export interface Shard {
    /** 1-based, so `1/3` is the first of three. */
    readonly index: number;
    readonly total: number;
}
/** `k/n`, or a sentence saying why it is not. Returning the message rather than
 *  throwing keeps the caller's error path one shape -- the CLI prints it and
 *  exits, and a guard reads it. */
export declare function parseShard(raw: string): Shard | string;
/**
 * The items belonging to `shard`, in their original order.
 *
 * TOTAL, and that is the property the guard is about: for any list and any n,
 * the n shards partition the list -- every item in exactly one, none invented,
 * order preserved within each. An off-by-one here does not fail loudly; it
 * drops scenarios from the build with every job still green, which is the same
 * silence `tools/summary-red-rows.ts` was extracted to remove one artifact over.
 */
export declare function selectShard<T>(items: readonly T[], shard: Shard | undefined): readonly T[];
/**
 * What a sharded run prints instead of pretending to be a sweep.
 *
 * Both counts, always: "28 of 83" is the sentence a reader needs, and either
 * number alone is the one that misleads. `undefined` returns null so the caller
 * has nothing to print rather than a line saying the run was complete -- a full
 * sweep has always printed no such line, and adding one now would make every
 * archived summary look like it was missing something.
 */
export declare function describeShard(shard: Shard | undefined, selected: number, total: number): string | null;
