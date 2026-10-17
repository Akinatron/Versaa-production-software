import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../components/flash";
import { PO_STATUS } from "../components/labels";
import { cancelOrder } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const orders = await db()
    .select({ po: t.purchaseOrders, supplier: t.suppliers.name })
    .from(t.purchaseOrders)
    .innerJoin(t.suppliers, eq(t.purchaseOrders.supplierId, t.suppliers.id))
    .orderBy(desc(t.purchaseOrders.createdAt));
  const lines = await db()
    .select({
      line: t.purchaseOrderLines,
      item: t.items,
      received: sql<string>`(select coalesce(sum(quantity), 0) from receipt_lines r where r.purchase_order_line_id = ${t.purchaseOrderLines.id})`,
    })
    .from(t.purchaseOrderLines)
    .innerJoin(t.items, eq(t.purchaseOrderLines.itemId, t.items.id));

  return (
    <>
      <h1>Purchase orders</h1>
      <p className="lead">What has been ordered and what is still to arrive. Ordering doesn't change stock; recording the delivery does.</p>
      <Flash params={params} />
      <p>
        <Link href="/orders/new">+ New order</Link>
      </p>
      {orders.length === 0 && <p className="card muted">No orders yet. From a plan, use "Order what's missing" to start one.</p>}
      {orders.map(({ po, supplier }) => {
        const st = PO_STATUS[po.status]!;
        const own = lines.filter((l) => l.line.purchaseOrderId === po.id);
        const open = po.status === "sent" || po.status === "partly_received";
        return (
          <div key={po.id} className="card scroll">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{po.code}</strong> · {supplier} <span className={`badge ${st.cls}`}>{st.label}</span>
                <div className="small muted">
                  Ordered {po.orderedOn ?? "—"}
                  {po.expectedOn && ` · expected ${po.expectedOn}`}
                  {po.reference && ` · ref ${po.reference}`}
                </div>
              </div>
              {open && (
                <div className="row" style={{ alignItems: "center" }}>
                  <Link href={`/deliveries/new?po=${po.id}`}>Record delivery →</Link>
                  <form action={cancelOrder}>
                    <input type="hidden" name="poId" value={po.id} />
                    <button type="submit" style={{ background: "var(--muted)", padding: "6px 12px" }}>
                      Cancel
                    </button>
                  </form>
                </div>
              )}
            </div>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Received</th>
                  <th className="num">Pending</th>
                </tr>
              </thead>
              <tbody>
                {own.map(({ line, item, received }) => {
                  const u = item.stockUnit as UnitCode;
                  const pending = Decimal.max(0, new Decimal(line.quantity).minus(received));
                  return (
                    <tr key={line.id}>
                      <td>{item.name}</td>
                      <td className="num">{formatQty(new Decimal(line.quantity), u)}</td>
                      <td className="num">{formatQty(new Decimal(received), u)}</td>
                      <td className="num">{po.status === "cancelled" ? "—" : formatQty(pending, u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
