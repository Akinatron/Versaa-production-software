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
export async function loadPlanCatalog(db: DB): Promise<PlanCatalog> {
  const [itemRows, sauceRows, recipeRows, lineRows, productRows, pkgRows, yieldRows, rejectRows, seenYields, seenRejects] = await Promise.all([
    db.select().from(t.items).where(inArray(t.items.kind, ["ingredient", "packaging"])),
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
        reject: seen
          ? { rate: seen.rate, source: "observed" as const }
          : r
            ? { rate: new Decimal(r.rate), source: r.source }
            : { rate: null, source: "missing" as const },
      };
    });

  return {
    items: itemRows.map((i) => ({ id: i.id, name: i.name, kind: i.kind as "ingredient" | "packaging", stockUnit: i.stockUnit as UnitCode })),
    sauces,
    products,
  };
}

/**
 * Stock position per item, from the ledger. An item with no movements at all
 * has never been counted, so its stock is unknown (null), not zero.
 */
export async function loadStockPositions(db: DB): Promise<Record<string, StockPosition>> {
  const [onHand, reserved, onOrder] = await Promise.all([
    db.select({ itemId: t.movements.itemId, qty: sql<string>`sum(${t.movements.quantity})` }).from(t.movements).groupBy(t.movements.itemId),
    db
      .select({ itemId: t.reservations.itemId, qty: sql<string>`sum(${t.reservations.quantity})` })
      .from(t.reservations)
      .where(isNull(t.reservations.releasedAt))
      .groupBy(t.reservations.itemId),
    db.execute<{ item_id: string; qty: string }>(sql`
      select l.item_id, sum(greatest(l.quantity - coalesce(r.received, 0), 0)) as qty
      from purchase_order_lines l
      join purchase_orders o on o.id = l.purchase_order_id and o.status in ('sent', 'partly_received')
      left join (select r.purchase_order_line_id, sum(r.quantity) as received from receipt_lines r join receipts x on x.id = r.receipt_id and x.deleted_at is null group by 1) r
        on r.purchase_order_line_id = l.id
      group by l.item_id`),
  ]);

  const out: Record<string, StockPosition> = {};
  const get = (id: string) => (out[id] ??= { onHand: null, reservedEarlier: new Decimal(0), onOrder: new Decimal(0) });
  for (const r of onHand) get(r.itemId).onHand = new Decimal(r.qty);
  for (const r of reserved) get(r.itemId).reservedEarlier = new Decimal(r.qty);
  for (const r of onOrder) get(r.item_id).onOrder = new Decimal(r.qty);
  return out;
}

export async function loadPlanInput(db: DB, targets: Record<string, number>): Promise<PlanInput & { catalog: PlanCatalog }> {
  const [catalog, stock] = await Promise.all([loadPlanCatalog(db), loadStockPositions(db)]);
  return { ...catalog, catalog, stock, targets };
}
