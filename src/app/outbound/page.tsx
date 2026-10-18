import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../components/flash";
import { OUTFLOW, OUTFLOW_REASONS, outflowBadge } from "../components/labels";
import { jars, who } from "../components/trace-format";
import { PageHeader, Empty } from "../components/ui/header";
import { fmtDate, relDate } from "../components/ui/format";
import { ConfirmButton } from "../components/unsaved-guard";
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
        .where(
          inArray(
            t.salesOrderLines.salesOrderId,
            pending.map((p) => p.o.id),
          ),
        )
    : [];
  const byProduct = new Map(avail.map((a) => [a.productId, a]));
  // Show products that have stock or are promised; others in a short note.
  const shown = avail.filter((a) => a.onHand.gt(0) || a.reserved.gt(0));
  const empty = avail.filter((a) => !(a.onHand.gt(0) || a.reserved.gt(0)));
  const show = params.show === "stock" || params.show === "history" ? params.show : reason ? "history" : "orders";
  const tab = (key: string, label: string, href: string) => (
    <Link href={href} aria-current={show === key ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Outbound"
        actions={
          <>
            <Link href="/outbound/orders/new" className="btn secondary">
              New sales order
            </Link>
            <Link href="/outbound/new" className="btn">
              Record a stock exit
            </Link>
          </>
        }
      />
      <Flash params={params} />

      <div
        className="row"
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 0,
        }}
      >
        <nav className="tabs" aria-label="Show">
          {tab("orders", `To deliver${pending.length ? ` (${pending.length})` : ""}`, "/outbound")}
          {tab("stock", "Jars available", "/outbound?show=stock")}
          {tab("history", "History", "/outbound?show=history")}
        </nav>
        <Link href="/outbound/customers" className="small" style={{ marginBottom: 16 }}>
          Customers
        </Link>
      </div>

      {show === "orders" &&
        (pending.length === 0 ? (
          <Empty title="Nothing to deliver">
            <p>Sales orders you take appear here until they are delivered. The jars they need are held for them.</p>
            <p>
              <Link href="/outbound/orders/new" className="btn secondary sm">
                New sales order
              </Link>
            </p>
          </Empty>
        ) : (
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <ul className="worklist">
              {pending.map(({ o, customer }) => {
                const own = lines.filter((l) => l.l.salesOrderId === o.id);
                const need = new Map<string, number>();
                for (const l of own) need.set(l.l.productId, (need.get(l.l.productId) ?? 0) + l.l.jars);
                // Free for this order = in stock minus what is promised to *other* orders.
                const short = [...need].filter(([pid, n]) => {
                  const a = byProduct.get(pid);
                  const free = a ? a.onHand.minus(a.reserved).plus(n) : 0;
                  return Number(free) < n;
                });
                return (
                  <li key={o.id}>
                    <span className={`dot ${short.length ? "bad" : "ok"}`} aria-hidden />
                    <div className="what">
                      <Link href={`/outbound/orders/${o.id}`}>
                        <strong>{who(customer, o.destination)}</strong>
                      </Link>
                      <div className="small muted">{own.map((l) => `${l.product} × ${l.l.jars}`).join(", ")}</div>
                      <div className="small muted">
                        {o.code} · ordered {relDate(o.orderedOn)}
                        {o.reference && ` · ref ${o.reference}`}
                        {short.length > 0 && <span className="text-bad"> · not enough jars in stock</span>}
                      </div>
                    </div>
                    <div
                      className="row"
                      style={{
                        flexWrap: "nowrap",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <form action={cancelOrder}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <ConfirmButton message={`Cancel order ${o.code}? The jars held for it are freed.`} className="ghost sm">
                          Cancel
                        </ConfirmButton>
                      </form>
                      <Link href={`/outbound/orders/${o.id}#deliver`} className="btn sm">
                        Deliver
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {show === "stock" && (
        <>
          <div className="card scroll">
            {shown.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No finished jars in stock yet. Jars appear here after packaging is recorded on a batch.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">In stock</th>
                    <th className="num">Promised</th>
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
                        {a.reserved.gt(a.onHand) && <div className="small text-bad">promised more than in stock</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="small muted">
            Promised means held for orders to deliver. Free is what you can still promise or send.
            {empty.length > 0 && shown.length > 0 && <> None in stock: {empty.map((e) => e.name).join(", ")}.</>}
          </p>
        </>
      )}

      {show === "history" && (
        <>
          <nav className="tabs" aria-label="Reason">
            {[["", "All"], ...OUTFLOW_REASONS.map((r) => [r, OUTFLOW[r]!])].map(([r, label]) => (
              <Link
                key={r}
                href={r ? `/outbound?show=history&reason=${r}` : "/outbound?show=history"}
                aria-current={(r || null) === reason ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="card scroll">
            {outflows.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {reason ? `No stock exits for “${OUTFLOW[reason]}” yet.` : "No jars have left stock yet."}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer / destination</th>
                    <th>Reason</th>
                    <th className="num">Jars</th>
                    <th>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {outflows.map(({ o, customer, jars: n }) => (
                    <tr key={o.id}>
                      <td>{fmtDate(o.occurredOn)}</td>
                      <td>
                        {who(customer, o.destination)}
                        {o.note && <div className="small muted">{o.note}</div>}
                      </td>
                      <td>
                        <span className={`badge ${outflowBadge(o.type)}`}>{OUTFLOW[o.type] ?? o.type}</span>
                      </td>
                      <td className="num">{n}</td>
                      <td>
                        <Link href={`/trace/outflow/${o.id}`}>{o.code}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="small muted">Only “Sale” counts as sales. Open a code to see which batch and ingredient lots the jars came from.</p>
        </>
      )}
    </>
  );
}
