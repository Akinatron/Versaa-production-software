import Decimal from "decimal.js";
import { inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB } from "./client";
import * as t from "./schema";

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Hold the names lock until the transaction ends, so two saves of the same
 * new name (a double click) run one after the other and the second one sees
 * the first.
 */
export async function lockNames(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(4545)`);
}

/** Today in the business's time zone (see src/domain/dates.ts). */
export { today } from "@/domain/dates";

/**
 * Read a number typed in a form. The one reader every form uses, so they all
 * accept the same things and say the same thing when it's wrong: "7,5" and
 * "7.5" are both 7.5, spaces around are ignored. Empty gives null.
 */
export function readNumber(value: Decimal.Value | null | undefined, what: string): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return new Decimal(value);
  const raw = value.trim().replace(/\s+/g, "");
  if (raw === "") return null;
  // One decimal mark, comma or point. "1.250,5" or "1,250.5" are refused rather than guessed.
  const text = raw.includes(",") && !raw.includes(".") && raw.split(",").length === 2 ? raw.replace(",", ".") : raw;
  let d: Decimal | null = null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) d = new Decimal(text);
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

/** A real calendar date written as YYYY-MM-DD (not 2026-02-31). */
export function isDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

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

