import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";

export const dynamic = "force-dynamic";

const OPEN_ORDER = ["planned", "in_production", "awaiting_packaging", "packing"] as const;

export default async function BatchesPage() {
  const rows = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      runCode: t.productionRuns.code,
      plannedFor: t.productionRuns.plannedFor,
      pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
      sessions: sql<number>`(select count(*)::int from packaging_sessions s where s.batch_id = ${t.productionBatches.id})`,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .orderBy(t.productionRuns.plannedFor, t.productionBatches.code);
  const closed = await db()
    .select({ batch: t.productionBatches, sauce: t.sauces.name, runCode: t.productionRuns.code })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .where(sql`${t.productionBatches.status} in ('closed', 'cancelled')`)
    .orderBy(desc(t.productionBatches.closedAt))
    .limit(20);

  const todo = (r: (typeof rows)[number]) => {
    const out: string[] = [];
    if (r.pending > 0) out.push(`${r.pending} ingredient${r.pending === 1 ? "" : "s"} pending`);
    if (r.batch.outputLitres === null && r.batch.outputKg === null) out.push("output not measured");
    if (r.sessions === 0) out.push("not packed");
    return out.length ? out.join(" · ") : "ready to close";
  };
  const open = rows.filter((r) => !["closed", "cancelled"].includes(r.batch.status));

  return (
    <>
      <h1>Batches</h1>
      <p className="lead">
        One batch is one pot of sauce, created when a production run is confirmed. Open a batch to record the ingredients used, the measured output and the jars packed.
      </p>
      {open.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No open batches. Confirm a run on the <a href="/plan">Plan</a> page to create them.
          </p>
        </div>
      )}
      {OPEN_ORDER.map((st) => {
        const list = open.filter((r) => r.batch.status === st);
        if (!list.length) return null;
        const s = BATCH_STATUS[st]!;
        return (
          <section key={st}>
            <h2>
              <span className={`badge ${s.cls}`}>{s.label}</span> <span className="small muted">{list.length}</span>
            </h2>
            <div className="card scroll">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Sauce</th>
                    <th>Run</th>
                    <th>Production date</th>
                    <th>Still to do</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.batch.id}>
                      <td>
                        <a href={`/batches/${r.batch.id}`}>
                          <strong>{r.batch.code}</strong>
                        </a>
                      </td>
                      <td>{r.sauce}</td>
                      <td>
                        <a href={`/runs/${r.batch.runId}`}>{r.runCode}</a>
                      </td>
                      <td>{r.batch.producedOn ?? <span className="muted">planned {r.plannedFor}</span>}</td>
                      <td className={todo(r) === "ready to close" ? "" : "small"}>{todo(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
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
                <th>Production date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => {
                const s = BATCH_STATUS[r.batch.status]!;
                return (
                  <tr key={r.batch.id}>
                    <td>
                      <a href={`/batches/${r.batch.id}`}>{r.batch.code}</a>
                    </td>
                    <td>{r.sauce}</td>
                    <td>
                      <a href={`/runs/${r.batch.runId}`}>{r.runCode}</a>
                    </td>
                    <td>{r.batch.producedOn ?? "—"}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                      {r.batch.closedAt ? <span className="small muted"> {r.batch.closedAt.toISOString().slice(0, 10)}</span> : null}
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
