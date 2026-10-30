import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../../components/flash";
import { OUTFLOW, SALES_STATUS } from "../../../components/labels";
import { jars, who } from "../../../components/trace-format";
import { cancelOrder, deliverOrder, editOrder, restoreOrder } from "../../actions";
import { activeProducts, customerList, fefoPreview, finishedLots, todayIso } from "../../data";
import { EditedMark, History, ReasonField } from "../../../components/history";
import { PageHeader } from "../../../components/ui/header";
import { fmtDate } from "../../../components/ui/format";
import { ConfirmButton, GuardedForm } from "../../../components/unsaved-guard";
import { idOrNotFound } from "@/lib/ids";
import { NumberInput } from "../../../components/ui/number-input";

export const dynamic = "force-dynamic";

export default async function SalesOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
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
  const [outflow] = await db()
    .select()
    .from(t.outflows)
    .where(and(eq(t.outflows.salesOrderId, o.id), isNull(t.outflows.deletedAt)));
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
  const [products, customers] = pending ? await Promise.all([activeProducts(), customerList()]) : [[], []];
  const editRows = [
    ...lines.map((l) => ({ productId: l.l.productId, jars: String(l.l.jars), price: l.l.unitPrice ?? "" })),
    { productId: "", jars: "", price: "" },
    { productId: "", jars: "", price: "" },
  ];
  const priced = lines.filter((l) => l.l.unitPrice !== null);
  const revenue = priced.reduce((s, l) => s.plus(new Decimal(l.l.unitPrice!).mul(l.l.jars)), new Decimal(0));

  return (
    <>
      <PageHeader
        back={{ href: "/outbound", label: "Outbound" }}
        title={who(customer, o.destination)}
        status={{ label: status.label, cls: status.cls }}
        lead={`Sales order ${o.code}, ordered ${fmtDate(o.orderedOn)}${o.deliverBy ? `, to deliver by ${fmtDate(o.deliverBy)}` : ""}${o.reference ? `, customer reference ${o.reference}` : ""}.`}
        actions={
          pending ? (
            <a href="#deliver" className="btn">
              Deliver
            </a>
          ) : null
        }
      />
      <EditedMark of={{ type: "sales_order", id: o.id }} />
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
      {o.status === "cancelled" && (
        <form action={restoreOrder} className="card row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="orderId" value={o.id} />
          <div style={{ flexBasis: "100%" }}>
            <strong>Restore this order?</strong>
            <div className="small muted">It goes back to waiting for delivery and its jars are promised again.</div>
          </div>
          <ReasonField id="so-restore" label="Why restore it?" />
          <button type="submit" className="secondary">
            Restore order
          </button>
        </form>
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
          <h2 id="deliver" >
            Deliver this order
          </h2>
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
                                <NumberInput whole
                                  name={`lot_${productId}_${l.id}`}
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
              <span className="small muted">
                Takes the jars out of stock, releases the hold and records the sale. If it was a mistake, delete the delivery from its page afterwards.
              </span>
            </div>
          </form>
          <details className="card" style={{ marginTop: 32 }} open={flash.edit === "1"}>
            <summary>Correct this order</summary>
            <GuardedForm action={editOrder}>
              <input type="hidden" name="orderId" value={o.id} />
              <div className="grid" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="e-customer">Customer</label>
                  <select id="e-customer" name="customerId" defaultValue={o.customerId ?? ""}>
                    <option value="">None</option>
                    {customers
                      .filter((c) => c.active || c.id === o.customerId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="e-destination">Destination</label>
                  <input id="e-destination" name="destination" defaultValue={o.destination ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-reference">Customer reference</label>
                  <input id="e-reference" name="reference" defaultValue={o.reference ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-orderedOn">Order date</label>
                  <input id="e-orderedOn" name="orderedOn" type="date" required defaultValue={o.orderedOn} />
                </div>
                <div>
                  <label htmlFor="e-deliverBy">Deliver by</label>
                  <input id="e-deliverBy" name="deliverBy" type="date" defaultValue={o.deliverBy ?? ""} />
                </div>
              </div>
              <div className="scroll" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Jars</th>
                      <th>Price per jar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editRows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <select name={`product_${i}`} defaultValue={r.productId} aria-label="Product">
                            <option value="">Choose…</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <NumberInput whole name={`jars_${i}`} defaultValue={r.jars} aria-label="Jars" />
                        </td>
                        <td>
                          <NumberInput name={`price_${i}`} defaultValue={r.price} aria-label="Price per jar" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">Set jars to 0 to take a line off. The promised jars are updated to match.</p>
              </div>
              <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                <ReasonField id="so-reason" label="Why the correction?" placeholder="e.g. customer asked for 12 more" />
                <button type="submit">Save correction</button>
              </div>
            </GuardedForm>
          </details>
          <details className="card">
            <summary>Cancel this order</summary>
            <form action={cancelOrder} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="orderId" value={o.id} />
              <span className="small muted" style={{ flexBasis: "100%" }}>
                Cancelling frees the promised jars. Stock doesn&apos;t change because nothing was taken out. It can be restored.
              </span>
              <ReasonField id="so-cancel" placeholder="e.g. customer called it off" />
              <button type="submit" className="danger">
                Cancel order
              </button>
            </form>
          </details>
        </>
      )}
      <History of={{ type: "sales_order", id: o.id }} />
    </>
  );
}
