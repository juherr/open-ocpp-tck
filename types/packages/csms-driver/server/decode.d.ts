/**
 * Strict JSON decoding for the daemon's request bodies.
 *
 * Strict in both directions: a missing or mistyped member is refused, and so
 * is a member the target type does not have. The second matters as much as
 * the first -- a client that sends `chargeBoxId`, or `action` beside the path
 * that already names it, would otherwise be told its request succeeded while
 * the daemon ignored half of it.
 */
/** The request body cannot become the value the route needs. Answered 400. */
export declare class InvalidInputError extends Error {
    constructor(message: string);
}
/** The members of a literal union, as a compiler-checked key set: a
 *  `Record<U, true>` misses no member and names nothing else. */
export declare function literals<U extends string>(members: Record<U, true>): readonly U[];
/** Reads the members of one JSON object, then refuses whatever it did not read. */
export declare class ObjectReader {
    private readonly where;
    private readonly read;
    private readonly value;
    constructor(value: unknown, where: string);
    /** Whether the member is present -- `null` counts, `undefined` cannot occur in JSON. */
    has(name: string): boolean;
    private take;
    private fail;
    /** `read` when the member is present. An absent one needs no marking:
     *  `done()` only refuses members that ARE there. */
    private opt;
    /** Decodes one nested object through its own reader, which refuses its own unknown members. */
    private nested;
    string(name: string): string;
    optString(name: string): string | undefined;
    int(name: string): number;
    optInt(name: string): number | undefined;
    oneOf<U extends string | number>(name: string, members: readonly U[]): U;
    optOneOf<U extends string | number>(name: string, members: readonly U[]): U | undefined;
    /**
     * An RFC 3339 instant with an explicit offset, so its meaning cannot depend
     * on the daemon's time zone. The calendar fields are checked themselves:
     * `Date.parse` rolls an impossible date over -- `2030-02-31` becomes
     * 3 March -- and an expiry that moved by days is worse than a refusal. A
     * leap second is refused too, because a `Date` cannot hold one.
     */
    date(name: string): Date;
    optDate(name: string): Date | undefined;
    strings(name: string): string[];
    optStrings(name: string): string[] | undefined;
    /** Each element of an array member, through its own reader. */
    optObjects<T>(name: string, each: (reader: ObjectReader) => T): T[] | undefined;
    /** A nested object member, through its own reader. */
    optObject<T>(name: string, each: (reader: ObjectReader) => T): T | undefined;
    /** The raw member, for a caller that decides its type itself. */
    raw(name: string): unknown;
    /** Refuses every member nothing asked for. */
    done(): void;
}
/** Drops `undefined` members, so an omitted JSON member stays omitted rather than present-and-undefined. */
export declare function present<T extends object>(value: T): T;
