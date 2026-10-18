import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { netLines } from "./production";

/*
 * Traceability queries. Movements link lots to the documents that used or
 * made them, so both directions are joins:
 *   forward:  lot → batches that used it → finished lots → where jars went
 *   backward: jars / outflow → finished lot → batch → ingredients and
 *             packaging lots used, with their suppliers.
 */

export interface LotSummary {
  id: string;
  code: string;
  itemId: string;
  itemName: string;
  itemKind: string;
  unit: string;
  supplierName: string | null;
  deliveryRef: string | null;
  supplierBatch: string | null;
  receivedOn: string | null;
  bestBefore: string | null;
  batchId: string | null;
  balance: Decimal;
}

export async function lotsByIds(db: DB, ids: string[]): Promise<LotSummary[]> {
  if (!ids.length) return [];
  const rows = await db.execute<{
    id: string; code: string; item_id: string; item_name: string; kind: string; unit: string; supplier: string | null;
    delivery_ref: string | null; supplier_batch: string | null; received_on: string | null; best_before: string | null; batch_id: string | null; balance: string;
  }>(sql`
    select l.id, l.code, l.item_id, i.name as item_name, i.kind, i.stock_unit as unit, s.name as supplier,
      l.delivery_ref, l.supplier_batch, l.received_on::text, l.best_before::text, l.batch_id,
      coalesce((select sum(m.quantity) from movements m where m.lot_id = l.id), 0) as balance
    from lots l join items i on i.id = l.item_id left join suppliers s on s.id = l.supplier_id
    where l.id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  return [...rows].map((r) => ({
    id: r.id, code: r.code, itemId: r.item_id, itemName: r.item_name, itemKind: r.kind, unit: r.unit, supplierName: r.supplier,
    deliveryRef: r.delivery_ref, supplierBatch: r.supplier_batch, receivedOn: r.received_on, bestBefore: r.best_before, batchId: r.batch_id,
    balance: new Decimal(r.balance),
  }));
}

/** Find a lot, batch or outflow by its code (what's printed on paperwork). */
export async function findByCode(db: DB, code: string) {
  const c = code.trim();
  if (!c) return null;
  const [lot] = await db.select({ id: t.lots.id }).from(t.lots).where(sql`upper(${t.lots.code}) = upper(${c})`);
  if (lot) return { kind: "lot" as const, id: lot.id };
  const [batch] = await db.select({ id: t.productionBatches.id }).from(t.productionBatches).where(sql`upper(${t.productionBatches.code}) = upper(${c})`);
  if (batch) return { kind: "batch" as const, id: batch.id };
  const [out] = await db.select({ id: t.outflows.id }).from(t.outflows).where(sql`upper(${t.outflows.code}) = upper(${c})`);
  if (out) return { kind: "outflow" as const, id: out.id };
  return null;
}

/** Search lots by code, supplier batch or delivery note (partial match). */
export async function searchLots(db: DB, q: string) {
  const like = `%${q.trim()}%`;
  const rows = await db.execute<{ id: string }>(sql`
    select l.id from lots l join items i on i.id = l.item_id
    where l.code ilike ${like} or l.supplier_batch ilike ${like} or l.delivery_ref ilike ${like} or i.name ilike ${like}
    order by l.created_at desc limit 50`);
  return lotsByIds(db, [...rows].map((r) => r.id));
}

export interface Destination {
  outflowId: string;
  code: string;
  type: string;
  occurredOn: string;
  customer: string | null;
  destination: string | null;
  reference: string | null;
  lotId: string;
  lotCode: string;
  productName: string;
  jars: number;
}

async function destinationsOfLots(db: DB, lotIds: string[]): Promise<Destination[]> {
  if (!lotIds.length) return [];
  const rows = await db
    .select({ line: t.outflowLines, out: t.outflows, customer: t.customers.name, lotCode: t.lots.code, productName: t.products.name })
    .from(t.outflowLines)
    .innerJoin(t.outflows, eq(t.outflowLines.outflowId, t.outflows.id))
    .innerJoin(t.lots, eq(t.outflowLines.lotId, t.lots.id))
    .innerJoin(t.products, eq(t.outflowLines.productId, t.products.id))
    .leftJoin(t.customers, eq(t.outflows.customerId, t.customers.id))
    .where(and(inArray(t.outflowLines.lotId, lotIds), isNull(t.outflows.deletedAt)));
  return rows.map((r) => ({
    outflowId: r.out.id,
    code: r.out.code,
    type: r.out.type,
    occurredOn: r.out.occurredOn,
    customer: r.customer,
    destination: r.out.destination,
    reference: r.out.reference,
    lotId: r.line.lotId,
    lotCode: r.lotCode,
    productName: r.productName,
    jars: r.line.jars,
  }));
}

/** Batches that used a lot (as ingredient, packaging or bulk), and how much. */
async function batchesUsingLot(db: DB, lotId: string) {
  const rows = await db.execute<{ batch_id: string; code: string; qty: string }>(sql`
    select b.id as batch_id, b.code, -sum(m.quantity) as qty
    from movements m
    left join batch_consumption c on m.doc_type = 'batch_consumption' and c.id = m.doc_id
    left join packaging_sessions s on m.doc_type = 'packaging_session' and s.id = m.doc_id
    join production_batches b on b.id = coalesce(c.batch_id, s.batch_id)
    where m.lot_id = ${lotId} and m.doc_type in ('batch_consumption', 'packaging_session') and m.type in ('consumption', 'reversal')
    group by b.id, b.code
    having sum(m.quantity) <> 0
    order by b.code`);
  return [...rows].map((r) => ({ batchId: r.batch_id, code: r.code, quantity: new Decimal(r.qty) }));
}

async function finishedLotsOfBatches(db: DB, batchIds: string[]) {
  if (!batchIds.length) return [];
  const rows = await db
    .select({ id: t.lots.id })
    .from(t.lots)
    .innerJoin(t.items, eq(t.lots.itemId, t.items.id))
    .where(and(inArray(t.lots.batchId, batchIds), eq(t.items.kind, "finished")));
  return lotsByIds(db, rows.map((r) => r.id));
}

/**
 * Forward trace (recall): where did this lot go? For an ingredient or
 * packaging lot: the batches that used it, the jar lots they made, what's
 * still in stock and every recorded destination.
 */
export async function traceForward(db: DB, lotId: string) {
  const [lot] = await lotsByIds(db, [lotId]);
  if (!lot) return null;
  let batches: { batchId: string; code: string; quantity: Decimal }[] = [];
  let jarLots: LotSummary[];
  if (lot.itemKind === "finished") {
    jarLots = [lot];
  } else if (lot.itemKind === "bulk" && lot.batchId) {
    const [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.id, lot.batchId));
    batches = b ? [{ batchId: b.id, code: b.code, quantity: new Decimal(0) }] : [];
    jarLots = await finishedLotsOfBatches(db, batches.map((b) => b.batchId));
  } else {
    batches = await batchesUsingLot(db, lotId);
    jarLots = await finishedLotsOfBatches(db, batches.map((b) => b.batchId));
  }
  const destinations = await destinationsOfLots(db, jarLots.map((l) => l.id));
  const jarsInStock = jarLots.reduce((s, l) => s.plus(l.balance), new Decimal(0));
  const jarsOut = destinations.reduce((s, d) => s + d.jars, 0);
  return { lot, batches, jarLots, destinations, jarsInStock, jarsOut };
}

/** Everything about one batch: recipe, ingredients and their origin, packaging, jars, incidents, where jars went. */
export async function traceBatch(db: DB, batchId: string) {
  const [row] = await db
    .select({ batch: t.productionBatches, run: t.productionRuns, sauce: t.sauces, recipe: t.recipeVersions })
    .from(t.productionBatches)
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.recipeVersions, eq(t.productionBatches.recipeVersionId, t.recipeVersions.id))
    .where(eq(t.productionBatches.id, batchId));
  if (!row) return null;

  const consumption = await db
    .select({ line: t.batchConsumption, item: t.items })
    .from(t.batchConsumption)
    .innerJoin(t.items, eq(t.batchConsumption.itemId, t.items.id))
    .where(eq(t.batchConsumption.batchId, batchId));
  // Deleted sessions stay in the database for traceability but are left out here; their stock effect is already reversed.
  const sessions = await db
    .select()
    .from(t.packagingSessions)
    .where(and(eq(t.packagingSessions.batchId, batchId), isNull(t.packagingSessions.deletedAt)))
    .orderBy(t.packagingSessions.packedOn, t.packagingSessions.createdAt);
  const sessionLines = sessions.length
    ? await db
        .select({ line: t.packagingSessionLines, product: t.products })
        .from(t.packagingSessionLines)
        .innerJoin(t.products, eq(t.packagingSessionLines.productId, t.products.id))
        .where(inArray(t.packagingSessionLines.sessionId, sessions.map((s) => s.id)))
    : [];

  // Lot-level use: ingredients (per consumption line) and packaging materials (per session).
  const docIds = [...consumption.map((c) => c.line.id), ...sessions.map((s) => s.id)];
  const moves = docIds.length
    ? await db
        .select()
        .from(t.movements)
        .where(and(inArray(t.movements.docId, docIds), inArray(t.movements.docType, ["batch_consumption", "packaging_session"])))
    : [];
  const lotIds = [...new Set(moves.map((m) => m.lotId))];
  const lots = new Map((await lotsByIds(db, lotIds)).map((l) => [l.id, l]));

  const ingredientUse = consumption
    .map((c) => {
      const ms = moves.filter((m) => m.docId === c.line.id);
      const byLot = new Map<string, Decimal>();
      for (const m of ms) byLot.set(m.lotId, (byLot.get(m.lotId) ?? new Decimal(0)).minus(m.quantity));
      const sources = [...byLot.entries()].filter(([, q]) => !q.isZero()).map(([id, q]) => ({ lot: lots.get(id)!, quantity: q }));
      const actual = c.line.confirmedAt ? sources.reduce((s, x) => s.plus(x.quantity), new Decimal(0)) : null;
      return {
        itemId: c.item.id,
        name: c.item.name,
        unit: c.item.stockUnit,
        standard: new Decimal(c.line.standardQty),
        planned: new Decimal(c.line.plannedQty),
        actual,
        extra: c.line.extra,
        sources,
      };
    })
    .sort((a, b) => Number(a.extra) - Number(b.extra) || a.name.localeCompare(b.name));

  const sessionIds = new Set(sessions.map((s) => s.id));
  const materialsByLot = new Map<string, Decimal>();
  for (const m of moves.filter((m) => sessionIds.has(m.docId ?? "") && m.type === "consumption")) {
    materialsByLot.set(m.lotId, (materialsByLot.get(m.lotId) ?? new Decimal(0)).minus(m.quantity));
  }
  const materials = [...materialsByLot.entries()].map(([id, q]) => ({ lot: lots.get(id)!, quantity: q })).filter((m) => m.lot.itemKind !== "bulk").sort((a, b) => a.lot.itemName.localeCompare(b.lot.itemName));

  const jarLots = await finishedLotsOfBatches(db, [batchId]);
  const bulk = row.batch.bulkLotId ? (await lotsByIds(db, [row.batch.bulkLotId]))[0] ?? null : null;
  const destinations = await destinationsOfLots(db, jarLots.map((l) => l.id));
  const incidents = await db
    .select()
    .from(t.incidents)
    .where(and(eq(t.incidents.batchId, batchId), isNull(t.incidents.deletedAt)))
    .orderBy(t.incidents.occurredOn);

  const bySize = new Map<string, { productId: string; itemId: string; name: string; filled: number; rejected: number; accepted: number }>();
  for (const { line, product } of sessionLines) {
    const cur = bySize.get(product.id) ?? { productId: product.id, itemId: product.itemId, name: product.name, filled: 0, rejected: 0, accepted: 0 };
    cur.filled += line.filled;
    cur.rejected += line.rejected;
    cur.accepted += line.accepted;
    bySize.set(product.id, cur);
  }
  const filledLitres = sessionLines.reduce((s, x) => s.plus(new Decimal(x.line.filled).mul(x.line.fillMl).div(1000)), new Decimal(0));
  const sellableLitres = sessionLines.reduce((s, x) => s.plus(new Decimal(x.line.accepted).mul(x.line.fillMl).div(1000)), new Decimal(0));

  return {
    ...row,
    ingredientUse,
    // Per session, one line per size: the original plus any corrections from edits.
    sessions: sessions.map((s) => {
      const mine = sessionLines.filter((l) => l.line.sessionId === s.id);
      return { ...s, lines: netLines(mine.map((l) => l.line)).map((line) => ({ line, product: mine.find((m) => m.product.id === line.productId)!.product })) };
    }),
    jarsBySize: [...bySize.values()],
    filledLitres,
    sellableLitres,
    materials,
    bulk,
    jarLots,
    destinations,
    incidents,
  };
}

/** Backward trace from an outflow: which batches the jars came from. */
export async function traceOutflow(db: DB, outflowId: string) {
  const [out] = await db
    .select({ out: t.outflows, customer: t.customers.name })
    .from(t.outflows)
    .leftJoin(t.customers, eq(t.outflows.customerId, t.customers.id))
    .where(eq(t.outflows.id, outflowId));
  if (!out) return null;
  const lines = await db
    .select({ line: t.outflowLines, product: t.products.name, lot: t.lots, batchCode: t.productionBatches.code })
    .from(t.outflowLines)
    .innerJoin(t.products, eq(t.outflowLines.productId, t.products.id))
    .innerJoin(t.lots, eq(t.outflowLines.lotId, t.lots.id))
    .leftJoin(t.productionBatches, eq(t.lots.batchId, t.productionBatches.id))
    .where(eq(t.outflowLines.outflowId, outflowId));
  return { ...out, lines };
}
