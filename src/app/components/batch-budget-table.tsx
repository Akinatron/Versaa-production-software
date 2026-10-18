import Decimal from "decimal.js";
import type { BatchBudget, BudgetLine } from "@/db/budget";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { ExpandGroup, expandCss } from "./expand-group";

const eur = (d: Decimal) => `€${d.toDecimalPlaces(2).toFixed(2)}`;

function cost(known: Decimal, complete: boolean) {
  if (complete) return eur(known);
  return known.isZero() ? "unknown" : `${eur(known)} + unknown`;
}

function price(l: BudgetLine) {
  if (!l.unpricedQty.isZero() && l.unpricedQty.eq(l.quantity)) return "no price";
  const priced = l.quantity.minus(l.unpricedQty);
  const per = l.knownCost.div(priced);
  const note = l.sources.has("fallback") ? " (latest order price)" : "";
  return `${eur(per)} / ${l.unit}${l.lots > 1 ? " (average)" : ""}${note}`;
}

/** Real cost of a batch: Ingredients, Packaging and Total, each opening to its items. */
export function BatchBudgetTable({ budget }: { budget: BatchBudget }) {
  const groups: [string, BatchBudget["ingredients"]][] = [
    ["Ingredients", budget.ingredients],
    ["Packaging (jars, lids, labels)", budget.packaging],
  ];
  return (
    <>
      <style>{expandCss}</style>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Quantity used</th>
            <th className="num">Price</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        {groups.map(([label, g]) => (
          <ExpandGroup
            key={label}
            hasChildren={g.lines.length > 0}
            cells={[{ content: label }, { content: "" }, { content: "" }, { content: g.lines.length ? cost(g.knownCost, g.complete) : "nothing used yet", num: true }]}
          >
            {g.lines.map((l) => (
              <tr key={l.itemId} className="exp-child">
                <td>{l.name}</td>
                <td className="num">{formatQty(l.quantity, l.unit as UnitCode)}</td>
                <td className="num">{price(l)}</td>
                <td className="num">{l.unpricedQty.isZero() ? eur(l.knownCost) : l.knownCost.isZero() ? "unknown" : `${eur(l.knownCost)} + unknown`}</td>
              </tr>
            ))}
          </ExpandGroup>
        ))}
        <ExpandGroup hasChildren={false} cells={[{ content: "Total" }, { content: "" }, { content: "" }, { content: cost(budget.total.knownCost, budget.total.complete), num: true }]} />
      </table>
      <p className="small muted" style={{ marginBottom: 0 }}>
        What this batch really used, at the price of the lot it came from (the price on its purchase order). A lot without a price, such as the opening count, uses the
        latest price ordered for that item. &quot;Unknown&quot; means no price has been recorded yet.
      </p>
    </>
  );
}
