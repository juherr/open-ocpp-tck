// Copyright 2026 Julien Herr
// SPDX-License-Identifier: Apache-2.0
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
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/** The members of a literal union, as a compiler-checked key set: a
 *  `Record<U, true>` misses no member and names nothing else. */
export function literals<U extends string>(members: Record<U, true>): readonly U[] {
  return Object.keys(members) as U[];
}

/** Reads the members of one JSON object, then refuses whatever it did not read. */
export class ObjectReader {
  private readonly read = new Set<string>();
  private readonly value: Record<string, unknown>;

  constructor(
    value: unknown,
    private readonly where: string,
  ) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InvalidInputError(`${where} must be a JSON object`);
    }
    this.value = value as Record<string, unknown>;
  }

  /** Whether the member is present -- `null` counts, `undefined` cannot occur in JSON. */
  has(name: string): boolean {
    return Object.hasOwn(this.value, name);
  }

  private take(name: string): unknown {
    this.read.add(name);
    return this.value[name];
  }

  private fail(name: string, expected: string): never {
    throw new InvalidInputError(`${this.where}.${name} must be ${expected}`);
  }

  /** `read` when the member is present. An absent one needs no marking:
   *  `done()` only refuses members that ARE there. */
  private opt<T>(name: string, read: (name: string) => T): T | undefined {
    return this.has(name) ? read(name) : undefined;
  }

  /** Decodes one nested object through its own reader, which refuses its own unknown members. */
  private nested<T>(value: unknown, where: string, each: (reader: ObjectReader) => T): T {
    const reader = new ObjectReader(value, where);
    const decoded = each(reader);
    reader.done();
    return decoded;
  }

  string(name: string): string {
    const value = this.take(name);
    if (typeof value !== "string") this.fail(name, "a string");
    return value;
  }

  optString(name: string): string | undefined {
    return this.opt(name, (n) => this.string(n));
  }

  int(name: string): number {
    const value = this.take(name);
    if (typeof value !== "number" || !Number.isInteger(value)) this.fail(name, "an integer");
    return value;
  }

  optInt(name: string): number | undefined {
    return this.opt(name, (n) => this.int(n));
  }

  oneOf<U extends string | number>(name: string, members: readonly U[]): U {
    const value = this.take(name);
    if (!members.includes(value as U)) this.fail(name, `one of ${members.map((m) => JSON.stringify(m)).join(", ")}`);
    return value as U;
  }

  optOneOf<U extends string | number>(name: string, members: readonly U[]): U | undefined {
    return this.opt(name, (n) => this.oneOf(n, members));
  }

  /**
   * An RFC 3339 instant with an explicit offset, so its meaning cannot depend
   * on the daemon's time zone. The calendar fields are checked themselves:
   * `Date.parse` rolls an impossible date over -- `2030-02-31` becomes
   * 3 March -- and an expiry that moved by days is worse than a refusal. A
   * leap second is refused too, because a `Date` cannot hold one.
   */
  date(name: string): Date {
    const value = this.take(name);
    const fields =
      typeof value === "string"
        ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
        : null;
    if (!fields) this.fail(name, "an RFC 3339 date-time with an offset, e.g. 2030-01-02T03:04:05Z");
    const [year, month, day, hour, minute, second] = fields.slice(1, 7).map(Number) as [
      number, number, number, number, number, number,
    ];
    const asWritten = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const sameFields =
      asWritten.getUTCFullYear() === year &&
      asWritten.getUTCMonth() === month - 1 &&
      asWritten.getUTCDate() === day &&
      asWritten.getUTCHours() === hour &&
      asWritten.getUTCMinutes() === minute &&
      asWritten.getUTCSeconds() === second;
    const offset = fields[8]!;
    const offsetValid = offset === "Z" || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59);
    if (!sameFields || !offsetValid) this.fail(name, "a date-time that exists on the calendar");
    return new Date(value as string);
  }

  optDate(name: string): Date | undefined {
    return this.opt(name, (n) => this.date(n));
  }

  strings(name: string): string[] {
    const value = this.take(name);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      this.fail(name, "an array of strings");
    }
    return value as string[];
  }

  optStrings(name: string): string[] | undefined {
    return this.opt(name, (n) => this.strings(n));
  }

  /** Each element of an array member, through its own reader. */
  optObjects<T>(name: string, each: (reader: ObjectReader) => T): T[] | undefined {
    return this.opt(name, (n) => {
      const value = this.take(n);
      if (!Array.isArray(value)) this.fail(n, "an array");
      return value.map((item, index) => this.nested(item, `${this.where}.${n}[${index}]`, each));
    });
  }

  /** A nested object member, through its own reader. */
  optObject<T>(name: string, each: (reader: ObjectReader) => T): T | undefined {
    return this.opt(name, (n) => this.nested(this.take(n), `${this.where}.${n}`, each));
  }

  /** The raw member, for a caller that decides its type itself. */
  raw(name: string): unknown {
    return this.take(name);
  }

  /** Refuses every member nothing asked for. */
  done(): void {
    const unknown = Object.keys(this.value).filter((key) => !this.read.has(key));
    if (unknown.length > 0) {
      throw new InvalidInputError(`${this.where} has unknown member(s): ${unknown.join(", ")}`);
    }
  }
}

/** Drops `undefined` members, so an omitted JSON member stays omitted rather than present-and-undefined. */
export function present<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)) as T;
}
