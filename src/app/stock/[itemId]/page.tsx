import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { UNITS, type UnitCode } from "@/domain/quantity";
import Decimal from "decimal.js";
import { Flash } from "../../components/flash";
import { MOVEMENT } from "../../components/labels";
import { LotOrigin, lotQty } from "../../components/trace-format";

export const dynamic = "force-dynamic";

export default async function ItemStockPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { itemId } = await params;
  const flash = await searchParams;
  const [item] = await db().select().from(t.items).where(eq(t.items.id, itemId));
  if (!item) notFound();
  const unit = item.stockUnit as UnitCode;
  const q = (v: Decimal.Value) => lotQty(v, unit, item.kind);
  const lots = await db()
    .select({
      lot: t.lots,
      supplier: t.suppliers.name,
      batchCode: t.productionBatches.code,
      balance: sql<string>`coalesce((select sum(m.quantity) from movements m where m.lot_id = ${t.lots.id}), 0)`,
    })
    .from(t.lots)
    .leftJoin(t.suppliers, eq(t.lots.supplierId, t.suppliers.id))
    .leftJoin(t.productionBatches, eq(t.lots.batchId, t.productionBatches.id))
    .where(eq(t.lots.itemId, itemId))
    .orderBy(t.lots.receivedOn, t.lots.createdAt);
  const history = await db()
    .select({ m: t.movements, lot: t.lots.code })
    .from(t.movements)
    .innerJoin(t.lots, eq(t.movements.lotId, t.lots.id))
    .where(eq(t.movements.itemId, itemId))
    .orderBy(desc(t.movements.occurredAt), desc(t.movements.createdAt));
  const withStock = lots.filter((l) => new Decimal(l.balance).gt(0));
  const empty = lots.filter((l) => !new Decimal(l.balance).gt(0));
  const total = lots.reduce((s, l) => s.plus(l.balance), new Decimal(0));
  const unitWord = item.kind === "finished" ? "jars" : UNITS[unit].label;

  const lotTable = (list: typeof lots) => (
    <table>
      <thead>
        <tr>
          <th>Lot</th>
          <th>Where it came from</th>
          <th>{item.kind === "finished" || item.kind === "bulk" ? "Made / packed" : "Received"}</th>
          <th>Best before</th>
          <th className="num">Left</th>
        </tr>
      </thead>
      <tbody>
        {list.map(({ lot, supplier, batchCode, balance }) => (
          <tr key={lot.id}>
            <td>
              <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link>
            </td>
            <td>
              <LotOrigin lot={{ ...lot, supplierName: supplier }} batchCode={batchCode} />
            </td>
            <td>{lot.receivedOn ?? "—"}</td>
            <td>{lot.bestBefore ?? <span className="muted">not recorded</span>}</td>
            <td className="num">{q(balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <h1>{item.name}</h1>
      <p className="lead">
        Stock is kept in {unitWord}. Each delivery, count or batch is its own lot, so you can see where every part came from. Click a lot to trace
        where it went.
      </p>
      <Flash params={flash} />
      <div className="card row">
        <span>
          In stock now: <strong>{lots.length ? q(total) : "not counted yet"}</strong>
        </span>
        <Link href={`/stock/adjust?item=${item.id}`}>Correct the count</Link>
        {item.kind !== "finished" ? (
          <Link href={`/stock/adjust?mode=writeoff&item=${item.id}`}>Write some off</Link>
        ) : (
          <Link href="/outbound/new">Record jars leaving stock (Outbound)</Link>
        )}
      </div>
      <h2>Lots with stock</h2>
      <div className="card scroll">{withStock.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing in stock.</p> : lotTable(withStock)}</div>
      {empty.length > 0 && (
        <details className="card scroll">
          <summary>Used-up lots ({empty.length})</summary>
          {lotTable(empty)}
        </details>
      )}
      <h2>History</h2>
      <div className="card scroll">
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>What happened</th>
                <th>Lot</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ m, lot }) => (
                <tr key={m.id}>
                  <td>{m.occurredAt.toISOString().slice(0, 10)}</td>
                  <td>
                    {m.docType === "outflow" && m.docId ? <Link href={`/trace/outflow/${m.docId}`}>{MOVEMENT[m.type] ?? m.type}</Link> : (MOVEMENT[m.type] ?? m.type)}
                    {m.reason && <div className="small muted">{m.reason}</div>}
                  </td>
                  <td>
                    <Link href={`/trace/lot/${m.lotId}`}>{lot}</Link>
                  </td>
                  <td className="num">
                    {new Decimal(m.quantity).gt(0) ? "+" : ""}
                    {q(m.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p>
        <Link href="/stock">← Back to stock</Link>
      </p>
    </>
  );
}
