import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, today, positive, itemsById, checkWholeUnits, nextLotCode, type Tx } from "./base";
import { loadOffers, offersByItem } from "./suppliers";
import { buildBudget, describePrice, favourite, roundToPacks, unitPrice, type BudgetLineInput, type Offer } from "@/domain/pricing";
import type { PlanResult } from "@/domain/planner";
import { UNITS, type UnitCode } from "@/domain/quantity";

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
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

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
  const items = await itemsById(tx, lines.map((l) => l.itemId));
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
  const chosen = input.lines.filter((l) => l.supplierId && ((l.packs ?? 0) > 0 || (l.quantity != null && String(l.quantity).trim() !== "" && Number(l.quantity) > 0)));
  if (chosen.length === 0) throw new OperationError("Nothing to order: choose a supplier and a quantity for at least one item.");
  const bySupplier = new Map<string, PlannedOrderLine[]>();
  for (const l of chosen) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l]);
  const orders = [];
  for (const [supplierId, lines] of bySupplier) {
    orders.push(await createPurchaseOrder(db, { idempotencyKey: `${input.idempotencyKey}:${supplierId}`, supplierId, runId: input.runId, lines }));
  }
  return orders;
}

/** Change a draft: dates, notes, quantities (0 removes the line). */
export async function updateDraftOrder(
  db: DB,
  purchaseOrderId: string,
  input: { expectedOn?: string | null; reference?: string | null; note?: string | null; lines: { lineId: string; quantity?: string | null; packs?: number | null; unitPrice?: string | null }[] },
) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status !== "draft") throw new OperationError("Only a draft order can be changed. This one has already been sent.");
    await tx
      .update(t.purchaseOrders)
      .set({ expectedOn: isDate(input.expectedOn) ? input.expectedOn : null, reference: input.reference?.trim() || null, note: input.note?.trim() || null })
      .where(eq(t.purchaseOrders.id, po.id));
    const current = await tx.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const items = await itemsById(tx, current.map((l) => l.itemId));
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
        quantity = raw === "" ? new Decimal(0) : new Decimal(raw.replace(",", "."));
        if (quantity.isNaN() || quantity.lt(0)) throw new OperationError(`${item.name}: quantity can't be negative.`);
        if (line.packQty && quantity.mod(line.packQty).isZero()) packs = quantity.div(line.packQty).toNumber();
      }
      if (quantity.isZero()) {
        await tx.delete(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.id, line.id));
        left--;
        continue;
      }
      checkWholeUnits(item, quantity);
      const rawPrice = String(change.unitPrice ?? "").trim();
      const price = rawPrice === "" ? null : new Decimal(rawPrice.replace(",", "."));
      if (price && (price.isNaN() || price.lt(0))) throw new OperationError(`${item.name}: price can't be negative.`);
      const priceChanged = change.unitPrice !== undefined && (price === null ? line.unitPrice !== null : line.unitPrice === null || !price.eq(line.unitPrice));
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
    return { po: updated!, alreadySent: false };
  });
}

export async function cancelPurchaseOrder(db: DB, purchaseOrderId: string) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, purchaseOrderId));
    if (!po) throw new OperationError("Order not found.");
    if (po.status === "received" || po.status === "closed") throw new OperationError("A received or closed order can't be cancelled.");
    if (po.status === "partly_received") throw new OperationError("Part of this order has arrived. Close it instead, so what arrived stays on record.");
    await tx.update(t.purchaseOrders).set({ status: "cancelled" }).where(eq(t.purchaseOrders.id, purchaseOrderId));
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

    const items = await itemsById(tx, input.lines.filter((l) => l.itemId).map((l) => l.itemId));
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
        if (pl.po.status === "cancelled" || pl.po.status === "closed") throw new OperationError(`${pl.po.code} is ${pl.po.status}.`);
      }
      let lotId: string | null = null;
      if (line.accepted.gt(0)) {
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
            bestBefore: line.bestBefore || null,
          })
          .returning();
        lotId = lot!.id;
        await tx.insert(t.movements).values({
          lotId,
          itemId: item.id,
          quantity: line.accepted.toString(),
          type: "receipt",
          occurredAt: new Date(`${input.receivedOn}T${time ?? "12:00"}:00Z`),
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
    return { receipt: receipt!, alreadyRecorded: false };
  });
}

/** Received when every line's accepted quantity reaches what was ordered. Refused goods don't count. */
async function refreshOrderStatus(tx: Tx, poId: string) {
  const rows = await tx.execute<{ ordered: string; accepted: string; touched: boolean }>(sql`
    select l.quantity as ordered, coalesce(sum(r.quantity), 0) as accepted, count(r.id) > 0 as touched
    from purchase_order_lines l left join receipt_lines r on r.purchase_order_line_id = l.id
    where l.purchase_order_id = ${poId} group by l.id, l.quantity`);
  const all = [...rows];
  const complete = all.every((r) => new Decimal(r.accepted).gte(r.ordered));
  const any = all.some((r) => r.touched);
  await tx
    .update(t.purchaseOrders)
    .set({ status: complete ? "received" : any ? "partly_received" : "sent" })
    .where(and(eq(t.purchaseOrders.id, poId), inArray(t.purchaseOrders.status, ["sent", "partly_received"])));
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

export async function loadOrders(db: DB, filter: { ids?: string[]; runId?: string } = {}): Promise<OrderView[]> {
  const conds = [];
  if (filter.ids) {
    if (filter.ids.length === 0) return [];
    conds.push(inArray(t.purchaseOrders.id, filter.ids));
  }
  if (filter.runId) conds.push(eq(t.purchaseOrders.runId, filter.runId));
  const orders = await db
    .select({ po: t.purchaseOrders, supplier: t.suppliers, runCode: t.productionRuns.code })
    .from(t.purchaseOrders)
    .innerJoin(t.suppliers, eq(t.purchaseOrders.supplierId, t.suppliers.id))
    .leftJoin(t.productionRuns, eq(t.purchaseOrders.runId, t.productionRuns.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${t.purchaseOrders.createdAt} desc`);
  if (orders.length === 0) return [];
  const lines = await db
    .select({
      line: t.purchaseOrderLines,
      item: t.items,
      accepted: sql<string>`(select coalesce(sum(quantity), 0) from receipt_lines r where r.purchase_order_line_id = ${t.purchaseOrderLines.id})`,
      rejected: sql<string>`(select coalesce(sum(rejected_qty), 0) from receipt_lines r where r.purchase_order_line_id = ${t.purchaseOrderLines.id})`,
    })
    .from(t.purchaseOrderLines)
    .innerJoin(t.items, eq(t.purchaseOrderLines.itemId, t.items.id))
    .where(inArray(t.purchaseOrderLines.purchaseOrderId, orders.map((o) => o.po.id)));
  return orders.map(({ po, supplier, runCode }) => {
    const open = po.status === "sent" || po.status === "partly_received" || po.status === "draft";
    const own = lines
      .filter((l) => l.line.purchaseOrderId === po.id)
      .sort((a, b) => a.item.name.localeCompare(b.item.name))
      .map((l) => {
        const accepted = new Decimal(l.accepted);
        return {
          line: l.line,
          item: l.item,
          accepted,
          rejected: new Decimal(l.rejected),
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
  kind: "ingredient" | "packaging";
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
  const offers = await offersByItem(db, short.map((r) => r.itemId));
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
  const offers = await offersByItem(db, plan.requirements.map((r) => r.itemId));
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
