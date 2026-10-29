import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError, lockNames, nextCode, today, type Tx, isDate, zeroOrMore } from "./base";
import { allocate, jarsFree, lotBalance } from "./ledger";
import { diff, logChange, needReason, type FieldChange, type Ref } from "./changes";
import { inSentence, SALES_STATUS_NAME } from "@/domain/status";

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

type OutflowType = (typeof t.outflowType.enumValues)[number];

export async function addCustomer(db: DB, input: { name: string; contact?: string | null; notes?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Customer name is required.");
  return db.transaction(async (tx) => {
    await lockNames(tx);
    const [dup] = await tx.select().from(t.customers).where(sql`lower(${t.customers.name}) = lower(${name})`);
    if (dup) throw new OperationError(`${dup.name} already exists.`);
    const [row] = await tx.insert(t.customers).values({ name, contact: input.contact?.trim() || null, notes: input.notes?.trim() || null }).returning();
    await logChange(tx, { action: "create", area: "sales", entity: { type: "customer", id: row!.id, code: name }, summary: `Added customer ${name}` });
    return row!;
  });
}

async function productsById(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, typeof t.products.$inferSelect>();
  const rows = await tx.select().from(t.products).where(inArray(t.products.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function price(v: Decimal.Value | null | undefined) {
  const d = zeroOrMore(v, "Price");
  if (!d) return null;
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
        code: await nextCode(tx, t.salesOrders.code, `SO-${orderedOn.replaceAll("-", "")}`),
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
    await logChange(tx, {
      action: "create",
      area: "sales",
      entity: { type: "sales_order", id: order!.id, code: order!.code },
      summary: `Sales order ${order!.code} for ${await customerName(tx, order!)}`,
      changes: lines.map((l) => ({ label: products.get(l.productId)!.name, after: `${l.jars} jars` })),
      links: order!.customerId ? [{ type: "customer", id: order!.customerId }] : [],
    });
    return { order: order!, alreadyRecorded: false };
  });
}

async function customerName(tx: Tx, o: { customerId: string | null; destination: string | null }) {
  if (o.customerId) {
    const [c] = await tx.select({ name: t.customers.name }).from(t.customers).where(eq(t.customers.id, o.customerId));
    if (c) return c.name;
  }
  return o.destination ?? "customer";
}

const orderRef = (o: { id: string; code: string }): Ref => ({ type: "sales_order", id: o.id, code: o.code });

export async function cancelSalesOrder(db: DB, salesOrderId: string, reason?: string | null) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, salesOrderId));
    if (!o) throw new OperationError("Order not found.");
    if (o.status !== "pending") throw new OperationError(`This order is already ${inSentence(SALES_STATUS_NAME, o.status)}.`);
    const why = needReason(reason, "Say why the order is cancelled");
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, o.id), isNull(t.reservations.releasedAt)));
    await tx.update(t.salesOrders).set({ status: "cancelled" }).where(eq(t.salesOrders.id, o.id));
    await logChange(tx, {
      action: "cancel",
      area: "sales",
      entity: orderRef(o),
      summary: `Sales order ${o.code} cancelled: its jars are free again`,
      changes: diff([["Status", "To deliver", "Cancelled"]]),
      reason: why,
      links: o.customerId ? [{ type: "customer", id: o.customerId }] : [],
    });
  });
}

/** A cancelled order back to "to deliver", reserving its jars again. */
export async function restoreSalesOrder(db: DB, salesOrderId: string, reason?: string | null) {
  const why = needReason(reason, "Say why the order is restored");
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, salesOrderId));
    if (!o) throw new OperationError("Order not found.");
    if (o.status !== "cancelled") throw new OperationError("Only a cancelled order can be restored.");
    await reserveOrder(tx, o.id);
    await tx.update(t.salesOrders).set({ status: "pending" }).where(eq(t.salesOrders.id, o.id));
    await logChange(tx, {
      action: "restore",
      area: "sales",
      entity: orderRef(o),
      summary: `Sales order ${o.code} restored: its jars are reserved again`,
      changes: diff([["Status", "Cancelled", "To deliver"]]),
      reason: why,
      links: o.customerId ? [{ type: "customer", id: o.customerId }] : [],
    });
  });
}

