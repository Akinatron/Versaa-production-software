import type { ItemKind } from "@/domain/planner";
import { bestBeforeFrom, shelfLifeOf } from "@/domain/shelf-life";
import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, today, positive, itemsById, checkWholeUnits, nextLotCode, type Tx, isDate } from "./base";
import { loadOffers, offersByItem } from "./suppliers";
import { buildBudget, describePrice, favourite, roundToPacks, unitPrice, type BudgetLineInput, type Offer } from "@/domain/pricing";
import type { PlanResult } from "@/domain/planner";
import { UNITS, type UnitCode, unitWord } from "@/domain/quantity";
import { diff, logChange, needReason, type FieldChange, type Ref } from "./changes";
import { lotBalance } from "./ledger";
import { parseStorage, storageLabel } from "@/domain/storage";
import { inSentence, PO_STATUS_NAME } from "@/domain/status";
import { BUSINESS_TIME_ZONE, localMoment } from "@/domain/dates";

/*
 * Purchase orders and deliveries.
 * - An order starts as a draft (prepared, not sent). "Mark as sent" stores the
 *   date it went to the supplier. Only sent orders count as "on order".
 * - An order can be for a production run or stand alone (restocking).
 * - A delivery records, per line, what was accepted and what was refused.
 *   Only the accepted quantity becomes a lot and enters stock. Refused goods
 *   count as not received: the order stays "partly received" until all has
 *   arrived or someone closes it by hand.
 */

const D = (v: Decimal.Value | null | undefined) => (v === null || v === undefined ? null : new Decimal(v));

async function nextOrderCode(tx: Tx, on: string) {
  const prefix = `PO-${on.replaceAll("-", "")}`;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t.purchaseOrders)
    .where(sql`${t.purchaseOrders.code} like ${prefix + "-%"}`);
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(2, "0")}`;
}

export interface OrderLine {
  itemId: string;
  /** Quantity in the item's stock unit. Ignored when `packs` is given and the supplier has a pack size. */
  quantity?: Decimal.Value | null;
  /** Whole packs to order; uses the supplier's pack size. */
  packs?: number | null;
  /** Price per stock unit. Left empty, the supplier's current price is used. */
  unitPrice?: Decimal.Value | null;
  /** What was missing before rounding to packs (for the record). */
  neededQty?: Decimal.Value | null;
}

/** Build order lines from input, applying the supplier's current pack size and price. */
async function resolveLines(tx: Tx, supplierId: string, lines: OrderLine[]) {
  const items = await itemsById(
    tx,
    lines.map((l) => l.itemId),
  );
  const offers = new Map((await loadOffers(tx, { supplierId, itemIds: [...items.keys()] })).map((o) => [o.itemId, o]));
  const out: (typeof t.purchaseOrderLines.$inferInsert)[] = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) throw new OperationError("Unknown item.");
    const offer = offers.get(item.id);
    let quantity: Decimal;
    let packs: number | null = null;
    if (line.packs != null && offer?.packQty) {
      if (!Number.isInteger(line.packs) || line.packs <= 0) throw new OperationError(`${item.name}: packs must be a whole number more than 0.`);
      packs = line.packs;
      quantity = offer.packQty.mul(packs);
    } else {
      quantity = positive(line.quantity ?? "", item.name);
      // A quantity that is an exact number of packs is recorded as packs too.
      if (offer?.packQty && quantity.mod(offer.packQty).isZero()) packs = quantity.div(offer.packQty).toNumber();
    }
    checkWholeUnits(item, quantity);
    const given = line.unitPrice != null && String(line.unitPrice).trim() !== "" ? new Decimal(String(line.unitPrice).replace(",", ".")) : null;
    if (given && (given.isNaN() || given.lt(0))) throw new OperationError(`${item.name}: price can't be negative.`);
    const up = given ?? unitPrice(offer);
    out.push({
      purchaseOrderId: "",
      itemId: item.id,
      quantity: quantity.toString(),
      unitPrice: up?.toString() ?? null,
      packQty: packs !== null ? offer!.packQty!.toString() : null,
      packs,
      packPrice: packs !== null && !given && offer?.price ? offer.price.toString() : null,
      neededQty: line.neededQty != null && String(line.neededQty) !== "" ? new Decimal(line.neededQty).toString() : null,
    });
  }
  return out;
}

/** Create an order as a draft. It doesn't count as on order, nor change stock, until it is sent. */
export async function createPurchaseOrder(
  db: DB,
  input: {
    idempotencyKey: string;
    supplierId: string;
    runId?: string | null;
    expectedOn?: string | null;
    reference?: string | null;
    note?: string | null;
    lines: OrderLine[];
  },
) {
  const lines = input.lines.filter((l) => l.itemId && ((l.quantity != null && String(l.quantity).trim() !== "") || l.packs != null));
  if (lines.length === 0) throw new OperationError("Add at least one item to the order.");
  if (!input.supplierId) throw new OperationError("Choose a supplier.");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.idempotencyKey, input.idempotencyKey));
    if (existing) return existing;
    if (input.runId) {
      const [run] = await tx.select().from(t.productionRuns).where(eq(t.productionRuns.id, input.runId));
      if (!run) throw new OperationError("Run not found.");
    }
    const values = await resolveLines(tx, input.supplierId, lines);
    const [po] = await tx
      .insert(t.purchaseOrders)
      .values({
        code: await nextOrderCode(tx, today()),
        supplierId: input.supplierId,
        runId: input.runId || null,
        status: "draft",
        orderedOn: null,
        expectedOn: isDate(input.expectedOn) ? input.expectedOn : null,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    await tx.insert(t.purchaseOrderLines).values(values.map((v) => ({ ...v, purchaseOrderId: po!.id })));
    const [sup] = await tx.select().from(t.suppliers).where(eq(t.suppliers.id, input.supplierId));
    await logChange(tx, {
      action: "create",
      area: "purchasing",
      entity: { type: "purchase_order", id: po!.id, code: po!.code },
      summary: `Draft order ${po!.code} to ${sup?.name ?? "supplier"} (${values.length} item${values.length === 1 ? "" : "s"})`,
      links: [await runRef(tx, po!.runId), { type: "supplier", id: input.supplierId, code: sup?.name }],
    });
    return po!;
  });
}

