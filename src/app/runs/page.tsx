import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { RUN_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await db().select().from(t.productionRuns).orderBy(desc(t.productionRuns.plannedFor));
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
