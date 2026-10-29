import Link from "next/link";
import { sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import type { PlanResult } from "@/domain/planner";
import { OUTFLOW } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";
import { SauceName } from "../components/sauce-name";

export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const money = (v: Decimal) => `€ ${v.toFixed(2)}`;
const pct = (num: number, den: number) => (den > 0 ? `${new Decimal(num).div(den).mul(100).toDecimalPlaces(1).toString()}%` : "—");

function defaultPeriod() {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const def = defaultPeriod();
  let from = isDate(sp.from) ? sp.from : def.from;
  let to = isDate(sp.to) ? sp.to : def.to;
  if (from > to) [from, to] = [to, from];
  const d = db();

  const [sales, other, batches, bySize, runs] = await Promise.all([
    d.execute<{
      sauce: string;
      sauce_color: string;
      size: string;
      jars: number;
      priced: number;
      unpriced: number;
      revenue: string | null;
    }>(sql`
      select s.name as sauce, s.color as sauce_color, f.name as size, sum(ol.jars)::int as jars,
        sum(case when ol.unit_price is not null then ol.jars else 0 end)::int as priced,
        sum(case when ol.unit_price is null then ol.jars else 0 end)::int as unpriced,
        sum(ol.jars * ol.unit_price) as revenue
      from outflow_lines ol
      join outflows o on o.id = ol.outflow_id and o.deleted_at is null
      join products p on p.id = ol.product_id
      join sauces s on s.id = p.sauce_id
      join formats f on f.id = p.format_id
      where o.type = 'sale' and o.occurred_on between ${from} and ${to}
      group by s.name, s.color, f.name, f.capacity_ml
      order by s.name, f.capacity_ml desc`),
    d.execute<{
      type: string;
      product: string;
      jars: number;
      times: number;
    }>(sql`
      select o.type::text as type, p.name as product, sum(ol.jars)::int as jars, count(distinct o.id)::int as times
      from outflow_lines ol
      join outflows o on o.id = ol.outflow_id and o.deleted_at is null
      join products p on p.id = ol.product_id
      where o.type <> 'sale' and o.occurred_on between ${from} and ${to}
      group by o.type, p.name
      order by o.type, p.name`),
    d.execute<{
      id: string;
      code: string;
      sauce: string;
      sauce_color: string;
      closed_on: string;
      litres: string | null;
      version_no: number;
      filled: number;
      rejected: number;
      accepted: number;
    }>(sql`
      select b.id, b.code, s.name as sauce, s.color as sauce_color, to_char(b.closed_at, 'YYYY-MM-DD') as closed_on, (sum(l.filled * l.fill_ml) / 1000.0)::text as litres, v.version_no,
        coalesce(sum(l.filled), 0)::int as filled, coalesce(sum(l.rejected), 0)::int as rejected, coalesce(sum(l.accepted), 0)::int as accepted
      from production_batches b
      join sauces s on s.id = b.sauce_id
      join recipe_versions v on v.id = b.recipe_version_id
      left join packaging_sessions ps on ps.batch_id = b.id and ps.deleted_at is null
      left join packaging_session_lines l on l.session_id = ps.id
      where b.status = 'closed' and b.closed_at::date between ${from} and ${to}
      group by b.id, s.name, s.color, v.version_no
      order by b.closed_at`),
    d.execute<{
      size: string;
      filled: number;
      rejected: number;
      accepted: number;
    }>(sql`
      select f.name as size, sum(l.filled)::int as filled, sum(l.rejected)::int as rejected, sum(l.accepted)::int as accepted
      from production_batches b
      join packaging_sessions ps on ps.batch_id = b.id and ps.deleted_at is null
      join packaging_session_lines l on l.session_id = ps.id
      join products p on p.id = l.product_id
      join formats f on f.id = p.format_id
      where b.status = 'closed' and b.closed_at::date between ${from} and ${to}
      group by f.name, f.capacity_ml
      order by f.capacity_ml desc`),
    d.execute<{
      id: string;
      code: string;
      planned_for: string;
      closed_on: string;
      data: PlanResult | null;
    }>(sql`
      select r.id, r.code, r.planned_for::text, to_char(max(b.closed_at), 'YYYY-MM-DD') as closed_on, fs.data
      from production_runs r
      join production_batches b on b.run_id = r.id
      left join forecast_snapshots fs on fs.run_id = r.id
      where r.status = 'closed'
      group by r.id, fs.data
      having max(b.closed_at)::date between ${from} and ${to}
      order by max(b.closed_at)`),
  ]);

  const runIds = [...runs].map((r) => r.id);
  const [actualBatches, actualJars] = runIds.length
    ? await Promise.all([
        d.execute<{
          run_id: string;
          sauce_id: string;
          made: number;
          not_made: number;
        }>(sql`
          select run_id, sauce_id, count(*) filter (where status = 'closed')::int as made, count(*) filter (where status = 'cancelled')::int as not_made
          from production_batches where run_id::text = any(string_to_array(${runIds.join(",")}, ','))
          group by run_id, sauce_id`),
        d.execute<{
          run_id: string;
          product_id: string;
          filled: number;
          accepted: number;
        }>(sql`
          select b.run_id, l.product_id, sum(l.filled)::int as filled, sum(l.accepted)::int as accepted
          from production_batches b
          join packaging_sessions ps on ps.batch_id = b.id and ps.deleted_at is null
          join packaging_session_lines l on l.session_id = ps.id
          where b.run_id::text = any(string_to_array(${runIds.join(",")}, ','))
          group by b.run_id, l.product_id`),
      ])
    : [[], []];

  const saleRows = [...sales];
  const totalJars = saleRows.reduce((a, r) => a + r.jars, 0);
  const totalUnpriced = saleRows.reduce((a, r) => a + r.unpriced, 0);
  const totalRevenue = saleRows.reduce((a, r) => a.plus(r.revenue ?? 0), new Decimal(0));
  const sizeRows = [...bySize];
  const tot = sizeRows.reduce(
    (a, r) => ({
      filled: a.filled + r.filled,
      rejected: a.rejected + r.rejected,
      accepted: a.accepted + r.accepted,
    }),
    { filled: 0, rejected: 0, accepted: 0 },
  );
  const period = `from=${from}&to=${to}`;

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <a href="#downloads" className="btn secondary">
            Download CSV
          </a>
        }
      />

      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <div>
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} required />
        </div>
        <div>
          <label htmlFor="to">To (inclusive)</label>
          <input id="to" name="to" type="date" defaultValue={to} required />
        </div>
        <button type="submit" className="secondary">
          Show period
        </button>
        <Link href="/reports" className="small" style={{ alignSelf: "center" }}>
          This month
        </Link>
      </form>

      <div className="stats">
        <div>
          <div className="v">{totalJars}</div>
          <div className="l">jars sold</div>
        </div>
        <div>
          <div className="v">{money(totalRevenue)}</div>
          <div className="l">
            revenue recorded
            {totalUnpriced > 0 ? ` (${totalUnpriced} jars without price)` : ""}
          </div>
        </div>
        <div>
          <div className="v">{[...batches].length}</div>
          <div className="l">batches closed</div>
        </div>
        <div>
          <div className="v">{tot.accepted}</div>
          <div className="l">jars packed</div>
        </div>
      </div>

      <h2>Sales</h2>
      <div className="card scroll">
        {saleRows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No sales delivered between {fmtDate(from)} and {fmtDate(to)}.
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Sauce</th>
                  <th>Size</th>
                  <th className="num">Jars sold</th>
                  <th className="num">Revenue from recorded prices (not profit)</th>
                  <th className="num">Jars without a price</th>
                </tr>
              </thead>
              <tbody>
                {saleRows.map((r) => (
                  <tr key={`${r.sauce}-${r.size}`}>
                    <td>
                      <SauceName name={r.sauce} color={r.sauce_color} />
                    </td>
                    <td>{r.size}</td>
                    <td className="num">{r.jars}</td>
                    <td className="num">{r.priced > 0 ? money(new Decimal(r.revenue ?? 0)) : "unknown"}</td>
                    <td className="num">{r.unpriced > 0 ? <span className="badge warn">{r.unpriced}</span> : 0}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <strong>Total</strong>
                  </td>
                  <td className="num">
                    <strong>{totalJars}</strong>
                  </td>
                  <td className="num">
                    <strong>{money(totalRevenue)}</strong>
                  </td>
                  <td className="num">
                    <strong>{totalUnpriced}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Only deliveries of type "sale" count. Revenue from recorded prices (not profit): jars sold × the unit price recorded on the order.
              {totalUnpriced > 0 && ` ${totalUnpriced} jar(s) had no price recorded, so their revenue is unknown and not included.`}
            </p>
          </>
        )}
      </div>

      <h2>Other stock exits (not sales)</h2>
      <div className="card scroll">
        {[...other].length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No own use, tests, samples or waste in this period.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Product</th>
                <th className="num">Jars</th>
                <th className="num">Times</th>
              </tr>
            </thead>
            <tbody>
              {[...other].map((r) => (
                <tr key={`${r.type}-${r.product}`}>
                  <td>{OUTFLOW[r.type] ?? r.type}</td>
                  <td>{r.product}</td>
                  <td className="num">{r.jars}</td>
                  <td className="num">{r.times}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          These jars left stock but are not sales.
        </p>
      </div>

      <h2>Production</h2>
      <div className="card scroll">
        {[...batches].length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No batches closed in this period.
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Sauce</th>
                  <th>Recipe</th>
                  <th>Closed</th>
                  <th className="num">Litres (from jars)</th>
                  <th className="num">Filled</th>
                  <th className="num">Rejected</th>
                  <th className="num">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {[...batches].map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/batches/${b.id}`}>{b.code}</Link>
                    </td>
                    <td>
                      <SauceName name={b.sauce} color={b.sauce_color} />
                    </td>
                    <td>v{b.version_no}</td>
                    <td>{fmtDate(b.closed_on)}</td>
                    <td className="num">{b.litres ? `${new Decimal(b.litres).toDecimalPlaces(3).toString()} L` : "—"}</td>
                    <td className="num">{b.filled}</td>
                    <td className="num">{b.rejected}</td>
                    <td className="num">{b.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 style={{ fontSize: "1rem", margin: "16px 0 4px" }}>Jars by size</h3>
            <table>
              <thead>
                <tr>
                  <th>Size</th>
                  <th className="num">Filled</th>
                  <th className="num">Rejected</th>
                  <th className="num">Accepted</th>
                  <th className="num">Reject rate (measured)</th>
                </tr>
              </thead>
              <tbody>
                {sizeRows.map((r) => (
                  <tr key={r.size}>
                    <td>{r.size}</td>
                    <td className="num">{r.filled}</td>
                    <td className="num">{r.rejected}</td>
                    <td className="num">{r.accepted}</td>
                    <td className="num">{pct(r.rejected, r.filled)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="num">
                    <strong>{tot.filled}</strong>
                  </td>
                  <td className="num">
                    <strong>{tot.rejected}</strong>
                  </td>
                  <td className="num">
                    <strong>{tot.accepted}</strong>
                  </td>
                  <td className="num">
                    <strong>{pct(tot.rejected, tot.filled)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>

      <h2>Plan vs actual</h2>
      <p className="small muted">For each run closed in this period: what the forecast frozen at confirmation said, against what was recorded.</p>
      {[...runs].length === 0 ? (
        <p className="card muted">No run was closed in this period.</p>
      ) : (
        [...runs].map((r) => {
          const plan = r.data;
          const ab = [...actualBatches].filter((x) => x.run_id === r.id);
          const aj = [...actualJars].filter((x) => x.run_id === r.id);
          return (
            <div key={r.id} className="card scroll">
              <strong>
                <Link href={`/runs/${r.id}`}>{r.code}</Link>
              </strong>{" "}
              <span className="small muted">
                planned for {fmtDate(r.planned_for)} · closed {fmtDate(r.closed_on)}
              </span>
              {!plan ? (
                <p className="small">No forecast was saved for this run.</p>
              ) : (
                <>
                  <table style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Sauce</th>
                        <th className="num">Batches planned</th>
                        <th className="num">Batches made</th>
                        <th className="num">Not made</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.sauces.map((s) => {
                        const a = ab.find((x) => x.sauce_id === s.sauceId);
                        return (
                          <tr key={s.sauceId}>
                            <td>{s.name}</td>
                            <td className="num">{s.batches ?? "unknown"}</td>
                            <td className="num">{a?.made ?? 0}</td>
                            <td className="num">{a?.not_made ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <table style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Sellable target</th>
                        <th className="num">Planned to fill</th>
                        <th className="num">Filled</th>
                        <th className="num">Accepted</th>
                        <th className="num">vs target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.products.map((p) => {
                        const a = aj.find((x) => x.product_id === p.productId);
                        const acc = a?.accepted ?? 0;
                        const diff = acc - p.targetJars;
                        return (
                          <tr key={p.productId}>
                            <td>{p.name}</td>
                            <td className="num">{p.targetJars}</td>
                            <td className="num">{p.jarsToFill}</td>
                            <td className="num">{a?.filled ?? 0}</td>
                            <td className="num">{acc}</td>
                            <td className="num">
                              <span className={`badge ${diff >= 0 ? "ok" : "warn"}`}>{diff >= 0 ? `+${diff}` : diff}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {aj
                        .filter((x) => !plan.products.some((p) => p.productId === x.product_id))
                        .map((x) => (
                          <tr key={x.product_id}>
                            <td className="muted">Not in plan</td>
                            <td className="num">0</td>
                            <td className="num">0</td>
                            <td className="num">{x.filled}</td>
                            <td className="num">{x.accepted}</td>
                            <td className="num">+{x.accepted}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })
      )}

      <h2 id="downloads">Downloads</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          <strong>Excel</strong> files open the same in any Excel, Numbers or Google Sheets, with real numbers and dates. <strong>CSV</strong> is plain text for
          other tools (comma separated, decimal point). &quot;Everything&quot; includes all history; &quot;this period&quot; only {fmtDate(from)} to{" "}
          {fmtDate(to)}.
        </p>
        <table>
          <tbody>
            {[
              ["movements", "Stock movements", "the full ledger: every quantity in or out, with item, lot, reason and document"],
              ["lots", "Lots", "every lot with its origin (supplier or batch) and what is left"],
              ["sales", "Outbound (all stock exits)", "every jar that left stock: reason, date, customer, product, lot, batch, price"],
              ["batches", "Batches", "every batch with recipe version, dates, litres (from jars filled) and jars"],
            ].map(([name, title, text]) => (
              <tr key={name}>
                <td>
                  <strong>{title}</strong>
                  <div className="small muted">{text}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div>
                    Excel:{" "}
                    <a href={`/export/${name}?format=xlsx`} download>
                      Everything
                    </a>
                    {name !== "lots" && (
                      <>
                        {" · "}
                        <a href={`/export/${name}?format=xlsx&${period}`} download>
                          This period
                        </a>
                      </>
                    )}
                  </div>
                  <div className="small">
                    CSV:{" "}
                    <a href={`/export/${name}`} download>
                      Everything
                    </a>
                    {name !== "lots" && (
                      <>
                        {" · "}
                        <a href={`/export/${name}?${period}`} download>
                          This period
                        </a>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
