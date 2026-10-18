import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";

export const dynamic = "force-dynamic";

/** Packaging: cooked batches waiting to be put in jars (or still being packed). */
export default async function PackagingPage() {
  const rows = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      runCode: t.productionRuns.code,
      pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
      sessions: sql<number>`(select count(*)::int from packaging_sessions s where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
      accepted: sql<number>`(select coalesce(sum(l.accepted), 0)::int from packaging_sessions s join packaging_session_lines l on l.session_id = s.id
        where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .where(sql`${t.productionBatches.status} not in ('closed', 'cancelled')`)
    .orderBy(t.productionBatches.producedOn, t.productionBatches.code);
  const waiting = rows.filter((r) => r.pending === 0 || r.sessions > 0);
  const cooking = rows.length - waiting.length;

  return (
    <>
      <h1>Packaging</h1>
      <p className="lead">Cooked batches waiting to be put in jars. Open one to record a packaging session, or to edit or delete one already recorded.</p>
      <div className="card scroll">
        {waiting.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No cooked batches waiting. Batches appear here once their ingredients are recorded in <Link href="/production">Production</Link>.
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
                <th className="num">Sessions</th>
                <th className="num">Jars accepted</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((r) => {
                const s = BATCH_STATUS[r.batch.status] ?? { label: r.batch.status, cls: "" };
                return (
                  <tr key={r.batch.id}>
                    <td>
                      <Link href={`/packaging/${r.batch.id}`}>
                        <strong>{r.batch.code}</strong>
                      </Link>
                    </td>
                    <td>{r.sauce}</td>
                    <td>
                      <Link href={`/runs/${r.batch.runId}`}>{r.runCode}</Link>
                    </td>
                    <td>{r.batch.producedOn ?? "—"}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                      {r.pending > 0 ? <span className="small muted"> · {r.pending} ingredient(s) not recorded</span> : null}
                    </td>
                    <td className="num">{r.sessions}</td>
                    <td className="num">{r.accepted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cooking > 0 && (
        <p className="small muted">
          {cooking} batch(es) are still being cooked in <Link href="/production">Production</Link>.
        </p>
      )}
      <p className="small muted">Closed batches can still have their packaging edited or deleted from their batch page.</p>
    </>
  );
}
