import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { finishedAvailability } from "@/db/sales";
import { Flash } from "../../components/flash";
import { OUTFLOW, OUTFLOW_EXPLAIN, OUTFLOW_REASONS, type OutflowReason } from "../../components/labels";
import { who } from "../../components/trace-format";
import { PageHeader } from "../../components/ui/header";
import { fmtDate, relDate } from "../../components/ui/format";
import { GuardedForm } from "../../components/unsaved-guard";
import { saveOutflow } from "../actions";
import { activeProducts, customerList, finishedLots, todayIso } from "../data";

export const dynamic = "force-dynamic";

export default async function NewOutboundPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const reason = (OUTFLOW_REASONS as readonly string[]).includes(params.reason ?? "") ? (params.reason as OutflowReason) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/outbound", label: "Outbound" }}
        title="Record a stock exit"
        lead="Jars that leave stock, for any reason. Stock goes down as soon as you save, and the jars stay traceable to their batch."
      />
      <Flash params={params} />

      <h2>Why are the jars leaving?</h2>
      <nav className="choices" aria-label="Reason">
        {OUTFLOW_REASONS.map((x) => (
          <Link key={x} href={`/outbound/new?reason=${x}`} aria-current={x === reason ? "page" : undefined}>
            <strong>{OUTFLOW[x]}</strong>
            <span>{OUTFLOW_EXPLAIN[x]}</span>
          </Link>
        ))}
      </nav>

      {reason === "sale" && <SaleForm />}
      {reason && reason !== "sale" && <ExitForm reason={reason} />}
    </>
  );
}

async function SaleForm() {
  const [products, customers, avail, lots, pending] = await Promise.all([
    activeProducts(),
    customerList(),
    finishedAvailability(db()),
    finishedLots(),
    db()
      .select({ o: t.salesOrders, customer: t.customers.name })
      .from(t.salesOrders)
      .leftJoin(t.customers, eq(t.salesOrders.customerId, t.customers.id))
      .where(eq(t.salesOrders.status, "pending"))
      .orderBy(t.salesOrders.orderedOn, t.salesOrders.createdAt),
  ]);
  const free = new Map(avail.map((a) => [a.productId, a.available]));
  const back = "/outbound/new?reason=sale";

  return (
    <>
      {pending.length > 0 && (
        <>
          <h2>Is it one of these orders?</h2>
          <p className="small muted">Delivering an order records the sale with its customer and prices.</p>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <ul className="worklist">
              {pending.map(({ o, customer }) => (
                <li key={o.id}>
                  <div className="what">
                    <strong>{who(customer, o.destination)}</strong>
                    <div className="sub">
                      {o.code} · ordered {relDate(o.orderedOn)}
                    </div>
                  </div>
                  <Link href={`/outbound/orders/${o.id}#deliver`} className="btn sm secondary">
                    Deliver this order
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>{pending.length > 0 ? "No, it's a sale handed over now" : "Sale handed over now"}</h2>
      <p className="small muted">
        Selling later? <Link href="/outbound/orders/new">Take a sales order</Link> instead: it holds the jars and stock goes down on delivery.
      </p>
      <GuardedForm action={saveOutflow}>
        <input type="hidden" name="key" value={crypto.randomUUID()} />
        <input type="hidden" name="type" value="sale" />
        <div className="card grid">
          <div>
            <label htmlFor="customerId">Customer</label>
            <select id="customerId" name="customerId" defaultValue="">
              <option value="">Choose…</option>
              {customers
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <div className="small">
              <Link href={`/outbound/customers?back=${encodeURIComponent(back)}`}>Add a customer</Link>
            </div>
          </div>
          <div>
            <label htmlFor="destination">Or a destination (free text)</label>
            <input id="destination" name="destination" type="text" placeholder="e.g. Saturday market Utrecht" />
          </div>
          <div>
            <label htmlFor="reference">Order / reference (optional)</label>
            <input id="reference" name="reference" type="text" placeholder="their order number or receipt" />
          </div>
          <div>
            <label htmlFor="occurredOn">Date (required)</label>
            <input id="occurredOn" name="occurredOn" type="date" required defaultValue={todayIso()} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="note">Note (optional)</label>
            <textarea id="note" name="note" rows={2} />
          </div>
        </div>
        <Lines products={products} lots={lots} free={free} withPrice />
        <div className="savebar">
          <button type="submit">Record sale</button>
        </div>
      </GuardedForm>
    </>
  );
}

async function ExitForm({ reason }: { reason: Exclude<OutflowReason, "sale"> }) {
  const [products, avail, lots] = await Promise.all([activeProducts(), finishedAvailability(db()), finishedLots()]);
  const free = new Map(avail.map((a) => [a.productId, a.available]));
  const noteRequired = reason === "waste";

  return (
    <GuardedForm action={saveOutflow}>
      <h2>Details</h2>
      <input type="hidden" name="key" value={crypto.randomUUID()} />
      <input type="hidden" name="type" value={reason} />
      <div className="card grid">
        <div>
          <label htmlFor="occurredOn">Date (required)</label>
          <input id="occurredOn" name="occurredOn" type="date" required defaultValue={todayIso()} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="note">Note {noteRequired ? "(required: why are these jars thrown away?)" : "(optional)"}</label>
          <textarea id="note" name="note" rows={2} required={noteRequired} />
        </div>
      </div>
      <Lines products={products} lots={lots} free={free} />
      <div className="savebar">
        <button type="submit">Record {OUTFLOW[reason]!.toLowerCase()}</button>
      </div>
    </GuardedForm>
  );
}

function Lines({
  products,
  lots,
  free,
  withPrice = false,
}: {
  products: Awaited<ReturnType<typeof activeProducts>>;
  lots: Awaited<ReturnType<typeof finishedLots>>;
  free: Map<string, { toString(): string }>;
  withPrice?: boolean;
}) {
  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Jars</th>
            <th>From lot (optional)</th>
            {withPrice && <th>Price per jar (optional)</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }, (_, i) => (
            <tr key={i}>
              <td>
                <select name={`product_${i}`} defaultValue="" aria-label="Product">
                  <option value="">Choose…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({free.get(p.id)?.toString() ?? "0"} free)
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input name={`jars_${i}`} type="number" min="1" step="1" inputMode="numeric" aria-label="Jars" />
              </td>
              <td>
                <select name={`lot_${i}`} defaultValue="" aria-label="Lot">
                  <option value="">Earliest best-before first</option>
                  {products
                    .filter((p) => lots.some((l) => l.productId === p.id))
                    .map((p) => (
                      <optgroup key={p.id} label={p.name}>
                        {lots
                          .filter((l) => l.productId === p.id)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.code} · best before {l.bestBefore ? fmtDate(l.bestBefore, { year: true }) : "not recorded"} · {l.balance.toString()} left
                            </option>
                          ))}
                      </optgroup>
                    ))}
                </select>
              </td>
              {withPrice && (
                <td>
                  <input name={`price_${i}`} type="number" min="0" step="0.01" inputMode="decimal" aria-label="Price per jar" placeholder="€" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        Rows without a product are ignored. If you pick a lot, all jars of that row come from it; otherwise the earliest best-before comes first.
        {withPrice && " Price: only if agreed; leave empty otherwise."} Jars promised to pending orders can&apos;t be used here.
      </p>
    </div>
  );
}
