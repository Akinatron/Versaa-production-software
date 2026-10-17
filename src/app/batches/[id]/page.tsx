import { notFound } from "next/navigation";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { lotBalances } from "@/db/ledger";
import { formatQty, type UnitCode } from "@/domain/quantity";
import type { PlanResult } from "@/domain/planner";
import { Flash } from "../../components/flash";
import { BATCH_STATUS, INCIDENT } from "../../components/labels";
import { BatchPackRow } from "../../components/batch-pack-row";
import { addIncident, close, markNotMade, recordLine, recordOutput, recordPack, recordZero, undoLine, useStandardForPending } from "../actions";

export const dynamic = "force-dynamic";

const big = { fontSize: "1.1rem", padding: "12px" } as const;
const bigNum = { ...big, maxWidth: 160 } as const;
const bigBtn = { fontSize: "1.05rem", padding: "12px 22px" } as const;
const ghostBtn = { ...bigBtn, background: "var(--muted)" } as const;
const q = (v: Decimal | null, unit: string) => formatQty(v, unit as UnitCode);
const todayIso = () => new Date().toISOString().slice(0, 10);

const SOURCE: Record<string, string> = { observed: "observed average", estimate: "estimate", missing: "unknown" };

// Narrow screens: the ingredient table turns into one card per ingredient.
const css = `
.bl td[data-label]::before { content: none; }
@media (max-width: 700px) {
  .bl thead { display: none; }
  .bl, .bl tbody, .bl tr, .bl td { display: block; width: 100%; }
  .bl tr.line { border-top: 2px solid var(--border); padding-top: 8px; }
  .bl td { border: 0; padding: 4px 0; }
  .bl td.num { text-align: left; white-space: normal; }
  .bl td[data-label]::before { content: attr(data-label) ": "; color: var(--muted); font-size: 0.85rem; }
  .bl tr.form td { padding-bottom: 16px; }
}`;

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const tr = await traceBatch(db(), id).catch(() => null);
  if (!tr) notFound();
  const { batch, run, sauce, recipe } = tr;
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, cls: "" };
  const open = batch.status !== "closed" && batch.status !== "cancelled";

  const pending = tr.ingredientUse.filter((l) => l.actual === null);
  const recorded = tr.ingredientUse.filter((l) => l.actual !== null);
  const lots = await db().transaction((tx) => lotBalances(tx, pending.map((p) => p.itemId)));
  const lotsFor = (itemId: string) => lots.filter((l) => l.itemId === itemId);

  const onBatch = new Set(tr.ingredientUse.map((l) => l.itemId));
  const ingredients = (
    await db().select().from(t.items).where(and(eq(t.items.kind, "ingredient"), eq(t.items.active, true))).orderBy(asc(t.items.name))
  ).filter((i) => !onBatch.has(i.id));

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

  const materials = tr.materials.filter((m) => m.lot.itemKind !== "bulk");
  const bulkLeft = tr.bulk ? tr.bulk.balance : null;
  const hasOutput = batch.outputLitres !== null || batch.outputKg !== null;
  const packDates = [...new Set(tr.sessions.map((s) => s.packedOn))];
  const nothingRecorded = recorded.length === 0 && tr.sessions.length === 0 && !batch.bulkLotId;

  const next =
    batch.status === "cancelled"
      ? "This batch was marked as not made. Nothing more to do."
      : batch.status === "closed"
        ? "Done: this batch is closed."
        : pending.length > 0
          ? `Next: record the ingredients used (${pending.length} still pending).`
          : !hasOutput
            ? "Next: measure the output."
            : tr.sessions.length === 0
              ? "Next: pack the jars."
              : "Next: pack more jars if there's sauce left, or close the batch.";

  const at = flash.at;
  const flashHere = (section: string) => (at === section ? <Flash params={flash} /> : null);
  const newKey = () => crypto.randomUUID();

  return (
    <>
      <style>{css}</style>
      <h1>
        {batch.code} <span className={`badge ${status.cls}`}>{status.label}</span>
      </h1>
      <p className="lead" style={{ marginBottom: 8 }}>
        {sauce.name} · recipe version {recipe.versionNo} · run <a href={`/runs/${run.id}`}>{run.code}</a> (planned for {run.plannedFor})
      </p>
      <p className="small muted" style={{ margin: "0 0 12px" }}>
        Production date: {batch.producedOn ?? "not recorded yet"} · Packaging dates: {packDates.length ? packDates.join(", ") : "not packed yet"}
      </p>
      <ul className="issues">
        <li className={open ? "warn" : "ok"} style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {next}
        </li>
      </ul>
      {!at && <Flash params={flash} />}

      {/* ------------------------------------------------ ingredients */}
      <h2 id="ingredients">1. Ingredients used</h2>
      <p className="small muted">
        Standard is the recipe quantity for one batch (version {recipe.versionNo}). Record what was actually used; it is taken from stock straight away. A line stays
        &quot;pending&quot; until it is recorded. If none was used, press &quot;None used (0)&quot;, which is not the same as pending.
      </p>
      {flashHere("ingredients")}
      <div className="card">
        <table className="bl">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Standard (recipe)</th>
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th>Lots used</th>
            </tr>
          </thead>
          <tbody>
            {tr.ingredientUse.map((l) => (
              <IngredientRows key={l.itemId} line={l} batchId={batch.id} open={open} lots={lotsFor(l.itemId)} newKey={newKey} />
            ))}
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
      {open && pending.some((p) => !p.extra) && (
        <form action={useStandardForPending} className="card">
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="key" value={newKey()} />
          <strong>Shortcut: use standard quantities for all pending</strong>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Records each of the {pending.filter((p) => !p.extra).length} pending lines as <strong>actually used</strong> at its standard recipe quantity, taken from the
            lots with the earliest best-before first. Only use it if that is what really went into the pot. You can undo a line afterwards.
          </p>
          <button type="submit" style={ghostBtn}>
            Record all pending at standard quantity
          </button>
        </form>
      )}
      {open && ingredients.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Add an ingredient that isn&apos;t in the recipe</summary>
          <form action={recordLine} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="key" value={newKey()} />
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="extra-item">Ingredient (required)</label>
              <select id="extra-item" name="itemId" defaultValue="" required style={big}>
                <option value="">Choose…</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.stockUnit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="extra-qty">Quantity used, in the unit shown (required)</label>
              <input id="extra-qty" name="quantity" inputMode="decimal" required style={bigNum} />
            </div>
            <button type="submit" style={bigBtn}>
              Save extra ingredient
            </button>
            <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
              Taken from stock, earliest best-before first. It shows in the table as an extra.
            </p>
          </form>
        </details>
      )}

      {/* ------------------------------------------------ output */}
      <h2 id="output">2. Output</h2>
      <p className="small muted">
        Measure what the batch produced. <strong>Litres</strong> become the bulk sauce that packaging draws from. <strong>Kilograms</strong> are kept for reference
        only; kg and litres are never converted into each other (30 kg is not assumed to be 30 L). Enter at least one.
      </p>
      {flashHere("output")}
      <div className="card">
        <div className="grid" style={{ marginBottom: 12 }}>
          <Stat label="Measured litres" value={batch.outputLitres !== null ? q(new Decimal(batch.outputLitres), "L") : "not measured"} />
          <Stat label="Measured kg (reference)" value={batch.outputKg !== null ? q(new Decimal(batch.outputKg), "kg") : "not measured"} />
          <Stat
            label="Bulk sauce left to pack"
            value={bulkLeft ? q(bulkLeft, "L") : batch.outputLitres === null ? "none (no litres measured)" : q(new Decimal(0), "L")}
          />
        </div>
        {open && (
          <form action={recordOutput}>
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="key" value={newKey()} />
            <div className="row">
              <div>
                <label htmlFor="producedOn">Production date (required)</label>
                <input id="producedOn" name="producedOn" type="date" required defaultValue={batch.producedOn ?? todayIso()} style={big} />
              </div>
              <div>
                <label htmlFor="litres">Measured litres (L)</label>
                <input id="litres" name="litres" inputMode="decimal" defaultValue={batch.outputLitres ?? ""} style={bigNum} />
              </div>
              <div>
                <label htmlFor="kg">Measured kg</label>
                <input id="kg" name="kg" inputMode="decimal" defaultValue={batch.outputKg ?? ""} style={bigNum} />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <label htmlFor="out-note">Note (optional)</label>
                <input id="out-note" name="note" defaultValue={batch.note ?? ""} style={big} />
              </div>
            </div>
            <p className="small muted">
              {hasOutput
                ? "Saving again corrects the measured figure (the change is kept in the stock history). It can't be less than what has already been packed."
                : "Saving creates the bulk sauce lot for this batch."}
            </p>
            <button type="submit" style={bigBtn}>
              {hasOutput ? "Correct measured output" : "Save measured output"}
            </button>
          </form>
        )}
      </div>

      {/* ------------------------------------------------ packaging */}
      <h2 id="packaging">3. Packaging</h2>
      <p className="small muted">
        Record each packaging session. Packaging materials (jars, lids, labels) are used for <strong>every filled jar</strong>, rejects included. Only{" "}
        <strong>accepted</strong> jars (filled − rejected) go into stock. The litres in the filled jars are taken from the bulk sauce.
      </p>
      {flashHere("packaging")}
      {open && (
        <form action={recordPack} className="card">
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="key" value={newKey()} />
          <div className="row" style={{ marginBottom: 12 }}>
            <div>
              <label htmlFor="packedOn">Packaging date (required)</label>
              <input id="packedOn" name="packedOn" type="date" required defaultValue={todayIso()} style={big} />
            </div>
            <div>
              <label htmlFor="bestBefore">Best-before (optional)</label>
              <input id="bestBefore" name="bestBefore" type="date" style={big} />
            </div>
            <p className="small muted" style={{ flex: "1 1 220px", margin: 0 }}>
              Best-before: only if you have one. It is never guessed; leave it empty if unknown.
            </p>
          </div>
          {products.length === 0 && <p className="muted">No active jar sizes for {sauce.name}.</p>}
          {products.map(({ product, format }, i) => (
            <BatchPackRow key={product.id} index={i} productId={product.id} name={product.name} fillMl={format.fillMl} />
          ))}
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="pack-note">Note (optional)</label>
            <input id="pack-note" name="note" style={big} />
          </div>
          <p className="small muted">Leave a size empty if it wasn&apos;t packed in this session.</p>
          <button type="submit" style={bigBtn}>
            Save packaging session
          </button>
        </form>
      )}
      <div className="card scroll">
        <strong>Totals per size</strong>
        {tr.jarsBySize.length === 0 ? (
          <p className="muted">Nothing packed yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Size</th>
                <th className="num">Filled</th>
                <th className="num">Rejected</th>
                <th className="num">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {tr.jarsBySize.map((s) => (
                <tr key={s.productId}>
                  <td>{s.name}</td>
                  <td className="num">{s.filled}</td>
                  <td className="num">{s.rejected}</td>
                  <td className="num">{s.accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tr.sessions.length > 0 && (
        <div className="card scroll">
          <strong>Packaging sessions</strong>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Size</th>
                <th className="num">Filled</th>
                <th className="num">Rejected</th>
                <th className="num">Accepted</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {tr.sessions.flatMap((s) =>
                s.lines.map(({ line, product }, i) => (
                  <tr key={line.id}>
                    <td>{i === 0 ? s.packedOn : ""}</td>
                    <td>{product.name}</td>
                    <td className="num">{line.filled}</td>
                    <td className="num">{line.rejected}</td>
                    <td className="num">{line.accepted}</td>
                    <td className="small">{i === 0 ? (s.note ?? "") : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {tr.jarLots.length > 0 && (
        <div className="card scroll">
          <strong>Finished lots from this batch</strong>
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Product</th>
                <th>Best before</th>
                <th className="num">Jars in stock</th>
              </tr>
            </thead>
            <tbody>
              {tr.jarLots.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a href={`/stock/${l.itemId}`}>{l.code}</a>
                  </td>
                  <td>{l.itemName}</td>
                  <td>{l.bestBefore ?? "not recorded"}</td>
                  <td className="num">{l.balance.toString()} jars</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>4. Packaging materials used</h2>
      <div className="card scroll">
        {materials.length === 0 ? (
          <p className="muted">None yet. They are taken from stock when a packaging session is recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Lot</th>
                <th className="num">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.lot.id}>
                  <td>{m.lot.itemName}</td>
                  <td>
                    <a href={`/stock/${m.lot.itemId}`}>{m.lot.code}</a>
                    {m.lot.supplierBatch ? <span className="small muted"> · supplier batch {m.lot.supplierBatch}</span> : null}
                  </td>
                  <td className="num">{q(m.quantity, m.lot.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ------------------------------------------------ incidents */}
      <h2 id="incidents">5. Incidents</h2>
      {flashHere("incidents")}
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
            This is a note for the batch record. It doesn&apos;t change stock; record lost jars or sauce as a write-off in Stock.
          </p>
        </form>
      </div>

      {/* ------------------------------------------------ close */}
      <h2>6. Close the batch</h2>
      <div className="card">
        {!open ? (
          <p style={{ margin: 0 }}>
            {batch.status === "closed" ? "Closed" : "Marked as not made"}
            {batch.closedAt ? ` on ${batch.closedAt.toISOString().slice(0, 10)}` : ""}.{batch.status === "cancelled" && batch.note ? ` Reason: ${batch.note}` : ""}
          </p>
        ) : (
          <>
            {pending.length > 0 ? (
              <ul className="issues">
                <li className="bad">
                  Can&apos;t close yet. Still pending: {pending.map((p) => p.name).join(", ")}. Record what was used (0 if none) first.
                </li>
              </ul>
            ) : null}
            <form action={close}>
              <input type="hidden" name="batchId" value={batch.id} />
              <input type="hidden" name="key" value={newKey()} />
              {bulkLeft && bulkLeft.gt(0) ? (
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="leftover">
                    {q(bulkLeft, "L")} of bulk sauce is left. What happened to it? (required; it is written off as waste with this reason)
                  </label>
                  <input id="leftover" name="leftoverReason" required style={big} placeholder="e.g. stuck to the pot, tasted, thrown away" />
                </div>
              ) : (
                <p className="small muted">No bulk sauce is left to account for.</p>
              )}
              <p className="small muted">
                Closing locks the batch record.{" "}
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
                    Only possible while nothing is recorded for this batch. Its stock reservations stay with the run until the run closes.
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
        <strong>Ingredients</strong>
        <table>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Standard</th>
              <th className="num">Actual</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {tr.ingredientUse.map((l) => {
              const diff = l.actual && !l.extra ? l.actual.minus(l.standard) : null;
              return (
                <tr key={l.itemId}>
                  <td>
                    {l.name}
                    {l.extra ? <span className="small muted"> (extra)</span> : null}
                  </td>
                  <td className="num">{l.extra ? "not in recipe" : q(l.standard, l.unit)}</td>
                  <td className="num">{l.actual ? q(l.actual, l.unit) : <span className="badge warn">pending</span>}</td>
                  <td className="num">{diff ? `${diff.gt(0) ? "+" : ""}${q(diff, l.unit)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <strong>Litres</strong>
        <table>
          <tbody>
            <tr>
              <td>Forecast litres per batch ({yieldLabel})</td>
              <td className="num">{perBatch ? q(perBatch, "L") : "unknown"}</td>
            </tr>
            <tr>
              <td>Measured output</td>
              <td className="num">{batch.outputLitres !== null ? q(new Decimal(batch.outputLitres), "L") : "not measured"}</td>
            </tr>
            <tr>
              <td>Filled into jars (all filled jars)</td>
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
            {batch.outputKg !== null && (
              <tr>
                <td>Measured kg (reference, not compared with litres)</td>
                <td className="num">{q(new Decimal(batch.outputKg), "kg")}</td>
              </tr>
            )}
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
          The run target is for the whole run; see the <a href={`/runs/${run.id}`}>run page</a> for totals across its batches.
        </p>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

type Line = NonNullable<Awaited<ReturnType<typeof traceBatch>>>["ingredientUse"][number];
type LotRow = Awaited<ReturnType<typeof lotBalances>>[number];

function IngredientRows({ line: l, batchId, open, lots, newKey }: { line: Line; batchId: string; open: boolean; lots: LotRow[]; newKey: () => string }) {
  const unit = l.unit;
  return (
    <>
      <tr className="line">
        <td>
          <strong>{l.name}</strong>
          {l.extra ? <span className="small muted"> (extra, not in recipe)</span> : null}
        </td>
        <td className="num" data-label="Standard">
          {l.extra ? "—" : q(l.standard, unit)}
        </td>
        <td className="num" data-label="Planned">
          {l.extra ? "—" : q(l.planned, unit)}
        </td>
        <td className="num" data-label="Actual">
          {l.actual === null ? <span className="badge warn">pending</span> : l.actual.isZero() ? `${q(l.actual, unit)} (none used)` : q(l.actual, unit)}
        </td>
        <td data-label="Lots used">
          {l.sources.length === 0
            ? "—"
            : l.sources.map((s) => (
                <div key={s.lot.id} className="small">
                  <a href={`/stock/${s.lot.itemId}`}>{s.lot.code}</a>
                  {s.lot.supplierBatch ? ` · supplier batch ${s.lot.supplierBatch}` : ""} · {q(s.quantity, unit)}
                </div>
              ))}
        </td>
      </tr>
      {open && (
        <tr className="form">
          <td colSpan={5} style={{ background: l.actual === null ? "var(--warn-bg)" : undefined }}>
            {l.actual === null ? (
              <div className="row">
                <form action={recordLine} className="row" style={{ flex: "1 1 auto" }}>
                  <input type="hidden" name="batchId" value={batchId} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="name" value={l.name} />
                  <input type="hidden" name="key" value={newKey()} />
                  <div>
                    <label htmlFor={`qty-${l.itemId}`}>Quantity used ({unit}){l.extra ? "" : `, standard ${l.standard.toString()}`}</label>
                    <input
                      id={`qty-${l.itemId}`}
                      name="quantity"
                      inputMode="decimal"
                      required
                      placeholder={l.extra ? "" : l.standard.toString()}
                      style={{ ...bigNum }}
                    />
                  </div>
                  <div style={{ flex: "1 1 240px" }}>
                    <label htmlFor={`lot-${l.itemId}`}>Lot (optional)</label>
                    <select id={`lot-${l.itemId}`} name="lotId" defaultValue="" style={big}>
                      <option value="">Earliest best-before first (automatic)</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.code}
                          {lot.supplierBatch ? ` · ${lot.supplierBatch}` : ""} · BB {lot.bestBefore ?? "none"} · {q(lot.balance, unit)} left
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" style={bigBtn}>
                    Save
                  </button>
                </form>
                <form action={recordZero}>
                  <input type="hidden" name="batchId" value={batchId} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="name" value={l.name} />
                  <input type="hidden" name="key" value={newKey()} />
                  <button type="submit" style={ghostBtn}>
                    None used (0)
                  </button>
                </form>
                {lots.length === 0 && <p className="small bad" style={{ flexBasis: "100%", margin: 0, padding: 6, borderRadius: 6 }}>No stock of {l.name} is left in any lot.</p>}
              </div>
            ) : (
              <details>
                <summary className="small" style={{ cursor: "pointer" }}>
                  Undo this line…
                </summary>
                <form action={undoLine} className="row" style={{ marginTop: 8 }}>
                  <input type="hidden" name="batchId" value={batchId} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="name" value={l.name} />
                  <input type="hidden" name="key" value={newKey()} />
                  <div style={{ flex: "1 1 240px" }}>
                    <label htmlFor={`undo-${l.itemId}`}>Why? (required)</label>
                    <input id={`undo-${l.itemId}`} name="reason" required style={big} placeholder="e.g. wrong quantity typed" />
                  </div>
                  <button type="submit" style={ghostBtn}>
                    Undo
                  </button>
                  <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                    Puts the stock back into its lots and makes the line pending again, so you can record it correctly.
                  </p>
                </form>
              </details>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
