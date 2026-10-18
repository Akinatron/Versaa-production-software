import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../components/flash";
import { OUTFLOW, OUTFLOW_REASONS, outflowBadge } from "../components/labels";
import { buttonLink, jars, who } from "../components/trace-format";
import { cancelOrder } from "./actions";

export const dynamic = "force-dynamic";

export default async function OutboundPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const reason = (OUTFLOW_REASONS as readonly string[]).includes(params.reason ?? "") ? (params.reason as (typeof OUTFLOW_REASONS)[number]) : null;
  const [avail, pending, outflows] = await Promise.all([
    finishedAvailability(db()),
    db()
      .select({ o: t.salesOrders, customer: t.customers.name })
      .from(t.salesOrders)
      .leftJoin(t.customers, eq(t.salesOrders.customerId, t.customers.id))
      .where(eq(t.salesOrders.status, "pending"))
      .orderBy(t.salesOrders.orderedOn, t.salesOrders.createdAt),
    db()
      .select({
        o: t.outflows,
        customer: t.customers.name,
        jars: sql<number>`(select coalesce(sum(l.jars), 0)::int from outflow_lines l where l.outflow_id = ${t.outflows.id})`,
      })
      .from(t.outflows)
      .leftJoin(t.customers, eq(t.outflows.customerId, t.customers.id))
      .where(reason ? eq(t.outflows.type, reason) : undefined)
      .orderBy(desc(t.outflows.occurredOn), desc(t.outflows.createdAt))
      .limit(40),
  ]);
  const lines = pending.length
    ? await db()
        .select({ l: t.salesOrderLines, product: t.products.name })
        .from(t.salesOrderLines)
        .innerJoin(t.products, eq(t.salesOrderLines.productId, t.products.id))
        .where(inArray(t.salesOrderLines.salesOrderId, pending.map((p) => p.o.id)))
    : [];
  const byProduct = new Map(avail.map((a) => [a.productId, a]));
  // Show products that have stock or are promised; others in a collapsed note.
  const shown = avail.filter((a) => a.onHand.gt(0) || a.reserved.gt(0));
  const empty = avail.filter((a) => !(a.onHand.gt(0) || a.reserved.gt(0)));

  return (
    <>
      <h1>Outbound</h1>
      <p className="lead">
        Every jar that leaves stock, for any reason: sales, own use, tests, samples and gifts, waste. A pending sales order only promises jars;
        stock goes down when you deliver it.
      </p>
      <Flash params={params} />
      <div className="card row">
        <Link href="/outbound/new" style={buttonLink}>
          Record a stock exit
        </Link>
        <Link href="/outbound/orders/new">New sales order</Link>
        <Link href="/outbound/customers">Customers</Link>
      </div>

      <h2>Jars available now</h2>
      <p className="small muted">In stock = jars counted from packaging minus everything already sent out. Promised = held for pending orders. Free = what you can still promise or send.</p>
      <div className="card scroll">
        {shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No finished jars in stock yet. Jars appear here after packaging is recorded on a batch.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">In stock</th>
                <th className="num">Promised to orders</th>
                <th className="num">Free</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.productId}>
                  <td>{a.name}</td>
                  <td className="num">{jars(a.onHand)}</td>
                  <td className="num">{jars(a.reserved)}</td>
                  <td className="num">
                    <strong>{jars(a.available)}</strong>
                    {a.reserved.gt(a.onHand) && <div className="badge bad">promised more than in stock</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {empty.length > 0 && shown.length > 0 && <p className="small muted">No jars in stock or promised: {empty.map((e) => e.name).join(", ")}.</p>}
      </div>

      <h2>Pending orders</h2>
      <div className="card scroll">
        {pending.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No pending orders.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer / destination</th>
                <th>Ordered</th>
                <th>Products</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map(({ o, customer }) => {
                const own = lines.filter((l) => l.l.salesOrderId === o.id);
                const need = new Map<string, number>();
                for (const l of own) need.set(l.l.productId, (need.get(l.l.productId) ?? 0) + l.l.jars);
                // Free for this order = in stock − promised to *other* orders.
                const short = [...need].filter(([pid, n]) => {
                  const a = byProduct.get(pid);
                  const free = a ? a.onHand.minus(a.reserved).plus(n) : 0;
                  return Number(free) < n;
                });
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/outbound/orders/${o.id}`}>{o.code}</Link>
                      {o.reference && <div className="small muted">Ref {o.reference}</div>}
                    </td>
                    <td>{who(customer, o.destination)}</td>
                    <td>{o.orderedOn}</td>
                    <td>
                      {own.map((l) => (
                        <div key={l.l.id}>
                          {l.product} × {l.l.jars}
                        </div>
                      ))}
                    </td>
                    <td>{short.length ? <span className="badge bad">not enough in stock</span> : <span className="badge ok">enough in stock</span>}</td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <Link href={`/outbound/orders/${o.id}#deliver`}>Deliver</Link>
                        <form action={cancelOrder}>
                          <input type="hidden" name="orderId" value={o.id} />
                          <button type="submit" style={{ background: "var(--muted)", padding: "4px 10px" }}>
                            Cancel
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2>Recent stock exits</h2>
      <p className="small muted">Every jar that left stock, with its reason. Only “Sale” counts as sales.</p>
      <div className="row small" style={{ gap: 6, marginBottom: 8 }}>
        <span className="muted">Show:</span>
        {[["", "All"], ...OUTFLOW_REASONS.map((r) => [r, OUTFLOW[r]!])].map(([r, label]) => (
          <Link key={r} href={r ? `/outbound?reason=${r}` : "/outbound"} aria-current={r === reason ? "page" : undefined} style={{ fontWeight: r === reason ? 700 : undefined }}>
            {label}
          </Link>
        ))}
      </div>
      <div className="card scroll">
        {outflows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{reason ? `No stock exits for “${OUTFLOW[reason]}” yet.` : "No jars have left stock yet."}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Reason</th>
                <th>Date</th>
                <th>Customer / destination</th>
                <th className="num">Jars</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {outflows.map(({ o, customer, jars: n }) => (
                <tr key={o.id}>
                  <td>{o.code}</td>
                  <td>
                    <span className={`badge ${outflowBadge(o.type)}`}>{OUTFLOW[o.type] ?? o.type}</span>
                    {o.note && <div className="small muted">{o.note}</div>}
                  </td>
                  <td>{o.occurredOn}</td>
                  <td>{who(customer, o.destination)}</td>
                  <td className="num">{n}</td>
                  <td>
                    <Link href={`/trace/outflow/${o.id}`}>Trace</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
