import { db } from "@/db/client";
import { loadPlanCatalog } from "@/db/planning";
import { formatQty } from "@/domain/quantity";
import { addRejectEstimate, addYieldEstimate } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const catalog = await loadPlanCatalog(db());
  const itemName = new Map(catalog.items.map((i) => [i.id, i]));

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Recipes, packaging and planning figures. These change rarely; daily work happens elsewhere.</p>

      <h2>Yields</h2>
      <p className="muted small">
        How many litres of filled product one batch gives. No batch has been measured yet, so plans need an estimate.
        Each new estimate is added, never overwritten, and is labelled as an estimate everywhere.
      </p>
      <div className="grid">
        {catalog.sauces.map((s) => (
          <form key={s.id} action={addYieldEstimate} className="card">
            <strong>{s.name}</strong>
            <p className="small muted" style={{ margin: "4px 0 12px" }}>
              Current: {s.yield.litresPerBatch ? `${s.yield.litresPerBatch} L per batch (${s.yield.source})` : "not set"}
            </p>
            <input type="hidden" name="sauceId" value={s.id} />
            <label htmlFor={`l-${s.id}`}>New estimate, litres per 30 kg batch</label>
            <input id={`l-${s.id}`} name="litresPerBatch" type="number" min="0.1" step="0.1" required />
            <label htmlFor={`n-${s.id}`} style={{ marginTop: 8 }}>Why this figure (optional)</label>
            <input id={`n-${s.id}`} name="note" type="text" />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Save estimate</button>
            </div>
          </form>
        ))}
      </div>

      <h2>Reject allowance</h2>
      <p className="muted small">Optional. Share of filled jars you expect to reject, so the plan fills a few extra.</p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Current</th>
              <th>New estimate (%)</th>
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.reject.rate ? `${p.reject.rate.mul(100)}% (${p.reject.source})` : "not set"}</td>
                <td>
                  <form action={addRejectEstimate} className="row" style={{ alignItems: "center" }}>
                    <input type="hidden" name="productId" value={p.id} />
                    <input name="percent" type="number" min="0" max="99" step="0.1" required aria-label={`Reject % for ${p.name}`} />
                    <button type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recipes</h2>
      <p className="muted small">Quantities for one 30 kg finished batch, exactly as recorded. Editing recipes (as new versions) comes next.</p>
      <div className="grid">
        {catalog.sauces.map((s) => (
          <div key={s.id} className="card">
            <strong>{s.name}</strong>{" "}
            <span className="muted small">version {s.recipe?.versionNo} · {s.recipe?.lines.length} ingredients</span>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {s.recipe?.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>{itemName.get(l.itemId)?.name}</td>
                    <td className="num">{formatQty(l.quantity, l.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <h2>Packaging per jar</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Uses (1 of each per filled jar)</th>
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.packaging.map((x) => itemName.get(x.itemId)?.name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
