import type { Budget } from "@/domain/pricing";
import { money } from "@/domain/pricing";
import { formatQty } from "@/domain/quantity";
import type { BudgetColumn, BudgetTableData } from "./budget-table";

const totalText = (t: { cost: import("decimal.js").default; missing: number }) =>
  t.missing === 0 ? money(t.cost) : `${money(t.cost)} + ${t.missing} without price`;

/** Turn a Budget (from buildBudget) into the plain strings BudgetTable shows. */
export function budgetForTable(budget: Budget, columns: BudgetColumn[]): BudgetTableData {
  return {
    columns,
    groups: budget.groups.map((g) => ({
      kind: g.kind,
      rows: g.lines
        .filter((l) => columns.some((c) => l.columns[c.key]?.quantity && !l.columns[c.key]!.quantity!.isZero()))
        .map((l) => ({
          itemId: l.itemId,
          name: l.name,
          priceText: l.priceText,
          priceSource: l.priceSource,
          cells: Object.fromEntries(
            columns.map((c) => {
              const cell = l.columns[c.key];
              if (!cell || cell.quantity === null) return [c.key, { qty: "unknown", cost: "unknown" }];
              if (cell.quantity.isZero()) return [c.key, { qty: "—", cost: "—" }];
              return [c.key, { qty: formatQty(cell.quantity, l.unit), cost: cell.cost === null ? "no price" : money(cell.cost) }];
            }),
          ),
        })),
      totals: Object.fromEntries(columns.map((c) => [c.key, totalText(g.totals[c.key]!)])),
    })),
    total: Object.fromEntries(columns.map((c) => [c.key, totalText(budget.total[c.key]!)])),
  };
}
