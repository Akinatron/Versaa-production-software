import { inArray, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { BOUGHT_KINDS } from "@/domain/item-kinds";
import { withDependencies, type WipeCounts, type WipePart } from "./wipe-info";

export { WIPE_INFO, WIPE_PARTS, withDependencies, type WipeCounts, type WipePart } from "./wipe-info";

/*
 * "Delete database" (developer mode). The person ticks what to delete; what
 * the ticked parts depend on is deleted with them, so nothing is left
 * pointing at a deleted row. Team logins are never deleted.
 *
 * Whole tables are emptied with one TRUNCATE, which also works on the
 * append-only tables (their triggers stop single-row deletes, not that).
 * Items are split: "Items" is what you buy, "Sauces, sizes & products"
 * owns the finished-jar and bulk-sauce items.
 */

const TABLES: Record<WipePart, string[]> = {
  activity: [
    "change_log_links",
    "change_log",
    "documents",
    "outflow_lines",
    "outflows",
    "sales_order_lines",
    "sales_orders",
    "customers",
    "stock_adjustments",
    "incidents",
    "packaging_session_lines",
    "packaging_sessions",
    "batch_consumption",
    "production_batches",
    "reservations",
    "forecast_snapshots",
    "run_targets",
    "production_runs",
    "receipt_lines",
    "receipts",
    "purchase_order_lines",
    "purchase_orders",
    "movements",
    "lots",
  ],
  suppliers: ["supplier_item_prices", "supplier_items", "suppliers"],
  recipes: ["recipe_lines", "recipe_versions", "packaging_lines", "packaging_versions"],
  items: [],
  catalog: ["reject_figures", "yield_figures", "products", "formats", "sauces"],
};

/** How much there is of each thing, to say what a delete would remove. */
export async function wipeCounts(db: DB): Promise<WipeCounts> {
  const [r] = await db.execute<Record<string, number>>(sql`select
    (select count(*)::int from production_runs) as runs,
    (select count(*)::int from production_batches) as batches,
    (select count(*)::int from purchase_orders) as orders,
    (select count(*)::int from receipts) as deliveries,
    (select count(*)::int from lots) as lots,
    (select count(*)::int from sales_orders) as sales_orders,
    (select count(*)::int from change_log) as history,
    (select count(*)::int from documents) as documents,
    (select count(*)::int from suppliers) as suppliers,
    (select count(*)::int from recipe_versions) as recipes,
    (select count(*)::int from packaging_versions) as packaging_lists,
    (select count(*)::int from items where kind in ('ingredient', 'packaging', 'other')) as items,
    (select count(*)::int from sauces) as sauces,
    (select count(*)::int from products) as products`);
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    runs: n("runs"),
    batches: n("batches"),
    orders: n("orders"),
    deliveries: n("deliveries"),
    lots: n("lots"),
    salesOrders: n("sales_orders"),
    history: n("history"),
    documents: n("documents"),
    suppliers: n("suppliers"),
    recipes: n("recipes"),
    packagingLists: n("packaging_lists"),
    items: n("items"),
    sauces: n("sauces"),
    products: n("products"),
  };
}

/** Delete the chosen parts (and what they depend on) in one transaction. Returns the parts deleted. */
export async function wipeDatabase(db: DB, chosen: Iterable<string>): Promise<Set<WipePart>> {
  const parts = withDependencies(chosen);
  if (parts.size === 0) return parts;
  // Both item parts chosen: the whole items table goes in the TRUNCATE.
  const allItems = parts.has("items") && parts.has("catalog");
  const tables = [...parts].flatMap((p) => TABLES[p]).concat(allItems ? ["items"] : []);
  await db.transaction(async (tx) => {
    if (tables.length) await tx.execute(sql.raw(`truncate table ${tables.map((x) => `"${x}"`).join(", ")}`));
    if (!allItems && parts.has("items")) await tx.delete(t.items).where(inArray(t.items.kind, [...BOUGHT_KINDS]));
    if (!allItems && parts.has("catalog")) await tx.delete(t.items).where(inArray(t.items.kind, ["finished", "bulk"]));
  });
  return parts;
}