/** Release whatever an order still reserves and reserve its lines afresh. */
async function reserveOrder(tx: Tx, orderId: string) {
  await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, orderId), isNull(t.reservations.releasedAt)));
  const lines = await tx.select({ jars: t.salesOrderLines.jars, itemId: t.products.itemId }).from(t.salesOrderLines).innerJoin(t.products, eq(t.salesOrderLines.productId, t.products.id)).where(eq(t.salesOrderLines.salesOrderId, orderId));
  for (const l of lines) await tx.insert(t.reservations).values({ salesOrderId: orderId, itemId: l.itemId, quantity: String(l.jars) });
}

/** Change an order that hasn't been delivered: customer, dates, reference and lines. Its reservation follows. */
export async function updateSalesOrder(
  db: DB,
  input: {
    salesOrderId: string;
    reason: string;
    customerId?: string | null;
    destination?: string | null;
    reference?: string | null;
    orderedOn: string;
    deliverBy?: string | null;
    lines: SalesLineInput[];
  },
) {
  const why = needReason(input.reason, "Say why the order is changed");
  const lines = input.lines.filter((l) => l.productId && l.jars !== 0);
  if (!lines.length) throw new OperationError("Add at least one product, or cancel the order.");
  for (const l of lines) if (!Number.isInteger(l.jars) || l.jars < 0) throw new OperationError("Jars must be whole numbers.");
  if (!input.customerId && !input.destination?.trim()) throw new OperationError("Choose a customer or write a destination.");
  if (!isDate(input.orderedOn)) throw new OperationError("Enter the order date.");
  const deliverBy = input.deliverBy?.trim() || null;
  if (deliverBy && !isDate(deliverBy)) throw new OperationError("The delivery date isn't a valid date.");
  if (deliverBy && deliverBy < input.orderedOn) throw new OperationError("The delivery date can't be before the order date.");
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, input.salesOrderId));
    if (!o) throw new OperationError("Order not found.");
    if (o.status !== "pending") throw new OperationError(`This order is ${inSentence(SALES_STATUS_NAME, o.status)}, so it can't be changed.${o.status === "delivered" ? " Correct its delivery instead." : ""}`);
    const old = await tx.select().from(t.salesOrderLines).where(eq(t.salesOrderLines.salesOrderId, o.id));
    const products = await productsById(tx, [...new Set([...old.map((l) => l.productId), ...lines.map((l) => l.productId)])]);
    for (const l of lines) if (!products.get(l.productId)) throw new OperationError("Unknown product.");
    const header = { customerId: input.customerId || null, destination: input.destination?.trim() || null, reference: input.reference?.trim() || null, orderedOn: input.orderedOn, deliverBy };
    const changes: FieldChange[] = diff([
      ["Customer", await customerName(tx, o), await customerName(tx, header)],
      ["Reference", o.reference, header.reference],
      ["Ordered", o.orderedOn, header.orderedOn],
      ["Deliver by", o.deliverBy, header.deliverBy],
    ]);
    const lineText = (ls: { productId: string; jars: number; unitPrice?: Decimal.Value | null }[]) => {
      const m = new Map<string, string>();
      for (const l of ls) m.set(l.productId, `${l.jars} jars${l.unitPrice != null && String(l.unitPrice) !== "" ? ` at ${new Decimal(l.unitPrice)} €` : ""}`);
      return m;
    };
    const before = lineText(old);
    const after = lineText(lines);
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(id) !== after.get(id)) changes.push({ label: products.get(id)?.name ?? "Product", before: before.get(id) ?? null, after: after.get(id) ?? null });
    }
    if (!changes.length) return;
    await tx.update(t.salesOrders).set(header).where(eq(t.salesOrders.id, o.id));
    await tx.delete(t.salesOrderLines).where(eq(t.salesOrderLines.salesOrderId, o.id));
    await tx.insert(t.salesOrderLines).values(lines.map((l) => ({ salesOrderId: o.id, productId: l.productId, jars: l.jars, unitPrice: price(l.unitPrice) })));
    await reserveOrder(tx, o.id);
    await logChange(tx, {
      action: "update",
      area: "sales",
      entity: orderRef(o),
      summary: `Sales order ${o.code} changed`,
      changes,
      reason: why,
      links: [o.customerId, header.customerId].filter((x): x is string => !!x).map((id) => ({ type: "customer" as const, id })),
    });
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
    if (o.status !== "pending") throw new OperationError(`This order is already ${inSentence(SALES_STATUS_NAME, o.status)}.`);
    const lines = await tx.select().from(t.salesOrderLines).where(eq(t.salesOrderLines.salesOrderId, o.id));
    const lotsByLine = await splitChosenLots(tx, lines, input.lots);
    const { outflow } = await writeOutflow(tx, {
      idempotencyKey: input.idempotencyKey,
      type: "sale",
      salesOrderId: o.id,
      customerId: o.customerId,
      destination: o.destination,
      reference: o.reference,
      occurredOn: input.deliveredOn && isDate(input.deliveredOn) ? input.deliveredOn : today(),
      lines: lines.map((l, i) => ({ productId: l.productId, jars: l.jars, unitPrice: l.unitPrice, lots: lotsByLine[i] })),
      exceptOrderId: o.id,
    });
    await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, o.id), isNull(t.reservations.releasedAt)));
    await tx.update(t.salesOrders).set({ status: "delivered" }).where(eq(t.salesOrders.id, o.id));
    await logOutflow(tx, outflow, "create", `Sales order ${o.code} delivered as ${outflow.code}`);
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
    if (existing) return { outflow: existing, alreadyRecorded: true, short: [] as string[] };
    await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
    const { outflow, short } = await writeOutflow(tx, { ...input, occurredOn: input.occurredOn && isDate(input.occurredOn) ? input.occurredOn : today() });
    await logOutflow(tx, outflow, "create", `${OUTFLOW[outflow.type]} recorded: ${outflow.code}`);
    return { outflow, alreadyRecorded: false, short };
  });
}

