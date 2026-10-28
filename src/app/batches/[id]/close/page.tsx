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
import { Flash } from "../../../components/flash";
import { INCIDENT } from "../../../components/labels";
import { BatchSteps } from "../../../components/batch-steps";
import { PackagingTable } from "../../../components/packaging-table";
import { BatchBudgetTable } from "../../../components/batch-budget-table";
import { addIncident, bringBack, close, editBatch, editIncident, markNotMade, toggleIncident } from "../../actions";
import { History, ReasonField } from "../../../components/history";
import { fmtWhen } from "../../../components/history-format";
import { fmtDate } from "../../../components/ui/format";

export const dynamic = "force-dynamic";

const q = (v: Decimal | null, unit: string) => formatQty(v, unit as UnitCode);
const todayIso = () => new Date().toISOString().slice(0, 10);

const SOURCE: Record<string, string> = {
  observed: "observed average",
  estimate: "estimate",
  missing: "unknown",
};

/** The batch summary: what was used and packed, its cost, incidents, closing, plan vs actual. */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
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

  const deletedIncidents = await db()
    .select({ i: t.incidents })
    .from(t.incidents)
    .where(and(eq(t.incidents.batchId, batch.id), sql`${t.incidents.deletedAt} is not null`))
    .orderBy(desc(t.incidents.deletedAt));
  const canRestore = batch.status === "cancelled" && run.status !== "closed" && run.status !== "cancelled";

  const packDates = [...new Set(tr.sessions.map((s) => s.packedOn))];
  const nothingRecorded = recorded.length === 0 && tr.sessions.length === 0;

  const newKey = () => crypto.randomUUID();
  const accepted = tr.jarsBySize.reduce((n, x) => n + x.accepted, 0);

  // The one thing to do next, at the top.
  const nextStep = !open ? (
    <li className={batch.status === "closed" ? "ok" : undefined}>
      {batch.status === "closed" ? "Closed" : "Marked as not made"}
      {batch.closedAt ? ` on ${fmtDate(batch.closedAt.toISOString().slice(0, 10))}` : ""}.
      {batch.status === "cancelled" && batch.note ? ` Reason: ${batch.note}.` : ""}
      {batch.status === "closed" ? " Its packaging can still be edited or deleted." : ""}
    </li>
  ) : null;

  return (
    <>
      <BatchSteps
        batch={batch}
        sauceName={sauce.name}
        sauceColor={sauce.color}
        run={run}
        current="close"
        versionNo={recipe.versionNo}
        progress={{ cooked: pending.length === 0, packed: tr.sessions.length > 0 }}
      />
      <Flash params={flash} />
      {nextStep && <ul className="issues">{nextStep}</ul>}
      {canRestore && (
        <form action={bringBack} className="card row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="batchId" value={batch.id} />
          <div style={{ flex: "1 1 100%" }}>
            <strong>Made it after all?</strong>
            <div className="small muted">Bring the batch back on the plan. Its ingredients are reserved again and it can be cooked.</div>
          </div>
          <ReasonField id="restore-reason" label="Why bring it back?" placeholder="e.g. marked by mistake" />
          <button type="submit" className="secondary">
            Restore batch
          </button>
        </form>
      )}

      {open && (
        <section className="card">
          {pending.length > 0 ? (
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>Next: record the ingredients</strong>
                <div className="small muted">
                  {pending.length} of {tr.ingredientUse.length} still to record (0 if none was used). The batch can&apos;t close before that.
                </div>
              </div>
              <Link href={`/batches/${batch.id}/cook`} className="btn">
                Record ingredients
              </Link>
            </div>
          ) : tr.sessions.length === 0 ? (
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>Next: record the jars</strong>
                <div className="small muted">The ingredients are recorded. Pack the sauce into jars.</div>
              </div>
              <Link href={`/batches/${batch.id}/pack`} className="btn">
                Record jars
              </Link>
            </div>
          ) : (
            <form action={close} className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="key" value={newKey()} />
              <div style={{ flex: "1 1 360px" }}>
                <strong>Ready to close</strong>
                <div className="small muted">
                  Closing locks the ingredients; packaging can still be corrected. Pack more first if there&apos;s sauce left.{" "}
                  {others === 0
                    ? `This is the last open batch of ${run.code}: closing it also closes the run and frees any stock still reserved for it.`
                    : `${others} other batch${others === 1 ? "" : "es"} of ${run.code} still open.`}
                </div>
              </div>
              <Link href={`/batches/${batch.id}/pack`} className="btn secondary">
                Pack more
              </Link>
              <button type="submit">Close batch</button>
            </form>
          )}
          {nothingRecorded && (
            <details
              className="small"
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <summary style={{ fontWeight: 500 }}>This batch wasn&apos;t made</summary>
              <form action={markNotMade} className="row">
                <input type="hidden" name="batchId" value={batch.id} />
                <input type="hidden" name="key" value={newKey()} />
                <div style={{ flex: "1 1 260px" }}>
                  <label htmlFor="notmade">Why not?</label>
                  <input id="notmade" name="reason" required />
                </div>
                <button type="submit" className="secondary">
                  Mark as not made
                </button>
              </form>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Only possible while nothing is recorded for this batch. Its stock reservations are freed.
              </p>
            </details>
          )}
        </section>
      )}

      <div className="stats">
        <div>
          <div className="v">{batch.producedOn ? fmtDate(batch.producedOn) : "—"}</div>
          <div className="l">cooked</div>
        </div>
        <div>
          <div className="v">{packDates.length ? packDates.map((d) => fmtDate(d)).join(", ") : "—"}</div>
          <div className="l">packed</div>
        </div>
        <div>
          <div className="v">{q(tr.filledLitres, "L")}</div>
          <div className="l">filled{perBatch ? ` of ${q(perBatch, "L")} forecast` : ""}</div>
        </div>
        <div>
          <div className="v">{accepted}</div>
          <div className="l">jars accepted</div>
        </div>
      </div>

      {/* ------------------------------------------------ production */}
      <section>
        <div className="card-head" style={{ marginTop: 32 }}>
          <h2 style={{ margin: 0 }}>Ingredients used</h2>
          {open && (
            <Link href={`/batches/${batch.id}/cook`} className="more">
              Record or correct
            </Link>
          )}
        </div>
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
                              <Link href={`/trace/lot/${s.lot.id}`}>{s.lot.code}</Link>
                              {s.lot.supplierBatch ? <span className="muted"> · {s.lot.supplierBatch}</span> : ""} · {q(s.quantity, l.unit)}
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
        </div>
      </section>

      {/* ------------------------------------------------ packaging */}
      <section>
        <div className="card-head" style={{ marginTop: 32 }}>
          <h2 style={{ margin: 0 }}>Jars</h2>
          {batch.status !== "cancelled" && (
            <Link href={`/batches/${batch.id}/pack`} className="more">
              {open ? "Record, edit or delete" : "Edit or delete"}
            </Link>
          )}
        </div>
        <div className="card scroll">
          <PackagingTable tr={tr} />
        </div>
      </section>

      {/* ------------------------------------------------ budget */}
      <h2>Cost of this batch</h2>
      <BatchBudgetTable budget={budget} />

      {/* ------------------------------------------------ plan vs actual */}
      <details className="card scroll">
        <summary>Plan vs actual</summary>
        <table>
          <tbody>
            <tr>
              <td>Forecast litres per batch ({yieldLabel})</td>
              <td className="num">{perBatch ? q(perBatch, "L") : "unknown"}</td>
            </tr>
            <tr>
              <td>Filled into jars (rejects included)</td>
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
        <h3>Jars by size</h3>
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th className="num">
                Run target ({sameSauce} batch{sameSauce === 1 ? "" : "es"} of this sauce)
              </th>
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
        <p className="small muted">
          The run target is for the whole run; the <Link href={`/runs/${run.id}`}>run page</Link> has the totals across its batches.
        </p>
      </details>

      {/* ------------------------------------------------ correct */}
      {batch.status !== "cancelled" && (
        <details className="card">
          <summary>Correct the cooking date or note</summary>
          <form action={editBatch} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="batchId" value={batch.id} />
            <div>
              <label htmlFor="b-produced">Cooked on</label>
              <input id="b-produced" name="producedOn" type="date" defaultValue={batch.producedOn ?? ""} />
            </div>
            <div style={{ flex: "1 1 260px" }}>
              <label htmlFor="b-note">Note</label>
              <input id="b-note" name="note" defaultValue={batch.note ?? ""} />
            </div>
            <ReasonField id="b-reason" placeholder="e.g. typed the wrong day" />
            <button type="submit" className="secondary">
              Save
            </button>
          </form>
        </details>
      )}

      {/* ------------------------------------------------ incidents */}
      <details className="card" id="incidents" open={tr.incidents.length > 0}>
        <summary>
          Incidents{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            {tr.incidents.length || "none"}
          </span>
        </summary>
        {tr.incidents.length > 0 && (
          <ul className="worklist" style={{ marginBottom: 12 }}>
            {tr.incidents.map((i) => (
              <li key={i.id}>
                <span className="badge neutral">{INCIDENT[i.type] ?? i.type}</span>
                <div className="what">
                  {i.note}
                  <div className="sub">{fmtDate(i.occurredOn)}</div>
                  <details className="small" style={{ marginTop: 6 }}>
                    <summary>Correct or delete</summary>
                    <form action={editIncident} className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="incidentId" value={i.id} />
                      <div>
                        <label htmlFor={`it-${i.id}`}>Type</label>
                        <select id={`it-${i.id}`} name="type" defaultValue={i.type}>
                          {Object.entries(INCIDENT).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`id-${i.id}`}>Date</label>
                        <input id={`id-${i.id}`} name="occurredOn" type="date" required defaultValue={i.occurredOn} />
                      </div>
                      <div style={{ flex: "1 1 220px" }}>
                        <label htmlFor={`in-${i.id}`}>What happened</label>
                        <input id={`in-${i.id}`} name="note" required defaultValue={i.note} />
                      </div>
                      <ReasonField id={`ir-${i.id}`} />
                      <button type="submit" className="secondary">
                        Save
                      </button>
                    </form>
                    <form action={toggleIncident} className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="incidentId" value={i.id} />
                      <input type="hidden" name="deleted" value="1" />
                      <ReasonField id={`idel-${i.id}`} label="Why delete it?" placeholder="e.g. wrong batch" />
                      <button type="submit" className="danger">
                        Delete
                      </button>
                    </form>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={addIncident} className="row">
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="key" value={newKey()} />
          <div>
            <label htmlFor="inc-type">Type</label>
            <select id="inc-type" name="type" defaultValue="" required>
              <option value="">Choose…</option>
              {Object.entries(INCIDENT).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inc-date">Date</label>
            <input id="inc-date" name="occurredOn" type="date" required defaultValue={todayIso()} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <label htmlFor="inc-note">What happened</label>
            <input id="inc-note" name="note" required />
          </div>
          <button type="submit" className="secondary">
            Record incident
          </button>
        </form>
        <p className="small muted" style={{ marginTop: 8 }}>
          A note for the batch record. It doesn&apos;t change stock; record lost jars as a write-off in Stock.
        </p>
        {deletedIncidents.length > 0 && (
          <details className="small" style={{ marginTop: 12 }}>
            <summary>Deleted incidents · {deletedIncidents.length}</summary>
            <ul className="worklist">
              {deletedIncidents.map(({ i }) => (
                <li key={i.id}>
                  <span className="badge neutral">{INCIDENT[i.type] ?? i.type}</span>
                  <div className="what">
                    <span className="is-deleted">{i.note}</span>
                    <div className="sub">
                      Deleted {fmtWhen(i.deletedAt!)}
                      {i.deletedReason ? `: “${i.deletedReason}”` : ""}
                    </div>
                    <form action={toggleIncident} className="row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="incidentId" value={i.id} />
                      <input type="hidden" name="deleted" value="0" />
                      <ReasonField id={`ires-${i.id}`} label="Why restore it?" />
                      <button type="submit" className="secondary">
                        Restore
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
      <History of={{ type: "batch", id: batch.id }} />
    </>
  );
}
