import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";
import { planProduction, targetsFromBatches, type Source } from "@/domain/planner";
import Link from "next/link";
import { Flash } from "../components/flash";
import { PlanView, orderLinkFor } from "../components/plan-view";
import { saveRun } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE: Record<Source, string> = { observed: "measured", estimate: "estimate", missing: "missing" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const base = await loadPlanInput(db(), {});
  if (params.mode === "batches") return <BatchMode params={params} base={base} />;

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
      <ModeTabs mode="jars" />

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

type Base = Awaited<ReturnType<typeof loadPlanInput>>;

function ModeTabs({ mode }: { mode: "jars" | "batches" }) {
  const tab = (active: boolean) =>
    ({
      padding: "8px 14px",
      borderRadius: 8,
      textDecoration: "none",
      border: "1px solid var(--border)",
      background: active ? "var(--accent)" : "var(--surface)",
      color: active ? "#fff" : "var(--text)",
      fontWeight: active ? 600 : 400,
    }) as const;
  return (
    <div className="row" style={{ marginBottom: 16, gap: 8 }} role="tablist">
      <Link href="/plan" style={tab(mode === "jars")} aria-current={mode === "jars" ? "page" : undefined}>
        By jars
      </Link>
      <Link href="/plan?mode=batches" style={tab(mode === "batches")} aria-current={mode === "batches" ? "page" : undefined}>
        By batches
      </Link>
    </div>
  );
}

/** Second way to plan: batches per sauce and a % split across sizes, turned into sellable jar targets. */
function BatchMode({ params, base }: { params: Record<string, string | undefined>; base: Base }) {
  const bySauce = base.sauces.map((s) => ({ sauce: s, products: base.catalog.products.filter((p) => p.sauceId === s.id) }));
  const input: Record<string, { batches: number; split: Record<string, number> }> = {};
  for (const { sauce, products } of bySauce) {
    const raw = params[`b_${sauce.id}`]?.trim();
    if (!raw) continue;
    const split: Record<string, number> = {};
    for (const p of products) {
      const v = params[`s_${p.id}`]?.trim();
      if (v) split[p.id] = Number(v);
    }
    input[sauce.id] = { batches: Number(raw), split };
  }
  const calculated = Object.keys(input).length > 0;
  const { targets, issues } = calculated ? targetsFromBatches(base, input) : { targets: {}, issues: [] };
  const hasTargets = Object.values(targets).some((n) => n > 0);
  const result = hasTargets ? planProduction({ ...base, targets }) : null;
  const orderLink = result ? orderLinkFor(result) : null;
  const query = Object.entries(params)
    .filter(([k, v]) => (k === "mode" || k.startsWith("b_") || k.startsWith("s_")) && v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  const productName = new Map(base.catalog.products.map((p) => [p.id, p]));

  return (
    <>
      <h1>Plan production</h1>
      <p className="lead">
        Enter how many batches of each sauce you want to make and how to split each sauce over the jar sizes (percent of its volume). This is turned into
        sellable jar targets and then planned exactly like entering jars. Calculating saves nothing and takes nothing from stock.
      </p>
      <Flash params={params} />
      <ModeTabs mode="batches" />

      <form className="card" method="get">
        <input type="hidden" name="mode" value="batches" />
        <div className="grid">
          {bySauce.map(({ sauce, products }) => (
            <div key={sauce.id}>
              <strong>{sauce.name}</strong>
              <p className="small muted" style={{ margin: "2px 0 8px" }}>
                Yield: {sauce.yield.litresPerBatch ? `${sauce.yield.litresPerBatch} L per batch` : "not set"} ({SOURCE[sauce.yield.source]})
              </p>
              <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                <label htmlFor={`b_${sauce.id}`} style={{ flex: 1, margin: 0 }}>
                  Batches
                </label>
                <input id={`b_${sauce.id}`} name={`b_${sauce.id}`} type="number" min={0} step={1} inputMode="numeric" defaultValue={params[`b_${sauce.id}`] ?? ""} placeholder="0" />
              </div>
              {products.map((p) => (
                <div key={p.id} className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                  <label htmlFor={`s_${p.id}`} style={{ flex: 1, margin: 0 }}>
                    {p.formatName} — % of volume
                  </label>
                  <input id={`s_${p.id}`} name={`s_${p.id}`} type="number" min={0} max={100} step="any" inputMode="decimal" defaultValue={params[`s_${p.id}`] ?? ""} placeholder="%" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="small muted">For each sauce with batches, the percentages must add up to 100%. Sauces left empty are not planned.</p>
        <div style={{ marginTop: 12 }}>
          <button type="submit">Calculate</button>
        </div>
      </form>

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n} className={i.level === "blocker" ? "bad" : "warn"}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      {calculated && !hasTargets && issues.length === 0 && (
        <ul className="issues">
          <li className="warn">These batches give no whole jars. Enter more batches or a split.</li>
        </ul>
      )}

      {hasTargets && (
        <>
          <h2>This gives these sellable jar targets</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Sellable jars</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(targets)
                  .filter(([, n]) => n > 0)
                  .map(([id, n]) => (
                    <tr key={id}>
                      <td>{productName.get(id)?.name ?? id}</td>
                      <td className="num">{n}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Whole jars only (rounded down), after the expected rejects where a reject rate is known. These targets are what the run saves.{" "}
              <Link href={`/plan?${Object.entries(targets).filter(([, n]) => n > 0).map(([id, n]) => `${id}=${n}`).join("&")}`}>Adjust as jars →</Link>
            </p>
          </div>
        </>
      )}

      {result && (
        <>
          <div className="card row">
            <form action={saveRun} className="row" style={{ alignItems: "end", flex: 1 }}>
              <input type="hidden" name="key" value={crypto.randomUUID()} />
              <input type="hidden" name="back" value={`/plan?${query}`} />
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
