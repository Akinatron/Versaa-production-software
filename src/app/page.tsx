import Link from "next/link";
import { sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";
import { finishedAvailability } from "@/db/sales";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { BATCH_STATUS, PO_STATUS, RUN_STATUS } from "./components/labels";

export const dynamic = "force-dynamic";

const tiles = [
  { href: "/plan", title: "Plan production", text: "Jars or batches per sauce → ingredients, packaging and what to buy." },
  { href: "/batches", title: "Batches", text: "Record what was used, measured and packed." },
  { href: "/outbound", title: "Outbound", text: "Every jar leaving stock: sales and orders, own use, tests, samples, waste." },
  { href: "/deliveries/new", title: "Record a delivery", text: "What arrived, with supplier batch and best-before." },
  { href: "/orders", title: "Purchase orders", text: "What's ordered and still pending." },
  { href: "/stock", title: "Stock", text: "What you have, by lot, and what's reserved." },
  { href: "/trace", title: "Trace", text: "From a lot or batch to where it came from and where it went." },
  { href: "/reports", title: "Reports", text: "Sales, production, plan vs actual and downloads." },
];

type Alert = { level: "bad" | "warn"; text: React.ReactNode };

export default async function Home() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const d = db();
  const [input, activeItems, runs, runNeeds, orders, batches, pendingSales, deliveries, available, soldMonth] = await Promise.all([
    loadPlanInput(d, {}),
    d.execute<{ id: string }>(sql`select id from items where active and kind in ('ingredient', 'packaging')`),
    d.execute<{ id: string; code: string; planned_for: string; status: string; batches: number }>(sql`
      select r.id, r.code, r.planned_for::text, r.status::text, (select count(*)::int from production_batches b where b.run_id = r.id and b.status <> 'cancelled') as batches
      from production_runs r where r.status in ('draft', 'confirmed', 'in_progress') order by r.planned_for`),
    d.execute<{ item_id: string; reserved: string; runs: string }>(sql`
      select r.item_id, sum(r.quantity)::text as reserved, string_agg(distinct pr.code, ', ') as runs
      from reservations r join production_runs pr on pr.id = r.run_id
      where r.released_at is null and r.run_id is not null and pr.status in ('confirmed', 'in_progress')
      group by r.item_id having sum(r.quantity) > 0`),
    d.execute<{ id: string; code: string; supplier: string; status: string; expected_on: string | null; ordered_on: string | null; lines: number }>(sql`
      select o.id, o.code, s.name as supplier, o.status::text, o.expected_on::text, o.ordered_on::text,
        (select count(*)::int from purchase_order_lines l where l.purchase_order_id = o.id) as lines
      from purchase_orders o join suppliers s on s.id = o.supplier_id
      where o.status in ('sent', 'partly_received') order by o.expected_on nulls last`),
    d.execute<{ id: string; code: string; status: string; sauce: string; planned_for: string; pending: number; bulk_left: string | null }>(sql`
      select b.id, b.code, b.status::text, s.name as sauce, r.planned_for::text,
        (select count(*)::int from batch_consumption c where c.batch_id = b.id and c.confirmed_at is null) as pending,
        (select sum(m.quantity)::text from movements m where m.lot_id = b.bulk_lot_id) as bulk_left
      from production_batches b join sauces s on s.id = b.sauce_id join production_runs r on r.id = b.run_id
      where b.status not in ('closed', 'cancelled') order by r.planned_for, b.code`),
    d.execute<{ id: string; code: string; who: string | null; product: string; jars: number; on_hand: string; other: string }>(sql`
      select so.id, so.code, coalesce(c.name, so.destination) as who, p.name as product, sol.jars,
        (select coalesce(sum(m.quantity), 0)::text from movements m where m.item_id = p.item_id) as on_hand,
        (select coalesce(sum(r.quantity), 0)::text from reservations r
           where r.item_id = p.item_id and r.released_at is null and r.sales_order_id is not null and r.sales_order_id <> so.id) as other
      from sales_orders so
      join sales_order_lines sol on sol.sales_order_id = so.id
      join products p on p.id = sol.product_id
      left join customers c on c.id = so.customer_id
      where so.status = 'pending' order by so.ordered_on, so.code`),
    d.execute<{ id: string; received_on: string; supplier: string | null; delivery_ref: string | null; lines: number }>(sql`
      select r.id, r.received_on::text, s.name as supplier, r.delivery_ref, (select count(*)::int from receipt_lines l where l.receipt_id = r.id) as lines
      from receipts r left join suppliers s on s.id = r.supplier_id order by r.received_on desc, r.created_at desc limit 5`),
    finishedAvailability(d),
    d.execute<{ product: string; jars: number }>(sql`
      select p.name as product, sum(ol.jars)::int as jars
      from outflow_lines ol join outflows o on o.id = ol.outflow_id join products p on p.id = ol.product_id
      where o.type = 'sale' and o.occurred_on between ${monthStart} and ${today}
      group by p.name order by p.name`),
  ]);

  const draftOrders = await d.execute<{ id: string; code: string; supplier: string }>(sql`
    select o.id, o.code, s.name as supplier from purchase_orders o join suppliers s on s.id = o.supplier_id where o.status = 'draft' order by o.created_at`);
  const itemById = new Map(input.items.map((i) => [i.id, i]));
  const active = new Set([...activeItems].map((r) => r.id));
  const alerts: Alert[] = [];

  // Planning set-up.
  for (const s of input.sauces.filter((x) => x.yield.litresPerBatch === null)) {
    alerts.push({
      level: "bad",
      text: (
        <>
          {s.name}: no litres-per-batch figure, so batches can't be planned. <Link href="/settings/yields">Enter an estimate</Link>.
        </>
      ),
    });
  }
  const noPkg = input.catalog.products.filter((p) => p.packaging.length === 0);
  if (noPkg.length) {
    alerts.push({
      level: "bad",
      text: (
        <>
          {noPkg.map((p) => p.name).join(", ")}: no packaging list, so {noPkg.length === 1 ? "it" : "they"} can't be planned.{" "}
          <Link href="/settings/packaging">Set up packaging</Link>.
        </>
      ),
    });
  }
  const uncounted = input.items.filter((i) => active.has(i.id) && input.stock[i.id]?.onHand == null);
  if (uncounted.length) {
    alerts.push({
      level: "warn",
      text: (
        <>
          {uncounted.length} of {active.size} ingredients and packaging items have no stock count yet, so their stock is unknown
          {uncounted.length <= 4 ? ` (${uncounted.map((i) => i.name).join(", ")})` : ""}. <Link href="/stock/count">Count stock</Link>.
        </>
      ),
    });
  }

  // Shortages for confirmed runs: what they still need vs what is in stock.
  const shortLines: { name: string; unit: UnitCode; short: Decimal; onOrder: Decimal; toBuy: Decimal; runs: string; itemId: string; onHand: Decimal | null }[] = [];
  for (const r of runNeeds) {
    const item = itemById.get(r.item_id);
    if (!item) continue;
    const pos = input.stock[r.item_id];
    const onHand = pos?.onHand ?? null;
    const short = new Decimal(r.reserved).minus(onHand ?? 0);
    if (short.lte(0)) continue;
    const onOrder = pos?.onOrder ?? new Decimal(0);
    let toBuy = Decimal.max(0, short.minus(onOrder));
    if (item.stockUnit === "unit") toBuy = toBuy.ceil();
    shortLines.push({ name: item.name, unit: item.stockUnit, short, onOrder, toBuy, runs: r.runs, itemId: item.id, onHand });
  }
  if (shortLines.length) {
    const buy = shortLines.filter((s) => s.toBuy.gt(0));
    alerts.push({
      level: buy.length ? "bad" : "warn",
      text: (
        <>
          Confirmed runs need more than is in stock:
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            {shortLines.slice(0, 8).map((s) => (
              <li key={s.itemId}>
                <Link href={`/stock/${s.itemId}`}>{s.name}</Link>: short {formatQty(s.short, s.unit)}
                {s.onHand === null && " (never counted)"}
                {s.onOrder.gt(0) && `, ${formatQty(s.onOrder, s.unit)} on order`}
                <span className="small"> · {s.runs}</span>
              </li>
            ))}
            {shortLines.length > 8 && <li>…and {shortLines.length - 8} more</li>}
          </ul>
          {buy.length ? (
            <Link href={`/orders/plan?items=${encodeURIComponent(buy.map((s) => `${s.itemId}:${s.toBuy.toString()}`).join(","))}`}>Order what's missing</Link>
          ) : (
            "Everything short is already on order; check it arrives in time."
          )}
        </>
      ),
    });
  }

  // Orders prepared but not sent.
  const drafts = [...draftOrders];
  if (drafts.length) {
    alerts.push({
      level: "warn",
      text: (
        <>
          {drafts.length} draft order{drafts.length === 1 ? "" : "s"} not sent yet: {drafts.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ", "}
              <Link href={`/orders/${o.id}`}>{o.code}</Link> ({o.supplier})
            </span>
          ))}
          . Mark each as sent once placed with the supplier.
        </>
      ),
    });
  }

  // Overdue deliveries.
  for (const o of [...orders].filter((x) => x.expected_on && x.expected_on < today)) {
    alerts.push({
      level: "warn",
      text: (
        <>
          {o.code} from {o.supplier} was expected {o.expected_on} and hasn't fully arrived. <Link href={`/deliveries/new?po=${o.id}`}>Record the delivery</Link> or{" "}
          <Link href="/orders">check the order</Link>.
        </>
      ),
    });
  }

  // Batches waiting on something (their production date has come).
  for (const b of [...batches].filter((x) => x.planned_for <= today)) {
    const why =
      b.status === "planned"
        ? `planned for ${b.planned_for}, nothing recorded yet`
        : b.status === "in_production"
          ? b.pending > 0
            ? `${b.pending} ingredient line(s) still pending`
            : "ingredients recorded, measured output still missing"
          : b.status === "awaiting_packaging"
            ? "output measured, packaging not recorded yet"
            : b.pending > 0
              ? `packed, but ${b.pending} ingredient line(s) still pending before it can close`
              : `packed, waiting to be closed${b.bulk_left && new Decimal(b.bulk_left).gt(0) ? ` (${new Decimal(b.bulk_left).toString()} L bulk left)` : ""}`;
    alerts.push({
      level: "warn",
      text: (
        <>
          <Link href={`/batches/${b.id}`}>{b.code}</Link> ({b.sauce}): {why}.
        </>
      ),
    });
  }

  // Pending sales orders that free stock can't cover.
  const salesShort = new Map<string, { code: string; who: string | null; parts: string[] }>();
  for (const l of pendingSales) {
    const onHand = new Decimal(l.on_hand);
    const free = Decimal.max(0, onHand.minus(l.other));
    if (free.gte(l.jars)) continue;
    const entry = salesShort.get(l.id) ?? { code: l.code, who: l.who, parts: [] };
    entry.parts.push(`${l.product}: ${l.jars} ordered, ${free} free${new Decimal(l.other).gt(0) ? ` (${onHand} in stock, ${l.other} promised to other orders)` : ""}`);
    salesShort.set(l.id, entry);
  }
  for (const [id, s] of salesShort) {
    alerts.push({
      level: "warn",
      text: (
        <>
          <Link href={`/outbound/orders/${id}`}>{s.code}</Link>
          {s.who && ` (${s.who})`} can't be fully delivered from stock: {s.parts.join("; ")}. <Link href="/plan">Plan production</Link>.
        </>
      ),
    });
  }

  const upcoming = [...runs];
  const pendingOrders = [...orders];
  const pendingSalesCount = new Set([...pendingSales].map((l) => l.id)).size;
  const soldTotal = [...soldMonth].reduce((a, r) => a + r.jars, 0);
  const jars = available.filter((a) => a.onHand.gt(0) || a.reserved.gt(0));

  return (
    <>
      <h1>Versaa operations</h1>
      <p className="lead">
        {upcoming.length} open run(s) · {[...batches].length} open batch(es) · {pendingOrders.length} purchase order(s) on the way · {pendingSalesCount} sales
        order(s) to deliver · {soldTotal} jars sold this month
      </p>

      <h2 style={{ marginTop: 0 }}>Needs attention</h2>
      <ul className="issues">
        {alerts.map((a, i) => (
          <li key={i} className={a.level}>
            {a.text}
          </li>
        ))}
        {alerts.length === 0 && <li className="ok">Nothing needs attention right now.</li>}
      </ul>

      <div className="grid">
        <section className="card scroll">
          <strong>Upcoming runs</strong>
          {upcoming.length === 0 ? (
            <p className="small muted">
              No open runs. <Link href="/plan">Plan production</Link>.
            </p>
          ) : (
            <table>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/runs/${r.id}`}>{r.code}</Link>
                      <div className="small muted">
                        {r.planned_for}
                        {r.batches > 0 && ` · ${r.batches} batch(es)`}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${RUN_STATUS[r.status]?.cls ?? ""}`}>{RUN_STATUS[r.status]?.label ?? r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card scroll">
          <strong>Open batches</strong>
          {[...batches].length === 0 ? (
            <p className="small muted">No batches in progress.</p>
          ) : (
            <table>
              <tbody>
                {[...batches].map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/batches/${b.id}`}>{b.code}</Link>
                      <div className="small muted">
                        {b.sauce} · {b.planned_for}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${BATCH_STATUS[b.status]?.cls ?? ""}`}>{BATCH_STATUS[b.status]?.label ?? b.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card scroll">
          <strong>Purchases on the way</strong>
          {pendingOrders.length === 0 ? (
            <p className="small muted">Nothing on order.</p>
          ) : (
            <table>
              <tbody>
                {pendingOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/deliveries/new?po=${o.id}`}>{o.code}</Link>
                      <div className="small muted">
                        {o.supplier} · {o.lines} item(s)
                      </div>
                    </td>
                    <td className="small">
                      {o.expected_on ? (
                        <span className={o.expected_on < today ? "badge bad" : "muted"}>
                          {o.expected_on < today ? "overdue " : "expected "}
                          {o.expected_on}
                        </span>
                      ) : (
                        <span className="muted">no date</span>
                      )}
                      <div>
                        <span className={`badge ${PO_STATUS[o.status]?.cls ?? ""}`}>{PO_STATUS[o.status]?.label}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card scroll">
          <strong>Recent deliveries</strong>
          {[...deliveries].length === 0 ? (
            <p className="small muted">
              No deliveries recorded yet. <Link href="/deliveries/new">Record one</Link>.
            </p>
          ) : (
            <table>
              <tbody>
                {[...deliveries].map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.supplier ?? "Unknown supplier"}
                      <div className="small muted">
                        {r.received_on}
                        {r.delivery_ref && ` · ${r.delivery_ref}`}
                      </div>
                    </td>
                    <td className="num">{r.lines} line(s)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>
            <Link href="/deliveries">All deliveries →</Link>
          </p>
        </section>

        <section className="card scroll">
          <strong>Finished jars</strong>
          {jars.length === 0 ? (
            <p className="small muted">No finished jars in stock.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">In stock</th>
                  <th className="num">Free</th>
                </tr>
              </thead>
              <tbody>
                {jars.map((a) => (
                  <tr key={a.productId}>
                    <td>{a.name}</td>
                    <td className="num">{a.onHand.toString()}</td>
                    <td className="num">
                      {a.available.toString()}
                      {a.reserved.gt(0) && <div className="small muted">{a.reserved.toString()} promised</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            Free = in stock minus jars promised to pending sales orders.
          </p>
        </section>

        <section className="card scroll">
          <strong>Sales this month</strong>
          <span className="small muted"> (jars delivered as sales since {monthStart})</span>
          {soldTotal === 0 ? (
            <p className="small muted">No sales recorded this month.</p>
          ) : (
            <table>
              <tbody>
                {[...soldMonth].map((r) => (
                  <tr key={r.product}>
                    <td>{r.product}</td>
                    <td className="num">{r.jars}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="num">
                    <strong>{soldTotal}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>
            <Link href="/reports">Reports →</Link>
          </p>
        </section>
      </div>

      <h2>Quick actions</h2>
      <div className="grid">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="card" style={{ color: "inherit", textDecoration: "none", marginBottom: 0 }}>
            <strong>{tile.title} →</strong>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {tile.text}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
