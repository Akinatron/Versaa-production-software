import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as t from "./schema";
import { OperationError, type Tx } from "./base";

/** Current balance of each lot of the given items (only lots with stock left). */
export async function lotBalances(tx: Tx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const rows = await tx
    .select({
      lot: t.lots,
      balance: sql<string>`coalesce(sum(${t.movements.quantity}), 0)`,
    })
    .from(t.lots)
    .leftJoin(t.movements, eq(t.movements.lotId, t.lots.id))
    .where(inArray(t.lots.itemId, itemIds))
    .groupBy(t.lots.id);
  return rows
    .map((r) => ({ ...r.lot, balance: new Decimal(r.balance) }))
    .filter((r) => r.balance.gt(0))
    .sort(fefo);
}

export async function lotBalance(tx: Tx, lotId: string) {
  const [row] = await tx
    .select({ balance: sql<string>`coalesce(sum(${t.movements.quantity}), 0)` })
    .from(t.movements)
    .where(eq(t.movements.lotId, lotId));
  return new Decimal(row?.balance ?? 0);
}

/** First expiring first; lots without a date after dated ones, oldest first. */
export function fefo(a: { bestBefore: string | null; receivedOn: string | null; createdAt: Date }, b: typeof a) {
  if (a.bestBefore !== b.bestBefore) {
    if (a.bestBefore === null) return 1;
    if (b.bestBefore === null) return -1;
    return a.bestBefore < b.bestBefore ? -1 : 1;
  }
  const ra = a.receivedOn ?? "", rb = b.receivedOn ?? "";
  if (ra !== rb) return ra < rb ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export interface Allocation {
  lotId: string;
  quantity: Decimal;
}

/**
 * Decide which lots a quantity is taken from. With `chosen` lots, those are
 * checked; otherwise the earliest-expiring lots are used first. Never lets a
 * lot go below zero.
 */
export async function allocate(
  tx: Tx,
  item: { id: string; name: string; stockUnit: string },
  quantity: Decimal,
  chosen?: { lotId: string; quantity: Decimal.Value }[],
): Promise<Allocation[]> {
  if (quantity.isZero() && !chosen?.length) return [];
  const lots = await lotBalances(tx, [item.id]);
  if (chosen && chosen.length > 0) {
    const out: Allocation[] = [];
    for (const c of chosen) {
      const q = new Decimal(c.quantity);
      if (q.isZero()) continue;
      if (q.lt(0)) throw new OperationError(`${item.name}: quantities can't be negative.`);
      const lot = lots.find((l) => l.id === c.lotId);
      if (!lot) {
        const [other] = await tx.select().from(t.lots).where(eq(t.lots.id, c.lotId));
        if (other && other.itemId !== item.id) throw new OperationError(`${item.name}: lot ${other.code} is a different item.`);
        throw new OperationError(`${item.name}: ${other ? `lot ${other.code}` : "that lot"} has no stock left.`);
      }
      if (lot.balance.lt(q)) throw new OperationError(`${item.name}: lot ${lot.code} only has ${lot.balance} ${item.stockUnit} left.`);
      out.push({ lotId: lot.id, quantity: q });
    }
    return out;
  }
  const total = lots.reduce((s, l) => s.plus(l.balance), new Decimal(0));
  if (total.lt(quantity)) {
    throw new OperationError(
      `Not enough ${item.name}: ${quantity} ${item.stockUnit} needed, ${total} in stock. Record the delivery or correct the stock count first.`,
    );
  }
  const out: Allocation[] = [];
  let left = quantity;
  for (const lot of lots) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, lot.balance);
    out.push({ lotId: lot.id, quantity: take });
    left = left.minus(take);
  }
  return out;
}

/** Jars of a finished item reserved by pending sales orders (other than `exceptOrderId`). */
export async function reservedForSales(tx: Tx, itemId: string, exceptOrderId?: string) {
  const [row] = await tx.execute<{ qty: string | null }>(sql`
    select sum(quantity) as qty from reservations
    where item_id = ${itemId} and released_at is null and sales_order_id is not null
    ${exceptOrderId ? sql`and sales_order_id <> ${exceptOrderId}` : sql``}`);
  return new Decimal(row?.qty ?? 0);
}

export async function itemOnHand(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({ qty: sql<string>`coalesce(sum(${t.movements.quantity}), 0)` })
    .from(t.movements)
    .where(and(eq(t.movements.itemId, itemId)));
  return new Decimal(row?.qty ?? 0);
}
