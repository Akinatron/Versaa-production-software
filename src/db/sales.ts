import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, today, type Tx } from "./base";
import { allocate, itemOnHand, reservedForSales } from "./ledger";

/*
 * Sales and other outflows of finished jars.
 *
 * - A sales order is a promise: it reserves jars but doesn't take them out.
 * - Delivering it is the one moment stock goes down, so a sale is never
 *   deducted twice.
 * - Own use, tests, samples/gifts and waste also take jars out, but are not sales.
 * - Every jar leaves from a specific batch lot (earliest best-before first
 *   unless you pick), and nothing can go out that isn't there.
 */

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
type OutflowType = (typeof t.outflowType.enumValues)[number];

export async function addCustomer(db: DB, input: { name: string; contact?: string | null; notes?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Customer name is required.");
  const [row] = await db.insert(t.customers).values({ name, contact: input.contact?.trim() || null, notes: input.notes?.trim() || null }).returning();
  return row!;
}

async function productsById(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, typeof t.products.$inferSelect>();
  const rows = await tx.select().from(t.products).where(inArray(t.products.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function price(v: Decimal.Value | null | undefined) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const d = new Decimal(v);
  if (d.isNaN() || d.lt(0)) throw new OperationError("Prices can't be negative.");
  return d.toString();
}

/** Jars of each product free to promise or send: on hand − reserved by pending orders. */
export async function finishedAvailability(db: DB | Tx) {
  const rows = await db.execute<{ product_id: string; name: string; on_hand: string | null; reserved: string | null }>(sql`
    select p.id as product_id, p.name,
      (select sum(m.quantity) from movements m where m.item_id = p.item_id) as on_hand,
      (select sum(r.quantity) from reservations r where r.item_id = p.item_id and r.released_at is null and r.sales_order_id is not null) as reserved
    from products p order by p.name`);
  return [...rows].map((r) => {
    const onHand = new Decimal(r.on_hand ?? 0);
    const reserved = new Decimal(r.reserved ?? 0);
    return { productId: r.product_id, name: r.name, onHand, reserved, available: Decimal.max(0, onHand.minus(reserved)) };
  });
}

// ---------------------------------------------------------------- sales orders

export interface SalesLineInput {
  productId: string;
  jars: number;
  unitPrice?: Decimal.Value | null;
}

/** A pending order: reserves jars so they aren't promised twice. Stock doesn't change yet. */
export async function createSalesOrder(
  db: DB,
  input: { idempotencyKey: string; customerId?: string | null; destination?: string | null; reference?: string | null; orderedOn?: string; deliverBy?: string | null; lines: SalesLineInput[] },
) {
  const lines = input.lines.filter((l) => l.productId && l.jars !== 0);
  if (!lines.length) throw new OperationError("Add at least one product.");
  for (const l of lines) if (!Number.isInteger(l.jars) || l.jars < 0) throw new OperationError("Jars must be whole numbers.");
  if (!input.customerId && !input.destination?.trim()) throw new OperationError("Choose a customer or write a destination.");
  const orderedOn = input.orderedOn && isDate(input.orderedOn) ? input.orderedOn : today();
  const deliverBy = input.deliverBy?.trim() || null;
  if (deliverBy && !isDate(deliverBy)) throw new OperationError("The delivery date isn't a valid date.");
  if (deliverBy && deliverBy < orderedOn) throw new OperationError("The delivery date can't be before the order date.");

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.idempotencyKey, input.idempotencyKey));
    if (existing) return { order: existing, alreadyRecorded: true };
    const products = await productsById(tx, lines.map((l) => l.productId));
    const [order] = await tx
      .insert(t.salesOrders)
      .values({
        code: `SO-${orderedOn.replaceAll("-", "")}-${input.idempotencyKey.slice(0, 4).toUpperCase()}`,
        customerId: input.customerId || null,
        destination: input.destination?.trim() || null,
        reference: input.reference?.trim() || null,
        orderedOn,
        deliverBy,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    for (const l of lines) {
      const p = products.get(l.productId);
      if (!p) throw new OperationError("Unknown product.");
      await tx.insert(t.salesOrderLines).values({ salesOrderId: order!.id, productId: p.id, jars: l.jars, unitPrice: price(l.unitPrice) });
      await tx.insert(t.reservations).values({ salesOrderId: order!.id, itemId: p.itemId, quantity: String(l.jars) });
    }
    return { order: order!, alreadyRecorded: false };
  });
}

export async function cancelSalesOrder(db: DB, salesOrderId: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, salesOrderId));
    if (!o) throw new OperationError("Order not found.");
    if (o.status !== "pending") throw new OperationError(`This order is already ${o.status}.`);
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, o.id), isNull(t.reservations.releasedAt)));
    await tx.update(t.salesOrders).set({ status: "cancelled" }).where(eq(t.salesOrders.id, o.id));
  });
}

/**
 * Deliver a pending order: jars leave stock now, from specific lots, and the
 * order's reservation is released. `lots` optionally picks lots per product.
 */