export interface PlannedOrderLine extends OrderLine {
  supplierId: string;
}

/**
 * From "what's missing", create one draft order per supplier. Lines without a
 * supplier are skipped (not ordered).
 */
export async function createOrdersFromPlan(db: DB, input: { idempotencyKey: string; runId?: string | null; lines: PlannedOrderLine[] }) {
  const chosen = input.lines.filter(
    (l) => l.supplierId && ((l.packs ?? 0) > 0 || (l.quantity != null && String(l.quantity).trim() !== "" && Number(l.quantity) > 0)),
  );
  if (chosen.length === 0) throw new OperationError("Nothing to order: choose a supplier and a quantity for at least one item.");
  const bySupplier = new Map<string, PlannedOrderLine[]>();
  for (const l of chosen) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l]);
  const orders = [];
  for (const [supplierId, lines] of bySupplier) {
    orders.push(await createPurchaseOrder(db, { idempotencyKey: `${input.idempotencyKey}:${supplierId}`, supplierId, runId: input.runId, lines }));
  }
  return orders;
}

async function runRef(tx: Tx, runId: string | null | undefined): Promise<Ref | null> {
  if (!runId) return null;
  const [run] = await tx.select({ id: t.productionRuns.id, code: t.productionRuns.code }).from(t.productionRuns).where(eq(t.productionRuns.id, runId));
  return run ? { type: "run", id: run.id, code: run.code } : null;
}

async function orderRefs(tx: Tx, po: typeof t.purchaseOrders.$inferSelect): Promise<Ref[]> {
  const [sup] = await tx.select().from(t.suppliers).where(eq(t.suppliers.id, po.supplierId));
  const run = await runRef(tx, po.runId);
  return [...(run ? [run] : []), { type: "supplier", id: po.supplierId, code: sup?.name }];
}

const qtyText = (q: Decimal.Value | null | undefined, unit: string) => (q === null || q === undefined ? null : `${new Decimal(q)} ${unit}`);
const priceText = (p: Decimal.Value | null | undefined, unit: string) => (p === null || p === undefined ? null : `${new Decimal(p)} €/${unit}`);

/**
 * Change an order: dates, notes, quantities (0 removes the line) and prices.
 * A draft changes freely. A sent or received order can be corrected too (for
 * example with the price on the invoice), with a reason; a line can't go
 * below what has already arrived.
 */
export async function updateDraftOrder(
  db: DB,
  purchaseOrderId: string,
  input: {
    expectedOn?: string | null;
    reference?: string | null;
    note?: string | null;
    reason?: string | null;
    lines: { lineId: string; quantity?: string | null; packs?: number | null; unitPrice?: string | null }[];
  },
) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status === "cancelled") throw new OperationError("This order is cancelled. Restore it first to change it.");
    const draft = po.status === "draft";
    const reason = draft ? input.reason?.trim() || null : needReason(input.reason, "Say why the order is corrected");
    const header = {
      expectedOn: isDate(input.expectedOn) ? input.expectedOn! : null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
    };
    const changes: FieldChange[] = diff([
      ["Expected", po.expectedOn, header.expectedOn],
      ["Reference", po.reference, header.reference],
      ["Note", po.note, header.note],
    ]);
    await tx.update(t.purchaseOrders).set(header).where(eq(t.purchaseOrders.id, po.id));
    const current = await tx.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const items = await itemsById(
      tx,
      current.map((l) => l.itemId),
    );
    const arrived = new Map(
      [
        ...(await tx.execute<{ line_id: string; accepted: string; n: number }>(sql`
        select r.purchase_order_line_id as line_id, coalesce(sum(r.quantity), 0) as accepted, count(*)::int as n
        from receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is null
        where r.purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${po.id})
        group by r.purchase_order_line_id`)),
      ].map((r) => [r.line_id, { accepted: new Decimal(r.accepted), n: r.n }]),
    );
    // Lines whose only deliveries were deleted: those stay on record, so the line can't go.
    const deletedOnly = new Set(
      [
        ...(await tx.execute<{ line_id: string }>(sql`
        select distinct r.purchase_order_line_id as line_id from receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is not null
        where r.purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${po.id})`)),
      ].map((r) => r.line_id),
    );
    let left = current.length;
    for (const change of input.lines) {
      const line = current.find((l) => l.id === change.lineId);
      if (!line) continue;
      const item = items.get(line.itemId)!;
      let quantity: Decimal;
      let packs: number | null = null;
      if (line.packQty && change.packs != null) {
        if (!Number.isInteger(change.packs) || change.packs < 0) throw new OperationError(`${item.name}: packs must be a whole number.`);
        packs = change.packs;
        quantity = new Decimal(line.packQty).mul(packs);
      } else {
        const raw = String(change.quantity ?? "").trim();
        // An empty box is a slip, not a removal: only 0 removes a line.
        if (raw === "") throw new OperationError(`${item.name}: enter a quantity (0 removes the line).`);
        quantity = new Decimal(raw.replace(",", "."));
        if (quantity.isNaN() || quantity.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
        if (line.packQty && quantity.mod(line.packQty).isZero()) packs = quantity.div(line.packQty).toNumber();
      }
      const got = arrived.get(line.id);
      if (got && quantity.lt(got.accepted)) {
        throw new OperationError(`${item.name}: ${got.accepted} ${unitWord(item.stockUnit)} has already arrived, so the order can't be lowered below that.`);
      }
      if (quantity.isZero()) {
        if (got) throw new OperationError(`${item.name} has deliveries recorded, so its line can't be removed.`);
        if (deletedOnly.has(line.id))
          throw new OperationError(
            `${item.name}: a deleted delivery is still on record for this line, so it can't be removed. Leave it as it is, or cancel the order if nothing on it is needed.`,
          );
        await tx.delete(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.id, line.id));
        changes.push({ label: item.name, before: qtyText(line.quantity, item.stockUnit), after: "removed" });
        left--;
        continue;
      }
      checkWholeUnits(item, quantity);
      const rawPrice = String(change.unitPrice ?? "").trim();
      const price = rawPrice === "" ? null : new Decimal(rawPrice.replace(",", "."));
      if (price && (price.isNaN() || price.lt(0))) throw new OperationError(`${item.name}: price can't be negative.`);
      const priceChanged = change.unitPrice !== undefined && (price === null ? line.unitPrice !== null : line.unitPrice === null || !price.eq(line.unitPrice));
      if (!quantity.eq(line.quantity))
        changes.push({ label: item.name, before: qtyText(line.quantity, item.stockUnit), after: qtyText(quantity, item.stockUnit) });
      if (priceChanged)
        changes.push({ label: `${item.name} price`, before: priceText(line.unitPrice, item.stockUnit), after: priceText(price, item.stockUnit) });
      await tx
        .update(t.purchaseOrderLines)
        .set({
          quantity: quantity.toString(),
          packs: line.packQty ? packs : null,
          ...(priceChanged ? { unitPrice: price?.toString() ?? null, packPrice: null } : {}),
        })
        .where(eq(t.purchaseOrderLines.id, line.id));
    }
    if (left === 0) throw new OperationError("An order needs at least one line. Cancel the order instead.");
    if (!draft) await refreshOrderStatus(tx, po.id);
    if (changes.length) {
      await logChange(tx, {
        action: "update",
        area: "purchasing",
        entity: { type: "purchase_order", id: po.id, code: po.code },
        summary: draft ? `Draft order ${po.code} changed` : `Order ${po.code} corrected`,
        changes,
        reason,
        links: await orderRefs(tx, po),
      });
    }
  });
}

