import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { batchBudget } from "@/db/budget";
import { formatQty, type UnitCode } from "@/domain/quantity";
import type { PlanResult } from "@/domain/planner";
import { Flash } from "../../components/flash";
import { INCIDENT } from "../../components/labels";
import { BatchSteps } from "../../components/batch-steps";
import { PackagingTable } from "../../components/packaging-table";
import { BatchBudgetTable } from "../../components/batch-budget-table";
import { addIncident, close, markNotMade } from "../actions";

export const dynamic = "force-dynamic";

const big = { fontSize: "1.1rem", padding: "12px" } as const;
const bigBtn = { fontSize: "1.05rem", padding: "12px 22px" } as const;
const ghostBtn = { ...bigBtn, background: "var(--muted)" } as const;
const q = (v: Decimal | null, unit: string) => formatQty(v, unit as UnitCode);
const todayIso = () => new Date().toISOString().slice(0, 10);

const SOURCE: Record<string, string> = { observed: "observed average", estimate: "estimate", missing: "unknown" };

/** The batch summary: what was used and packed, its cost, incidents, closing, plan vs actual. */
export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const tr = await traceBatch(db(), id).catch(() => null);
  if (!tr) notFound();
  const { batch, run, sauce, recipe } = tr;
  const open = batch.status !== "closed" && batch.status !== "cancelled";
  const pending = tr.ingredientUse.filter((l) => l.actual === null);
  const recorded = tr.ingredientUse.filter((l) => l.actual !== null);
  const budget = await batchBudget(db(), batch.id);

  const products = await db()
    .select({ product: t.products, format: t.formats })
    .from(t.products)
    .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
    .where(and(eq(t.products.sauceId, sauce.id), eq(t.products.active, true)))
    .orderBy(desc(t.formats.capacityMl));

  const [snap] = await db().select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, run.id));
  const plan = snap ? (snap.data as unknown as PlanResult) : null;
  const sauceLine = plan?.sauces.find((s) => s.sauceId === sauce.id) ?? null;
  const perBatch = sauceLine?.litresPerBatch != null ? new Decimal(sauceLine.litresPerBatch) : null;
  const yieldLabel = SOURCE[sauceLine?.yieldSource ?? "missing"] ?? "unknown";

  const [{ others } = { others: 0 }] = await db()
    .select({ others: sql<number>`count(*)::int` })
    .from(t.productionBatches)
    .where(and(eq(t.productionBatches.runId, run.id), ne(t.productionBatches.id, batch.id), sql`${t.productionBatches.status} not in ('closed', 'cancelled')`));
  const [{ sameSauce } = { sameSauce: 0 }] = await db()
    .select({ sameSauce: sql<number>`count(*)::int` })
    .from(t.productionBatches)
    .where(and(eq(t.productionBatches.runId, run.id), eq(t.productionBatches.sauceId, sauce.id), ne(t.productionBatches.status, "cancelled")));

  const packDates = [...new Set(tr.sessions.map((s) => s.packedOn))];
  const nothingRecorded = recorded.length === 0 && tr.sessions.length === 0;

  const next =
    batch.status === "cancelled" ? (
      "This batch was marked as not made. Nothing more to do."
    ) : batch.status === "closed" ? (
      "Done: this batch is closed."
    ) : pending.length > 0 ? (
      <>
        Next: <Link href={`/production/${batch.id}`}>record the ingredients used</Link> ({pending.length} still to record).
      </>
    ) : tr.sessions.length === 0 ? (
      <>
        Next: <Link href={`/packaging/${batch.id}`}>pack the jars</Link>.
      </>
    ) : (
      <>
        Next: <Link href={`/packaging/${batch.id}`}>pack more jars</Link> if there&apos;s sauce left, or close the batch below.
      </>
    );
  const newKey = () => crypto.randomUUID();

  return (
    <>
      <BatchSteps batch={batch} sauceName={sauce.name} run={run} current="summary" versionNo={recipe.versionNo} />
      <p className="small muted" style={{ margin: "0 0 12px" }}>
        Production date: {batch.producedOn ?? "not recorded yet"} · Packaging dates: {packDates.length ? packDates.join(", ") : "not packed yet"}
      </p>
      <ul className="issues">
        <li className={open ? "warn" : "ok"} style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {next}
        </li>
      </ul>
      <Flash params={flash} />

      {/* ------------------------------------------------ production */}
      <h2>1. Production: ingredients used</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Recipe</th>
              <th className="num">Used</th>
              <th className="num">Difference</th>
              <th>Lots used</th>
            </tr>
          </thead>
          <tbody>
            {tr.ingredientUse.map((l) => {
              const diff = l.actual && !l.extra ? l.actual.minus(l.standard) : null;
              return (
                <tr key={l.itemId}>
                  <td>
                    {l.name}
                    {l.extra ? <span className="small muted"> (not in recipe)</span> : null}
                  </td>
                  <td className="num">{l.extra ? "—" : q(l.standard, l.unit)}</td>
                  <td className="num">{l.actual ? q(l.actual, l.unit) : <span className="badge warn">not recorded</span>}</td>
                  <td className="num">{diff && !diff.isZero() ? `${diff.gt(0) ? "+" : ""}${q(diff, l.unit)}` : "—"}</td>
                  <td className="small">
                    {l.sources.length === 0
                      ? "—"
                      : l.sources.map((s) => (
                          <div key={s.lot.id}>
                            <Link href={`/stock/${s.lot.itemId}`}>{s.lot.code}</Link>
                            {s.lot.supplierBatch ? ` · supplier batch ${s.lot.supplierBatch}` : ""} · {q(s.quantity, l.unit)}
                          </div>
                        ))}
                  </td>
                </tr>
              );
            })}
            {tr.ingredientUse.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  This recipe version has no ingredient lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {open && (
          <p className="small" style={{ marginBottom: 0 }}>
            <Link href={`/production/${batch.id}`}>Record or correct the ingredients →</Link>
          </p>
        )}
      </div>

      {/* ------------------------------------------------ packaging */}
      <h2>2. Packaging: jars</h2>
      <p className="small muted">
        Litres from this batch: <strong>{q(tr.filledLitres, "L")}</strong> (jars filled × ml per jar, rejects included).
      </p>
      <div className="card scroll">
        <PackagingTable tr={tr} />
        {batch.status !== "cancelled" && (
          <p className="small" style={{ marginBottom: 0 }}>
            <Link href={`/packaging/${batch.id}`}>{open ? "Record, edit or delete packaging →" : "Edit or delete packaging →"}</Link>
          </p>
        )}
      </div>

      {/* ------------------------------------------------ budget */}
      <h2>3. Cost of this batch</h2>
      <BatchBudgetTable budget={budget} />

      {/* ------------------------------------------------ incidents */}
      <h2 id="incidents">4. Incidents</h2>
      <div className="card">
        {tr.incidents.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>
            No incidents recorded.
          </p>
        ) : (
          <ul style={{ marginTop: 0 }}>
            {tr.incidents.map((i) => (
              <li key={i.id}>
                <strong>{INCIDENT[i.type] ?? i.type}</strong> · {i.occurredOn}: {i.note}
              </li>
            ))}
          </ul>
        )}
        <form action={addIncident} className="row">
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="key" value={newKey()} />
          <div>
            <label htmlFor="inc-type">Type (required)</label>
            <select id="inc-type" name="type" defaultValue="" required style={big}>
              <option value="">Choose…</option>
              {Object.entries(INCIDENT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inc-date">Date (required)</label>
            <input id="inc-date" name="occurredOn" type="date" required defaultValue={todayIso()} style={big} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <label htmlFor="inc-note">What happened (required)</label>
            <input id="inc-note" name="note" required style={big} />
          </div>
          <button type="submit" style={bigBtn}>
            Record incident
          </button>
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            This is a note for the batch record. It doesn&apos;t change stock; record lost jars as a write-off in Stock.
          </p>
        </form>
      </div>

      {/* ------------------------------------------------ close */}
      <h2>5. Close the batch</h2>
      <div className="card">
        {!open ? (
          <p style={{ margin: 0 }}>
            {batch.status === "closed" ? "Closed" : "Marked as not made"}
            {batch.closedAt ? ` on ${batch.closedAt.toISOString().slice(0, 10)}` : ""}.{batch.status === "cancelled" && batch.note ? ` Reason: ${batch.note}` : ""}
            {batch.status === "closed" ? " Its packaging can still be edited or deleted." : ""}
          </p>
        ) : (
          <>
            {pending.length > 0 ? (
              <ul className="issues">
                <li className="bad">
                  Can&apos;t close yet. Not recorded: {pending.map((p) => p.name).join(", ")}. <Link href={`/production/${batch.id}`}>Record what was used</Link> (0 if
                  none) first.
                </li>
              </ul>
            ) : null}
            <form action={close}>
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="key" value={newKey()} />
              <p className="small muted">
                Closing locks the ingredients of this batch; packaging can still be corrected afterwards.{" "}
                {others === 0
                  ? `This is the last open batch of ${run.code}, so closing it also closes the run and releases any stock still reserved for it.`
                  : `${others} other batch(es) of ${run.code} are still open; the run closes when the last one is closed.`}
              </p>
              <button type="submit" style={bigBtn} disabled={pending.length > 0}>
                Close batch
              </button>
            </form>
            {nothingRecorded && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer" }}>This batch wasn&apos;t made</summary>
                <form action={markNotMade} className="row" style={{ marginTop: 8 }}>
                  <input type="hidden" name="batchId" value={batch.id} />
                  <input type="hidden" name="key" value={newKey()} />
                  <div style={{ flex: "1 1 260px" }}>
                    <label htmlFor="notmade">Why not? (required)</label>
                    <input id="notmade" name="reason" required style={big} />
                  </div>
                  <button type="submit" style={ghostBtn}>
                    Mark as not made
                  </button>
                  <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                    Only possible while nothing is recorded for this batch. Its stock reservations are freed.
                  </p>
                </form>
              </details>
            )}
          </>
        )}
      </div>

      {/* ------------------------------------------------ plan vs actual */}
      <h2>Plan vs actual for this batch</h2>
      <div className="card scroll">
        <strong>Litres</strong>
        <table>
          <tbody>
            <tr>
              <td>Forecast litres per batch ({yieldLabel})</td>
              <td className="num">{perBatch ? q(perBatch, "L") : "unknown"}</td>
            </tr>
            <tr>
              <td>Filled into jars (all filled jars, rejects included)</td>
              <td className="num">{q(tr.filledLitres, "L")}</td>
            </tr>
            <tr>
              <td>Sellable (accepted jars)</td>
              <td className="num">
                {q(tr.sellableLitres, "L")}
                {perBatch && perBatch.gt(0) && tr.sellableLitres.gt(0) ? (
                  <span className="small muted"> ({tr.sellableLitres.div(perBatch).mul(100).toDecimalPlaces(0).toString()}% of forecast)</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <strong>Jars by size</strong>
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th className="num">Run target ({sameSauce} batch{sameSauce === 1 ? "" : "es"} of this sauce)</th>
              <th className="num">Filled</th>
              <th className="num">Rejected</th>
              <th className="num">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {products.map(({ product }) => {
              const s = tr.jarsBySize.find((x) => x.productId === product.id);
              const target = plan?.products.find((p) => p.productId === product.id)?.targetJars;
              return (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td className="num">{target ?? "—"}</td>
                  <td className="num">{s?.filled ?? 0}</td>
                  <td className="num">{s?.rejected ?? 0}</td>
                  <td className="num">{s?.accepted ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The run target is for the whole run; see the <Link href={`/runs/${run.id}`}>run page</Link> for totals across its batches.
        </p>
      </div>
    </>
  );
}
