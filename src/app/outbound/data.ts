import Decimal from "decimal.js";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { fefo } from "@/db/ledger";

export interface FinishedLot {
  id: string;
  code: string;
  productId: string;
  productName: string;
  itemId: string;
  batchId: string | null;
  bestBefore: string | null;
  receivedOn: string | null;
  createdAt: Date;
  balance: Decimal;
}

/** Finished-jar lots that still have jars, earliest best-before first. */
export async function finishedLots(): Promise<FinishedLot[]> {
  const rows = await db()
    .select({
      lot: t.lots,
      productId: t.products.id,
      productName: t.products.name,
      balance: sql<string>`coalesce((select sum(m.quantity) from movements m where m.lot_id = ${t.lots.id}), 0)`,
    })
    .from(t.lots)
    .innerJoin(t.products, eq(t.products.itemId, t.lots.itemId));
  return rows
    .map((r) => ({
      id: r.lot.id,
      code: r.lot.code,
      productId: r.productId,
      productName: r.productName,
      itemId: r.lot.itemId,
      batchId: r.lot.batchId,
      bestBefore: r.lot.bestBefore,
      receivedOn: r.lot.receivedOn,
      createdAt: r.lot.createdAt,
      balance: new Decimal(r.balance),
    }))
    .filter((l) => l.balance.gt(0))
    .sort(fefo);
}

/** Which lots "earliest best-before first" would take `jars` from (preview only). */
export function fefoPreview(lots: FinishedLot[], productId: string, jars: number) {
  const out: { lot: FinishedLot; jars: number }[] = [];
  let left = jars;
  for (const l of lots.filter((x) => x.productId === productId)) {
    if (left <= 0) break;
    const take = Math.min(left, l.balance.toNumber());
    out.push({ lot: l, jars: take });
    left -= take;
  }
  return { out, short: left > 0 ? left : 0 };
}

export async function activeProducts() {
  return db().select().from(t.products).where(eq(t.products.active, true)).orderBy(asc(t.products.name));
}

export async function customerList() {
  return db().select().from(t.customers).orderBy(asc(t.customers.name));
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
