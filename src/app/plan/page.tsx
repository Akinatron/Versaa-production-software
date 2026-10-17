import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";
import { planProduction, type CoverageStatus, type Source } from "@/domain/planner";
import { formatQty } from "@/domain/quantity";

export const dynamic = "force-dynamic";

const STATUS: Record<CoverageStatus, { label: string; cls: string }> = {
  covered: { label: "Covered", cls: "ok" },
  short: { label: "Buy", cls: "bad" },
  unknown: { label: "Unknown", cls: "warn" },
};
const SOURCE: Record<Source, string> = { observed: "measured", estimate: "estimate", missing: "missing" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const base = await loadPlanInput(db(), {});

  const targets: Record<string, number> = {};
  for (const p of base.products) {
    const raw = params[p.id];
    if (raw !== undefined && raw.trim() !== "") targets[p.id] = Number(raw);
  }
  const hasTargets = Object.values(targets).some((n) => n !== 0);
  const result = hasTargets ? planProduction({ ...base, targets }) : null;

  const bySauce = base.sauces.map((s) => ({ sauce: s, products: base.catalog.products.filter((p) => p.sauceId === s.id) }));

  return (
    <>
      <h1>Plan production</h1>
      <p className="lead">
        Enter how many sellable jars you want of each sauce and size. Nothing is saved or taken from stock: this only
        calculates.
      </p>

      <form className="card" method="get">
        <div className="grid">
          {bySauce.map(({ sauce, products }) => (
            <div key={sauce.id}>
              <strong>{sauce.name}</strong>
              <p className="small muted" style={{ margin: "2px 0 8px" }}>
                Yield: {sauce.yield.litresPerBatch ? `${sauce.yield.litresPerBatch} L per batch` : "not set"} (
                {SOURCE[sauce.yield.source]})
              </p>
              {products.map((p) => (
                <div key={p.id} className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                  <label htmlFor={p.id} style={{ flex: 1, margin: 0 }}>
                    {p.formatName}
                  </label>
                  <input id={p.id} name={p.id} type="number" min={0} step={1} inputMode="numeric" defaultValue={params[p.id] ?? ""} placeholder="0" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="submit">Calculate</button>
        </div>
      </form>

      {result && (
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
                        <td className="num">{formatQty(s.litresNeeded, "L")}</td>
                        <td className="num">
                          {s.litresPerBatch ? formatQty(s.litresPerBatch, "L") : "—"}{" "}
                          <span className={`badge ${s.yieldSource === "observed" ? "ok" : "warn"}`}>{SOURCE[s.yieldSource]}</span>
                        </td>
                        <td className="num">{s.batches ?? "unknown"}</td>
                        <td className="num">{s.surplusLitres ? formatQty(s.surplusLitres, "L") : "unknown"}</td>
                        <td>{s.recipeVersionNo ? `version ${s.recipeVersionNo}` : "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">
                  Batches and surplus are estimates until real batch results are recorded. The surplus is extra product
                  from making whole batches; you decide which jar sizes to fill with it.
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
                        <td className="num">{p.rejectRate ? `${p.rejectRate.mul(100).toString()}%` : "unknown"}</td>
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
                        <th className="num">Reserved</th>
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
                              <div className="small muted">{r.contributions.map((c) => `${c.from}: ${formatQty(c.quantity, r.unit)}`).join(" · ")}</div>
                            )}
                          </td>
                          <td className="num">{formatQty(r.required, r.unit)}</td>
                          <td className="num">{r.onHand === null ? "not counted" : formatQty(r.onHand, r.unit)}</td>
                          <td className="num">{formatQty(r.reservedEarlier, r.unit)}</td>
                          <td className="num">{formatQty(r.onOrder, r.unit)}</td>
                          <td className="num">
                            <strong>{formatQty(r.toBuy, r.unit)}</strong>
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
      )}
    </>
  );
}
