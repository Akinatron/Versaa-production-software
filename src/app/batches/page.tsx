import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";
import { SauceName } from "../components/sauce-name";

export const dynamic = "force-dynamic";

const OPEN_ORDER = ["planned", "in_production", "awaiting_packaging", "packing"] as const;

export default async function BatchesPage() {
  const rows = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      sauceColor: t.sauces.color,
      runCode: t.productionRuns.code,
      plannedFor: t.productionRuns.plannedFor,
      pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
      sessions: sql<number>`(select count(*)::int from packaging_sessions s where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .orderBy(t.productionRuns.plannedFor, t.productionBatches.code);
  const closed = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      sauceColor: t.sauces.color,
      runCode: t.productionRuns.code,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .where(sql`${t.productionBatches.status} in ('closed', 'cancelled')`)
    .orderBy(desc(t.productionBatches.closedAt))
    .limit(20);

  const todo = (r: (typeof rows)[number]) => {
    const out: string[] = [];
    if (r.pending > 0) out.push(`${r.pending} ingredient${r.pending === 1 ? "" : "s"} not recorded`);
    if (r.sessions === 0) out.push("not packed");
    return out.length ? out.join(" · ") : "ready to close";
  };
  const open = rows.filter((r) => !["closed", "cancelled"].includes(r.batch.status));

  const nextHref = (r: (typeof rows)[number]) =>
    r.pending > 0 || r.batch.status === "planned" ? `/production/${r.batch.id}` : r.sessions === 0 ? `/packaging/${r.batch.id}` : `/batches/${r.batch.id}`;
  open.sort((a, b) => OPEN_ORDER.indexOf(b.batch.status as never) - OPEN_ORDER.indexOf(a.batch.status as never) || a.plannedFor.localeCompare(b.plannedFor));

  return (
    <>
      <PageHeader title="Batches" />
      <h2 style={{ marginTop: 0 }}>Open</h2>
      <div className="card scroll">
        {open.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No open batches. They appear when a run is confirmed. <Link href="/plan">Plan production</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Sauce</th>
                <th>Run</th>
                <th>Status</th>
                <th>Still to do</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((r) => {
                const s = BATCH_STATUS[r.batch.status]!;
                return (
                  <tr key={r.batch.id}>
                    <td>
                      <Link href={`/batches/${r.batch.id}`}>
                        <strong>{r.batch.code}</strong>
                      </Link>
                    </td>
                    <td>
                      <SauceName name={r.sauce} color={r.sauceColor} />
                    </td>
                    <td>
                      <Link href={`/runs/${r.batch.runId}`}>{r.runCode}</Link>
                      <div className="small muted">{fmtDate(r.batch.producedOn ?? r.plannedFor)}</div>
                    </td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="small">{todo(r)}</td>
                    <td className="num">
                      <Link href={nextHref(r)} className="btn secondary sm">
                        {r.pending > 0 || r.batch.status === "planned" ? "Ingredients" : r.sessions === 0 ? "Jars" : "Close"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <h2>Recently closed</h2>
      <div className="card scroll">
        {closed.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            None yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Sauce</th>
                <th>Run</th>
                <th>Cooked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => {
                const s = BATCH_STATUS[r.batch.status]!;
                return (
                  <tr key={r.batch.id}>
                    <td>
                      <Link href={`/batches/${r.batch.id}`}>{r.batch.code}</Link>
                    </td>
                    <td>
                      <SauceName name={r.sauce} color={r.sauceColor} />
                    </td>
                    <td>
                      <Link href={`/runs/${r.batch.runId}`}>{r.runCode}</Link>
                    </td>
                    <td>{fmtDate(r.batch.producedOn)}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                      {r.batch.closedAt ? <span className="small muted"> {fmtDate(r.batch.closedAt.toISOString().slice(0, 10))}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
