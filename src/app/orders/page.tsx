import Link from "next/link";
import { db } from "@/db/client";
import { loadOrders, type OrderView } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { Flash } from "../components/flash";
import { PO_STATUS } from "../components/labels";
import { MarkSentForm } from "../components/order-bits";
import { PageHeader } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";
import { addDays, today } from "@/domain/dates";

export const dynamic = "force-dynamic";

const DONE_DAYS = 90;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const todayIso = today();
  // Finished orders from the last 90 days, unless all were asked for.
  const showAll = params.all === "1";
  const orders = await loadOrders(db(), showAll ? {} : { doneSince: addDays(todayIso, -DONE_DAYS) });
  const groups: { title: string; hint: string; list: OrderView[] }[] = [
    {
      title: "Drafts: not sent yet",
      hint: "Prepared but not placed with the supplier. They don't count as on order.",
      list: orders.filter((o) => o.po.status === "draft"),
    },
    {
      title: "On the way",
      hint: "Sent to the supplier, waiting for delivery.",
      list: orders.filter((o) => o.po.status === "sent" || o.po.status === "partly_received"),
    },
    {
      title: "Done",
      hint: showAll ? "All finished orders." : `Received, closed or cancelled, created in the last ${DONE_DAYS} days.`,
      list: orders.filter((o) => ["received", "closed", "cancelled"].includes(o.po.status)),
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        actions={
          <Link href="/orders/new" className="btn">
            New order
          </Link>
        }
      />
      <Flash params={params} />
      {orders.length === 0 && <p className="card muted">{showAll ? "No orders yet." : `No open orders, and none finished in the last ${DONE_DAYS} days.`}</p>}
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
                          <div className="small muted">
                            {o.lines.length === 1 ? "1 item" : `${o.lines.length} items`}
                            {o.lines.length > 0 &&
                              `: ${o.lines
                                .slice(0, 2)
                                .map((l) => l.item.name)
                                .join(", ")}${o.lines.length > 2 ? ` and ${o.lines.length - 2} more` : ""}`}
                          </div>
                        </td>
                        <td>
                          <Link href={`/suppliers/${o.supplier.id}`}>{o.supplier.name}</Link>
                        </td>
                        <td>{o.run ? <Link href={`/runs/${o.run.id}`}>{o.run.code}</Link> : <span className="muted small">Restock</span>}</td>
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </td>
                        <td>{fmtDate(o.po.orderedOn)}</td>
                        <td>
                          {o.po.expectedOn ? (
                            <span className={o.po.expectedOn < todayIso && g.title === "On the way" ? "text-bad" : undefined}>{fmtDate(o.po.expectedOn)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{money(o.cost)}</td>
                        <td>
                          {o.po.status === "draft" && <MarkSentForm poId={o.po.id} back="/orders" compact />}
                          {(o.po.status === "sent" || o.po.status === "partly_received") && (
                            <Link href={`/deliveries/new?po=${o.po.id}`} className="btn secondary sm">
                              Record delivery
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      <p className="small">
        <Link href={showAll ? "/orders" : "/orders?all=1"}>{showAll ? `Only finished orders from the last ${DONE_DAYS} days` : "Show all finished orders"}</Link>
      </p>
    </>
  );
}