/** Draft → sent, storing the date it was sent to the supplier. */
export async function markOrderSent(db: DB, purchaseOrderId: string, input: { sentOn?: string | null; expectedOn?: string | null } = {}) {
  const sentOn = input.sentOn || today();
  if (!isDate(sentOn)) throw new OperationError("Enter the date the order was sent.");
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status !== "draft") return { po, alreadySent: true };
    const [updated] = await tx
      .update(t.purchaseOrders)
      .set({ status: "sent", orderedOn: sentOn, ...(isDate(input.expectedOn) ? { expectedOn: input.expectedOn } : {}) })
      .where(eq(t.purchaseOrders.id, po.id))
      .returning();
    await logChange(tx, {
      action: "status",
      area: "purchasing",
      entity: { type: "purchase_order", id: po.id, code: po.code },
      summary: `Order ${po.code} marked as sent`,
      changes: diff([
        ["Sent", null, sentOn],
        ["Expected", po.expectedOn, updated!.expectedOn],
      ]),
      links: await orderRefs(tx, po),
    });
    return { po: updated!, alreadySent: false };
  });
}

export async function cancelPurchaseOrder(db: DB, purchaseOrderId: string, reason?: string | null) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status === "cancelled") return;
    if (po.status === "received" || po.status === "closed") throw new OperationError("A received or closed order can't be cancelled.");
    if (po.status === "partly_received") throw new OperationError("Part of this order has arrived. Close it instead, so what arrived stays on record.");
    const why = po.status === "draft" ? reason?.trim() || null : needReason(reason, "Say why the order is cancelled");
    await tx.update(t.purchaseOrders).set({ status: "cancelled" }).where(eq(t.purchaseOrders.id, purchaseOrderId));
    await logChange(tx, {
      action: "cancel",
      area: "purchasing",
      entity: { type: "purchase_order", id: po.id, code: po.code },
      summary: `Order ${po.code} cancelled`,
      changes: diff([["Status", po.status === "draft" ? "Draft" : "Sent", "Cancelled"]]),
      reason: why,
      links: await orderRefs(tx, po),
    });
  });
}

/** Bring a cancelled order back: to "sent" if it had been sent, otherwise to draft. */
export async function restorePurchaseOrder(db: DB, purchaseOrderId: string, reason?: string | null) {
  const why = needReason(reason, "Say why the order is restored");
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status !== "cancelled") throw new OperationError("Only a cancelled order can be restored.");
    const status = po.orderedOn ? "sent" : "draft";
    await tx.update(t.purchaseOrders).set({ status }).where(eq(t.purchaseOrders.id, po.id));
    if (status === "sent") await refreshOrderStatus(tx, po.id);
    await logChange(tx, {
      action: "restore",
      area: "purchasing",
      entity: { type: "purchase_order", id: po.id, code: po.code },
      summary: `Order ${po.code} restored`,
      changes: diff([["Status", "Cancelled", status === "sent" ? "Sent" : "Draft"]]),
      reason: why,
      links: await orderRefs(tx, po),
    });
  });
}

/** Close an order by hand when the rest won't come (e.g. refused goods not replaced). */
export async function closePurchaseOrder(db: DB, purchaseOrderId: string, note?: string | null) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status !== "sent" && po.status !== "partly_received") throw new OperationError("Only an order that is on its way can be closed.");
    const text = note?.trim();
    await tx
      .update(t.purchaseOrders)
      .set({ status: "closed", closedAt: new Date(), ...(text ? { note: po.note ? `${po.note}\n${text}` : text } : {}) })
      .where(eq(t.purchaseOrders.id, po.id));
    await logChange(tx, {
      action: "status",
      area: "purchasing",
      entity: { type: "purchase_order", id: po.id, code: po.code },
      summary: `Order ${po.code} closed before everything arrived`,
      reason: text,
      links: await orderRefs(tx, po),
    });
  });
}

// ---------------------------------------------------------------- deliveries

export interface ReceiptLineInput {
  itemId: string;
  /** Accepted quantity: goes into stock as a lot. */
  quantity: Decimal.Value;
  /** Refused at delivery; counts as not received. */
  rejectedQuantity?: Decimal.Value | null;
  damageNote?: string | null;
  purchaseOrderLineId?: string | null;
  supplierBatch?: string | null;
  bestBefore?: string | null;
  /** Where this lot goes. Empty = the item's default storage. Ignored for packaging. */
  storage?: string | null;
}

