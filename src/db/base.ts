import Decimal from "decimal.js";
import { inArray, sql } from "drizzle-orm";
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

export function positive(value: Decimal.Value, what: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new OperationError(`${what}: "${value}" is not a number.`);
  }
  if (d.isNaN() || d.lte(0)) throw new OperationError(`${what} must be more than 0.`);
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

export async function nextLotCode(tx: Tx, prefix: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t.lots)
    .where(sql`${t.lots.code} like ${prefix + "-%"}`);
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

