import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { ADJUSTMENT_NAME } from "@/domain/status";
import { OperationError, checkWholeUnits, itemsById, nextLotCode, today, type Tx, isDate, notFuture, readNumber, zeroOrMore } from "./base";
import { lotBalance, lotBalanceAt } from "./ledger";
import { logChange, needReason, type FieldChange, type Ref } from "./changes";

/*
 * Stock corrections after the opening count. The number is never edited:
 * each correction is a movement with a reason, so the balance stays
 * explainable and the history stays complete.
 */


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
 * and what the ledger held at the end of the count day is posted as a count
 * correction. So a count entered days later doesn't undo what was recorded
 * after it (cooking, packing, deliveries, write-offs).
 */
export async function recordStockCount(db: DB, input: { idempotencyKey: string; countedOn?: string; reason: string; lines: CountLine[] }) {
  const reason = input.reason.trim();
  if (!reason) throw new OperationError("Say why stock is being recounted (e.g. monthly count, breakage found).");
  const lines = input.lines.filter((l) => String(l.counted).trim() !== "");
  if (!lines.length) throw new OperationError("Enter at least one counted quantity.");
  const on = input.countedOn && isDate(input.countedOn) ? input.countedOn : today();
  notFuture(on, "The count date");

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
      const counted = zeroOrMore(line.counted, "Counted quantity")!;
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
      const diff = counted.minus(await lotBalanceAt(tx, lotId, on));
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
    if (changed) await logAdjustment(tx, adj!, "create");
    return { adjustment: adj!, changed, alreadyRecorded: false };
  });
}

