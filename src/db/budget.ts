import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { DB } from "./client";
import { lotUnitCosts } from "./suppliers";

/*
 * What a batch really cost: every ingredient and packaging material it used,
 * at the price of the lot it came from.
 *
 * - Lot price: the price paid on the order the lot arrived with.
 * - A lot without a price (opening count, delivery without an order or
 *   without a price) uses the favourite supplier's current price.
 * - No price at all: the cost is unknown, never 0.
 * Prices come from lotUnitCosts (suppliers.ts), shared with the run budget.
 */

export type PriceSource = "lot" | "favourite" | "unknown";

export interface BudgetLine {
  itemId: string;
  name: string;
  unit: string;
  quantity: Decimal;
  /** Cost of the part with a known price. */
  knownCost: Decimal;
  /** Quantity with no price at all. */
  unpricedQty: Decimal;
  sources: Set<PriceSource>;
  /** How many lots it came from. */
  lots: number;
}

export interface BudgetGroup {
  lines: BudgetLine[];
  knownCost: Decimal;
  complete: boolean;
}

export interface BatchBudget {
  ingredients: BudgetGroup;
  packaging: BudgetGroup;
  total: { knownCost: Decimal; complete: boolean };
}

export async function batchBudget(db: DB, batchId: string): Promise<BatchBudget> {
  // Net use per lot by this batch's ingredient lines and packaging sessions.
  const rows = await db.execute<{ item_id: string; name: string; unit: string; kind: string; lot_id: string; used: string }>(sql`
    with docs as (
      select c.id, 'batch_consumption' as doc_type from batch_consumption c where c.batch_id = ${batchId}
      union all
      select s.id, 'packaging_session' from packaging_sessions s where s.batch_id = ${batchId}
    ),
    used as (
      select m.item_id, m.lot_id, -sum(m.quantity) as used
      from movements m join docs d on d.id = m.doc_id and d.doc_type = m.doc_type
      group by m.item_id, m.lot_id
      having sum(m.quantity) < 0
    )
    select u.item_id, i.name, i.stock_unit::text as unit, i.kind::text as kind, u.lot_id, u.used::text as used
    from used u join items i on i.id = u.item_id
    where i.kind in ('ingredient', 'packaging')
    order by i.name`);
  const list = [...rows];
  const costs = await lotUnitCosts(db, list.map((r) => ({ lotId: r.lot_id, itemId: r.item_id })));

  const byItem = new Map<string, BudgetLine & { kind: string }>();
  for (const r of list) {
    const line = byItem.get(r.item_id) ?? {
      itemId: r.item_id,
      name: r.name,
      unit: r.unit,
      kind: r.kind,
      quantity: new Decimal(0),
      knownCost: new Decimal(0),
      unpricedQty: new Decimal(0),
      sources: new Set<PriceSource>(),
      lots: 0,
    };
    line.lots++;
    const qty = new Decimal(r.used);
    const cost = costs.get(r.lot_id);
    const price = cost?.unitPrice ?? null;
    line.quantity = line.quantity.plus(qty);
    if (price) line.knownCost = line.knownCost.plus(qty.mul(price));
    else line.unpricedQty = line.unpricedQty.plus(qty);
    line.sources.add(cost?.source === "lot" ? "lot" : cost?.source === "favourite" ? "favourite" : "unknown");
    byItem.set(r.item_id, line);
  }
  const group = (kind: string): BudgetGroup => {
    const lines = [...byItem.values()].filter((l) => l.kind === kind);
    return {
      lines,
      knownCost: lines.reduce((s, l) => s.plus(l.knownCost), new Decimal(0)),
      complete: lines.every((l) => l.unpricedQty.isZero()),
    };
  };
  const ingredients = group("ingredient");
  const packaging = group("packaging");
  return {
    ingredients,
    packaging,
    total: { knownCost: ingredients.knownCost.plus(packaging.knownCost), complete: ingredients.complete && packaging.complete },
  };
}