/**
 * Lots picked by hand, per product, split over the order's lines of that
 * product in order: with 6 + 2 jars of one size, the picked 8 fill the first
 * line and then the second.
 */
async function splitChosenLots(
  tx: Tx,
  lines: { productId: string; jars: number }[],
  lots: Record<string, { lotId: string; jars: number }[]> | undefined,
): Promise<({ lotId: string; jars: number }[] | undefined)[]> {
  if (!lots) return lines.map(() => undefined);
  const queue = new Map(Object.entries(lots).map(([productId, ls]) => [productId, ls.filter((x) => x.jars > 0).map((x) => ({ ...x }))]));
  for (const [productId, picked] of queue) {
    if (!picked.length) continue;
    const want = lines.filter((l) => l.productId === productId).reduce((n, l) => n + l.jars, 0);
    const sum = picked.reduce((n, x) => n + x.jars, 0);
    if (sum !== want) {
      const [p] = await tx.select({ name: t.products.name }).from(t.products).where(eq(t.products.id, productId));
      throw new OperationError(`${p?.name ?? "A product"}: the lots add up to ${sum} jars, not ${want}.`);
    }
  }
  return lines.map((l) => {
    const picked = queue.get(l.productId);
    if (!picked?.length) return undefined;
    const out: { lotId: string; jars: number }[] = [];
    let left = l.jars;
    while (left > 0 && picked.length) {
      const head = picked[0]!;
      const take = Math.min(left, head.jars);
      out.push({ lotId: head.lotId, jars: take });
      head.jars -= take;
      left -= take;
      if (head.jars === 0) picked.shift();
    }
    return out;
  });
}

/**
 * Can these jars leave stock? Used when recording an outflow and when
 * restoring a deleted one, so both follow the same rule. A sale leaves jars
 * promised to other orders alone; waste, samples, tests and own use only need
 * the jars to be there (broken is broken), and say which orders are now short.
 */
