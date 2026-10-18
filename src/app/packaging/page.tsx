import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { relDate } from "../components/ui/format";

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
      <PageHeader title="Packaging" lead="Cooked batches waiting to be put in jars." />
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
                <th>Cooked</th>
                <th>Status</th>
                <th className="num">Jars so far</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((r) => {
                const s = BATCH_STATUS[r.batch.status] ?? {
                  label: r.batch.status,
                  cls: "",
                };
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
                    <td>{r.batch.producedOn ? relDate(r.batch.producedOn) : "—"}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                      {r.pending > 0 ? <div className="small muted">{r.pending} ingredient(s) not recorded</div> : null}
                    </td>
                    <td className="num">{r.sessions > 0 ? r.accepted : "—"}</td>
                    <td className="num">
                      <Link href={`/packaging/${r.batch.id}`} className={`btn sm${r.sessions > 0 ? " secondary" : ""}`}>
                        {r.sessions > 0 ? "Open" : "Record jars"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cooking > 0 && (
        <p className="small muted">
          {cooking} {cooking === 1 ? "batch is" : "batches are"} still being cooked in <Link href="/production">Production</Link>.
        </p>
      )}
      <p className="small muted">Closed batches can still have their packaging edited or deleted from their batch page.</p>
    </>
  );
}