const qtyOrZero = (v: Decimal.Value | null | undefined, what: string) => {
  const raw = v === null || v === undefined ? "" : String(v).trim().replace(",", ".");
  if (raw === "") return new Decimal(0);
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch {
    throw new OperationError(`${what}: "${v}" is not a number.`);
  }
  if (d.isNaN() || d.lt(0)) throw new OperationError(`${what} can't be negative.`);
  return d;
};

/**
 * Record what actually arrived. Accepted quantities become lots with their
 * origin (supplier, delivery note, supplier batch, best-before) and add to
 * stock. Refused quantities and damage notes are kept on the delivery.
 */
export async function recordReceipt(
  db: DB,
  input: {
    idempotencyKey: string;
    supplierId?: string | null;
    receivedOn: string;
    receivedTime?: string | null;
    deliveryRef?: string | null;
    note?: string | null;
    lines: ReceiptLineInput[];
  },
) {
  if (!isDate(input.receivedOn)) throw new OperationError("Enter the delivery date.");
  const time = input.receivedTime?.trim() || null;
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new OperationError("Enter the time as HH:MM, or leave it empty.");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.receipts).where(eq(t.receipts.idempotencyKey, input.idempotencyKey));
    if (existing) return { receipt: existing, alreadyRecorded: true };

    const items = await itemsById(
      tx,
      input.lines.filter((l) => l.itemId).map((l) => l.itemId),
    );
    const lines = input.lines
      .filter((l) => l.itemId)
      .map((l) => {
        const name = items.get(l.itemId)?.name ?? "Item";
        return { ...l, accepted: qtyOrZero(l.quantity, name), rejected: qtyOrZero(l.rejectedQuantity, `${name} (refused)`) };
      })
      .filter((l) => l.accepted.gt(0) || l.rejected.gt(0));
    if (lines.length === 0) throw new OperationError("Enter at least one quantity received or refused.");

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
      .values({
        supplierId: input.supplierId || null,
        receivedOn: input.receivedOn,
        receivedTime: time,
        deliveryRef: input.deliveryRef?.trim() || null,
        note: input.note?.trim() || null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    let i = 0;
    for (const line of lines) {
      const item = items.get(line.itemId);
      if (!item) throw new OperationError("Unknown item.");
      checkWholeUnits(item, line.accepted);
      checkWholeUnits(item, line.rejected);
      if (line.purchaseOrderLineId) {
        const pl = poLines.find((p) => p.line.id === line.purchaseOrderLineId);
        if (!pl || pl.line.itemId !== item.id) throw new OperationError(`${item.name}: order line doesn't match this item.`);
        if (pl.po.status === "draft") throw new OperationError(`${pl.po.code} is still a draft. Mark it as sent first.`);
        if (pl.po.status === "cancelled" || pl.po.status === "closed") throw new OperationError(`${pl.po.code} is ${inSentence(PO_STATUS_NAME, pl.po.status)}.`);
      }
      let lotId: string | null = null;
      if (line.accepted.gt(0)) {
        const storage = item.kind === "packaging" || item.kind === "other" ? null : parseStorage(line.storage);
        if (storage === "invalid") throw new OperationError(`${item.name}: choose Fridge, Freezer or Room temperature.`);
        const code = await nextLotCode(tx, `RCV-${input.receivedOn.replaceAll("-", "")}`);
        const [lot] = await tx
          .insert(t.lots)
          .values({
            itemId: item.id,
            code,
            supplierId: input.supplierId || null,
            deliveryRef: input.deliveryRef?.trim() || null,
            supplierBatch: line.supplierBatch?.trim() || null,
            receivedOn: input.receivedOn,
            bestBefore: newLotBestBefore(line.bestBefore, input.receivedOn, item),
            // Null lets the database fill in the item's default.
            storage,
          })
          .returning();
        lotId = lot!.id;
        await tx.insert(t.movements).values({
          lotId,
          itemId: item.id,
          quantity: line.accepted.toString(),
          type: "receipt",
          // A typed time is local time; without one, midday.
          occurredAt: time ? localMoment(input.receivedOn, time) : new Date(`${input.receivedOn}T12:00:00Z`),
          docType: "receipt",
          docId: receipt!.id,
          idempotencyKey: `${input.idempotencyKey}:${i++}`,
        });
      }
      await tx.insert(t.receiptLines).values({
        receiptId: receipt!.id,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        lotId,
        itemId: item.id,
        quantity: line.accepted.toString(),
        rejectedQty: line.rejected.toString(),
        damageNote: line.damageNote?.trim() || null,
      });
    }

    for (const poId of new Set(poLines.map((p) => p.po.id))) await refreshOrderStatus(tx, poId);
    const refs = await receiptRefs(tx, receipt!);
    await logChange(tx, {
      action: "create",
      area: "purchasing",
      entity: refs.self,
      summary: `Delivery recorded${refs.supplier ? ` from ${refs.supplier}` : ""}: ${lines.length} line${lines.length === 1 ? "" : "s"}`,
      links: refs.links,
    });
    return { receipt: receipt!, alreadyRecorded: false };
  });
}

/** Received when every line's accepted quantity reaches what was ordered. Refused goods don't count. */
async function refreshOrderStatus(tx: Tx, poId: string) {
  const rows = await tx.execute<{ ordered: string; accepted: string; touched: boolean }>(sql`
    select l.quantity as ordered, coalesce(sum(r.quantity), 0) as accepted, count(r.id) > 0 as touched
    from purchase_order_lines l
      left join (receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is null) on r.purchase_order_line_id = l.id
    where l.purchase_order_id = ${poId} group by l.id, l.quantity`);
  const all = [...rows];
  const complete = all.every((r) => new Decimal(r.accepted).gte(r.ordered));
  const any = all.some((r) => r.touched);
  await tx
    .update(t.purchaseOrders)
    .set({ status: complete ? "received" : any ? "partly_received" : "sent" })
    .where(and(eq(t.purchaseOrders.id, poId), inArray(t.purchaseOrders.status, ["sent", "partly_received", "received"])));
}

// ---------------------------------------------------------------- correcting deliveries

export const receiptCode = (r: { deliveryRef: string | null; receivedOn: string }) => r.deliveryRef || `Delivery ${r.receivedOn}`;

