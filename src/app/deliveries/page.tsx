import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../components/flash";
import { PageHeader, Empty } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";

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
      <PageHeader
        title="Deliveries"
        actions={
          <Link href="/deliveries/new" className="btn">
            Record a delivery
          </Link>
        }
      />
      <Flash params={params} />
      {receipts.length === 0 && (
        <Empty title="No deliveries yet">
          <p>When goods arrive, record them here. Stock goes up and each line becomes a traceable lot.</p>
        </Empty>
      )}
      {receipts.map(({ r, supplier }) => (
        <section key={r.id} className="card scroll">
          <div className="card-head">
            <h2>
              {supplier ?? "No supplier"}
              <span className="muted small" style={{ fontWeight: 400 }}>
                {" "}
                {fmtDate(r.receivedOn, { weekday: true })}
                {r.receivedTime && ` ${r.receivedTime.slice(0, 5)}`}
                {r.deliveryRef && ` · note ${r.deliveryRef}`}
              </span>
            </h2>
          </div>
          {r.note && <p className="small muted">{r.note}</p>}
          <table>
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
                    <td>{lot?.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
