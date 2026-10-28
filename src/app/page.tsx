import Link from "next/link";
import { sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { loadPlanInput } from "@/db/planning";
import { finishedAvailability } from "@/db/sales";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { RUN_STATUS } from "./components/labels";
import { PageHeader } from "./components/ui/header";
import { fmtDate, plural, relDate } from "./components/ui/format";
import { SauceName } from "./components/sauce-name";
import { currentUser } from "@/lib/session";
import { daysUntil } from "@/domain/shelf-life";
import { listChanges } from "@/db/changes";
import { fmtWhen, openHref, refLabel, ACTION_LABEL } from "./components/history-format";

export const dynamic = "force-dynamic";

/** Lots this close to their best-before show on Today. */
const EXPIRY_WARN_DAYS = 30;

type Alert = {
  level: "bad" | "warn";
  text: React.ReactNode;
  sub?: React.ReactNode;
  action?: { href: string; label: string };
};

export default async function Home() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const d = db();
  const [input, activeItems, runs, runNeeds, orders, batches, pendingSales, available, soldMonth] = await Promise.all([
    loadPlanInput(d, {}),
    d.execute<{ id: string }>(sql`select id from items where active and kind in ('ingredient', 'packaging')`),
    d.execute<{
      id: string;
      code: string;
      planned_for: string;
      status: string;
      batches: number;
    }>(sql`
      select r.id, r.code, r.planned_for::text, r.status::text, (select count(*)::int from production_batches b where b.run_id = r.id and b.status <> 'cancelled') as batches
      from production_runs r where r.status in ('draft', 'confirmed', 'in_progress') order by r.planned_for`),
    d.execute<{ item_id: string; reserved: string; runs: string }>(sql`
      select r.item_id, sum(r.quantity)::text as reserved, string_agg(distinct pr.code, ', ') as runs
      from reservations r join production_runs pr on pr.id = r.run_id
      where r.released_at is null and r.run_id is not null and pr.status in ('confirmed', 'in_progress')
      group by r.item_id having sum(r.quantity) > 0`),
    d.execute<{
      id: string;
      code: string;
      supplier: string;
      status: string;
      expected_on: string | null;
      ordered_on: string | null;
      lines: number;
    }>(sql`
      select o.id, o.code, s.name as supplier, o.status::text, o.expected_on::text, o.ordered_on::text,
        (select count(*)::int from purchase_order_lines l where l.purchase_order_id = o.id) as lines
      from purchase_orders o join suppliers s on s.id = o.supplier_id
      where o.status in ('sent', 'partly_received') order by o.expected_on nulls last`),
    d.execute<{
      id: string;
      code: string;
      status: string;
      sauce: string;
      sauce_color: string;
      planned_for: string;
      pending: number;
      sessions: number;
    }>(sql`
      select b.id, b.code, b.status::text, s.name as sauce, s.color as sauce_color, r.planned_for::text,
        (select count(*)::int from batch_consumption c where c.batch_id = b.id and c.confirmed_at is null) as pending,
        (select count(*)::int from packaging_sessions ps where ps.batch_id = b.id and ps.deleted_at is null) as sessions
      from production_batches b join sauces s on s.id = b.sauce_id join production_runs r on r.id = b.run_id
      where b.status not in ('closed', 'cancelled') order by r.planned_for, b.code`),
    d.execute<{
      id: string;
      code: string;
      who: string | null;
      product: string;
      jars: number;
      on_hand: string;
      other: string;
    }>(sql`
      select so.id, so.code, coalesce(c.name, so.destination) as who, p.name as product, sol.jars,
        (select coalesce(sum(m.quantity), 0)::text from movements m where m.item_id = p.item_id) as on_hand,
        (select coalesce(sum(r.quantity), 0)::text from reservations r
           where r.item_id = p.item_id and r.released_at is null and r.sales_order_id is not null and r.sales_order_id <> so.id) as other
      from sales_orders so
      join sales_order_lines sol on sol.sales_order_id = so.id
      join products p on p.id = sol.product_id
      left join customers c on c.id = so.customer_id
      where so.status = 'pending' order by so.ordered_on, so.code`),
    finishedAvailability(d),
    d.execute<{ product: string; jars: number }>(sql`
      select p.name as product, sum(ol.jars)::int as jars
      from outflow_lines ol join outflows o on o.id = ol.outflow_id and o.deleted_at is null join products p on p.id = ol.product_id
      where o.type = 'sale' and o.occurred_on between ${monthStart} and ${today}
      group by p.name order by p.name`),
  ]);

  const draftOrders = await d.execute<{
    id: string;
    code: string;
    supplier: string;
  }>(sql`
    select o.id, o.code, s.name as supplier from purchase_orders o join suppliers s on s.id = o.supplier_id where o.status = 'draft' order by o.created_at`);
  const itemById = new Map(input.items.map((i) => [i.id, i]));
  const active = new Set([...activeItems].map((r) => r.id));
  const alerts: Alert[] = [];

  // Planning set-up.
  for (const s of input.sauces.filter((x) => x.yield.litresPerBatch === null)) {
    alerts.push({
      level: "bad",
      text: <>{s.name} can't be planned</>,
      sub: "No litres-per-batch figure yet.",
      action: { href: "/settings/yields", label: "Enter an estimate" },
    });
  }
  const noPkg = input.catalog.products.filter((p) => p.packaging.length === 0);
  if (noPkg.length) {
    alerts.push({
      level: "bad",
      text: <>{plural(noPkg.length, "product")} without a packaging list</>,
      sub: noPkg.map((p) => p.name).join(", "),
      action: { href: "/settings/packaging", label: "Set up packaging" },
    });
  }
  const uncounted = input.items.filter((i) => active.has(i.id) && input.stock[i.id]?.onHand == null);
  if (uncounted.length) {
    alerts.push({
      level: "warn",
      text: (
        <>
          {uncounted.length} of {active.size} items have never been counted
        </>
      ),
      sub: uncounted.length <= 4 ? uncounted.map((i) => i.name).join(", ") : "Their stock is unknown until they are.",
      action: { href: "/stock/count", label: "Count stock" },
    });
  }

  // Shortages for confirmed runs: what they still need vs what is in stock.
  const shortLines: {
    name: string;
    unit: UnitCode;
    short: Decimal;
    onOrder: Decimal;
    toBuy: Decimal;
    runs: string;
    itemId: string;
    onHand: Decimal | null;
  }[] = [];
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
    shortLines.push({
      name: item.name,
      unit: item.stockUnit,
      short,
      onOrder,
      toBuy,
      runs: r.runs,
      itemId: item.id,
      onHand,
    });
  }
  if (shortLines.length) {
    const buy = shortLines.filter((s) => s.toBuy.gt(0));
    const runsShort = [...new Set(shortLines.flatMap((s) => s.runs.split(", ")))].join(", ");
    alerts.push(
      buy.length
        ? {
            level: "bad",
            text: (
              <>
                {plural(buy.length, "item")} to buy for {runsShort}
              </>
            ),
            sub:
              buy
                .slice(0, 6)
                .map((s) => `${s.name} ${formatQty(s.toBuy, s.unit)}${s.onHand === null ? " (never counted)" : ""}`)
                .join(" · ") + (buy.length > 6 ? ` · and ${buy.length - 6} more` : ""),
            action: {
              href: `/orders/plan?items=${encodeURIComponent(buy.map((s) => `${s.itemId}:${s.toBuy.toString()}`).join(","))}`,
              label: "Order what's missing",
            },
          }
        : {
            level: "warn",
            text: (
              <>
                {plural(shortLines.length, "item")} for {runsShort} still on the way
              </>
            ),
            sub: `${shortLines.map((s) => s.name).join(", ")}. Already ordered; check it arrives in time.`,
            action: { href: "/deliveries", label: "See deliveries" },
          },
    );
  }

  // Orders prepared but not sent.
  for (const o of [...draftOrders]) {
    alerts.push({
      level: "warn",
      text: (
        <>
          Send order {o.code} to {o.supplier}
        </>
      ),
      sub: "Prepared but not sent yet. Mark it as sent once placed with the supplier.",
      action: { href: `/orders/${o.id}`, label: "Open order" },
    });
  }

  // Overdue deliveries.
  for (const o of [...orders].filter((x) => x.expected_on && x.expected_on < today)) {
    alerts.push({
      level: "warn",
      text: <>{o.supplier} delivery is late</>,
      sub: `${o.code} was expected ${fmtDate(o.expected_on)} and hasn't fully arrived.`,
      action: { href: `/deliveries/new?po=${o.id}`, label: "Record delivery" },
    });
  }

  // Batches waiting on something (their production date has come).
  for (const b of [...batches].filter((x) => x.planned_for <= today)) {
    const step =
      b.status === "planned"
        ? {
            why: `To cook, planned ${relDate(b.planned_for)}`,
            href: `/batches/${b.id}/cook`,
            label: "Record ingredients",
          }
        : b.pending > 0
          ? {
              why: `${plural(b.pending, "ingredient line")} still to record`,
              href: `/batches/${b.id}/cook`,
              label: "Record ingredients",
            }
          : b.sessions === 0
            ? {
                why: "Cooked, jars not recorded yet",
                href: `/batches/${b.id}/pack`,
                label: "Record jars",
              }
            : {
                why: "Packed, ready to close",
                href: `/batches/${b.id}/close`,
                label: "Close batch",
              };
    alerts.push({
      level: "warn",
      text: (
        <>
          {b.code} · <SauceName name={b.sauce} color={b.sauce_color} />
        </>
      ),
      sub: step.why,
      action: { href: step.href, label: step.label },
    });
  }

  // Pending sales orders that free stock can't cover.
  const salesShort = new Map<string, { code: string; who: string | null; parts: string[] }>();
  for (const l of pendingSales) {
    const onHand = new Decimal(l.on_hand);
    const free = Decimal.max(0, onHand.minus(l.other));
    if (free.gte(l.jars)) continue;
    const entry = salesShort.get(l.id) ?? {
      code: l.code,
      who: l.who,
      parts: [],
    };
    entry.parts.push(`${l.product}: ${l.jars} ordered, ${free} free`);
    salesShort.set(l.id, entry);
  }
  for (const [id, s] of salesShort) {
    alerts.push({
      level: "warn",
      text: <>Not enough jars for {s.who ?? s.code}</>,
      sub: (
        <>
          <Link href={`/outbound/orders/${id}`}>{s.code}</Link> · {s.parts.join(" · ")}
        </>
      ),
      action: { href: "/plan", label: "Plan production" },
    });
  }
  // Lots in stock that are past or near their best-before: use or sell them first.
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + EXPIRY_WARN_DAYS * 864e5).toISOString().slice(0, 10);
  const expiring = await d.execute<{ id: string; code: string; best_before: string; name: string; kind: string; stock_unit: string; on_hand: string }>(sql`
    select l.id, l.code, l.best_before::text, i.name, i.kind::text, i.stock_unit::text, sum(m.quantity)::text as on_hand
    from lots l join items i on i.id = l.item_id join movements m on m.lot_id = l.id
    where l.best_before is not null and l.best_before <= ${soon} and i.kind in ('ingredient', 'finished')
    group by l.id, i.id having sum(m.quantity) > 0
    order by l.best_before, l.code`);
  for (const l of expiring) {
    const days = daysUntil(l.best_before, today);
    const left = l.kind === "finished" ? plural(Number(l.on_hand), "jar") : formatQty(new Decimal(l.on_hand), l.stock_unit as UnitCode);
    alerts.push({
      level: days < 0 ? "bad" : "warn",
      text: (
        <>
          {l.name} lot {l.code}{" "}
          {days < 0 ? "is past its best-before" : days === 0 ? "reaches its best-before today" : `reaches its best-before in ${plural(days, "day")}`}
        </>
      ),
      sub: `Best before ${fmtDate(l.best_before, { year: true })} · ${left} left. ${l.kind === "finished" ? "Sell these first." : "Use this lot first."}`,
      action: { href: `/trace/lot/${l.id}`, label: "Open lot" },
    });
  }

  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));

  const upcoming = [...runs];
  const pendingOrders = [...orders];
  const pendingSalesIds = [...new Set([...pendingSales].map((l) => l.id))];
  const soldTotal = [...soldMonth].reduce((a, r) => a + r.jars, 0);
  const jars = available.filter((a) => a.onHand.gt(0) || a.reserved.gt(0));
  const freeJars = available.reduce((a, r) => a.plus(r.available), new Decimal(0));
  const openBatches = [...batches];
  const toCook = openBatches.filter((b) => b.status === "planned" || b.status === "in_production").length;
  const toPack = openBatches.length - toCook;

  // One agenda of what's coming: production days, deliveries expected, sales to deliver.
  type Ev = {
    date: string | null;
    kind: string;
    title: React.ReactNode;
    sub?: React.ReactNode;
    href: string;
  };
  const agenda: Ev[] = [
    ...upcoming.map((r) => ({
      date: r.planned_for,
      kind: "Production",
      title: r.code,
      sub: (
        <>
          <span className={`badge ${RUN_STATUS[r.status]?.cls ?? ""}`}>{RUN_STATUS[r.status]?.label ?? r.status}</span>
          {r.batches > 0 && ` ${plural(r.batches, "batch", "batches")}`}
        </>
      ),
      href: `/runs/${r.id}`,
    })),
    ...pendingOrders.map((o) => ({
      date: o.expected_on,
      kind: "Delivery",
      title: o.supplier,
      sub: (
        <>
          {o.code} · {plural(o.lines, "item")}
          {o.expected_on && o.expected_on < today && (
            <>
              {" "}
              <span className="badge bad">late</span>
            </>
          )}
        </>
      ),
      href: `/deliveries/new?po=${o.id}`,
    })),
    ...pendingSalesIds.map((id) => {
      const l = [...pendingSales].find((x) => x.id === id)!;
      const n = [...pendingSales].filter((x) => x.id === id).reduce((a, x) => a + x.jars, 0);
      return {
        date: null,
        kind: "To deliver",
        title: l.who ?? l.code,
        sub: (
          <>
            {l.code} · {n} jars
          </>
        ),
        href: `/outbound/orders/${id}`,
      };
    }),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return (
    <>
      <PageHeader
        title="Today"
        lead={fmtDate(today, { weekday: true, year: true })}
        actions={
          <>
            <Link href="/deliveries/new" className="btn secondary">
              Record a delivery
            </Link>
            <Link href="/outbound/new" className="btn secondary">
              Record a stock exit
            </Link>
            <Link href="/plan" className="btn">
              Plan production
            </Link>
          </>
        }
      />

      <div className="stats">
        <Link href="/batches?show=cook">
          <div className="v">{toCook}</div>
          <div className="l">{toCook === 1 ? "batch" : "batches"} to cook</div>
        </Link>
        <Link href="/batches?show=pack">
          <div className="v">{toPack}</div>
          <div className="l">{toPack === 1 ? "batch" : "batches"} to pack or close</div>
        </Link>
        <Link href="/orders">
          <div className="v">{pendingOrders.length}</div>
          <div className="l">{pendingOrders.length === 1 ? "order" : "orders"} on the way</div>
        </Link>
        <Link href="/outbound">
          <div className="v">{freeJars.toString()}</div>
          <div className="l">jars free to sell</div>
        </Link>
        <Link href="/reports">
          <div className="v">{soldTotal}</div>
          <div className="l">jars sold this month</div>
        </Link>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>To do</h2>
          {alerts.length > 0 && <span className="muted small">{plural(alerts.length, "thing")} waiting</span>}
        </div>
        {alerts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="worklist">
            {alerts.map((a, i) => (
              <li key={i}>
                <span className={`dot ${a.level}`} aria-label={a.level === "bad" ? "Urgent" : "To do"} />
                <div className="what">
                  <div>{a.text}</div>
                  {a.sub && <div className="sub">{a.sub}</div>}
                </div>
                {a.action && (
                  <Link href={a.action.href} className={`btn sm ${a.level === "bad" ? "" : "secondary"}`}>
                    {a.action.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Coming up</h2>
            <Link href="/runs" className="more">
              All runs
            </Link>
          </div>
          {agenda.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing planned. <Link href="/plan">Plan production</Link>.
            </p>
          ) : (
            <ul className="worklist">
              {agenda.map((e, i) => (
                <li key={i}>
                  <div style={{ width: 76, flex: "none" }}>
                    <div style={{ fontWeight: 650 }}>{e.date ? relDate(e.date) : "—"}</div>
                    <div className="small muted">{e.kind}</div>
                  </div>
                  <div className="what">
                    <Link href={e.href}>{e.title}</Link>
                    {e.sub && <div className="sub">{e.sub}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Jars in stock</h2>
            <Link href="/outbound" className="more">
              Outbound
            </Link>
          </div>
          {jars.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No finished jars in stock.
            </p>
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
                      <strong className={a.available.lte(0) ? "text-bad" : undefined}>{a.available.toString()}</strong>
                      {a.reserved.gt(0) && <div className="small muted">{a.reserved.toString()} promised</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <LatestChanges />
      </div>
    </>
  );
}

/** What other people changed lately, so a correction made elsewhere doesn't go unnoticed. */
async function LatestChanges() {
  const me = await currentUser();
  const rows = await listChanges(db(), { exceptUserId: me?.id ?? null, limit: 6 });
  return (
    <section className="card">
      <div className="card-head">
        <h2>Latest changes</h2>
        <Link href="/history" className="more">
          History
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Nobody else has changed anything yet.
        </p>
      ) : (
        <ul className="worklist">
          {rows.map((c) => (
            <li key={c.id}>
              <div className="what">
                <span className={`badge ${ACTION_LABEL[c.action].cls}`}>{ACTION_LABEL[c.action].label}</span>{" "}
                <Link href={openHref({ type: c.entityType, id: c.entityId })}>{refLabel({ type: c.entityType, id: c.entityId, code: c.entityCode })}</Link>
                <div className="sub">
                  {c.summary}
                  {c.reason ? ` · “${c.reason}”` : ""}
                </div>
                <div className="sub">
                  {fmtWhen(c.at)} · {c.userName ?? "someone"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