/** The delivery, its supplier, orders, runs and lots: everything a change to it shows on. */
async function receiptRefs(tx: Tx, receipt: typeof t.receipts.$inferSelect) {
  const [sup] = receipt.supplierId ? await tx.select().from(t.suppliers).where(eq(t.suppliers.id, receipt.supplierId)) : [];
  const lines = await tx
    .select({ lot: t.lots, po: t.purchaseOrders })
    .from(t.receiptLines)
    .leftJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id))
    .leftJoin(t.purchaseOrderLines, eq(t.receiptLines.purchaseOrderLineId, t.purchaseOrderLines.id))
    .leftJoin(t.purchaseOrders, eq(t.purchaseOrderLines.purchaseOrderId, t.purchaseOrders.id))
    .where(eq(t.receiptLines.receiptId, receipt.id));
  const links: Ref[] = [];
  if (sup) links.push({ type: "supplier", id: sup.id, code: sup.name });
  for (const l of lines) {
    if (l.lot) links.push({ type: "lot", id: l.lot.id, code: l.lot.code });
    if (l.po) {
      links.push({ type: "purchase_order", id: l.po.id, code: l.po.code });
      const run = await runRef(tx, l.po.runId);
      if (run) links.push(run);
    }
  }
  return { self: { type: "receipt" as const, id: receipt.id, code: receiptCode(receipt) }, supplier: sup?.name ?? null, links };
}

/** Where a lot's stock went, in words, for "can't take it back" messages. */
async function usedIn(tx: Tx, lotId: string) {
  const rows = await tx.execute<{ code: string }>(sql`
    select distinct coalesce(b.code, b2.code, o.code, a.reason, m.type::text) as code
    from movements m
      left join batch_consumption c on m.doc_type = 'batch_consumption' and c.id = m.doc_id
      left join production_batches b on b.id = c.batch_id
      left join packaging_sessions s on m.doc_type = 'packaging_session' and s.id = m.doc_id
      left join production_batches b2 on b2.id = s.batch_id
      left join outflows o on m.doc_type = 'outflow' and o.id = m.doc_id
      left join stock_adjustments a on m.doc_type = 'stock_adjustment' and a.id = m.doc_id
    where m.lot_id = ${lotId} and m.quantity < 0 and m.doc_type is distinct from 'receipt'`);
  return [...rows]
    .map((r) => r.code)
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");
}

/**
 * Best-before of a lot that comes in with a delivery, when it's recorded and
 * when a correction creates it: the date given, or else worked out from the
 * item's shelf life (when it has one).
 */
function newLotBestBefore(given: string | null | undefined, receivedOn: string, item: Parameters<typeof shelfLifeOf>[0]) {
  return given || bestBeforeFrom(receivedOn, shelfLifeOf(item));
}

export interface ReceiptLineChange {
  lineId: string;
  quantity?: Decimal.Value | null;
  rejectedQuantity?: Decimal.Value | null;
  damageNote?: string | null;
  supplierBatch?: string | null;
  bestBefore?: string | null;
}

/**
 * Correct a delivery. A changed accepted quantity moves the lot by the
 * difference; it can't take back stock that has already been used.
 */
