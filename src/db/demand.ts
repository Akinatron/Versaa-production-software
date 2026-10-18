import { sql } from "drizzle-orm";
import type { DB } from "./client";
import { demandFromOrders, type DemandOrderLine } from "@/domain/demand";

/**
 * What the pending sales orders still need made, per product.
 * Jars "in runs" are the targets of confirmed and in-progress runs minus the
 * accepted jars already packed for them (those are already in stock).
 */
export async function loadOrderDemand(db: DB, until: string | null) {
  const [lineRows, stockRows, runRows, draftRows] = await Promise.all([
    db.execute<{ order_id: string; product_id: string; jars: number; deliver_by: string | null }>(sql`
      select o.id as order_id, l.product_id, l.jars, o.deliver_by::text as deliver_by
      from sales_order_lines l
      join sales_orders o on o.id = l.sales_order_id and o.status = 'pending'`),
    db.execute<{ product_id: string; jars: string | null }>(sql`
      select p.id as product_id, (select sum(m.quantity) from movements m where m.item_id = p.item_id) as jars
      from products p`),
    db.execute<{ product_id: string; jars: string }>(sql`
      select t.product_id, sum(greatest(t.target_jars - coalesce(packed.jars, 0), 0)) as jars
      from run_targets t
      join production_runs r on r.id = t.run_id and r.status in ('confirmed', 'in_progress')
      left join (
        select b.run_id, l.product_id, sum(l.accepted) as jars
        from packaging_session_lines l
        join packaging_sessions s on s.id = l.session_id
        join production_batches b on b.id = s.batch_id
        group by 1, 2
      ) packed on packed.run_id = t.run_id and packed.product_id = t.product_id
      group by 1`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from production_runs where status = 'draft'`),
  ]);

  const lines: DemandOrderLine[] = [...lineRows].map((r) => ({ orderId: r.order_id, productId: r.product_id, jars: Number(r.jars), deliverBy: r.deliver_by }));
  const inStock: Record<string, number> = {};
  for (const r of stockRows) inStock[r.product_id] = Math.floor(Number(r.jars ?? 0));
  const inRuns: Record<string, number> = {};
  for (const r of runRows) inRuns[r.product_id] = Number(r.jars);

  const pendingOrders = new Set(lines.map((l) => l.orderId)).size;
  return { ...demandFromOrders({ lines, inStock, inRuns, until }), pendingOrders, draftRuns: draftRows[0]?.n ?? 0 };
}
