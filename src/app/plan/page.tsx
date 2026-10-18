import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanInput } from "@/db/planning";
import { planProduction, targetsFromBatches, type Source } from "@/domain/planner";
import Link from "next/link";
import { Flash } from "../components/flash";
import { PlanView, orderLinkFor } from "../components/plan-view";
import { saveRun } from "./actions";
import { PageHeader, Empty } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";
import { loadOrderDemand } from "@/db/demand";

export const dynamic = "force-dynamic";

const SOURCE: Record<Source, string> = {
  observed: "measured",
  estimate: "estimate",
  missing: "missing",
};

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const base = await loadPlanInput(db(), {});
  if (params.mode === "batches") return <BatchMode params={params} base={base} />;
  if (params.mode === "orders") return <OrdersMode params={params} base={base} />;

  const targets: Record<string, number> = {};
  for (const p of base.products) {
    const raw = params[p.id];
    if (raw !== undefined && raw.trim() !== "") targets[p.id] = Number(raw);
  }
  const hasTargets = Object.values(targets).some((n) => n !== 0);
  const result = hasTargets ? planProduction({ ...base, targets }) : null;
  const orderLink = result ? orderLinkFor(result) : null;

  const bySauce = base.sauces.map((s) => ({
    sauce: s,
    products: base.catalog.products.filter((p) => p.sauceId === s.id),
  }));

  return (
    <>
      <PageHeader title="Plan production" lead="How many sellable jars of each sauce and size? Calculating saves nothing." />
      <Flash params={params} />
      <ModeTabs mode="jars" />

      <form className="card" method="get">
        <div className="grid">
          {bySauce.map(({ sauce, products }) => (
            <div key={sauce.id}>
              <h3 style={{ margin: 0 }}>{sauce.name}</h3>
              <p className="small muted" style={{ margin: "2px 0 10px" }}>
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
        <div className="form-actions">
          <button type="submit">Calculate</button>
        </div>
      </form>

      {result && (
        <>
          <SaveRun result={result} targets={targets} orderLink={orderLink} />
          <PlanView result={result} />
        </>
      )}
    </>
  );
}

type Base = Awaited<ReturnType<typeof loadPlanInput>>;

function ModeTabs({ mode }: { mode: "jars" | "batches" | "orders" }) {
  return (
    <nav className="tabs" aria-label="Plan by">
      <Link href="/plan" aria-current={mode === "jars" ? "page" : undefined}>
        By jars
      </Link>
      <Link href="/plan?mode=batches" aria-current={mode === "batches" ? "page" : undefined}>
        By batches
      </Link>
      <Link href="/plan?mode=orders" aria-current={mode === "orders" ? "page" : undefined}>
        From sales orders
      </Link>
    </nav>
  );
}

/** The result's first block: what it adds up to, and saving it as a run. */
function SaveRun({
  result,
  targets,
  back,
  orderLink,
}: {
  result: ReturnType<typeof planProduction>;
  targets: Record<string, number>;
  back?: string;
  orderLink: string | null;
}) {
  const batches = result.sauces.reduce((a, s) => a + (s.batches ?? 0), 0);
  const jars = result.products.reduce((a, p) => a + p.jarsToFill, 0);
  const toBuy = result.requirements.filter((r) => r.status === "short").length;
  const unknown = result.requirements.filter((r) => r.status === "unknown").length;
  return (
    <section className="card" style={{ marginTop: 8 }}>
      <div className="card-head">
        <h2>Result</h2>
      </div>
      <p>
        <strong>{batches}</strong> {batches === 1 ? "batch" : "batches"} · <strong>{jars}</strong> jars to fill ·{" "}
        {toBuy === 0 ? (
          <span className="text-ok">everything in stock or on order</span>
        ) : (
          <span className="text-bad">
            {toBuy} {toBuy === 1 ? "item" : "items"} to buy
          </span>
        )}
        {unknown > 0 && <span className="text-warn"> · {unknown} with unknown stock</span>}
      </p>
      <form action={saveRun} className="row">
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        {back && <input type="hidden" name="back" value={back} />}
        {Object.entries(targets).map(([id, n]) => (
          <input key={id} type="hidden" name={`t:${id}`} value={n} />
        ))}
        <div>
          <label htmlFor="plannedFor">Production date</label>
          <input id="plannedFor" name="plannedFor" type="date" required />
        </div>
        <button type="submit">Save as production run</button>
        {orderLink && (
          <a href={orderLink} className="btn secondary">
            Order what&apos;s missing
          </a>
        )}
      </form>
      <p className="small muted" style={{ marginTop: 10 }}>
        Saving creates a draft run. Nothing is reserved or taken from stock until you confirm it.
      </p>
    </section>
  );
}

/** Second way to plan: batches per sauce and a % split across sizes, turned into sellable jar targets. */
function BatchMode({ params, base }: { params: Record<string, string | undefined>; base: Base }) {
  const bySauce = base.sauces.map((s) => ({
    sauce: s,
    products: base.catalog.products.filter((p) => p.sauceId === s.id),
  }));
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
      <PageHeader
        title="Plan production"
        lead="How many batches of each sauce, and how to split each one over the jar sizes (percent of its volume)? This becomes sellable jar targets, planned exactly like entering jars."
      />
      <Flash params={params} />
      <ModeTabs mode="batches" />

      <form className="card" method="get">
        <input type="hidden" name="mode" value="batches" />
        <div className="grid">
          {bySauce.map(({ sauce, products }) => (
            <div key={sauce.id}>
              <h3 style={{ margin: 0 }}>{sauce.name}</h3>
              <p className="small muted" style={{ margin: "2px 0 10px" }}>
                Yield: {sauce.yield.litresPerBatch ? `${sauce.yield.litresPerBatch} L per batch` : "not set"} ({SOURCE[sauce.yield.source]})
              </p>
              <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                <label htmlFor={`b_${sauce.id}`} style={{ flex: 1, margin: 0 }}>
                  Batches
                </label>
                <input
                  id={`b_${sauce.id}`}
                  name={`b_${sauce.id}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  defaultValue={params[`b_${sauce.id}`] ?? ""}
                  placeholder="0"
                />
              </div>
              {products.map((p) => (
                <div key={p.id} className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                  <label htmlFor={`s_${p.id}`} style={{ flex: 1, margin: 0 }}>
                    {p.formatName} — % of volume
                  </label>
                  <input
                    id={`s_${p.id}`}
                    name={`s_${p.id}`}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    inputMode="decimal"
                    defaultValue={params[`s_${p.id}`] ?? ""}
                    placeholder="%"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="small muted">For each sauce with batches, the percentages must add up to 100%. Sauces left empty are not planned.</p>
        <div className="form-actions">
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
              <Link
                href={`/plan?${Object.entries(targets)
                  .filter(([, n]) => n > 0)
                  .map(([id, n]) => `${id}=${n}`)
                  .join("&")}`}
              >
                Adjust as jars
              </Link>
            </p>
          </div>
        </>
      )}

      {result && (
        <>
          <SaveRun result={result} targets={targets} back={`/plan?${query}`} orderLink={orderLink} />
          <PlanView result={result} />
        </>
      )}
    </>
  );
}

/** Third way to plan: targets proposed from pending sales orders, minus stock and runs already under way. */
async function OrdersMode({ params, base }: { params: Record<string, string | undefined>; base: Base }) {
  const until = /^\d{4}-\d{2}-\d{2}$/.test(params.until ?? "") ? params.until! : null;
  const demand = await loadOrderDemand(db(), until);
  const product = new Map(base.catalog.products.map((p) => [p.id, p]));
  // Only active products can be planned; anything else is listed as a warning.
  const targets = Object.fromEntries(Object.entries(demand.targets).filter(([id]) => product.has(id)));
  const notPlannable = demand.lines.filter((l) => l.toMake > 0 && !product.has(l.productId));
  const hasTargets = Object.keys(targets).length > 0;
  const result = hasTargets ? planProduction({ ...base, targets }) : null;
  const orderLink = result ? orderLinkFor(result) : null;
  const order = base.catalog.products.map((p) => p.id);
  const lines = [...demand.lines].sort((a, b) => order.indexOf(a.productId) - order.indexOf(b.productId));
  const back = `/plan?mode=orders${until ? `&until=${until}` : ""}`;
  const names = new Map((await db().select({ id: t.products.id, name: t.products.name }).from(t.products)).map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader title="Plan production" lead="What pending sales orders still need, minus jars in stock and jars confirmed runs will pack." />
      <Flash params={params} />
      <ModeTabs mode="orders" />

      <form className="card row" method="get" style={{ alignItems: "flex-end" }}>
        <input type="hidden" name="mode" value="orders" />
        <div>
          <label htmlFor="until">Orders to deliver by</label>
          <input id="until" name="until" type="date" defaultValue={until ?? ""} />
        </div>
        <button type="submit" className="secondary">
          Update
        </button>
        {until && (
          <Link href="/plan?mode=orders" className="small">
            All pending orders
          </Link>
        )}
        <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
          {until ? `Orders due by ${fmtDate(until)}, plus orders with no delivery date.` : "Every pending order."}
        </p>
      </form>

      {demand.pendingOrders === 0 ? (
        <Empty title="No pending sales orders">
          <p>Orders you take in Outbound appear here until they are delivered, and the jars they still need become a proposed run.</p>
          <p>
            <Link href="/outbound/orders/new" className="btn secondary sm">
              New sales order
            </Link>
          </p>
        </Empty>
      ) : (
        <>
          <div className="stats">
            <span>
              <span className="v">{demand.ordersCounted}</span>
              <span className="l">{demand.ordersCounted === 1 ? "order counted" : "orders counted"}</span>
            </span>
            {demand.ordersLater > 0 && (
              <span>
                <span className="v">{demand.ordersLater}</span>
                <span className="l">due later</span>
              </span>
            )}
            <span>
              <span className="v">{Object.values(targets).reduce((a, n) => a + n, 0)}</span>
              <span className="l">jars to make</span>
            </span>
          </div>
          <div className="card scroll">
            {lines.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No orders are due by this date.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Ordered</th>
                    <th className="num">In stock</th>
                    <th className="num">Coming from runs</th>
                    <th className="num">To make</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.productId}>
                      <td>{product.get(l.productId)?.name ?? names.get(l.productId) ?? "Unknown product"}</td>
                      <td className="num">{l.ordered}</td>
                      <td className="num">{l.inStock}</td>
                      <td className="num">{l.inRuns}</td>
                      <td className="num">{l.toMake > 0 ? <strong>{l.toMake}</strong> : <span className="text-ok">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted" style={{ marginBottom: 0 }}>
              {demand.draftRuns > 0 && `${demand.draftRuns} draft ${demand.draftRuns === 1 ? "run is" : "runs are"} not counted until confirmed.`}
              {hasTargets && (
                <>
                  {" "}
                  <Link
                    href={`/plan?${Object.entries(targets)
                      .map(([id, n]) => `${id}=${n}`)
                      .join("&")}`}
                  >
                    Adjust these numbers
                  </Link>
                </>
              )}
            </p>
          </div>

          {notPlannable.length > 0 && (
            <ul className="issues">
              {notPlannable.map((l) => (
                <li key={l.productId} className="warn">
                  {names.get(l.productId) ?? "A product"} is no longer active, so its {l.toMake} jars can&apos;t be planned here.
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 && !hasTargets && notPlannable.length === 0 && (
            <ul className="issues">
              <li className="ok">Stock and confirmed runs already cover these orders. Nothing to make.</li>
            </ul>
          )}
        </>
      )}

      {result && (
        <>
          <SaveRun result={result} targets={targets} back={back} orderLink={orderLink} />
          <PlanView result={result} />
        </>
      )}
    </>
  );
}
