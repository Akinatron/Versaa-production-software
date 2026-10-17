import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { DB } from "./client";

/*
 * What recorded batches tell us, for the planner and for reports.
 *
 * - Filled litres per batch: jars filled × fill per jar, over closed batches.
 *   This is what the planner uses as "litres per batch" once history exists.
 *   Rejected jars count here (they were filled); rejects are planned
 *   separately with the reject rate, so they are never counted twice.
 * - Sellable litres per batch: accepted jars only.
 * - Measured litres: what was measured right after cooking, when recorded.
 * - Reject rate per product: rejected ÷ filled over all packaging recorded.
 */

export interface YieldStats {
  sauceId: string;
  batches: number;
  avgFilledLitres: Decimal;
  minFilledLitres: Decimal;
  maxFilledLitres: Decimal;
  avgSellableLitres: Decimal;
  avgMeasuredLitres: Decimal | null;
  avgMeasuredKg: Decimal | null;
}

export async function observedYields(db: DB): Promise<Map<string, YieldStats>> {
  const rows = await db.execute<{
    sauce_id: string;
    n: number;
    avg_filled: string;
    min_filled: string;
    max_filled: string;
    avg_sellable: string;
    avg_measured: string | null;
    avg_kg: string | null;
  }>(sql`
    with per_batch as (
      select b.id, b.sauce_id, b.output_litres, b.output_kg,
        sum(l.filled * l.fill_ml) / 1000.0 as filled_l,
        sum(l.accepted * l.fill_ml) / 1000.0 as sellable_l
      from production_batches b
      join packaging_sessions s on s.batch_id = b.id
      join packaging_session_lines l on l.session_id = s.id
      where b.status = 'closed'
      group by b.id
    )
    select sauce_id, count(*)::int as n,
      avg(filled_l) as avg_filled, min(filled_l) as min_filled, max(filled_l) as max_filled,
      avg(sellable_l) as avg_sellable, avg(output_litres) as avg_measured, avg(output_kg) as avg_kg
    from per_batch group by sauce_id`);
  const d = (v: string | null) => (v === null ? null : new Decimal(v).toDecimalPlaces(3));
  return new Map(
    [...rows].map((r) => [
      r.sauce_id,
      {
        sauceId: r.sauce_id,
        batches: r.n,
        avgFilledLitres: d(r.avg_filled)!,
        minFilledLitres: d(r.min_filled)!,
        maxFilledLitres: d(r.max_filled)!,
        avgSellableLitres: d(r.avg_sellable)!,
        avgMeasuredLitres: d(r.avg_measured),
        avgMeasuredKg: d(r.avg_kg),
      },
    ]),
  );
}

export interface RejectStats {
  productId: string;
  filled: number;
  rejected: number;
  sessions: number;
  rate: Decimal;
}

export async function observedRejects(db: DB): Promise<Map<string, RejectStats>> {
  const rows = await db.execute<{ product_id: string; filled: number; rejected: number; sessions: number }>(sql`
    select product_id, sum(filled)::int as filled, sum(rejected)::int as rejected, count(*)::int as sessions
    from packaging_session_lines group by product_id having sum(filled) > 0`);
  return new Map(
    [...rows].map((r) => [
      r.product_id,
      { productId: r.product_id, filled: r.filled, rejected: r.rejected, sessions: r.sessions, rate: new Decimal(r.rejected).div(r.filled).toDecimalPlaces(4) },
    ]),
  );
}