export async function correctReceipt(
  db: DB,
  input: {
    idempotencyKey: string;
    receiptId: string;
    reason: string;
    receivedOn: string;
    receivedTime?: string | null;
    deliveryRef?: string | null;
    note?: string | null;
    lines: ReceiptLineChange[];
  },
) {
  const reason = needReason(input.reason, "Say why the delivery is corrected");
  if (!isDate(input.receivedOn)) throw new OperationError("Enter the delivery date.");
  const time = input.receivedTime?.trim() || null;
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new OperationError("Enter the time as HH:MM, or leave it empty.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(t.receipts).where(eq(t.receipts.id, input.receiptId));
    if (!r) throw new OperationError("Delivery not found.");
    if (r.deletedAt) throw new OperationError("This delivery was deleted. Restore it first.");
    const [done] = await tx
      .select({ id: t.movements.id })
      .from(t.movements)
      .where(sql`${t.movements.idempotencyKey} like ${input.idempotencyKey + ":%"}`)
      .limit(1);
    if (done) return { alreadyRecorded: true };

    const header = { receivedOn: input.receivedOn, receivedTime: time, deliveryRef: input.deliveryRef?.trim() || null, note: input.note?.trim() || null };
    const changes: FieldChange[] = diff([
      ["Date", r.receivedOn, header.receivedOn],
      ["Time", r.receivedTime, header.receivedTime],
      ["Delivery note", r.deliveryRef, header.deliveryRef],
      ["Note", r.note, header.note],
    ]);
    const lines = await tx.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r.id));
    const items = await itemsById(
      tx,
      lines.map((l) => l.itemId),
    );
    const moves: { lineId: string; itemId: string; diff: Decimal }[] = [];
    const errors: string[] = [];
    const plan: {
      line: (typeof lines)[number];
      accepted: Decimal;
      rejected: Decimal;
      damageNote: string | null;
      supplierBatch?: string | null;
      bestBefore?: string | null;
    }[] = [];
    for (const c of input.lines) {
      const line = lines.find((l) => l.id === c.lineId);
      if (!line) continue;
      const item = items.get(line.itemId)!;
      const accepted = c.quantity === undefined ? new Decimal(line.quantity) : qtyOrZero(c.quantity, item.name);
      const rejected = c.rejectedQuantity === undefined ? new Decimal(line.rejectedQty) : qtyOrZero(c.rejectedQuantity, `${item.name} (refused)`);
      checkWholeUnits(item, accepted);
      checkWholeUnits(item, rejected);
      const d = accepted.minus(line.quantity);
      if (d.lt(0) && line.lotId) {
        const left = await lotBalance(tx, line.lotId);
        if (left.lt(d.neg())) {
          const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, line.lotId));
          errors.push(
            `${item.name}: lot ${lot?.code} only has ${left} ${item.stockUnit} left (used in ${await usedIn(tx, line.lotId)}), so it can't go down by ${d.neg()}.`,
          );
          continue;
        }
      }
      if (!d.isZero()) {
        changes.push({ label: `${item.name} accepted`, before: qtyText(line.quantity, item.stockUnit), after: qtyText(accepted, item.stockUnit) });
        moves.push({ lineId: line.id, itemId: item.id, diff: d });
      }
      if (!rejected.eq(line.rejectedQty))
        changes.push({ label: `${item.name} refused`, before: qtyText(line.rejectedQty, item.stockUnit), after: qtyText(rejected, item.stockUnit) });
      const damageNote = c.damageNote === undefined ? line.damageNote : c.damageNote?.trim() || null;
      if (damageNote !== line.damageNote) changes.push({ label: `${item.name} damage note`, before: line.damageNote, after: damageNote });
      if (c.bestBefore && !isDate(c.bestBefore)) throw new OperationError(`${item.name}: best-before isn't a valid date.`);
      if (line.lotId) {
        const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, line.lotId));
        changes.push(
          ...diff([
            [`${item.name} supplier batch`, lot!.supplierBatch, c.supplierBatch === undefined ? lot!.supplierBatch : c.supplierBatch?.trim() || null],
            [`${item.name} best-before`, lot!.bestBefore, c.bestBefore === undefined ? lot!.bestBefore : c.bestBefore || null],
          ]),
        );
      }
      plan.push({ line, accepted, rejected, damageNote, supplierBatch: c.supplierBatch, bestBefore: c.bestBefore });
    }
    if (errors.length) throw new OperationError(errors.join(" "));

    if (!changes.length) return { alreadyRecorded: false, changeId: null };
    await tx.update(t.receipts).set(header).where(eq(t.receipts.id, r.id));
    const changeId = await logChange(tx, {
      action: "update",
      area: "purchasing",
      entity: { type: "receipt", id: r.id, code: receiptCode(header) },
      summary: "Delivery corrected",
      changes,
      reason,
      links: (await receiptRefs(tx, r)).links,
    });
    let i = 0;
    for (const p of plan) {
      const item = items.get(p.line.itemId)!;
      let lotId = p.line.lotId;
      if (!lotId && p.accepted.gt(0)) {
        const [lot] = await tx
          .insert(t.lots)
          .values({
            itemId: item.id,
            code: await nextLotCode(tx, `RCV-${header.receivedOn.replaceAll("-", "")}`),
            supplierId: r.supplierId,
            deliveryRef: header.deliveryRef,
            supplierBatch: p.supplierBatch?.trim() || null,
            receivedOn: header.receivedOn,
            // Same as a new delivery: storage comes from the item (database
            // default), best-before from its shelf life when left empty.
            bestBefore: newLotBestBefore(p.bestBefore, header.receivedOn, item),
          })
          .returning();
        lotId = lot!.id;
        await tx.insert(t.changeLogLinks).values({ changeId, entityType: "lot", entityId: lot!.id, entityCode: lot!.code });
      } else if (lotId) {
        const upd = {
          deliveryRef: header.deliveryRef,
          receivedOn: header.receivedOn,
          ...(p.supplierBatch !== undefined ? { supplierBatch: p.supplierBatch?.trim() || null } : {}),
          ...(p.bestBefore !== undefined ? { bestBefore: p.bestBefore || null } : {}),
        };
        await tx.update(t.lots).set(upd).where(eq(t.lots.id, lotId));
      }
      const move = moves.find((m) => m.lineId === p.line.id);
      if (move && lotId) {
        await tx.insert(t.movements).values({
          lotId,
          itemId: item.id,
          quantity: move.diff.toString(),
          type: move.diff.gt(0) ? "receipt" : "reversal",
          occurredAt: new Date(),
          docType: "receipt",
          docId: r.id,
          reason: `Delivery corrected: ${reason}`,
          idempotencyKey: `${input.idempotencyKey}:${i++}`,
          changeId,
        });
      }
      await tx
        .update(t.receiptLines)
        .set({ quantity: p.accepted.toString(), rejectedQty: p.rejected.toString(), damageNote: p.damageNote, lotId })
        .where(eq(t.receiptLines.id, p.line.id));
    }
    for (const poId of await receiptOrders(tx, r.id)) await refreshOrderStatus(tx, poId);
    return { alreadyRecorded: false, changeId };
  });
}

async function receiptOrders(tx: Tx, receiptId: string) {
  const rows = await tx
    .selectDistinct({ id: t.purchaseOrderLines.purchaseOrderId })
    .from(t.receiptLines)
    .innerJoin(t.purchaseOrderLines, eq(t.receiptLines.purchaseOrderLineId, t.purchaseOrderLines.id))
    .where(eq(t.receiptLines.receiptId, receiptId));
  return rows.map((r) => r.id);
}

/**
 * Delete or restore a delivery. Deleting takes its lots back out of stock
 * (only if nothing has been used from them) and marks it deleted; restoring
 * puts them back. Orders go back to "on the way" or "received" to match.
 */
