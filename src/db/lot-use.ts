import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as t from "./schema";
import { OperationError, type Tx } from "./base";
import { fefo } from "./ledger";

/*
 * How a document (a batch's ingredient line, a packaging session) uses lots,
 * and how to move that use to a new figure with new movements only.
 *
 * Recording again or correcting never edits a movement: it posts the
 * difference per lot. More used → taken from the same lot first. Less used →
 * given back to the lots it came from, the latest-expiring first.
 */

/** Quantity per lot id. Positive means used. */
export type LotSplit = Map<string, Decimal>;

export interface LotInfo {
  id: string;
  code: string;
  itemId: string;
  supplierBatch: string | null;
  bestBefore: string | null;
  receivedOn: string | null;
  createdAt: Date;
  balance: Decimal;
}

const D0 = new Decimal(0);

/** Every lot of these items with its balance, including empty ones, earliest best-before first. */
export async function lotsOf(tx: Tx, itemIds: string[]): Promise<LotInfo[]> {
  if (!itemIds.length) return [];
  const rows = await tx
    .select({ lot: t.lots, balance: sql<string>`coalesce(sum(${t.movements.quantity}), 0)` })
    .from(t.lots)
    .leftJoin(t.movements, eq(t.movements.lotId, t.lots.id))
    .where(inArray(t.lots.itemId, itemIds))
    .groupBy(t.lots.id);
  return rows
    .map((r) => ({
      id: r.lot.id,
      code: r.lot.code,
      itemId: r.lot.itemId,
      supplierBatch: r.lot.supplierBatch,
      bestBefore: r.lot.bestBefore,
      receivedOn: r.lot.receivedOn,
      createdAt: r.lot.createdAt,
      balance: new Decimal(r.balance),
    }))
    .sort(fefo);
}

/** What each document has used so far, per document, item and lot (positive = used). */
export async function usedByDocs(tx: Tx, docType: string, docIds: string[]) {
  const out = new Map<string, Map<string, LotSplit>>();
  if (!docIds.length) return out;
  const rows = await tx
    .select({ docId: t.movements.docId, itemId: t.movements.itemId, lotId: t.movements.lotId, used: sql<string>`-sum(${t.movements.quantity})` })
    .from(t.movements)
    .where(and(sql`${t.movements.docType} = ${docType}`, inArray(t.movements.docId, docIds)))
    .groupBy(t.movements.docId, t.movements.itemId, t.movements.lotId);
  for (const r of rows) {
    const used = new Decimal(r.used);
    if (used.isZero()) continue;
    const byItem = out.get(r.docId!) ?? new Map<string, LotSplit>();
    const split = byItem.get(r.itemId) ?? new Map<string, Decimal>();
    split.set(r.lotId, used);
    byItem.set(r.itemId, split);
    out.set(r.docId!, byItem);
  }
  return out;
}

export const splitTotal = (s: LotSplit) => [...s.values()].reduce((a, b) => a.plus(b), D0);

export function sameSplit(a: LotSplit, b: LotSplit) {
  const ids = new Set([...a.keys(), ...b.keys()]);
  return [...ids].every((id) => (a.get(id) ?? D0).eq(b.get(id) ?? D0));
}

/**
 * The split for an automatic quantity. What's already taken stays; more comes
 * from the lots already used first, then the earliest-expiring others; less is
 * given back starting with the latest-expiring lot.
 */
export function autoSplit(item: { name: string; stockUnit: string }, current: LotSplit, lots: LotInfo[], quantity: Decimal): LotSplit {
  const target = new Map(current);
  const have = splitTotal(current);
  if (quantity.gt(have)) {
    let need = quantity.minus(have);
    const ordered = [...lots.filter((l) => current.has(l.id)), ...lots.filter((l) => !current.has(l.id))];
    for (const lot of ordered) {
      if (need.lte(0)) break;
      if (lot.balance.lte(0)) continue;
      const take = Decimal.min(need, lot.balance);
      target.set(lot.id, (target.get(lot.id) ?? D0).plus(take));
      need = need.minus(take);
    }
    if (need.gt(0)) {
      const inStock = lots.reduce((s, l) => s.plus(Decimal.max(D0, l.balance)), D0);
      throw new OperationError(
        `Not enough ${item.name}: ${quantity.minus(have)} ${item.stockUnit} more needed, ${inStock} in stock. Record the delivery or correct the stock count first.`,
      );
    }
  } else if (quantity.lt(have)) {
    let give = have.minus(quantity);
    const ordered = lots.filter((l) => current.has(l.id)).reverse();
    for (const lot of ordered) {
      if (give.lte(0)) break;
      const back = Decimal.min(give, target.get(lot.id)!);
      target.set(lot.id, target.get(lot.id)!.minus(back));
      give = give.minus(back);
    }
  }
  return target;
}

/** Check a split chosen by hand: lots of this item, and enough left in each for what's added. */
export function checkManualSplit(item: { id: string; name: string; stockUnit: string }, current: LotSplit, target: LotSplit, lots: LotInfo[]) {
  for (const [lotId, qty] of target) {
    if (qty.lt(0)) throw new OperationError(`${item.name}: quantities can't be negative.`);
    const lot = lots.find((l) => l.id === lotId);
    if (!lot) throw new OperationError(`${item.name}: one of the chosen lots isn't a lot of ${item.name}.`);
    const more = qty.minus(current.get(lotId) ?? D0);
    if (more.gt(lot.balance)) {
      throw new OperationError(`${item.name}: lot ${lot.code} only has ${Decimal.max(D0, lot.balance)} ${item.stockUnit} left.`);
    }
  }
}

/** Post the movements that take a document's use of one item from `current` to `target`. Returns how many were posted. */
export async function applySplit(
  tx: Tx,
  a: {
    itemId: string;
    docType: string;
    docId: string;
    current: LotSplit;
    target: LotSplit;
    at: Date;
    takeReason: string;
    giveReason: string;
    keyPrefix: string;
    /** The history entry that caused these movements, when it is a correction. */
    changeId?: string | null;
  },
) {
  let i = 0;
  const ids = new Set([...a.current.keys(), ...a.target.keys()]);
  for (const lotId of ids) {
    const diff = (a.target.get(lotId) ?? D0).minus(a.current.get(lotId) ?? D0);
    if (diff.isZero()) continue;
    await tx.insert(t.movements).values({
      lotId,
      itemId: a.itemId,
      quantity: diff.neg().toString(),
      type: diff.gt(0) ? "consumption" : "reversal",
      occurredAt: a.at,
      docType: a.docType,
      docId: a.docId,
      reason: diff.gt(0) ? a.takeReason : a.giveReason,
      idempotencyKey: `${a.keyPrefix}:${i++}`,
      changeId: a.changeId ?? null,
    });
  }
  return i;
}