export async function deliverSalesOrder(
  db: DB,
  input: { idempotencyKey: string; salesOrderId: string; deliveredOn?: string; lots?: Record<string, { lotId: string; jars: number }[]> },
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.outflows).where(eq(t.outflows.idempotencyKey, input.idempotencyKey));
    if (existing) return { outflow: existing, alreadyRecorded: true };
    await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
    const [o] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, input.salesOrderId));
    if (!o) throw new OperationError("Order not found.");
    if (o.status !== "pending") throw new OperationError(`This order is already ${o.status}.`);
    const lines = await tx.select().from(t.salesOrderLines).where(eq(t.salesOrderLines.salesOrderId, o.id));
    const outflow = await writeOutflow(tx, {
      idempotencyKey: input.idempotencyKey,
      type: "sale",
      salesOrderId: o.id,
      customerId: o.customerId,
      destination: o.destination,
      reference: o.reference,
      occurredOn: input.deliveredOn && isDate(input.deliveredOn) ? input.deliveredOn : today(),
      lines: lines.map((l) => ({ productId: l.productId, jars: l.jars, unitPrice: l.unitPrice, lots: input.lots?.[l.productId] })),
      exceptOrderId: o.id,
    });
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, o.id), isNull(t.reservations.releasedAt)));
    await tx.update(t.salesOrders).set({ status: "delivered" }).where(eq(t.salesOrders.id, o.id));
    return { outflow, alreadyRecorded: false };
  });
}

// ---------------------------------------------------------------- outflows

export interface OutflowLineInput {
  productId: string;
  jars: number;
  unitPrice?: Decimal.Value | null;
  lots?: { lotId: string; jars: number }[];
}

/** Jars going out without a sales order: a direct sale, own use, test, sample/gift or waste. */
export async function recordOutflow(
  db: DB,
  input: {
    idempotencyKey: string;
    type: OutflowType;
    customerId?: string | null;
    destination?: string | null;
    reference?: string | null;
    note?: string | null;
    occurredOn?: string;
    lines: OutflowLineInput[];
  },
) {
  if (input.type === "waste" && !input.note?.trim()) throw new OperationError("Say why the jars are written off.");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(t.outflows).where(eq(t.outflows.idempotencyKey, input.idempotencyKey));
    if (existing) return { outflow: existing, alreadyRecorded: true };
    await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
    const outflow = await writeOutflow(tx, { ...input, occurredOn: input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today() });
    return { outflow, alreadyRecorded: false };
  });
}

const PREFIX: Record<OutflowType, string> = { sale: "OUT", sample: "SMP", waste: "WST", internal_use: "INT", test: "TST" };

async function writeOutflow(
  tx: Tx,
  input: {
    idempotencyKey: string;
    type: OutflowType;
    salesOrderId?: string | null;
    customerId?: string | null;
    destination?: string | null;
    reference?: string | null;
    note?: string | null;
    occurredOn: string;
    lines: OutflowLineInput[];
    exceptOrderId?: string;
  },
) {
  const lines = input.lines.filter((l) => l.productId && l.jars !== 0);
  if (!lines.length) throw new OperationError("Add at least one product.");
  for (const l of lines) if (!Number.isInteger(l.jars) || l.jars < 0) throw new OperationError("Jars must be whole numbers.");
  const products = await productsById(tx, lines.map((l) => l.productId));

  // Nothing leaves that isn't there, and jars promised to other orders stay put.
  const problems: string[] = [];
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.jars);
  for (const [productId, jars] of totals) {
    const p = products.get(productId);
    if (!p) throw new OperationError("Unknown product.");
    const onHand = await itemOnHand(tx, p.itemId);
    const reserved = await reservedForSales(tx, p.itemId, input.exceptOrderId);
    const free = Decimal.max(0, onHand.minus(reserved));
    if (free.lt(jars)) {
      problems.push(
        `${p.name}: ${jars} jars needed, ${free} available${reserved.gt(0) ? ` (${onHand} in stock, ${reserved} promised to other orders)` : ""}.`,
      );
    }
  }
  if (problems.length) throw new OperationError(`Not enough stock. ${problems.join(" ")}`);

  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t.outflows)
    .where(sql`${t.outflows.code} like ${`${PREFIX[input.type]}-${input.occurredOn.replaceAll("-", "")}-%`}`);
  const [outflow] = await tx
    .insert(t.outflows)
    .values({
      code: `${PREFIX[input.type]}-${input.occurredOn.replaceAll("-", "")}-${String(n + 1).padStart(3, "0")}`,
      type: input.type,
      salesOrderId: input.salesOrderId || null,
      customerId: input.customerId || null,
      destination: input.destination?.trim() || null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      occurredOn: input.occurredOn,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();

  let i = 0;
  for (const l of lines) {
    const p = products.get(l.productId)!;
    const item = { id: p.itemId, name: p.name, stockUnit: "jars" };
    const chosen = l.lots?.filter((x) => x.jars > 0);
    if (chosen?.length) {
      const sum = chosen.reduce((s, x) => s + x.jars, 0);
      if (sum !== l.jars) throw new OperationError(`${p.name}: the lots add up to ${sum} jars, not ${l.jars}.`);
    }
    const allocations = await allocate(tx, item, new Decimal(l.jars), chosen?.map((x) => ({ lotId: x.lotId, quantity: x.jars })));
    for (const a of allocations) {
      await tx.insert(t.outflowLines).values({ outflowId: outflow!.id, productId: p.id, lotId: a.lotId, jars: a.quantity.toNumber(), unitPrice: price(l.unitPrice) });
      await tx.insert(t.movements).values({
        lotId: a.lotId,
        itemId: p.itemId,
        quantity: a.quantity.neg().toString(),
        type: input.type,
        occurredAt: new Date(`${input.occurredOn}T12:00:00Z`),
        docType: "outflow",
        docId: outflow!.id,
        reason: input.note?.trim() || null,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
      });
    }
  }
  return outflow!;
}
