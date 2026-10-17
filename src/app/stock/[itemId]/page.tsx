import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, type UnitCode } from "@/domain/quantity";
import Decimal from "decimal.js";
import { MOVEMENT } from "../../components/labels";

export const dynamic = "force-dynamic";

export default async function ItemStockPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const [item] = await db().select().from(t.items).where(eq(t.items.id, itemId));
  if (!item) notFound();
  const unit = item.stockUnit as UnitCode;
  const lots = await db()
    .select({ lot: t.lots, supplier: t.suppliers.name, balance: sql<string>`coalesce(sum(${t.movements.quantity}), 0)` })
    .from(t.lots)
    .leftJoin(t.suppliers, eq(t.lots.supplierId, t.suppliers.id))
    .leftJoin(t.movements, eq(t.movements.lotId, t.lots.id))
    .where(eq(t.lots.itemId, itemId))
    .groupBy(t.lots.id, t.suppliers.name)
    .orderBy(t.lots.receivedOn);
  const history = await db()
    .select({ m: t.movements, lot: t.lots.code })
    .from(t.movements)
    .innerJoin(t.lots, eq(t.movements.lotId, t.lots.id))
    .where(eq(t.movements.itemId, itemId))
    .orderBy(desc(t.movements.occurredAt), desc(t.movements.createdAt));

  return (
    <>
      <h1>{item.name}</h1>
      <p className="lead">Stock is kept in {formatQty(null, unit).replace("unknown ", "")}. Each delivery or count is its own lot, so you can see where every part came from.</p>
      <h2>Lots</h2>
      <div className="card scroll">
        {lots.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Received</th>
                <th>Supplier</th>
                <th>Delivery note</th>
                <th>Supplier batch</th>
                <th>Best before</th>
                <th className="num">Left</th>
              </tr>
            </thead>
            <tbody>
              {lots.map(({ lot, supplier, balance }) => (
                <tr key={lot.id}>
                  <td>{lot.code}</td>
                  <td>{lot.receivedOn ?? "—"}</td>
                  <td>{supplier ?? "—"}</td>
                  <td>{lot.deliveryRef ?? "—"}</td>
                  <td>{lot.supplierBatch ?? "—"}</td>
                  <td>{lot.bestBefore ?? "—"}</td>
                  <td className="num">{formatQty(new Decimal(balance), unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2>History</h2>
      <div className="card scroll">
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
                  {MOVEMENT[m.type] ?? m.type}
                  {m.reason && <div className="small muted">{m.reason}</div>}
                </td>
                <td>{lot}</td>
                <td className="num">{new Decimal(m.quantity).gt(0) ? "+" : ""}{formatQty(new Decimal(m.quantity), unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
