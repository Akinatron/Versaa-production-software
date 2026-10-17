import Link from "next/link";
import { db } from "@/db/client";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { formatQty } from "@/domain/quantity";
import Decimal from "decimal.js";
import { Flash } from "../components/flash";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [catalog, stock] = await Promise.all([loadPlanCatalog(db()), loadStockPositions(db())]);
  const uncounted = catalog.items.filter((i) => stock[i.id]?.onHand == null).length;

  return (
    <>
      <h1>Stock</h1>
      <p className="lead">Every number here is the sum of recorded deliveries, counts and usage. Click an item to see its lots and history.</p>
      <Flash params={params} />
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
    </>
  );
}
