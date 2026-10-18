import Link from "next/link";
import { db } from "@/db/client";
import { loadOrders, type OrderView } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { Flash } from "../components/flash";
import { PO_STATUS } from "../components/labels";
import { MarkSentForm } from "../components/order-bits";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const orders = await loadOrders(db());
  const groups: { title: string; hint: string; list: OrderView[] }[] = [
    { title: "Drafts: not sent yet", hint: "Prepared but not placed with the supplier. They don't count as on order.", list: orders.filter((o) => o.po.status === "draft") },
    { title: "On the way", hint: "Sent to the supplier, waiting for delivery.", list: orders.filter((o) => o.po.status === "sent" || o.po.status === "partly_received") },
    { title: "Done", hint: "", list: orders.filter((o) => ["received", "closed", "cancelled"].includes(o.po.status)) },
  ];

  return (
    <>
      <h1>Purchase orders</h1>
      <p className="lead">What has been prepared, sent and received. Ordering doesn't change stock; recording the delivery does.</p>
      <Flash params={params} />
      <p className="row" style={{ gap: 16 }}>
        <Link href="/orders/new">+ New order</Link>
        <span className="small muted">To order for a run, open the run and go to step 3, "Order".</span>
      </p>
      {orders.length === 0 && <p className="card muted">No orders yet.</p>}
      {groups
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            {g.hint && <p className="small muted">{g.hint}</p>}
            <div className="card scroll">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Supplier</th>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th>Expected</th>
                    <th className="num">Cost</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.list.map((o) => {
                    const st = PO_STATUS[o.po.status]!;
                    return (
                      <tr key={o.po.id}>
                        <td>
                          <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link>
                          <div className="small muted">{o.lines.map((l) => l.item.name).join(", ")}</div>
                        </td>
                        <td>
                          <Link href={`/suppliers/${o.supplier.id}`}>{o.supplier.name}</Link>
                        </td>
                        <td>{o.run ? <Link href={`/runs/${o.run.id}`}>{o.run.code}</Link> : <span className="muted small">Restock</span>}</td>
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </td>
                        <td>{o.po.orderedOn ?? "—"}</td>
                        <td>{o.po.expectedOn ?? "—"}</td>
                        <td className="num">{money(o.cost)}</td>
                        <td>
                          {o.po.status === "draft" && <MarkSentForm poId={o.po.id} back="/orders" compact />}
                          {(o.po.status === "sent" || o.po.status === "partly_received") && <Link href={`/deliveries/new?po=${o.po.id}`}>Record delivery →</Link>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </>
  );
}
