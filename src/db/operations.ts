import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { loadPlanCatalog, loadStockPositions } from "./planning";
import { planProduction, type PlanResult } from "@/domain/planner";

/*
 * Recording actions. Each one:
 * - runs in a single transaction, so it either happens completely or not at all;
 * - takes an idempotency key, so repeating it (double click, reload, retry)
 *   returns the first result instead of recording twice;
 * - only ever adds stock movements, never edits them.
 */

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const today = () => new Date().toISOString().slice(0, 10);

function positive(value: Decimal.Value, what: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new OperationError(`${what}: "${value}" is not a number.`);
  }
  if (d.isNaN() || d.lte(0)) throw new OperationError(`${what} must be more than 0.`);
  return d;
}

async function itemsById(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof t.items.$inferSelect>();
  const rows = await tx.select().from(t.items).where(inArray(t.items.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function checkWholeUnits(item: typeof t.items.$inferSelect, qty: Decimal) {
  if (item.stockUnit === "unit" && !qty.isInteger()) {
    throw new OperationError(`${item.name} is counted in whole units.`);
  }
}

async function nextLotCode(tx: Tx, prefix: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t.lots)
    .where(sql`${t.lots.code} like ${prefix + "-%"}`);
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- stock count

export interface OpeningLine {
  itemId: string;
  quantity: Decimal.Value;
  supplierBatch?: string | null;
  bestBefore?: string | null;
}

/**
 * Record the first stock count for items that have never been counted.
 * Each line becomes its own lot, so it can be traced later like any delivery.
 */
export async function recordOpeningCount(db: DB, input: { idempotencyKey: string; countedOn?: string; lines: OpeningLine[] }) {
  const lines = input.lines.filter((l) => String(l.quantity).trim() !== "");
  if (lines.length === 0) throw new OperationError("Enter at least one quantity.");
  return db.transaction(async (tx) => {
    const done = await tx.select().from(t.movements).where(sql`${t.movements.idempotencyKey} like ${input.idempotencyKey + ":%"}`);
    if (done.length > 0) return { created: 0, alreadyRecorded: true };

    const items = await itemsById(tx, lines.map((l) => l.itemId));
    const counted = await tx
      .selectDistinct({ itemId: t.movements.itemId })
      .from(t.movements)
      .where(inArray(t.movements.itemId, [...items.keys()]));
    if (counted.length > 0) {
      const names = counted.map((c) => items.get(c.itemId)?.name).join(", ");
      throw new OperationError(`Already counted: ${names}. Later changes are recorded as corrections, not opening counts.`);
    }

    const on = input.countedOn ?? today();
    let i = 0;
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new OperationError("Unknown item.");
      const qty = new Decimal(line.quantity);
      if (qty.isNaN() || qty.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
      checkWholeUnits(item, qty);
      const code = await nextLotCode(tx, `OPEN-${on.replaceAll("-", "")}`);
      const [lot] = await tx
        .insert(t.lots)
        .values({ itemId: item.id, code, supplierBatch: line.supplierBatch || null, bestBefore: line.bestBefore || null, receivedOn: on })
        .returning();
      await tx.insert(t.movements).values({
        lotId: lot!.id,
        itemId: item.id,
        quantity: qty.toString(),
        type: "opening_balance",
        occurredAt: new Date(`${on}T00:00:00Z`),
        reason: "Opening stock count",
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }
    return { created: lines.length, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- suppliers

export async function addSupplier(db: DB, input: { name: string; contact?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Supplier name is required.");
  const [row] = await db.insert(t.suppliers).values({ name, contact: input.contact?.trim() || null }).returning();
  return row!;
}

// ---------------------------------------------------------------- purchase orders

export interface OrderLine {
  itemId: string;
  quantity: Decimal.Value;
  unitPrice?: Decimal.Value | null;
}

/** An order records intent only; it never changes stock. */
export async function createPurchaseOrder(
  db: DB,
  input: { idempotencyKey: string; supplierId: string; orderedOn?: string | null; expectedOn?: string | null; reference?: string | null; lines: OrderLine[] },
) {
  const lines = input.lines.filter((l) => l.itemId && String(l.quantity).trim() !== "");
  if (lines.length === 0) throw new OperationError("Add at least one item to the order.");
  return db.transaction(async (tx) => {
    const code = `PO-${input.idempotencyKey.slice(0, 8).toUpperCase()}`;
    const [existing] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.code, code));
    if (existing) return existing;

    const items = await itemsById(tx, lines.map((l) => l.itemId));
    const [po] = await tx
      .insert(t.purchaseOrders)
      .values({
        code,
        supplierId: input.supplierId,
        status: "sent",
        orderedOn: input.orderedOn || today(),
        expectedOn: input.expectedOn || null,
        reference: input.reference || null,
      })
      .returning();
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new OperationError("Unknown item.");
      const qty = positive(line.quantity, item.name);
      checkWholeUnits(item, qty);
      const price = line.unitPrice != null && String(line.unitPrice).trim() !== "" ? new Decimal(line.unitPrice).toString() : null;
      await tx.insert(t.purchaseOrderLines).values({ purchaseOrderId: po!.id, itemId: item.id, quantity: qty.toString(), unitPrice: price });
    }
    return po!;
  });
}

export async function cancelPurchaseOrder(db: DB, purchaseOrderId: string) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status === "received") throw new OperationError("A fully received order can't be cancelled.");
    await tx.update(t.purchaseOrders).set({ status: "cancelled" }).where(eq(t.purchaseOrders.id, purchaseOrderId));
  });
}

// ---------------------------------------------------------------- deliveries

export interface ReceiptLineInput {
  itemId: string;
  quantity: Decimal.Value;
  purchaseOrderLineId?: string | null;
  supplierBatch?: string | null;
  bestBefore?: string | null;
}

/**
 * Record what actually arrived. Each line becomes a lot with its origin
 * (supplier, delivery note, supplier batch, best-before) and adds to stock.
 * Partial or unexpected deliveries are fine: the order shows what's pending.
 */
export async function recordReceipt(
  db: DB,
  input: { idempotencyKey: string; supplierId?: string | null; receivedOn: string; deliveryRef?: string | null; lines: ReceiptLineInput[] },
) {
  const lines = input.lines.filter((l) => l.itemId && String(l.quantity).trim() !== "" && Number(l.quantity) !== 0);
  if (lines.length === 0) throw new OperationError("Enter at least one quantity received.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new OperationError("Enter the delivery date.");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.receipts).where(eq(t.receipts.idempotencyKey, input.idempotencyKey));
    if (existing) return { receipt: existing, alreadyRecorded: true };

    const items = await itemsById(tx, lines.map((l) => l.itemId));
    const poLineIds = lines.map((l) => l.purchaseOrderLineId).filter((x): x is string => !!x);
    const poLines = poLineIds.length
      ? await tx
          .select({ line: t.purchaseOrderLines, po: t.purchaseOrders })
          .from(t.purchaseOrderLines)
          .innerJoin(t.purchaseOrders, eq(t.purchaseOrderLines.purchaseOrderId, t.purchaseOrders.id))
          .where(inArray(t.purchaseOrderLines.id, poLineIds))
      : [];

    const [receipt] = await tx
      .insert(t.receipts)
      .values({ supplierId: input.supplierId || null, receivedOn: input.receivedOn, deliveryRef: input.deliveryRef || null, idempotencyKey: input.idempotencyKey })
      .returning();

    let i = 0;
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new OperationError("Unknown item.");
      const qty = positive(line.quantity, item.name);
      checkWholeUnits(item, qty);
      if (line.purchaseOrderLineId) {
        const pl = poLines.find((p) => p.line.id === line.purchaseOrderLineId);
        if (!pl || pl.line.itemId !== item.id) throw new OperationError(`${item.name}: order line doesn't match this item.`);
        if (pl.po.status === "cancelled") throw new OperationError(`${pl.po.code} is cancelled.`);
      }
      const code = await nextLotCode(tx, `RCV-${input.receivedOn.replaceAll("-", "")}`);
      const [lot] = await tx
        .insert(t.lots)
        .values({
          itemId: item.id,
          code,
          supplierId: input.supplierId || null,
          deliveryRef: input.deliveryRef || null,
          supplierBatch: line.supplierBatch || null,
          receivedOn: input.receivedOn,
          bestBefore: line.bestBefore || null,
        })
        .returning();
      await tx.insert(t.receiptLines).values({
        receiptId: receipt!.id,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        lotId: lot!.id,
        itemId: item.id,
        quantity: qty.toString(),
      });
      await tx.insert(t.movements).values({
        lotId: lot!.id,
        itemId: item.id,
        quantity: qty.toString(),
        type: "receipt",
        occurredAt: new Date(`${input.receivedOn}T12:00:00Z`),
        docType: "receipt",
        docId: receipt!.id,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }

    // Update order status from what has arrived so far.
    const poIds = [...new Set(poLines.map((p) => p.po.id))];
    for (const poId of poIds) {
      const rows = await tx.execute<{ ordered: string; received: string }>(sql`
        select l.quantity as ordered, coalesce(sum(r.quantity), 0) as received
        from purchase_order_lines l left join receipt_lines r on r.purchase_order_line_id = l.id
        where l.purchase_order_id = ${poId} group by l.id, l.quantity`);
      const all = [...rows];
      const complete = all.every((r) => new Decimal(r.received).gte(r.ordered));
      const any = all.some((r) => new Decimal(r.received).gt(0));
      await tx
        .update(t.purchaseOrders)
        .set({ status: complete ? "received" : any ? "partly_received" : "sent" })
        .where(eq(t.purchaseOrders.id, poId));
    }
    return { receipt: receipt!, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- production runs

export async function createRun(db: DB, input: { idempotencyKey: string; plannedFor: string; targets: Record<string, number> }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.plannedFor)) throw new OperationError("Choose a production date.");
  const targets = Object.entries(input.targets).filter(([, n]) => n > 0);
  if (targets.length === 0) throw new OperationError("Enter at least one jar target.");
  for (const [, n] of targets) if (!Number.isInteger(n)) throw new OperationError("Jar targets must be whole numbers.");
  return db.transaction(async (tx) => {
    const code = `RUN-${input.plannedFor.replaceAll("-", "")}-${input.idempotencyKey.slice(0, 4).toUpperCase()}`;
    const [existing] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.code, code));
    if (existing) return existing;
    const [run] = await tx.insert(t.productionRuns).values({ code, plannedFor: input.plannedFor }).returning();
    await tx.insert(t.runTargets).values(targets.map(([productId, n]) => ({ runId: run!.id, productId, targetJars: n })));
    return run!;
  });
}

export async function runTargets(db: DB, runId: string) {
  const rows = await db.select().from(t.runTargets).where(eq(t.runTargets.runId, runId));
  return Object.fromEntries(rows.map((r) => [r.productId, r.targetJars]));
}

/** Plan for a run, treating stock reserved by other runs as unavailable. */
export async function planForRun(db: DB, runId: string): Promise<PlanResult> {
  const [catalog, stock, targets, own] = await Promise.all([
    loadPlanCatalog(db),
    loadStockPositions(db),
    runTargets(db, runId),
    db.select().from(t.reservations).where(and(eq(t.reservations.runId, runId), isNull(t.reservations.releasedAt))),
  ]);
  // Stock positions count every reservation; give this run's own back.
  for (const r of own) {
    const pos = stock[r.itemId];
    if (pos) pos.reservedEarlier = pos.reservedEarlier.minus(r.quantity);
  }
  return planProduction({ ...catalog, stock, targets });
}

/**
 * Confirm a run: freeze the forecast, and reserve what it needs so no other
 * run is shown the same stock. Stock itself doesn't change until production.
 */
export async function confirmRun(db: DB, runId: string) {
  return db.transaction(async (tx) => {
    // Serialize confirmations so two runs can't reserve the same stock at once.
    await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run) throw new OperationError("Run not found.");
    if (run.status === "confirmed") return { run, alreadyConfirmed: true };
    if (run.status !== "draft") throw new OperationError(`This run is ${run.status} and can't be confirmed.`);

    const plan = await planForRun(tx as unknown as DB, runId);
    const blockers = plan.issues.filter((i) => i.level === "blocker");
    if (blockers.length > 0) {
      throw new OperationError(`Can't confirm yet: ${blockers.map((b) => b.message).join(" ")}`);
    }

    await tx.insert(t.forecastSnapshots).values({ runId, data: JSON.parse(JSON.stringify(plan)) });
    const toReserve = plan.requirements.filter((r) => r.required !== null && r.required.gt(0));
    if (toReserve.length) {
      await tx.insert(t.reservations).values(toReserve.map((r) => ({ runId, itemId: r.itemId, quantity: r.required!.toString() })));
    }
    const [updated] = await tx
      .update(t.productionRuns)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(t.productionRuns.id, runId))
      .returning();
    return { run: updated!, alreadyConfirmed: false };
  });
}

export async function cancelRun(db: DB, runId: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run) throw new OperationError("Run not found.");
    if (!["draft", "confirmed"].includes(run.status)) throw new OperationError(`A run that is ${run.status} can't be cancelled.`);
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.runId, runId), isNull(t.reservations.releasedAt)));
    await tx.update(t.productionRuns).set({ status: "cancelled" }).where(eq(t.productionRuns.id, runId));
  });
}

/** Re-plan a draft run's targets. Confirmed runs are frozen. */
export async function updateDraftRun(db: DB, runId: string, plannedFor: string, targets: Record<string, number>) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    if (!run || run.status !== "draft") throw new OperationError("Only draft runs can be changed.");
    await tx.update(t.productionRuns).set({ plannedFor }).where(eq(t.productionRuns.id, runId));
    await tx.delete(t.runTargets).where(eq(t.runTargets.runId, runId));
    const rows = Object.entries(targets).filter(([, n]) => n > 0);
    if (rows.length) await tx.insert(t.runTargets).values(rows.map(([productId, n]) => ({ runId, productId, targetJars: n })));
  });
}

