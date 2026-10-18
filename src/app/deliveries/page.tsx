import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../components/flash";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const receipts = await db()
    .select({ r: t.receipts, supplier: t.suppliers.name })
    .from(t.receipts)
    .leftJoin(t.suppliers, eq(t.receipts.supplierId, t.suppliers.id))
    .orderBy(desc(t.receipts.receivedOn), desc(t.receipts.createdAt));
  const lines = await db()
    .select({ line: t.receiptLines, item: t.items, lot: t.lots })
    .from(t.receiptLines)
    .innerJoin(t.items, eq(t.receiptLines.itemId, t.items.id))
    .leftJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id));

  return (
    <>
      <h1>Deliveries</h1>
      <p className="lead">What actually arrived. Each line becomes a lot with its origin, so it can be traced into production.</p>
      <Flash params={params} />
      <p>
        <Link href="/deliveries/new">+ Record a delivery</Link>
      </p>
      {receipts.length === 0 && <p className="card muted">No deliveries recorded yet.</p>}
      {receipts.map(({ r, supplier }) => (
        <div key={r.id} className="card scroll">
          <strong>
            {r.receivedOn}
            {r.receivedTime && ` ${r.receivedTime}`}
          </strong>{" "}
          · {supplier ?? "No supplier"}
          {r.deliveryRef && <span className="muted"> · delivery note {r.deliveryRef}</span>}
          {r.note && <div className="small muted">{r.note}</div>}
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Accepted</th>
                <th className="num">Refused</th>
                <th>Damage</th>
                <th>Lot</th>
                <th>Supplier batch</th>
                <th>Best before</th>
              </tr>
            </thead>
            <tbody>
              {lines
                .filter((l) => l.line.receiptId === r.id)
                .map(({ line, item, lot }) => (
                  <tr key={line.id}>
                    <td>
                      <Link href={`/stock/${item.id}`}>{item.name}</Link>
                    </td>
                    <td className="num">{formatQty(new Decimal(line.quantity), item.stockUnit as UnitCode)}</td>
                    <td className="num">{new Decimal(line.rejectedQty).gt(0) ? formatQty(new Decimal(line.rejectedQty), item.stockUnit as UnitCode) : "—"}</td>
                    <td className="small">{line.damageNote ?? "—"}</td>
                    <td>{lot ? <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link> : <span className="muted">none</span>}</td>
                    <td>{lot?.supplierBatch ?? "—"}</td>
                    <td>{lot?.bestBefore ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
