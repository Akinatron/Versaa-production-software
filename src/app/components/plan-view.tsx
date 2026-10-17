import Decimal from "decimal.js";
import type { CoverageStatus, PlanResult, Source } from "@/domain/planner";
import { formatQty, type UnitCode } from "@/domain/quantity";

const STATUS: Record<CoverageStatus, { label: string; cls: string }> = {
  covered: { label: "Covered", cls: "ok" },
  short: { label: "Buy", cls: "bad" },
  unknown: { label: "Unknown", cls: "warn" },
};
const SOURCE: Record<Source, string> = { observed: "measured", estimate: "estimate", missing: "missing" };

/** Works with a live plan or one read back from a frozen snapshot (strings). */
const D = (v: unknown): Decimal | null => (v === null || v === undefined ? null : new Decimal(v as Decimal.Value));
const q = (v: unknown, unit: UnitCode) => formatQty(D(v), unit);

export function PlanView({ result }: { result: PlanResult }) {
  return (
    <>
      {result.issues.length > 0 && (
        <>
          <h2>Needs attention</h2>
          <ul className="issues">
            {result.issues.map((i, n) => (
              <li key={n} className={i.level === "blocker" ? "bad" : "warn"}>
                {i.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {result.sauces.length > 0 && (
        <>
          <h2>Batches</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Sauce</th>
                  <th className="num">Product needed</th>
                  <th className="num">Litres per batch</th>
                  <th className="num">Batches</th>
                  <th className="num">Expected surplus</th>
                  <th>Recipe</th>
                </tr>
              </thead>
              <tbody>
                {result.sauces.map((s) => (
                  <tr key={s.sauceId}>
                    <td>{s.name}</td>
                    <td className="num">{q(s.litresNeeded, "L")}</td>
                    <td className="num">
                      {s.litresPerBatch ? q(s.litresPerBatch, "L") : "—"}{" "}
                      <span className={`badge ${s.yieldSource === "observed" ? "ok" : "warn"}`}>{SOURCE[s.yieldSource]}</span>
                    </td>
                    <td className="num">{s.batches ?? "unknown"}</td>
                    <td className="num">{s.surplusLitres ? q(s.surplusLitres, "L") : "unknown"}</td>
                    <td>{s.recipeVersionNo ? `version ${s.recipeVersionNo}` : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              Batches and surplus are estimates until real batch results are recorded. The surplus is extra product from
              making whole batches; you decide which jar sizes to fill with it.
            </p>
          </div>

          <h2>Jars</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Sellable target</th>
                  <th className="num">Reject allowance</th>
                  <th className="num">Jars to fill</th>
                  <th>Packaging</th>
                </tr>
              </thead>
              <tbody>
                {result.products.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td className="num">{p.targetJars}</td>
                    <td className="num">{p.rejectRate ? `${D(p.rejectRate)!.mul(100).toString()}%` : "unknown"}</td>
                    <td className="num">{p.jarsToFill}</td>
                    <td>
                      {p.packable === null ? (
                        <span className="badge warn">Stock unknown</span>
                      ) : p.packable ? (
                        <span className="badge ok">All parts in stock</span>
                      ) : (
                        <span className="badge bad">Parts missing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(["ingredient", "packaging"] as const).map((kind) => {
        const rows = result.requirements.filter((r) => r.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind}>
            <h2>{kind === "ingredient" ? "Ingredients" : "Packaging"}</h2>
            <div className="card scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Required</th>
                    <th className="num">In stock</th>
                    <th className="num">Reserved by other runs</th>
                    <th className="num">On order</th>
                    <th className="num">To buy</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.itemId}>
                      <td>
                        {r.name}
                        {r.contributions.length > 1 && (
                          <div className="small muted">{r.contributions.map((c) => `${c.from}: ${q(c.quantity, r.unit)}`).join(" · ")}</div>
                        )}
                      </td>
                      <td className="num">{q(r.required, r.unit)}</td>
                      <td className="num">{r.onHand === null ? "not counted" : q(r.onHand, r.unit)}</td>
                      <td className="num">{q(r.reservedEarlier, r.unit)}</td>
                      <td className="num">{q(r.onOrder, r.unit)}</td>
                      <td className="num">
                        <strong>{q(r.toBuy, r.unit)}</strong>
                      </td>
                      <td>
                        <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Link that pre-fills a purchase order with everything still to buy. */
export function orderLinkFor(result: PlanResult): string | null {
  const lines = result.requirements.filter((r) => r.toBuy !== null && D(r.toBuy)!.gt(0));
  if (lines.length === 0) return null;
  return `/orders/new?items=${encodeURIComponent(lines.map((r) => `${r.itemId}:${D(r.toBuy)!.toString()}`).join(","))}`;
}