/** Take stock out of a lot for waste, breakage, internal use or samples, with a reason. */
export async function recordWriteOff(
  db: DB,
  input: {
    idempotencyKey: string;
    type: "waste" | "internal_use" | "sample";
    reason: string;
    occurredOn?: string;
    lines: { lotId: string; quantity: Decimal.Value }[];
  },
) {
  const reason = input.reason.trim();
  if (!reason) throw new OperationError("Say what happened.");
  const lines = input.lines.filter((l) => l.lotId && !(readNumber(l.quantity, "Quantity")?.isZero() ?? true));
  if (!lines.length) throw new OperationError("Enter at least one quantity.");
  const on = input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today();
  notFuture(on, "The date");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.stockAdjustments).where(eq(t.stockAdjustments.idempotencyKey, input.idempotencyKey));
    if (existing) return { adjustment: existing, alreadyRecorded: true };
    const [adj] = await tx.insert(t.stockAdjustments).values({ type: input.type, reason, occurredOn: on, idempotencyKey: input.idempotencyKey }).returning();
    let i = 0;
    for (const line of lines) {
      const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, line.lotId));
      if (!lot) throw new OperationError("Lot not found.");
      const item = (await itemsById(tx, [lot.itemId])).get(lot.itemId)!;
      // Finished jars leave through an outflow, which knows about jars promised to sales orders.
      if (item.kind === "finished") throw new OperationError(`${item.name}: finished jars leave stock with "Record a stock exit", not here.`);
      const qty = zeroOrMore(line.quantity, item.name)!;
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
    await logAdjustment(tx, adj!, "create");
    return { adjustment: adj!, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- deleting and restoring

const KIND = ADJUSTMENT_NAME;

/** What an adjustment did, per lot, from its own movements (not the ones that undid it). */
async function effect(tx: Tx, adjId: string) {
  return tx
    .select({
      lotId: t.movements.lotId,
      itemId: t.movements.itemId,
      quantity: sql<string>`sum(${t.movements.quantity})`,
      code: t.lots.code,
      name: t.items.name,
      unit: t.items.stockUnit,
    })
    .from(t.movements)
    .innerJoin(t.lots, eq(t.movements.lotId, t.lots.id))
    .innerJoin(t.items, eq(t.movements.itemId, t.items.id))
    .where(and(sql`${t.movements.docType} = 'stock_adjustment'`, eq(t.movements.docId, adjId), sql`${t.movements.changeId} is null`))
    .groupBy(t.movements.lotId, t.movements.itemId, t.lots.code, t.items.name, t.items.stockUnit);
}

async function logAdjustment(tx: Tx, adj: typeof t.stockAdjustments.$inferSelect, action: "create" | "delete" | "restore", reason?: string) {
  const rows = await effect(tx, adj.id);
  const signed = (q: Decimal.Value, unit: string) => `${new Decimal(q).gt(0) ? "+" : ""}${new Decimal(q)} ${unit}`;
  const changes: FieldChange[] = rows.map((r) => ({
    label: `${r.name} (${r.code})`,
    before: action === "create" ? null : action === "delete" ? signed(r.quantity, r.unit) : "undone",
    after: action === "delete" ? "undone" : signed(r.quantity, r.unit),
  }));
  const links: Ref[] = rows.flatMap((r) => [
    { type: "lot" as const, id: r.lotId, code: r.code },
    { type: "item" as const, id: r.itemId, code: r.name },
  ]);
  const what = KIND[adj.type] ?? "Stock correction";
  return logChange(tx, {
    action,
    area: "stock",
    entity: { type: "stock_adjustment", id: adj.id, code: `${what} ${adj.occurredOn}` },
    summary:
      action === "create"
        ? `${what}: ${adj.reason}`
        : action === "delete"
          ? `${what} of ${adj.occurredOn} deleted: stock put back as it was`
          : `${what} of ${adj.occurredOn} restored`,
    changes,
    reason: action === "create" ? null : reason,
    links,
  });
}

/**
 * Undo a stock count or write-off (its movements are reversed and it is
 * marked deleted), or restore it. Refused if a lot no longer has the stock
 * the reversal would take out.
 */
export async function setAdjustmentDeleted(db: DB, input: { idempotencyKey: string; adjustmentId: string; deleted: boolean; reason: string }) {
  const reason = needReason(input.reason, input.deleted ? "Say why this is deleted" : "Say why this is restored");
  return db.transaction(async (tx) => {
    const [adj] = await tx.select().from(t.stockAdjustments).where(eq(t.stockAdjustments.id, input.adjustmentId));
    if (!adj) throw new OperationError("Stock correction not found.");
    if (!!adj.deletedAt === input.deleted) return { alreadyRecorded: true };
    const rows = await effect(tx, adj.id);
    const errors: string[] = [];
    for (const r of rows) {
      // Deleting takes back what was added; restoring takes out again what was taken out.
      const change = new Decimal(r.quantity).mul(input.deleted ? -1 : 1);
      if (change.lt(0)) {
        const left = await lotBalance(tx, r.lotId);
        if (left.lt(change.neg())) errors.push(`${r.name}: lot ${r.code} only has ${left} ${r.unit} left.`);
      }
    }
    if (errors.length) throw new OperationError(`Not enough stock left to ${input.deleted ? "undo" : "restore"} this. ${errors.join(" ")}`);
    const changeId = await logAdjustment(tx, adj, input.deleted ? "delete" : "restore", reason);
    let i = 0;
    for (const r of rows) {
      const q = new Decimal(r.quantity).mul(input.deleted ? -1 : 1);
      if (q.isZero()) continue;
      await tx.insert(t.movements).values({
        lotId: r.lotId,
        itemId: r.itemId,
        quantity: q.toString(),
        type: input.deleted ? "reversal" : adj.type,
        occurredAt: new Date(),
        docType: "stock_adjustment",
        docId: adj.id,
        reason: `${input.deleted ? "Deleted" : "Restored"}: ${reason}`,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
        changeId,
      });
    }
    await tx
      .update(t.stockAdjustments)
      .set(
        input.deleted
          ? { deletedAt: new Date(), deletedReason: reason }
          : { deletedAt: null, deletedReason: null },
      )
      .where(eq(t.stockAdjustments.id, adj.id));
    return { alreadyRecorded: false };
  });
}
