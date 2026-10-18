import type { BatchBudget, BudgetGroup, BudgetLine } from "@/db/budget";
import { money } from "@/domain/pricing";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { BudgetTable, type BudgetTableData } from "./budget-table";

const cost = (known: BudgetLine["knownCost"], missing: number) => (missing === 0 ? money(known) : `${money(known)} + ${missing} without price`);

function price(l: BudgetLine) {
  if (l.unpricedQty.eq(l.quantity)) return { text: "no price" };
  const per = l.knownCost.div(l.quantity.minus(l.unpricedQty));
  const from = l.sources.has("lot") && l.sources.has("favourite") ? "lot price and favourite supplier" : l.sources.has("favourite") ? "favourite supplier" : "lot price";
  return { text: `${money(per)} / ${l.unit}${l.lots > 1 ? " (average)" : ""}`, source: from };
}

function group(kind: "ingredient" | "packaging", g: BudgetGroup): BudgetTableData["groups"][number] {
  const missing = g.lines.filter((l) => !l.unpricedQty.isZero()).length;
  return {
    kind,
    rows: g.lines.map((l) => {
      const p = price(l);
      return {
        itemId: l.itemId,
        name: l.name,
        priceText: p.text,
        priceSource: p.source,
        cells: {
          used: {
            qty: formatQty(l.quantity, l.unit as UnitCode),
            cost: l.unpricedQty.isZero() ? money(l.knownCost) : l.knownCost.isZero() ? "no price" : `${money(l.knownCost)} + no price`,
          },
        },
      };
    }),
    totals: { used: g.lines.length ? cost(g.knownCost, missing) : "—" },
  };
}

/** Real cost of a batch in the same expandable table as the run budget. */
export function BatchBudgetTable({ budget }: { budget: BatchBudget }) {
  const missing = [...budget.ingredients.lines, ...budget.packaging.lines].filter((l) => !l.unpricedQty.isZero()).length;
  return (
    <BudgetTable
      data={{
        columns: [{ key: "used", label: "Used" }],
        groups: [group("ingredient", budget.ingredients), group("packaging", budget.packaging)],
        total: { used: cost(budget.total.knownCost, missing) },
      }}
      note="What this batch really used, at the price paid for the lot it came from. A lot without a price, such as the opening count, uses the favourite supplier's current price. Items without any price are counted separately, never as 0."
    />
  );
}
