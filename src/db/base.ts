import Decimal from "decimal.js";
import { inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB } from "./client";
import * as t from "./schema";
import { numberText } from "@/domain/typed-number";

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Saves that must run one after the other. Each holds its lock until its
 * transaction ends, so the second one sees what the first did.
 */
const LOCK = {
  /** Confirming runs: two can't reserve the same stock at once. */
  runConfirm: 4242,
  /** Jars leaving or coming back (deliveries, write-offs, restores): two can't take the same jars. */
  jarsOut: 4343,
  /** A new name saved twice (a double click). */
  names: 4545,
} as const;

export async function lock(tx: Tx, what: keyof typeof LOCK) {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(LOCK[what]))})`);
}

export const lockNames = (tx: Tx) => lock(tx, "names");

/** Today in the business's time zone (see src/domain/dates.ts). */
export { today } from "@/domain/dates";
import { today as todayIso } from "@/domain/dates";

/**
 * Read a number typed in a form. The one reader every form uses, so they all
 * accept the same things and say the same thing when it's wrong: "7,5" and
 * "7.5" are both 7.5, spaces around are ignored. Empty gives null.
 */
export function readNumber(value: Decimal.Value | null | undefined, what: string): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return new Decimal(value);
  // One decimal mark, comma or point. "1.250,5" or "1,250.5" are refused rather than guessed.
  const text = numberText(value);
  if (text === "") return null;
  const d = text === null ? null : new Decimal(text);
  if (!d || d.isNaN() || !d.isFinite()) throw new OperationError(`${what}: "${value}" is not a number. Write it like 7.5 or 7,5.`);
  return d;
}

/** A number of 0 or more, or null when left empty. */
export function zeroOrMore(value: Decimal.Value | null | undefined, what: string): Decimal | null {
  const d = readNumber(value, what);
  if (d && d.lt(0)) throw new OperationError(`${what}: can't be negative.`);
  return d;
}

/** A number of more than 0; empty isn't allowed. */
export function positive(value: Decimal.Value | null | undefined, what: string): Decimal {
  const d = readNumber(value, what);
  if (!d || d.lte(0)) throw new OperationError(`${what}: must be more than 0.`);
  return d;
}

export async function itemsById(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof t.items.$inferSelect>();
  const rows = await tx.select().from(t.items).where(inArray(t.items.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Something that already happened (a delivery, an exit, a count, cooking,
 * packing) can't be dated after today: a date in the future would put its
 * stock on the wrong side of every count until that day.
 */
export function notFuture(day: string, what: string) {
  if (day > todayIso()) throw new OperationError(`${what} can't be in the future.`);
}

/** A real calendar date written as YYYY-MM-DD (not 2026-02-31). */
export function isDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Litres in the jars of the rows summed: sum(jars × fill ml) ÷ 1000, like litresFromJars(). Column names only, never input. */
export const sumLitres = (jarsColumn: string, fillMlColumn: string) => sql.raw(`(sum(${jarsColumn} * ${fillMlColumn}) / 1000.0)`);

/** A list of texts for `in (…)` in SQL: sql`status::text in (${sqlList(PO_ON_THE_WAY)})`. */
export const sqlList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

export function checkWholeUnits(item: typeof t.items.$inferSelect, qty: Decimal) {
  if (item.stockUnit === "unit" && !qty.isInteger()) {
    throw new OperationError(`${item.name} is counted in whole units.`);
  }
}

/**
 * The next code that starts with `prefix`, such as RUN-20261029-01. A counter
 * per prefix in the database hands out the numbers, with no chance involved.
 * The first time a prefix is used it starts after the codes already there,
 * and a number already taken (an older code) is skipped, so the same code is
 * never given twice. Codes already given never change.
 */
export async function nextCode(tx: Tx, column: AnyPgColumn, prefix: string, digits = 2): Promise<string> {
  const table = column.table;
  for (let tries = 0; tries < 1000; tries++) {
    const [row] = await tx.execute<{ last: number }>(sql`
      insert into code_counters (prefix, last)
      values (${prefix}, (select count(*)::int from ${table} where ${column} like ${prefix + "-%"}) + 1)
      on conflict (prefix) do update set last = code_counters.last + 1
      returning last`);
    const code = `${prefix}-${String(row!.last).padStart(digits, "0")}`;
    const [taken] = await tx.execute(sql`select 1 from ${table} where ${column} = ${code} limit 1`);
    if (!taken) return code;
  }
  throw new Error(`No free code left for ${prefix}.`);
}

export const nextLotCode = (tx: Tx, prefix: string) => nextCode(tx, t.lots.code, prefix, 3);

