import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../../components/flash";
import { OUTFLOW, SALES_STATUS } from "../../../components/labels";
import { jars, who } from "../../../components/trace-format";
import { cancelOrder, deliverOrder } from "../../actions";
import { fefoPreview, finishedLots, todayIso } from "../../data";
import { PageHeader } from "../../../components/ui/header";
import { fmtDate } from "../../../components/ui/format";
import { ConfirmButton } from "../../../components/unsaved-guard";

export const dynamic = "force-dynamic";

export default async function SalesOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
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
        .select({
          l: t.outflowLines,
          product: t.products.name,
          lot: t.lots.code,
        })
        .from(t.outflowLines)
        .innerJoin(t.products, eq(t.outflowLines.productId, t.products.id))
        .innerJoin(t.lots, eq(t.outflowLines.lotId, t.lots.id))
        .where(eq(t.outflowLines.outflowId, outflow.id))
    : [];

  const pending = o.status === "pending";
  const [avail, lots] = pending ? await Promise.all([finishedAvailability(db()), finishedLots()]) : [[], []];
  const need = new Map<string, { name: string; jars: number }>();
  for (const l of lines)
    need.set(l.l.productId, {
      name: l.product,
      jars: (need.get(l.l.productId)?.jars ?? 0) + l.l.jars,
    });
  const priced = lines.filter((l) => l.l.unitPrice !== null);
  const revenue = priced.reduce((s, l) => s.plus(new Decimal(l.l.unitPrice!).mul(l.l.jars)), new Decimal(0));

  return (
    <>
      <PageHeader
        back={{ href: "/outbound", label: "Outbound" }}
        title={who(customer, o.destination)}
        status={{ label: status.label, cls: status.cls }}
        lead={`Sales order ${o.code}, ordered ${fmtDate(o.orderedOn)}${o.reference ? `, customer reference ${o.reference}` : ""}.`}
        actions={
          pending ? (
            <a href="#deliver" className="btn">
              Deliver
            </a>
          ) : null
        }
      />
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

      {o.status === "cancelled" && (
        <ul className="issues">
          <li className="info">This order was cancelled. Its jars were released and stock never changed.</li>
        </ul>
      )}

      {outflow && (
        <>
          <h2>Delivered</h2>
          <div className="card scroll">
            <p style={{ marginTop: 0 }}>
              Delivered on {fmtDate(outflow.occurredOn, { weekday: true })} as <strong>{outflow.code}</strong> ({OUTFLOW[outflow.type]}). These jars have left
              stock. <Link href={`/trace/outflow/${outflow.id}`}>Trace this delivery</Link>
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
                      <li className="bad">
                        Not enough in stock: {n.jars - freeForThis.toNumber()} jars short. Pack more or change the order before delivering.
                      </li>
                    </ul>
                  )}
                  <label>Which lots the jars come from</label>
                  <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                    <label
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                        color: "var(--text)",
                      }}
                    >
                      <input type="radio" name={`mode_${productId}`} value="fefo" defaultChecked style={{ width: "auto" }} />
                      <span>
                        Earliest best-before first (recommended)
                        {preview.out.length > 0 && (
                          <span className="small muted">: takes {preview.out.map((p) => `${p.jars} from ${p.lot.code}`).join(", ")}</span>
                        )}
                      </span>
                    </label>
                    <label
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                        color: "var(--text)",
                      }}
                    >
                      <input type="radio" name={`mode_${productId}`} value="choose" style={{ width: "auto" }} />
                      <span>I&apos;ll choose the lots (enter jars per lot below; they must add up to {n.jars})</span>
                    </label>
                  </div>
                  {productLots.length === 0 ? (
                    <p className="small muted">No lots of this product have jars left.</p>
                  ) : (
                    <details className="scroll">
                      <summary className="small">
                        Lots of {n.name} ({productLots.length})
                      </summary>
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
                              <td>{l.bestBefore ? fmtDate(l.bestBefore, { year: true }) : <span className="muted">not recorded</span>}</td>
                              <td className="num">{l.balance.toString()}</td>
                              <td>
                                <input
                                  name={`lot_${productId}_${l.id}`}
                                  type="number"
                                  min="0"
                                  max={l.balance.toNumber()}
                                  step="1"
                                  inputMode="numeric"
                                  aria-label={`Jars from ${l.code}`}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </div>
              );
            })}
            <div className="form-actions">
              <ConfirmButton message="Deliver this order now? The jars leave stock and it is recorded as a sale.">Deliver now</ConfirmButton>
              <span className="small muted">Takes the jars out of stock, releases the hold and records the sale. It can&apos;t be undone from here.</span>
            </div>
          </form>
          <details className="card" style={{ marginTop: 32 }}>
            <summary>Cancel this order</summary>
            <form action={cancelOrder} className="row" style={{ alignItems: "center" }}>
              <input type="hidden" name="orderId" value={o.id} />
              <span className="small muted" style={{ flex: 1 }}>
                Cancelling frees the promised jars. Stock doesn&apos;t change because nothing was taken out.
              </span>
              <button type="submit" className="danger">
                Cancel order
              </button>
            </form>
          </details>
        </>
      )}
    </>
  );
}
