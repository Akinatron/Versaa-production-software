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
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";
import { History } from "../../components/history";

export const dynamic = "force-dynamic";

export default async function ItemStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
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
            <td>{lot.receivedOn ? fmtDate(lot.receivedOn, { year: true }) : "—"}</td>
            <td>{lot.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : <span className="muted">not recorded</span>}</td>
            <td className="num">{q(balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHeader
        back={{
          href: item.kind === "finished" ? "/stock?show=jars" : item.kind === "packaging" ? "/stock?show=packaging" : "/stock",
          label: "Stock",
        }}
        title={item.name}
        actions={
          <>
            <Link href={`/stock/adjust?item=${item.id}`} className="btn secondary">
              Correct the count
            </Link>
            {item.kind !== "finished" ? (
              <Link href={`/stock/adjust?mode=writeoff&item=${item.id}`} className="btn secondary">
                Write off
              </Link>
            ) : (
              <Link href="/outbound/new" className="btn secondary">
                Record a stock exit
              </Link>
            )}
          </>
        }
      />
      <Flash params={flash} />
      <div className="stats">
        <div>
          <div className="v">{lots.length ? q(total) : "Not counted"}</div>
          <div className="l">in stock now</div>
        </div>
        <div>
          <div className="v">{withStock.length}</div>
          <div className="l">{withStock.length === 1 ? "lot" : "lots"} with stock</div>
        </div>
      </div>
      <h2>Lots with stock</h2>
      <div className="card scroll">
        {withStock.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing in stock.
          </p>
        ) : (
          lotTable(withStock)
        )}
      </div>
      {empty.length > 0 && (
        <details className="card scroll">
          <summary>Used-up lots ({empty.length})</summary>
          {lotTable(empty)}
        </details>
      )}
      <h2>Stock movements</h2>
      <div className="card scroll">
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing recorded yet.
          </p>
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
                  <td>
                    {fmtDate(m.occurredAt.toISOString().slice(0, 10), {
                      year: true,
                    })}
                  </td>
                  <td>
                    {m.docType && m.docId ? (
                      <Link href={`/history/open/${m.docType}/${m.docId}`}>{MOVEMENT[m.type] ?? m.type}</Link>
                    ) : (
                      (MOVEMENT[m.type] ?? m.type)
                    )}
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
      <History of={{ type: "item", id: itemId }} />
    </>
  );
}
