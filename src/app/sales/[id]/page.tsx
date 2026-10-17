import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../components/flash";
import { OUTFLOW, SALES_STATUS } from "../../components/labels";
import { jars, who } from "../../components/trace-format";
import { cancelOrder, deliverOrder } from "../actions";
import { fefoPreview, finishedLots, todayIso } from "../data";

export const dynamic = "force-dynamic";

export default async function SalesOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const [row] = await db()
    .select({ o: t.salesOrders, customer: t.customers.name })
    .from(t.salesOrders)
    .leftJoin(t.customers, eq(t.salesOrders.customerId, t.customers.id))
    .where(eq(t.salesOrders.id, id));
  if (!row) notFound();
  const { o, customer } = row;
  const lines = await db()
    .select({ l: t.salesOrderLines, product: t.products.name })
    .from(t.salesOrderLines)
    .innerJoin(t.products, eq(t.salesOrderLines.productId, t.products.id))
    .where(eq(t.salesOrderLines.salesOrderId, o.id));
  const status = SALES_STATUS[o.status]!;
  const [outflow] = await db().select().from(t.outflows).where(eq(t.outflows.salesOrderId, o.id));
  const outLines = outflow
    ? await db()
        .select({ l: t.outflowLines, product: t.products.name, lot: t.lots.code })
        .from(t.outflowLines)
        .innerJoin(t.products, eq(t.outflowLines.productId, t.products.id))
        .innerJoin(t.lots, eq(t.outflowLines.lotId, t.lots.id))
        .where(eq(t.outflowLines.outflowId, outflow.id))
    : [];

  const pending = o.status === "pending";
  const [avail, lots] = pending ? await Promise.all([finishedAvailability(db()), finishedLots()]) : [[], []];
  const need = new Map<string, { name: string; jars: number }>();
  for (const l of lines) need.set(l.l.productId, { name: l.product, jars: (need.get(l.l.productId)?.jars ?? 0) + l.l.jars });
  const priced = lines.filter((l) => l.l.unitPrice !== null);
  const revenue = priced.reduce((s, l) => s.plus(new Decimal(l.l.unitPrice!).mul(l.l.jars)), new Decimal(0));

  return (
    <>
      <h1>
        {o.code} <span className={`badge ${status.cls}`}>{status.label}</span>
      </h1>
      <p className="lead">
        Sales order for {who(customer, o.destination)}, ordered {o.orderedOn}
        {o.reference ? `, customer reference ${o.reference}` : ""}.
      </p>
      <Flash params={flash} />

      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Jars</th>
              <th className="num">Price per jar</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.l.id}>
                <td>{l.product}</td>
                <td className="num">{l.l.jars}</td>
                <td className="num">{l.l.unitPrice === null ? <span className="muted">not recorded</span> : `€ ${new Decimal(l.l.unitPrice).toFixed(2)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {priced.length > 0 && (
          <p className="small muted">
            Order value from recorded prices: € {revenue.toFixed(2)}
            {priced.length < lines.length ? " (some lines have no price, so this is incomplete)" : ""}. This is revenue, not profit.
          </p>
        )}
      </div>

      {o.status === "cancelled" && <p className="card">This order was cancelled. Its jars were released and stock never changed.</p>}

      {outflow && (
        <>
          <h2>Delivered</h2>
          <div className="card scroll">
            <p style={{ marginTop: 0 }}>
              Delivered on {outflow.occurredOn} as <strong>{outflow.code}</strong> ({OUTFLOW[outflow.type]}). These jars have left stock.{" "}
              <Link href={`/trace/outflow/${outflow.id}`}>Trace this delivery →</Link>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>From lot</th>
                  <th className="num">Jars</th>
                </tr>
              </thead>
              <tbody>
                {outLines.map((l) => (
                  <tr key={l.l.id}>
                    <td>{l.product}</td>
                    <td>
                      <Link href={`/trace/lot/${l.l.lotId}`}>{l.lot}</Link>
                    </td>
                    <td className="num">{l.l.jars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pending && (
        <>
          <h2 id="deliver">Deliver this order</h2>
          <form action={deliverOrder}>
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <input type="hidden" name="orderId" value={o.id} />
            <div className="card">
              <label htmlFor="deliveredOn">Delivery date (required)</label>
              <input id="deliveredOn" name="deliveredOn" type="date" required defaultValue={todayIso()} style={{ maxWidth: 200 }} />
            </div>
            {[...need].map(([productId, n]) => {
              const a = avail.find((x) => x.productId === productId);
              const freeForThis = a ? Decimal.max(0, a.onHand.minus(a.reserved).plus(n.jars)) : new Decimal(0);
              const productLots = lots.filter((l) => l.productId === productId);
              const preview = fefoPreview(lots, productId, n.jars);
              return (
                <div className="card" key={productId}>
                  <h3 style={{ margin: "0 0 4px" }}>
                    {n.name} × {n.jars}
                  </h3>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    {jars(a?.onHand ?? 0)} in stock, {jars(freeForThis)} available for this order
                    {a && freeForThis.lt(a.onHand) ? " (the rest is promised to other orders)" : ""}.
                  </p>
                  {freeForThis.lt(n.jars) && (
                    <ul className="issues">
                      <li className="bad">Not enough in stock: {n.jars - freeForThis.toNumber()} jars short. Pack more or change the order before delivering.</li>
                    </ul>
                  )}
                  <label>Which lots the jars come from</label>
                  <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "baseline", color: "var(--text)" }}>
                      <input type="radio" name={`mode_${productId}`} value="fefo" defaultChecked style={{ width: "auto" }} />
                      <span>
                        Earliest best-before first (recommended)
                        {preview.out.length > 0 && (
                          <span className="small muted"> — will take {preview.out.map((p) => `${p.jars} from ${p.lot.code}`).join(", ")}</span>
                        )}
                      </span>
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "baseline", color: "var(--text)" }}>
                      <input type="radio" name={`mode_${productId}`} value="choose" style={{ width: "auto" }} />
                      <span>I&apos;ll choose the lots (enter jars per lot below; they must add up to {n.jars})</span>
                    </label>
                  </div>
                  {productLots.length === 0 ? (
                    <p className="small muted">No lots of this product have jars left.</p>
                  ) : (
                    <div className="scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Lot</th>
                            <th>Best before</th>
                            <th className="num">Jars left</th>
                            <th>Jars from this lot</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productLots.map((l) => (
                            <tr key={l.id}>
                              <td>
                                <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                              </td>
                              <td>{l.bestBefore ?? <span className="muted">not recorded</span>}</td>
                              <td className="num">{l.balance.toString()}</td>
                              <td>
                                <input name={`lot_${productId}_${l.id}`} type="number" min="0" max={l.balance.toNumber()} step="1" inputMode="numeric" aria-label={`Jars from ${l.code}`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            <button type="submit">Deliver now</button>
            <p className="small muted">Delivering takes the jars out of stock from the lots above, releases the reservation and records it as a sale. It can&apos;t be undone from here.</p>
          </form>
          <form action={cancelOrder} className="card row">
            <input type="hidden" name="orderId" value={o.id} />
            <button type="submit" style={{ background: "var(--muted)" }}>
              Cancel order
            </button>
            <span className="small muted">Cancelling frees the promised jars. Stock doesn&apos;t change because nothing was taken out.</span>
          </form>
        </>
      )}
      <p>
        <Link href="/sales">← Back to sales</Link>
      </p>
    </>
  );
}