export async function setReceiptDeleted(db: DB, input: { idempotencyKey: string; receiptId: string; deleted: boolean; reason: string }) {
  const reason = needReason(input.reason, input.deleted ? "Say why the delivery is deleted" : "Say why the delivery is restored");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(t.receipts).where(eq(t.receipts.id, input.receiptId));
    if (!r) throw new OperationError("Delivery not found.");
    if (!!r.deletedAt === input.deleted) return { alreadyRecorded: true };
    const lines = await tx.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r.id));
    const items = await itemsById(
      tx,
      lines.map((l) => l.itemId),
    );
    const errors: string[] = [];
    if (input.deleted) {
      for (const l of lines) {
        if (!l.lotId || new Decimal(l.quantity).isZero()) continue;
        const left = await lotBalance(tx, l.lotId);
        if (left.lt(l.quantity)) {
          const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, l.lotId));
          errors.push(
            `${items.get(l.itemId)?.name}: part of lot ${lot?.code} has already been used (${await usedIn(tx, l.lotId)}). Correct the quantity instead, or undo those first.`,
          );
        }
      }
    }
    if (errors.length) throw new OperationError(errors.join(" "));
    const refs = await receiptRefs(tx, r);
    const changeId = await logChange(tx, {
      action: input.deleted ? "delete" : "restore",
      area: "purchasing",
      entity: refs.self,
      summary: input.deleted ? `Delivery deleted: its lots are taken out of stock` : `Delivery restored: its lots are back in stock`,
      reason,
      links: refs.links,
    });
    let i = 0;
    for (const l of lines) {
      if (!l.lotId || new Decimal(l.quantity).isZero()) continue;
      const q = new Decimal(l.quantity);
      await tx.insert(t.movements).values({
        lotId: l.lotId,
        itemId: l.itemId,
        quantity: (input.deleted ? q.neg() : q).toString(),
        type: input.deleted ? "reversal" : "receipt",
        occurredAt: new Date(),
        docType: "receipt",
        docId: r.id,
        reason: `${input.deleted ? "Delivery deleted" : "Delivery restored"}: ${reason}`,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
        changeId,
      });
    }
    await tx
      .update(t.receipts)
      .set(
        input.deleted
          ? { deletedAt: new Date(), deletedReason: reason }
          : { deletedAt: null, deletedReason: null },
      )
      .where(eq(t.receipts.id, r.id));
    for (const poId of await receiptOrders(tx, r.id)) {
      // Goods that did arrive belong to an open order: a cancelled one is reopened.
      if (!input.deleted) {
        const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, poId));
        if (po?.status === "cancelled") {
          await tx.update(t.purchaseOrders).set({ status: "sent" }).where(eq(t.purchaseOrders.id, poId));
          await logChange(tx, {
            action: "restore",
            area: "purchasing",
            entity: { type: "purchase_order", id: po.id, code: po.code },
            summary: `Order ${po.code} reopened: one of its deliveries was restored`,
            changes: diff([["Status", "Cancelled", "Open"]]),
            reason,
            links: await orderRefs(tx, po),
          });
        }
      }
      await refreshOrderStatus(tx, poId);
    }
    return { alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- lots

/** Correct a lot's supplier batch or best-before (matters for recalls, so it goes in the history). */
export async function updateLot(
  db: DB,
  input: { lotId: string; reason: string; supplierBatch?: string | null; bestBefore?: string | null; storage?: string | null },
) {
  const reason = needReason(input.reason, "Say why the lot is corrected");
  if (input.bestBefore && !isDate(input.bestBefore)) throw new OperationError("Best-before isn't a valid date.");
  const storage = input.storage === undefined ? undefined : parseStorage(input.storage);
  if (storage === "invalid") throw new OperationError("Choose Fridge, Freezer or Room temperature.");
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(t.lots).where(eq(t.lots.id, input.lotId));
    if (!lot) throw new OperationError("Lot not found.");
    const upd = {
      ...(input.supplierBatch !== undefined ? { supplierBatch: input.supplierBatch?.trim() || null } : {}),
      ...(input.bestBefore !== undefined ? { bestBefore: input.bestBefore || null } : {}),
      ...(storage !== undefined ? { storage } : {}),
    };
    const changes = diff([
      ["Supplier batch", lot.supplierBatch, upd.supplierBatch === undefined ? lot.supplierBatch : upd.supplierBatch],
      ["Best-before", lot.bestBefore, upd.bestBefore === undefined ? lot.bestBefore : upd.bestBefore],
      ["Storage", storageLabel(lot.storage), storageLabel(upd.storage === undefined ? lot.storage : upd.storage)],
    ]);
    if (!changes.length) return;
    await tx.update(t.lots).set(upd).where(eq(t.lots.id, lot.id));
    const [item] = await tx.select().from(t.items).where(eq(t.items.id, lot.itemId));
    const links: Ref[] = [{ type: "item", id: lot.itemId, code: item?.name }];
    if (lot.batchId) {
      const [b] = await tx.select().from(t.productionBatches).where(eq(t.productionBatches.id, lot.batchId));
      if (b) links.push({ type: "batch", id: b.id, code: b.code }, { type: "run", id: b.runId });
    }
    const [rl] = await tx
      .select({ r: t.receipts })
      .from(t.receiptLines)
      .innerJoin(t.receipts, eq(t.receiptLines.receiptId, t.receipts.id))
      .where(eq(t.receiptLines.lotId, lot.id));
    if (rl) links.push({ type: "receipt", id: rl.r.id, code: receiptCode(rl.r) });
    await logChange(tx, {
      action: "update",
      area: lot.batchId ? "packaging" : "stock",
      entity: { type: "lot", id: lot.id, code: lot.code },
      summary: changes.length === 1 && changes[0]!.label === "Storage" ? `Lot ${lot.code} moved to ${storageLabel(upd.storage)}` : `Lot ${lot.code} corrected`,
      changes,
      reason,
      links,
    });
  });
}

// ---------------------------------------------------------------- reading orders

export interface OrderLineView {
  line: typeof t.purchaseOrderLines.$inferSelect;
  item: typeof t.items.$inferSelect;
  accepted: Decimal;
  rejected: Decimal;
  /** Still to come; 0 once the order is received, closed or cancelled. */
  pending: Decimal;
}

export interface OrderView {
  po: typeof t.purchaseOrders.$inferSelect;
  supplier: typeof t.suppliers.$inferSelect;
  run: { id: string; code: string } | null;
  lines: OrderLineView[];
  /** Sum of line quantity × unit price; null if any line has no price. */
  cost: Decimal | null;
}

