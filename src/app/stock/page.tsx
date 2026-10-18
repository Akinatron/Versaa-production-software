import Link from "next/link";
import { db } from "@/db/client";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { formatQty } from "@/domain/quantity";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../components/flash";
import { jars } from "../components/trace-format";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, stock, avail, lotCounts] = await Promise.all([
    loadPlanCatalog(db()),
    loadStockPositions(db()),
    finishedAvailability(db()),
    db().execute<{ product_id: string; item_id: string; lots: number }>(sql`
      select p.id as product_id, p.item_id,
        (select count(*)::int from lots l where l.item_id = p.item_id
          and (select coalesce(sum(m.quantity), 0) from movements m where m.lot_id = l.id) > 0) as lots
      from products p`),
  ]);
  const lotsByProduct = new Map([...lotCounts].map((r) => [r.product_id, r]));
  const finished = avail.filter((a) => a.onHand.gt(0) || a.reserved.gt(0));
  const uncounted = catalog.items.filter((i) => stock[i.id]?.onHand == null).length;

  return (
    <>
      <h1>Stock</h1>
      <p className="lead">Every number here is the sum of recorded deliveries, counts and usage. Click an item to see its lots and history.</p>
      <Flash params={params} />
      <div className="card row">
        <Link href="/stock/adjust">Correct a count or write stock off</Link>
        <Link href="/stock/count">Opening count (items never counted)</Link>
        <Link href="/trace">Trace a lot</Link>
      </div>
      {uncounted > 0 && (
        <ul className="issues">
          <li className="warn">
            {uncounted} item(s) have never been counted, so their stock is unknown. <Link href="/stock/count">Record an opening count</Link>.
          </li>
        </ul>
      )}
      {(["ingredient", "packaging"] as const).map((kind) => (
        <div key={kind}>
          <h2>{kind === "ingredient" ? "Ingredients" : "Packaging"}</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">In stock</th>
                  <th className="num">Reserved for runs</th>
                  <th className="num">Free</th>
                  <th className="num">On order</th>
                </tr>
              </thead>
              <tbody>
                {catalog.items
                  .filter((i) => i.kind === kind)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((i) => {
                    const s = stock[i.id];
                    const on = s?.onHand ?? null;
                    const res = s?.reservedEarlier ?? new Decimal(0);
                    return (
                      <tr key={i.id}>
                        <td>
                          <Link href={`/stock/${i.id}`}>{i.name}</Link>
                        </td>
                        <td className="num">{on === null ? <span className="badge warn">not counted</span> : formatQty(on, i.stockUnit)}</td>
                        <td className="num">{formatQty(res, i.stockUnit)}</td>
                        <td className="num">{on === null ? "unknown" : formatQty(on.minus(res), i.stockUnit)}</td>
                        <td className="num">{formatQty(s?.onOrder ?? new Decimal(0), i.stockUnit)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <h2>Finished jars</h2>
      <p className="small muted">Jars come in from packaging and go out through Outbound. Promised = held for pending sales orders, still physically here.</p>
      <div className="card scroll">
        {finished.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No finished jars in stock.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">In stock</th>
                <th className="num">Promised to orders</th>
                <th className="num">Free</th>
                <th className="num">Batch lots</th>
              </tr>
            </thead>
            <tbody>
              {finished.map((a) => {
                const lc = lotsByProduct.get(a.productId);
                return (
                  <tr key={a.productId}>
                    <td>{lc ? <Link href={`/stock/${lc.item_id}`}>{a.name}</Link> : a.name}</td>
                    <td className="num">{jars(a.onHand)}</td>
                    <td className="num">{jars(a.reserved)}</td>
                    <td className="num">{jars(a.available)}</td>
                    <td className="num">{lc?.lots ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </>
  );
}
