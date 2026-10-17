import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { RUN_STATUS } from "../components/labels";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await db().select().from(t.productionRuns).orderBy(desc(t.productionRuns.plannedFor));
  return (
    <>
      <h1>Production runs</h1>
      <p className="lead">Saved plans. Confirming a run reserves the stock it needs; production itself is recorded later.</p>
      <p>
        <Link href="/plan">+ Plan a new run</Link>
      </p>
      <div className="card scroll">
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`}>{r.code}</Link>
                  </td>
                  <td>{r.plannedFor}</td>
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
