import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { inArray } from "drizzle-orm";
import * as t from "@/db/schema";
import { lotsByIds, traceForward } from "@/db/trace";
import { OUTFLOW } from "../../../components/labels";
import { BatchBackward } from "../../../components/trace-backward";
import { LotOrigin, batchCodes, jars, lotQty, who } from "../../../components/trace-format";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { ingredient: "Ingredient", packaging: "Packaging", finished: "Finished jars", bulk: "Bulk sauce" };

export default async function LotTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await traceForward(db(), id);
  if (!tr) notFound();
  const { lot, batches, jarLots, destinations, jarsInStock, jarsOut } = tr;
  const codes = await batchCodes([lot.batchId, ...jarLots.map((l) => l.batchId)]);
  const isMade = lot.itemKind === "finished" || lot.itemKind === "bulk";
  const affected = lot.itemKind === "finished" && lot.batchId ? [{ batchId: lot.batchId, code: codes.get(lot.batchId) ?? "batch" }] : batches;
  const inStock = jarLots.filter((l) => l.balance.gt(0));
  // Sauce from affected batches that hasn't been put in jars yet.
  const bulkIds = affected.length
    ? (await db().select({ id: t.productionBatches.bulkLotId }).from(t.productionBatches).where(inArray(t.productionBatches.id, affected.map((b) => b.batchId))))
        .map((r) => r.id)
        .filter((x): x is string => !!x && x !== lot.id)
    : [];
  const bulkLeft = (await lotsByIds(db(), bulkIds)).filter((l) => l.balance.gt(0));

  // Jars already out, grouped by where they went.
  const out = new Map<string, { type: string; who: string; jars: number }>();
  for (const d of destinations) {
    const named = who(d.customer, d.destination);
    const w = named === "—" ? "No destination recorded" : named;
    const k = `${d.type}|${w}`;
    out.set(k, { type: d.type, who: w, jars: (out.get(k)?.jars ?? 0) + d.jars });
  }
  const sorted = [...destinations].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.code.localeCompare(b.code)));

  return (
    <>
      <h1>Lot {lot.code}</h1>
      <p className="lead">
        {lot.itemName} · {KIND[lot.itemKind] ?? lot.itemKind}
      </p>

      <div className="card grid">
        <div>
          <div className="small muted">Where it came from</div>
          <LotOrigin lot={lot} batchCode={lot.batchId ? codes.get(lot.batchId) : null} />
        </div>
        <div>
          <div className="small muted">{isMade ? "Made / packed on" : "Received on"}</div>
          {lot.receivedOn ?? "not recorded"}
        </div>
        <div>
          <div className="small muted">Best before</div>
          {lot.bestBefore ?? "not recorded"}
        </div>
        <div>
          <div className="small muted">Still in stock</div>
          <strong>{lotQty(lot.balance, lot.unit, lot.itemKind)}</strong> <Link href={`/stock/${lot.itemId}`} className="small">stock of this item</Link>
        </div>
      </div>

      <h2>Recall summary</h2>
      <div className="card" style={{ borderColor: "var(--warn)" }}>
        <p className="small muted" style={{ marginTop: 0 }}>If this lot had a problem, this is everything it reached, from recorded production and outflows.</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Batches affected:</strong>{" "}
            {affected.length === 0
              ? lot.itemKind === "ingredient" || lot.itemKind === "packaging"
                ? "none — this lot hasn't been used in production."
                : "none recorded."
              : affected.map((b, i) => (
                  <span key={b.batchId}>
                    {i > 0 && ", "}
                    <Link href={`/batches/${b.batchId}`}>{b.code}</Link>
                  </span>
                ))}
          </li>
          {!isMade && lot.balance.gt(0) && (
            <li>
              <strong>Unused, still in stock:</strong> {lotQty(lot.balance, lot.unit, lot.itemKind)} of this lot.
            </li>
          )}
          <li>
            <strong>Jars still in stock:</strong> {jars(jarsInStock)}
            {inStock.length > 0 && (
              <>
                {" "}
                —{" "}
                {inStock.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ", "}
                    {l.balance.toString()} in <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                  </span>
                ))}
              </>
            )}
          </li>
          {bulkLeft.length > 0 && (
            <li>
              <strong>Sauce not yet in jars:</strong>{" "}
              {bulkLeft.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ", "}
                  {lotQty(l.balance, l.unit, l.itemKind)} in <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                </span>
              ))}
            </li>
          )}
          <li>
            <strong>Jars already out:</strong> {jars(jarsOut)}
            {out.size > 0 && (
              <ul style={{ paddingLeft: 20 }}>
                {[...out.values()].map((o) => (
                  <li key={`${o.type}|${o.who}`}>
                    {o.who}: {jars(o.jars)} <span className="small muted">({OUTFLOW[o.type] ?? o.type})</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
      </div>

      <h2>Forward: where it went</h2>
      {!isMade && (
        <div className="card scroll">
          <h3 style={{ marginTop: 0 }}>Batches that used this lot</h3>
          {batches.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Not used in any batch yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="num">Used from this lot</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batchId}>
                    <td>
                      <Link href={`/batches/${b.batchId}`}>{b.code}</Link>
                    </td>
                    <td className="num">{lotQty(b.quantity, lot.unit, lot.itemKind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {lot.itemKind !== "finished" && (
        <div className="card scroll">
          <h3 style={{ marginTop: 0 }}>Jar lots made</h3>
          {jarLots.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No jars packed from {lot.itemKind === "bulk" ? "this batch" : "these batches"} yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Jar lot</th>
                  <th>Product</th>
                  <th>Best before</th>
                  <th className="num">Jars still in stock</th>
                </tr>
              </thead>
              <tbody>
                {jarLots.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                    </td>
                    <td>{l.itemName}</td>
                    <td>{l.bestBefore ?? <span className="muted">not recorded</span>}</td>
                    <td className="num">{l.balance.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="card scroll">
        <h3 style={{ marginTop: 0 }}>Every destination</h3>
        {sorted.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No jars have left stock yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Customer / destination</th>
                <th>Reference</th>
                <th>Jar lot</th>
                <th className="num">Jars</th>
                <th>Outflow</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={`${d.outflowId}-${d.lotId}-${i}`}>
                  <td>{d.occurredOn}</td>
                  <td>{OUTFLOW[d.type] ?? d.type}</td>
                  <td>{who(d.customer, d.destination)}</td>
                  <td>{d.reference ?? "—"}</td>
                  <td>
                    {d.lotCode}
                    <div className="small muted">{d.productName}</div>
                  </td>
                  <td className="num">{d.jars}</td>
                  <td>
                    <Link href={`/trace/outflow/${d.outflowId}`}>{d.code}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isMade && lot.batchId && (
        <>
          <h2>Backward: what went into it</h2>
          <BatchBackward batchId={lot.batchId} />
        </>
      )}
      <p>
        <Link href="/trace">← New search</Link>
      </p>
    </>
  );
}