export async function loadOrders(db: DB, filter: { ids?: string[]; runId?: string; doneSince?: string } = {}): Promise<OrderView[]> {
  const conds = [];
  if (filter.ids) {
    if (filter.ids.length === 0) return [];
    conds.push(inArray(t.purchaseOrders.id, filter.ids));
  }
  if (filter.runId) conds.push(eq(t.purchaseOrders.runId, filter.runId));
  // Open orders always; finished ones (received, closed, cancelled) only from this day on.
  if (filter.doneSince)
    conds.push(
      sql`(${t.purchaseOrders.status} not in ('received', 'closed', 'cancelled') or (${t.purchaseOrders.createdAt} at time zone ${BUSINESS_TIME_ZONE})::date >= ${filter.doneSince}::date)`,
    );
  const orders = await db
    .select({ po: t.purchaseOrders, supplier: t.suppliers, runCode: t.productionRuns.code })
    .from(t.purchaseOrders)
    .innerJoin(t.suppliers, eq(t.purchaseOrders.supplierId, t.suppliers.id))
    .leftJoin(t.productionRuns, eq(t.purchaseOrders.runId, t.productionRuns.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${t.purchaseOrders.createdAt} desc`);
  if (orders.length === 0) return [];
  const orderIds = orders.map((o) => o.po.id);
  const lines = await db
    .select({ line: t.purchaseOrderLines, item: t.items })
    .from(t.purchaseOrderLines)
    .innerJoin(t.items, eq(t.purchaseOrderLines.itemId, t.items.id))
    .where(inArray(t.purchaseOrderLines.purchaseOrderId, orderIds));
  // What has arrived against these lines, in one grouped query (not one per line).
  const received = new Map<string, { accepted: string; rejected: string }>();
  if (lines.length) {
    const rows = await db.execute<{ line_id: string; accepted: string; rejected: string }>(sql`
      select r.purchase_order_line_id as line_id, coalesce(sum(r.quantity), 0) as accepted, coalesce(sum(r.rejected_qty), 0) as rejected
      from receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is null
      where r.purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id in (${sql.join(
        orderIds.map((id) => sql`${id}`),
        sql`, `,
      )}))
      group by r.purchase_order_line_id`);
    for (const r of rows) received.set(r.line_id, { accepted: r.accepted, rejected: r.rejected });
  }
  return orders.map(({ po, supplier, runCode }) => {
    const open = po.status === "sent" || po.status === "partly_received" || po.status === "draft";
    const own = lines
      .filter((l) => l.line.purchaseOrderId === po.id)
      .sort((a, b) => a.item.name.localeCompare(b.item.name))
      .map((l) => {
        const got = received.get(l.line.id);
        const accepted = new Decimal(got?.accepted ?? 0);
        return {
          line: l.line,
          item: l.item,
          accepted,
          rejected: new Decimal(got?.rejected ?? 0),
          pending: open ? Decimal.max(0, new Decimal(l.line.quantity).minus(accepted)) : new Decimal(0),
        };
      });
    const cost = own.some((l) => l.line.unitPrice === null)
      ? null
      : own.reduce((s, l) => s.plus(new Decimal(l.line.quantity).mul(l.line.unitPrice!)), new Decimal(0));
    return { po, supplier, run: po.runId ? { id: po.runId, code: runCode ?? "" } : null, lines: own, cost };
  });
}

// ---------------------------------------------------------------- planning an order

export interface OrderPlanLine {
  itemId: string;
  name: string;
  kind: ItemKind;
  unit: UnitCode;
  /** Missing after stock, other runs' reservations, sent orders and this run's drafts. */
  missing: Decimal;
  /** Already in draft orders for this run. */
  inDrafts: Decimal;
  offers: Offer[];
}

/**
 * What still has to be ordered for a plan: the planner's "to buy", minus what
 * is already in draft orders for this run (sent orders already count as on order).
 */
export async function orderPlan(db: DB, plan: PlanResult, runId?: string | null): Promise<OrderPlanLine[]> {
  const short = plan.requirements.filter((r) => r.toBuy !== null && new Decimal(r.toBuy).gt(0));
  const drafts = new Map<string, Decimal>();
  if (runId) {
    const rows = await db
      .select({ itemId: t.purchaseOrderLines.itemId, qty: sql<string>`sum(${t.purchaseOrderLines.quantity})` })
      .from(t.purchaseOrderLines)
      .innerJoin(t.purchaseOrders, eq(t.purchaseOrderLines.purchaseOrderId, t.purchaseOrders.id))
      .where(and(eq(t.purchaseOrders.runId, runId), eq(t.purchaseOrders.status, "draft")))
      .groupBy(t.purchaseOrderLines.itemId);
    for (const r of rows) drafts.set(r.itemId, new Decimal(r.qty));
  }
  const offers = await offersByItem(
    db,
    short.map((r) => r.itemId),
  );
  return short
    .map((r) => {
      const inDrafts = drafts.get(r.itemId) ?? new Decimal(0);
      return {
        itemId: r.itemId,
        name: r.name,
        kind: r.kind,
        unit: r.unit,
        missing: Decimal.max(0, new Decimal(r.toBuy!).minus(inDrafts)),
        inDrafts,
        offers: offers.get(r.itemId) ?? [],
      };
    })
    .filter((l) => l.missing.gt(0) || l.inDrafts.gt(0));
}

// ---------------------------------------------------------------- run budget

export const RUN_BUDGET_COLUMNS = ["toBuy", "total"] as const;

/**
 * Budget for a plan or run, with the favourite supplier's current price.
 * "toBuy": only what's missing, rounded up to whole packs.
 * "total": everything the run needs, including what is already in stock.
 */
export async function planBudget(db: DB, plan: PlanResult) {
  const offers = await offersByItem(
    db,
    plan.requirements.map((r) => r.itemId),
  );
  const lines: BudgetLineInput[] = plan.requirements.map((r) => {
    const fav = favourite(offers.get(r.itemId) ?? []);
    const up = unitPrice(fav);
    const required = D(r.required as Decimal.Value | null);
    const toBuy = D(r.toBuy as Decimal.Value | null);
    const rounded = toBuy !== null && toBuy.gt(0) ? roundToPacks(toBuy, fav, r.unit) : null;
    return {
      itemId: r.itemId,
      name: r.name,
      kind: r.kind,
      unit: r.unit,
      priceText: fav ? describePrice(fav, UNITS[r.unit].label) : "no supplier",
      priceSource: fav?.supplierName,
      columns: {
        toBuy: { quantity: rounded?.quantity ?? toBuy, cost: rounded ? rounded.cost : toBuy === null ? null : new Decimal(0) },
        total: { quantity: required, cost: required === null || up === null ? null : required.mul(up) },
      },
    };
  });
  return buildBudget(lines, [...RUN_BUDGET_COLUMNS]);
}
