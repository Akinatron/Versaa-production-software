import Decimal from "decimal.js";
import type { CoverageStatus, PlanResult, Source } from "@/domain/planner";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { db } from "@/db/client";
import { sauceColorMaps } from "@/db/catalog";
import { SauceName } from "./sauce-name";

const STATUS: Record<CoverageStatus, { label: string; cls: string }> = {
  covered: { label: "Covered", cls: "ok" },
  short: { label: "To buy", cls: "bad" },
  unknown: { label: "Unknown", cls: "warn" },
};
const SOURCE: Record<Source, string> = {
  observed: "measured",
  estimate: "estimate",
  missing: "missing",
};

/** Works with a live plan or one read back from a frozen snapshot (strings). */
const D = (v: unknown): Decimal | null => (v === null || v === undefined ? null : new Decimal(v as Decimal.Value));
const q = (v: unknown, unit: UnitCode) => formatQty(D(v), unit);

type Part = "issues" | "production" | "requirements";

/** The plan; `only` shows just some parts (the run splits them over its steps). */
export async function PlanView({ result, only, batchesTitle = "Batches" }: { result: PlanResult; only?: Part[]; batchesTitle?: string }) {
  const show = (p: Part) => !only || only.includes(p);
  const colors = await sauceColorMaps(db());
  return (
    <>
      {show("issues") && result.issues.some((i) => i.level === "blocker") && (
        <ul className="issues">
          {result.issues
            .filter((i) => i.level === "blocker")
            .map((i, n) => (
              <li key={n} className="bad">
                {i.message}
              </li>
            ))}
        </ul>
      )}
      {show("issues") && result.issues.some((i) => i.level !== "blocker") && (
        <details className="card">
          <summary>
            {result.issues.filter((i) => i.level !== "blocker").length} planning{" "}
            {result.issues.filter((i) => i.level !== "blocker").length === 1 ? "note" : "notes"}
            <span className="small muted" style={{ fontWeight: 400 }}>
              estimates and unknowns behind these numbers
            </span>
          </summary>
          <ul style={{ margin: 0 }}>
            {result.issues
              .filter((i) => i.level !== "blocker")
              .map((i, n) => (
                <li key={n} className="small" style={{ marginBottom: 4 }}>
                  {i.message}
                </li>
              ))}
          </ul>
        </details>
      )}

      {show("production") && result.sauces.length > 0 && (
        <>
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
                    <td>
                      <SauceName name={p.name} color={colors.byProduct.get(p.productId)} />
                    </td>
                    <td className="num">{p.targetJars}</td>
                    <td className="num">{p.rejectRate ? `${D(p.rejectRate)!.mul(100).toString()}%` : "unknown"}</td>
                    <td className="num">{p.jarsToFill}</td>
                    <td>
                      {p.packable === null ? (
                        <span className="badge warn">Stock unknown</span>
                      ) : p.packable ? (
                        <span className="badge ok">In stock</span>
                      ) : (
                        <span className="badge bad">Parts missing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>{batchesTitle}</h2>
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
                    <td>
                      <SauceName name={s.name} color={colors.bySauce.get(s.sauceId)} />
                    </td>
                    <td className="num">{q(s.litresNeeded, "L")}</td>
                    <td className="num">
                      {s.litresPerBatch ? q(s.litresPerBatch, "L") : "—"}{" "}
                      <span className={`badge ${s.yieldSource === "observed" ? "ok" : "neutral"}`}>{SOURCE[s.yieldSource]}</span>
                    </td>
                    <td className="num">{s.batches ?? "unknown"}</td>
                    <td className="num">{s.surplusLitres ? q(s.surplusLitres, "L") : "unknown"}</td>
                    <td>{s.recipeVersionNo ? `v${s.recipeVersionNo}` : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              Batches and surplus are estimates until real batch results are recorded. The surplus is extra product from making whole batches; you decide which
              jar sizes to fill with it.
            </p>
          </div>
        </>
      )}

      {show("requirements") &&
        (["ingredient", "packaging"] as const).map((kind) => {
          const rows = result.requirements.filter((r) => r.kind === kind);
          if (rows.length === 0) return null;
          const attention = rows.filter((r) => r.status !== "covered");
          const covered = rows.filter((r) => r.status === "covered");
          // A confirmed run shows what it still has to use once it has used some.
          const showLeft = rows.some((r) => r.stillToUse != null && (r.required == null || !new Decimal(r.stillToUse).eq(r.required)));
          const table = (list: typeof rows) => (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Needed</th>
                  {showLeft && <th className="num">Still to use</th>}
                  <th className="num">In stock</th>
                  <th className="num">Held by earlier runs</th>
                  <th className="num">On order</th>
                  <th className="num">To buy</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.itemId}>
                    <td>
                      {r.name}
                      {r.contributions.length > 1 && (
                        <div className="small muted">{r.contributions.map((c) => `${c.from}: ${q(c.quantity, r.unit)}`).join(" · ")}</div>
                      )}
                    </td>
                    <td className="num">{q(r.required, r.unit)}</td>
                    {showLeft && <td className="num">{q(r.stillToUse ?? null, r.unit)}</td>}
                    <td className="num">{r.onHand === null ? <span className="text-warn">not counted</span> : q(r.onHand, r.unit)}</td>
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
          );
          return (
            <section key={kind}>
              <h2>{kind === "ingredient" ? "Ingredients" : "Packaging"}</h2>
              {attention.length > 0 && <div className="card scroll">{table(attention)}</div>}
              {covered.length > 0 && (
                <details className="card scroll">
                  <summary>
                    {covered.length} {covered.length === 1 ? "item" : "items"} covered
                    <span className="small muted" style={{ fontWeight: 400 }}>
                      enough in stock or on order
                    </span>
                  </summary>
                  {table(covered)}
                </details>
              )}
            </section>
          );
        })}
    </>
  );
}

/** Link to plan orders (one per supplier) for everything still to buy. */
export function orderLinkFor(result: PlanResult): string | null {
  const lines = result.requirements.filter((r) => r.toBuy !== null && D(r.toBuy)!.gt(0));
  if (lines.length === 0) return null;
  return `/orders/plan?items=${encodeURIComponent(lines.map((r) => `${r.itemId}:${D(r.toBuy)!.toString()}`).join(","))}`;
}
