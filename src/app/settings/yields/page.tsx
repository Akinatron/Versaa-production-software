import { desc } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog } from "@/db/planning";
import { observedRejects, observedYields } from "@/db/history";
import { formatQty } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { fmtDate } from "../../components/settings-versions";
import { addRejectEstimate, addYieldEstimate } from "../actions";
import { PageHeader } from "../../components/ui/header";

export const dynamic = "force-dynamic";

const L = (v: Decimal | null) => formatQty(v, "L");
const pct = (v: Decimal) => `${v.mul(100).toDecimalPlaces(2).toString()}%`;

export default async function YieldsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [catalog, yields, rejects, yieldRows, rejectRows] = await Promise.all([
    loadPlanCatalog(db()),
    observedYields(db()),
    observedRejects(db()),
    db().select().from(t.yieldFigures).orderBy(desc(t.yieldFigures.createdAt)),
    db().select().from(t.rejectFigures).orderBy(desc(t.rejectFigures.createdAt)),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Yields & rejects"
        lead={
          <>
            The figures the planner uses to turn jars into batches. As soon as a batch is closed with its packaging recorded, the measured average replaces any
            estimate automatically. Estimates are only used until then, and are always labelled as estimates.
          </>
        }
      />
      <Flash params={sp} />

      <h2>Litres per batch</h2>
      <p className="small muted">
        Litres of filled product one batch gives (jars filled × fill per jar, rejected jars included). Kilograms are never converted into litres.
      </p>
      {catalog.sauces.map((s) => {
        const seen = yields.get(s.id);
        const entered = yieldRows.filter((y) => y.sauceId === s.id);
        return (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong>{s.name}</strong>
              <span>
                Planner uses: <strong>{s.yield.litresPerBatch ? L(s.yield.litresPerBatch) : "unknown"}</strong>{" "}
                {s.yield.source === "observed" ? (
                  <span className="badge ok">measured</span>
                ) : s.yield.source === "estimate" ? (
                  <span className="badge warn">estimate</span>
                ) : (
                  <span className="badge bad">missing</span>
                )}
              </span>
            </div>
            {s.yield.note && (
              <p className="small muted" style={{ margin: "4px 0 0" }}>
                {s.yield.source === "estimate" ? `Estimate note: ${s.yield.note}` : s.yield.note}
              </p>
            )}
            {s.yield.source === "missing" && (
              <p className="small" style={{ margin: "4px 0 0" }}>
                No batch recorded and no estimate: plans for {s.name} can't calculate batches. Enter an estimate below.
              </p>
            )}

            <div className="grid" style={{ marginTop: 12 }}>
              <div>
                <div className="small muted">From recorded batches (measured)</div>
                {seen ? (
                  <table>
                    <tbody>
                      <tr>
                        <td>Closed batches</td>
                        <td className="num">{seen.batches}</td>
                      </tr>
                      <tr>
                        <td>Filled per batch: average</td>
                        <td className="num">{L(seen.avgFilledLitres)}</td>
                      </tr>
                      <tr>
                        <td>Lowest – highest</td>
                        <td className="num">
                          {L(seen.minFilledLitres)} – {L(seen.maxFilledLitres)}
                        </td>
                      </tr>
                      <tr>
                        <td>Sellable (accepted jars) average</td>
                        <td className="num">{L(seen.avgSellableLitres)}</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <p className="small">No closed batch with packaging recorded yet.</p>
                )}
              </div>
              <div>
                <div className="small muted">Estimates entered (newest first, never overwritten)</div>
                {entered.length === 0 ? (
                  <p className="small">None.</p>
                ) : (
                  <table>
                    <tbody>
                      {entered.map((y) => (
                        <tr key={y.id}>
                          <td>{fmtDate(y.createdAt)}</td>
                          <td className="num">{L(new Decimal(y.litresPerBatch))}</td>
                          <td className="small">
                            {y.source === "observed" ? "measured" : "estimate"}
                            {y.note && ` · ${y.note}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <form action={addYieldEstimate}>
                <input type="hidden" name="sauceId" value={s.id} />
                <input type="hidden" name="back" value="/settings/yields" />
                <label htmlFor={`l-${s.id}`}>New estimate, litres per batch (required)</label>
                <input id={`l-${s.id}`} name="litresPerBatch" type="number" min="0.1" step="0.1" required />
                <label htmlFor={`n-${s.id}`} style={{ marginTop: 8 }}>
                  Why this figure (optional)
                </label>
                <input id={`n-${s.id}`} name="note" type="text" />
                <div style={{ marginTop: 8 }}>
                  <button type="submit">Save estimate</button>
                </div>
                {seen && (
                  <p className="small muted">
                    Measured batches exist, so the planner keeps using the measured average; an estimate is kept for reference only.
                  </p>
                )}
              </form>
            </div>
          </div>
        );
      })}

      <h2>Reject rate per product</h2>
      <p className="small muted">
        Share of filled jars rejected at packaging. The plan fills extra jars so the sellable target is still met. Unknown means no extra jars are planned.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Planner uses</th>
              <th>Recorded packaging</th>
              <th>Last estimate</th>
              <th>New estimate (%)</th>
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => {
              const seen = rejects.get(p.id);
              const est = rejectRows.find((r) => r.productId === p.id);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.reject.rate ? pct(p.reject.rate) : "unknown"}{" "}
                    <span className={`badge ${p.reject.source === "observed" ? "ok" : p.reject.source === "estimate" ? "warn" : "bad"}`}>
                      {p.reject.source === "observed" ? "measured" : p.reject.source === "estimate" ? "estimate" : "unknown"}
                    </span>
                  </td>
                  <td className="small">
                    {seen ? (
                      `${seen.rejected} rejected of ${seen.filled} filled (${seen.sessions} session${seen.sessions === 1 ? "" : "s"})`
                    ) : (
                      <span className="muted">none yet</span>
                    )}
                  </td>
                  <td className="small">{est ? `${pct(new Decimal(est.rate))} · ${fmtDate(est.createdAt)}` : <span className="muted">—</span>}</td>
                  <td>
                    <form
                      action={addRejectEstimate}
                      className="row"
                      style={{
                        alignItems: "center",
                        flexWrap: "nowrap",
                        gap: 6,
                      }}
                    >
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="back" value="/settings/yields" />
                      <input name="percent" type="number" min="0" max="99" step="0.1" required aria-label={`Reject % for ${p.name}`} />
                      <button type="submit" style={{ padding: "6px 12px" }}>
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
