import { BOUGHT_KINDS, type BoughtKind } from "@/domain/item-kinds";
import { sqlList, today } from "./base";
import { PO_ON_THE_WAY } from "@/domain/status";
import Decimal from "decimal.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import type { PlanInput, PlanItem, PlanProduct, PlanSauce, StockPosition } from "@/domain/planner";
import type { UnitCode } from "@/domain/quantity";
import { observedRejects, observedYields } from "./history";

export interface PlanCatalog {
  items: PlanItem[];
  sauces: PlanSauce[];
  products: (PlanProduct & { formatName: string; sauceName: string })[];
}

/** The active catalog as the planner needs it. */
const toPlanItem = (i: typeof t.items.$inferSelect): PlanItem => ({ id: i.id, name: i.name, kind: i.kind as BoughtKind, stockUnit: i.stockUnit as UnitCode });

/** Just the items that are bought (ingredients, packaging, other), for a pick list. One query. */
export async function boughtItems(db: DB): Promise<PlanItem[]> {
  return (await db.select().from(t.items).where(inArray(t.items.kind, [...BOUGHT_KINDS]))).map(toPlanItem);
}

export async function loadPlanCatalog(db: DB): Promise<PlanCatalog> {
  const [itemRows, sauceRows, recipeRows, lineRows, productRows, pkgRows, yieldRows, rejectRows, seenYields, seenRejects] = await Promise.all([
    db.select().from(t.items).where(inArray(t.items.kind, [...BOUGHT_KINDS])),
    db.select().from(t.sauces).where(eq(t.sauces.active, true)),
    db.select().from(t.recipeVersions).where(eq(t.recipeVersions.status, "active")),
    db.select().from(t.recipeLines),
    db
      .select({ product: t.products, format: t.formats, sauce: t.sauces })
      .from(t.products)
      .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
      .innerJoin(t.sauces, eq(t.products.sauceId, t.sauces.id))
      .where(and(eq(t.products.active, true), eq(t.formats.active, true), eq(t.sauces.active, true))),
    db
      .select({ productId: t.packagingVersions.productId, itemId: t.packagingLines.itemId, perJar: t.packagingLines.perJar })
      .from(t.packagingLines)
      .innerJoin(t.packagingVersions, eq(t.packagingLines.packagingVersionId, t.packagingVersions.id))
      .where(eq(t.packagingVersions.status, "active")),
    db.execute<{ sauce_id: string; litres_per_batch: string; source: "estimate" | "observed"; note: string | null }>(
      sql`select distinct on (sauce_id) sauce_id, litres_per_batch, source, note from yield_figures order by sauce_id, created_at desc`,
    ),
    db.execute<{ product_id: string; rate: string; source: "estimate" | "observed" }>(
      sql`select distinct on (product_id) product_id, rate, source from reject_figures order by product_id, created_at desc`,
    ),
    observedYields(db),
    observedRejects(db),
  ]);

  const yields = new Map([...yieldRows].map((y) => [y.sauce_id, y]));
  const rejects = new Map([...rejectRows].map((r) => [r.product_id, r]));

  const sauces: PlanSauce[] = sauceRows.map((s) => {
    const v = recipeRows.find((r) => r.sauceId === s.id);
    const y = yields.get(s.id);
    const seen = seenYields.get(s.id);
    return {
      id: s.id,
      name: s.name,
      recipe: v
        ? {
            versionId: v.id,
            versionNo: v.versionNo,
            batchReferenceKg: new Decimal(v.batchReferenceKg),
            lines: lineRows
              .filter((l) => l.recipeVersionId === v.id)
              .sort((a, b) => a.position - b.position)
              .map((l) => ({ itemId: l.itemId, quantity: new Decimal(l.quantity), unit: l.unit as UnitCode })),
          }
        : null,
      // Recorded batches beat any estimate.
      yield: seen
        ? {
            litresPerBatch: seen.avgFilledLitres,
            source: "observed" as const,
            note: `average of ${seen.batches} closed batch${seen.batches === 1 ? "" : "es"} (${seen.minFilledLitres}–${seen.maxFilledLitres} L filled)`,
          }
        : y
        ? { litresPerBatch: new Decimal(y.litres_per_batch), source: y.source, note: y.note ?? undefined }
        : { litresPerBatch: null, source: "missing" },
    };
  });

  const products = productRows
    .sort((a, b) => a.sauce.name.localeCompare(b.sauce.name) || b.format.capacityMl - a.format.capacityMl)
    .map(({ product, format, sauce }) => {
      const r = rejects.get(product.id);
      const seen = seenRejects.get(product.id);
      return {
        id: product.id,
        sauceId: sauce.id,
        sauceName: sauce.name,
        formatName: format.name,
        name: product.name,
        fillMl: format.fillMl,
        packaging: pkgRows.filter((p) => p.productId === product.id).map((p) => ({ itemId: p.itemId, perJar: p.perJar })),
        // Older estimates were saved with float noise (1.1% as 0.011000000000000001).
        reject: seen
          ? { rate: seen.rate, source: "observed" as const }
          : r
            ? { rate: new Decimal(r.rate).toDecimalPlaces(6), source: r.source }
            : { rate: null, source: "missing" as const },
      };
    });

  return {
    items: itemRows.map(toPlanItem),
    sauces,
    products,
  };
}