async function jarsCanLeave(
  tx: Tx,
  type: OutflowType,
  lines: { productId: string; jars: number }[],
  products: Map<string, typeof t.products.$inferSelect>,
  exceptOrderId?: string | null,
) {
  const isSale = type === "sale";
  const problems: string[] = [];
  const short: string[] = [];
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.jars);
  for (const [productId, jars] of totals) {
    const p = products.get(productId);
    if (!p) throw new OperationError("Unknown product.");
    const { onHand, promised, free } = await jarsFree(tx, p.itemId, exceptOrderId ?? undefined);
    if (isSale && free.lt(jars)) {
      problems.push(
        `${p.name}: ${jars} jars needed, ${free} available${promised.gt(0) ? ` (${onHand} in stock, ${promised} promised to other orders)` : ""}.`,
      );
    } else if (!isSale && onHand.lt(jars)) {
      problems.push(`${p.name}: ${jars} jars needed, ${onHand} in stock.`);
    } else if (!isSale && promised.gt(onHand.minus(jars))) {
      short.push(`${p.name}: sales orders are now ${promised.minus(Decimal.max(0, onHand.minus(jars)))} jars short.`);
    }
  }
  return { problems, short };
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

  const { problems, short } = await jarsCanLeave(tx, input.type, lines, products, input.exceptOrderId);
  if (problems.length) throw new OperationError(`Not enough stock. ${problems.join(" ")}`);

  const [outflow] = await tx
    .insert(t.outflows)
    .values({
      code: await nextCode(tx, t.outflows.code, `${PREFIX[input.type]}-${input.occurredOn.replaceAll("-", "")}`, 3),
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
  return { outflow: outflow!, short };
}

// ---------------------------------------------------------------- correcting outflows

export const OUTFLOW: Record<OutflowType, string> = { sale: "Sale", sample: "Sample / gift", waste: "Waste / loss", internal_use: "Own use", test: "Test" };

async function outflowLinesText(tx: Tx, outflowId: string) {
  return tx
    .select({ line: t.outflowLines, product: t.products, lot: t.lots })
    .from(t.outflowLines)
    .innerJoin(t.products, eq(t.outflowLines.productId, t.products.id))
    .innerJoin(t.lots, eq(t.outflowLines.lotId, t.lots.id))
    .where(eq(t.outflowLines.outflowId, outflowId));
}

async function outflowRefs(tx: Tx, o: typeof t.outflows.$inferSelect) {
  const lines = await outflowLinesText(tx, o.id);
  const refs: Ref[] = lines.map((l) => ({ type: "lot", id: l.lot.id, code: l.lot.code }));
  for (const batchId of new Set(lines.map((l) => l.lot.batchId).filter((x): x is string => !!x))) {
    const [b] = await tx.select({ id: t.productionBatches.id, code: t.productionBatches.code }).from(t.productionBatches).where(eq(t.productionBatches.id, batchId));
    if (b) refs.push({ type: "batch", id: b.id, code: b.code });
  }
  if (o.salesOrderId) {
    const [so] = await tx.select({ id: t.salesOrders.id, code: t.salesOrders.code }).from(t.salesOrders).where(eq(t.salesOrders.id, o.salesOrderId));
    if (so) refs.push(orderRef(so));
  }
  if (o.customerId) refs.push({ type: "customer", id: o.customerId });
  return { refs, lines };
}

async function logOutflow(tx: Tx, o: typeof t.outflows.$inferSelect, action: "create" | "delete" | "restore", summary: string, reason?: string | null) {
  const { refs, lines } = await outflowRefs(tx, o);
  return logChange(tx, {
    action,
    area: "sales",
    entity: { type: "outflow", id: o.id, code: o.code },
    summary,
    changes: lines.map((l) => ({
      label: `${l.product.name} (${l.lot.code})`,
      before: action === "create" ? null : action === "delete" ? `${l.line.jars} jars out` : "back in stock",
      after: action === "delete" ? "back in stock" : `${l.line.jars} jars out`,
    })),
    reason,
    links: refs,
  });
}

/**
 * Delete an outflow: its jars go back into the lots they left, and it stays
 * on record marked as deleted. If it delivered a sales order, the order is
 * "to deliver" again with its jars reserved. Restoring takes the same jars
 * out of the same lots again, if they are still there.
 */
export async function setOutflowDeleted(db: DB, input: { idempotencyKey: string; outflowId: string; deleted: boolean; reason: string }) {
  const reason = needReason(input.reason, input.deleted ? "Say why this is deleted" : "Say why this is restored");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
    const [o] = await tx.select().from(t.outflows).where(eq(t.outflows.id, input.outflowId));
    if (!o) throw new OperationError("Not found.");
    if (!!o.deletedAt === input.deleted) return { alreadyRecorded: true };
    const lines = await outflowLinesText(tx, o.id);
    const [so] = o.salesOrderId ? await tx.select().from(t.salesOrders).where(eq(t.salesOrders.id, o.salesOrderId)) : [];
    if (!input.deleted) {
      // The same jars leave the same lots again: each lot must still hold all
      // the jars its lines take, and the jars must pass the same check as a
      // new outflow (a sale can't take jars promised to another order).
      const problems: string[] = [];
      const perLot = new Map<string, { code: string; name: string; jars: number }>();
      for (const l of lines) {
        const cur = perLot.get(l.lot.id) ?? { code: l.lot.code, name: l.product.name, jars: 0 };
        cur.jars += l.line.jars;
        perLot.set(l.lot.id, cur);
      }
      for (const [lotId, need] of perLot) {
        const left = await lotBalance(tx, lotId);
        if (left.lt(need.jars)) problems.push(`${need.name}: lot ${need.code} only has ${left} jars left, ${need.jars} needed.`);
      }
      const products = new Map(lines.map((l) => [l.product.id, l.product]));
      const check = await jarsCanLeave(
        tx,
        o.type,
        lines.map((l) => ({ productId: l.product.id, jars: l.line.jars })),
        products,
        o.salesOrderId,
      );
      problems.push(...check.problems);
      if (problems.length) throw new OperationError(`Those jars aren't free any more, so this can't be restored. ${problems.join(" ")}`);
      if (so && so.status !== "pending") throw new OperationError(`Sales order ${so.code} is ${inSentence(SALES_STATUS_NAME, so.status)} now, so this delivery can't come back.`);
    } else if (so && so.status !== "delivered") {
      throw new OperationError(`Sales order ${so.code} is ${inSentence(SALES_STATUS_NAME, so.status)}; it can't go back to "to deliver".`);
    }
    const changeId = await logOutflow(
      tx,
      o,
      input.deleted ? "delete" : "restore",
      input.deleted ? `${o.code} deleted: its jars are back in stock${so ? `, ${so.code} is to deliver again` : ""}` : `${o.code} restored: its jars are out again${so ? `, ${so.code} delivered` : ""}`,
      reason,
    );
    let i = 0;
    for (const l of lines) {
      await tx.insert(t.movements).values({
        lotId: l.lot.id,
        itemId: l.product.itemId,
        quantity: String(input.deleted ? l.line.jars : -l.line.jars),
        type: input.deleted ? "reversal" : o.type,
        occurredAt: new Date(),
        docType: "outflow",
        docId: o.id,
        reason: `${o.code} ${input.deleted ? "deleted" : "restored"}: ${reason}`,
        idempotencyKey: `${input.idempotencyKey}:${i++}`,
        changeId,
      });
    }
    if (so) {
      if (input.deleted) {
        await reserveOrder(tx, so.id);
        await tx.update(t.salesOrders).set({ status: "pending" }).where(eq(t.salesOrders.id, so.id));
      } else {
        await tx.update(t.reservations).set({ releasedAt: new Date() }).where(and(eq(t.reservations.salesOrderId, so.id), isNull(t.reservations.releasedAt)));
        await tx.update(t.salesOrders).set({ status: "delivered" }).where(eq(t.salesOrders.id, so.id));
      }
    }
    await tx
      .update(t.outflows)
      .set(input.deleted ? { deletedAt: new Date(), deletedReason: reason } : { deletedAt: null, deletedReason: null })
      .where(eq(t.outflows.id, o.id));
    return { alreadyRecorded: false };
  });
}

