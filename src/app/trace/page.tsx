import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { findByCode, searchLots } from "@/db/trace";
import { LotOrigin, batchCodes, lotQty } from "../components/trace-format";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { ingredient: "Ingredient", packaging: "Packaging", finished: "Finished jars", bulk: "Bulk sauce" };

export default async function TracePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  if (q) {
    const hit = await findByCode(db(), q);
    if (hit?.kind === "lot") redirect(`/trace/lot/${hit.id}`);
    if (hit?.kind === "batch") redirect(`/batches/${hit.id}`);
    if (hit?.kind === "outflow") redirect(`/trace/outflow/${hit.id}`);
    const [so] = await db().select({ id: t.salesOrders.id }).from(t.salesOrders).where(sql`upper(${t.salesOrders.code}) = upper(${q})`);
    if (so) redirect(`/sales/${so.id}`);
  }
  const lots = q ? await searchLots(db(), q) : [];
  const codes = await batchCodes(lots.map((l) => l.batchId));

  return (
    <>
      <h1>Trace</h1>
      <p className="lead">
        Forward: start from an ingredient or packaging lot to see which batches used it and where those jars went (for a recall). Backward:
        start from jars or a delivery to a customer to see which batch they came from and which ingredient lots and suppliers went into it.
      </p>
      <form method="get" className="card row">
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="q">Code or search text</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="e.g. RCV-20261010-001, KIP-20261012-01, OUT-20261017-001, ON-42, onions" autoFocus />
          <div className="small muted">
            An exact code (lot, batch, delivery out, sales order) opens it directly. Anything else searches lots by code, supplier batch, delivery
            note number or item name.
          </div>
        </div>
        <button type="submit">Search</button>
      </form>

      {q && (
        <>
          <h2>Lots matching “{q}”</h2>
          <div className="card scroll">
            {lots.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing found. Check the code, or try part of it (e.g. the supplier batch number).</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Item</th>
                    <th>Where it came from</th>
                    <th>Received / made</th>
                    <th>Best before</th>
                    <th className="num">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                      </td>
                      <td>
                        {l.itemName}
                        <div className="small muted">{KIND[l.itemKind] ?? l.itemKind}</div>
                      </td>
                      <td className="small">
                        <LotOrigin lot={l} batchCode={l.batchId ? codes.get(l.batchId) : null} />
                      </td>
                      <td>{l.receivedOn ?? "—"}</td>
                      <td>{l.bestBefore ?? <span className="muted">not recorded</span>}</td>
                      <td className="num">{lotQty(l.balance, l.unit, l.itemKind)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lots.length === 50 && <p className="small muted">Showing the 50 newest matches. Type more of the code to narrow it down.</p>}
          </div>
        </>
      )}
    </>
  );
}
