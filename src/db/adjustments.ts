import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, checkWholeUnits, itemsById, nextLotCode, today } from "./base";
import { lotBalance } from "./ledger";

/*
 * Stock corrections after the opening count. The number is never edited:
 * each correction is a movement with a reason, so the balance stays
 * explainable and the history stays complete.
 */

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface CountLine {
  /** An existing lot to recount… */
  lotId?: string | null;
  /** …or an item found without a lot (creates one). */
  itemId?: string | null;
  counted: Decimal.Value;
  bestBefore?: string | null;
}

/**
 * Record a stock count. For each lot, the difference between what's counted
 * and what the ledger says is posted as a count correction.
 */
export async function recordStockCount(db: DB, input: { idempotencyKey: string; countedOn?: string; reason: string; lines: CountLine[] }) {
  const reason = input.reason.trim();
  if (!reason) throw new OperationError("Say why stock is being recounted (e.g. monthly count, breakage found).");
  const lines = input.lines.filter((l) => String(l.counted).trim() !== "");
  if (!lines.length) throw new OperationError("Enter at least one counted quantity.");
  const on = input.countedOn && isDate(input.countedOn) ? input.countedOn : today();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.stockAdjustments).where(eq(t.stockAdjustments.idempotencyKey, input.idempotencyKey));
    if (existing) return { adjustment: existing, changed: 0, alreadyRecorded: true };
    const [adj] = await tx
      .insert(t.stockAdjustments)
      .values({ type: "count_correction", reason, occurredOn: on, idempotencyKey: input.idempotencyKey })
      .returning();

    let i = 0;
    let changed = 0;
    for (const line of lines) {
      const counted = new Decimal(line.counted);
      if (counted.isNaN() || counted.lt(0)) throw new OperationError("Counted quantities can't be negative.");
      let lotId = line.lotId || null;
      let itemId: string;
      if (lotId) {
        const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, lotId));
        if (!lot) throw new OperationError("Lot not found.");
        itemId = lot.itemId;
      } else {
        if (!line.itemId) throw new OperationError("Choose a lot or an item.");
        itemId = line.itemId;
      }
      const item = (await itemsById(tx, [itemId])).get(itemId)!;
      checkWholeUnits(item, counted);
      if (!lotId) {
        if (counted.isZero()) continue;
        const [lot] = await tx
          .insert(t.lots)
          .values({ itemId, code: await nextLotCode(tx, `COUNT-${on.replaceAll("-", "")}`), receivedOn: on, bestBefore: line.bestBefore || null })
          .returning();
        lotId = lot!.id;
      }
      const diff = counted.minus(await lotBalance(tx, lotId));
      if (diff.isZero()) continue;
      await tx.insert(t.movements).values({
        lotId,
        itemId,
        quantity: diff.toString(),
        type: "count_correction",
        occurredAt: new Date(`${on}T18:00:00Z`),
        docType: "stock_adjustment",
        docId: adj!.id,
        reason,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
      changed++;
    }
    return { adjustment: adj!, changed, alreadyRecorded: false };
  });
}

/** Take stock out of a lot for waste, breakage, internal use or samples, with a reason. */
export async function recordWriteOff(
  db: DB,
  input: { idempotencyKey: string; type: "waste" | "internal_use" | "sample"; reason: string; occurredOn?: string; lines: { lotId: string; quantity: Decimal.Value }[] },
) {
  const reason = input.reason.trim();
  if (!reason) throw new OperationError("Say what happened.");
  const lines = input.lines.filter((l) => l.lotId && String(l.quantity).trim() !== "" && !new Decimal(l.quantity).isZero());
  if (!lines.length) throw new OperationError("Enter at least one quantity.");
  const on = input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.stockAdjustments).where(eq(t.stockAdjustments.idempotencyKey, input.idempotencyKey));
    if (existing) return { adjustment: existing, alreadyRecorded: true };
    const [adj] = await tx.insert(t.stockAdjustments).values({ type: input.type, reason, occurredOn: on, idempotencyKey: input.idempotencyKey }).returning();
    let i = 0;
    for (const line of lines) {
      const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, line.lotId));
      if (!lot) throw new OperationError("Lot not found.");
      const item = (await itemsById(tx, [lot.itemId])).get(lot.itemId)!;
      const qty = new Decimal(line.quantity);
      if (qty.isNaN() || qty.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
      checkWholeUnits(item, qty);
      const balance = await lotBalance(tx, lot.id);
      if (balance.lt(qty)) throw new OperationError(`${item.name}: lot ${lot.code} only has ${balance} left.`);
      await tx.insert(t.movements).values({
        lotId: lot.id,
        itemId: lot.itemId,
        quantity: qty.neg().toString(),
        type: input.type,
        occurredAt: new Date(`${on}T18:00:00Z`),
        docType: "stock_adjustment",
        docId: adj!.id,
        reason,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }
    return { adjustment: adj!, alreadyRecorded: false };
  });
}
