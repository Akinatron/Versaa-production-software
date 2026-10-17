import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";
import { planProduction, type Source } from "@/domain/planner";
import { Flash } from "../components/flash";
import { PlanView, orderLinkFor } from "../components/plan-view";
import { saveRun } from "./actions";

export const dynamic = "force-dynamic";

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
  const orderLink = result ? orderLinkFor(result) : null;

  const bySauce = base.sauces.map((s) => ({ sauce: s, products: base.catalog.products.filter((p) => p.sauceId === s.id) }));

  return (
    <>
      <h1>Plan production</h1>
      <p className="lead">
        Enter how many sellable jars you want of each sauce and size. Calculating saves nothing and takes nothing from
        stock.
      </p>
      <Flash params={params} />

      <form className="card" method="get">
        <div className="grid">
          {bySauce.map(({ sauce, products }) => (
            <div key={sauce.id}>
              <strong>{sauce.name}</strong>
              <p className="small muted" style={{ margin: "2px 0 8px" }}>
                Yield: {sauce.yield.litresPerBatch ? `${sauce.yield.litresPerBatch} L per batch` : "not set"} ({SOURCE[sauce.yield.source]})
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
          <div className="card row">
            <form action={saveRun} className="row" style={{ alignItems: "end", flex: 1 }}>
              <input type="hidden" name="key" value={crypto.randomUUID()} />
              {Object.entries(targets).map(([id, n]) => (
                <input key={id} type="hidden" name={`t:${id}`} value={n} />
              ))}
              <div>
                <label htmlFor="plannedFor">Production date</label>
                <input id="plannedFor" name="plannedFor" type="date" required />
              </div>
              <button type="submit">Save as production run</button>
            </form>
            {orderLink && (
              <a href={orderLink} className="small">
                Order what's missing →
              </a>
            )}
          </div>
          <PlanView result={result} />
        </>
      )}
    </>
  );
}
