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

export const today = () => new Date().toISOString().slice(0, 10);

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