/** Correct the details of an outflow (date, who it went to, reference, note). To change jars, delete it and record it again. */
export async function updateOutflow(
  db: DB,
  input: { outflowId: string; reason: string; occurredOn: string; customerId?: string | null; destination?: string | null; reference?: string | null; note?: string | null },
) {
  const why = needReason(input.reason, "Say why this is corrected");
  if (!isDate(input.occurredOn)) throw new OperationError("Enter the date.");
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(t.outflows).where(eq(t.outflows.id, input.outflowId));
    if (!o) throw new OperationError("Not found.");
    if (o.deletedAt) throw new OperationError("This was deleted. Restore it first.");
    if (o.type === "waste" && !input.note?.trim()) throw new OperationError("Say why the jars are written off.");
    const upd = {
      occurredOn: input.occurredOn,
      customerId: input.customerId === undefined ? o.customerId : input.customerId || null,
      destination: input.destination === undefined ? o.destination : input.destination?.trim() || null,
      reference: input.reference === undefined ? o.reference : input.reference?.trim() || null,
      note: input.note === undefined ? o.note : input.note?.trim() || null,
    };
    const changes = diff([
      ["Date", o.occurredOn, upd.occurredOn],
      ["Customer", o.customerId ? await customerName(tx, o) : null, upd.customerId ? await customerName(tx, upd) : null],
      ["Destination", o.destination, upd.destination],
      ["Reference", o.reference, upd.reference],
      ["Note", o.note, upd.note],
    ]);
    if (!changes.length) return;
    await tx.update(t.outflows).set(upd).where(eq(t.outflows.id, o.id));
    const { refs } = await outflowRefs(tx, o);
    await logChange(tx, { action: "update", area: "sales", entity: { type: "outflow", id: o.id, code: o.code }, summary: `${o.code} corrected`, changes, reason: why, links: refs });
  });
}
