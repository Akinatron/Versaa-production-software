import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { RUN_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { dayOf, fmtDate } from "../components/ui/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const [runs, jars] = await Promise.all([
    db().select().from(t.productionRuns).orderBy(desc(t.productionRuns.plannedFor)),
    db()
      .select({ runId: t.runTargets.runId, jars: sql<number>`sum(${t.runTargets.targetJars})::int` })
      .from(t.runTargets)
      .groupBy(t.runTargets.runId),
  ]);
  const jarsOf = new Map(jars.map((j) => [j.runId, j.jars]));
  return (
    <>
      <PageHeader
        title="Runs"
        actions={
          <Link href="/plan" className="btn">
            Plan a new run
          </Link>
        }
      />
      <div className="card scroll">
        {runs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No runs yet. Plan production and save it as a run.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Production</th>
                <th>Created</th>
                <th className="num">Sellable jars</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`}>{r.code}</Link>
                  </td>
                  <td>{fmtDate(r.plannedFor, { weekday: true })}</td>
                  <td>{fmtDate(dayOf(r.createdAt))}</td>
                  <td className="num">{jarsOf.get(r.id) ?? 0}</td>
                  <td>
                    <span className={`badge ${RUN_STATUS[r.status]!.cls}`}>{RUN_STATUS[r.status]!.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
