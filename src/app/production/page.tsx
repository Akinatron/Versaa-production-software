import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { relDate } from "../components/ui/format";
import { SauceName } from "../components/sauce-name";

export const dynamic = "force-dynamic";

/** Production: batches still to cook, where the ingredients used are recorded. */
export default async function ProductionPage() {
  const rows = await db()
    .select({
      batch: t.productionBatches,
      sauce: t.sauces.name,
      sauceColor: t.sauces.color,
      runCode: t.productionRuns.code,
      plannedFor: t.productionRuns.plannedFor,
      pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
      lines: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id})`,
    })
    .from(t.productionBatches)
    .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
    .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id))
    .where(sql`${t.productionBatches.status} not in ('closed', 'cancelled')`)
    .orderBy(t.productionRuns.plannedFor, t.productionBatches.code);
  const toCook = rows.filter((r) => r.pending > 0 || r.lines === 0);
  const cooked = rows.length - toCook.length;

  return (
    <>
      <PageHeader title="Production" />
      <div className="card scroll">
        {toCook.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing to cook. Batches appear here when a run is confirmed. <Link href="/plan">Plan production</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Sauce</th>
                <th>Run</th>
                <th>Cook on</th>
                <th>Still to record</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {toCook.map((r) => {
                const s = BATCH_STATUS[r.batch.status] ?? {
                  label: r.batch.status,
                  cls: "",
                };
                return (
                  <tr key={r.batch.id}>
                    <td>
                      <Link href={`/production/${r.batch.id}`}>
                        <strong>{r.batch.code}</strong>
                      </Link>
                    </td>
                    <td>
                      <SauceName name={r.sauce} color={r.sauceColor} />
                    </td>
                    <td>
                      <Link href={`/runs/${r.batch.runId}`}>{r.runCode}</Link>
                    </td>
                    <td>
                      {relDate(r.plannedFor)}
                      {r.batch.status !== "planned" && (
                        <>
                          {" "}
                          <span className={`badge ${s.cls}`}>{s.label}</span>
                        </>
                      )}
                    </td>
                    <td className="small">{r.lines === 0 ? "no recipe lines" : `${r.pending} of ${r.lines} ingredients`}</td>
                    <td className="num">
                      <Link href={`/production/${r.batch.id}`} className="btn sm">
                        Record ingredients
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cooked > 0 && (
        <p className="small muted">
          {cooked} cooked {cooked === 1 ? "batch is" : "batches are"} waiting in <Link href="/packaging">Packaging</Link>. Their ingredients can still be
          corrected from the batch page until the batch is closed.
        </p>
      )}
    </>
  );
}