/**
 * Stock position per item, from the ledger. An item with no movements at all
 * has never been counted, so its stock is unknown (null), not zero.
 *
 * With `arrivingBy` (a run's date), only orders expected by that day, or with
 * no expected date, count as on order; later ones are given as lateOnOrder.
 *
 * With `usableOn`, lots whose best-before is before that day can't be used, so
 * they are left out of onHand and given as `expired`. The stock pages leave it
 * out: they show what is physically there.
 */
export async function loadStockPositions(db: DB, opts: { arrivingBy?: string; usableOn?: string } = {}): Promise<Record<string, StockPosition>> {
  const by = opts.arrivingBy ?? null;
  const usableOn = opts.usableOn ?? null;
  const [onHand, reserved, onOrder, expired] = await Promise.all([
    db.select({ itemId: t.movements.itemId, qty: sql<string>`sum(${t.movements.quantity})` }).from(t.movements).groupBy(t.movements.itemId),
    db
      .select({ itemId: t.reservations.itemId, qty: sql<string>`sum(${t.reservations.quantity})` })
      .from(t.reservations)
      .where(isNull(t.reservations.releasedAt))
      .groupBy(t.reservations.itemId),
    db.execute<{ item_id: string; qty: string; late: string }>(sql`
      select l.item_id,
        sum(case when ${by}::date is null or o.expected_on is null or o.expected_on <= ${by}::date then greatest(l.quantity - coalesce(r.received, 0), 0) else 0 end) as qty,
        sum(case when ${by}::date is not null and o.expected_on > ${by}::date then greatest(l.quantity - coalesce(r.received, 0), 0) else 0 end) as late
      from purchase_order_lines l
      join purchase_orders o on o.id = l.purchase_order_id and o.status::text in (${sqlList(PO_ON_THE_WAY)})
      left join (select r.purchase_order_line_id, sum(r.quantity) as received from receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is null group by 1) r
        on r.purchase_order_line_id = l.id
      group by l.item_id`),
    usableOn
      ? db.execute<{ item_id: string; qty: string }>(sql`
          select item_id, sum(balance) as qty from (
            select l.item_id, sum(m.quantity) as balance from lots l join movements m on m.lot_id = l.id
            where l.best_before < ${usableOn}::date group by l.id, l.item_id) x
          where balance > 0 group by item_id`)
      : Promise.resolve([] as { item_id: string; qty: string }[]),
  ]);

  const out: Record<string, StockPosition> = {};
  const get = (id: string) => (out[id] ??= { onHand: null, reservedEarlier: new Decimal(0), onOrder: new Decimal(0) });
  for (const r of onHand) get(r.itemId).onHand = new Decimal(r.qty);
  for (const r of reserved) get(r.itemId).reservedEarlier = new Decimal(r.qty);
  for (const r of onOrder) {
    get(r.item_id).onOrder = new Decimal(r.qty);
    if (new Decimal(r.late).gt(0)) get(r.item_id).lateOnOrder = new Decimal(r.late);
  }
  for (const r of expired) {
    const pos = get(r.item_id);
    const q = new Decimal(r.qty);
    if (pos.onHand === null || !q.gt(0)) continue;
    pos.onHand = Decimal.max(0, pos.onHand.minus(q));
    pos.expired = q;
  }
  return out;
}

export async function loadPlanInput(db: DB, targets: Record<string, number>): Promise<PlanInput & { catalog: PlanCatalog }> {
  const [catalog, stock] = await Promise.all([loadPlanCatalog(db), loadStockPositions(db, { usableOn: today() })]);
  return { ...catalog, catalog, stock, targets };
}
