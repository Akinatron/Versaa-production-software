import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { BATCH_STATUS } from "../components/labels";
import { PageHeader } from "../components/ui/header";
import { fmtDate, relDate } from "../components/ui/format";
import { SauceName } from "../components/sauce-name";
import { batchHref, batchStepFor } from "../components/batch-paths";
import { dayOf } from "@/domain/dates";

export const dynamic = "force-dynamic";

type Show = "cook" | "pack" | "closed";
const COOKING = ["planned", "in_production"];
const PACKING = ["awaiting_packaging", "packing"];

/** Every batch in one list, filtered by where it is: to cook, to pack (or close), closed. Each opens on the step it waits on. */
export default async function BatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const base = () =>
    db()
      .select({
        batch: t.productionBatches,
        sauce: t.sauces.name,
        sauceColor: t.sauces.color,
        runCode: t.productionRuns.code,
        plannedFor: t.productionRuns.plannedFor,
        pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
        lines: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id})`,
        sessions: sql<number>`(select count(*)::int from packaging_sessions s where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
        accepted: sql<number>`(select coalesce(sum(l.accepted), 0)::int from packaging_sessions s join packaging_session_lines l on l.session_id = s.id
        where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
      })
      .from(t.productionBatches)
      .innerJoin(t.sauces, eq(t.productionBatches.sauceId, t.sauces.id))
      .innerJoin(t.productionRuns, eq(t.productionBatches.runId, t.productionRuns.id));
  const [open, closed] = await Promise.all([
    base()
      .where(sql`${t.productionBatches.status} not in ('closed', 'cancelled')`)
      .orderBy(t.productionRuns.plannedFor, t.productionBatches.code),
    base()
      .where(sql`${t.productionBatches.status} in ('closed', 'cancelled')`)
      .orderBy(desc(t.productionBatches.closedAt))
      .limit(30),
  ]);
  type Row = (typeof open)[number];
  const toCook = open.filter((r) => COOKING.includes(r.batch.status));
  const toPack = open.filter((r) => PACKING.includes(r.batch.status));
  const asked = sp.show as Show | undefined;
  const show: Show = asked && ["cook", "pack", "closed"].includes(asked) ? asked : toCook.length === 0 && toPack.length > 0 ? "pack" : "cook";

  const tab = (key: Show, label: string, n?: number) => (
    <Link href={`/batches?show=${key}`} aria-current={show === key ? "page" : undefined}>
      {label}
      {n ? ` (${n})` : ""}
    </Link>
  );
  const badge = (r: Row) => {
    const s = BATCH_STATUS[r.batch.status] ?? { label: r.batch.status, cls: "" };
    return <span className={`badge ${s.cls}`}>{s.label}</span>;
  };
  const sauceCell = (r: Row) => <SauceName name={r.sauce} color={r.sauceColor} />;
  const runCell = (r: Row) => <Link href={`/runs/${r.batch.runId}`}>{r.runCode}</Link>;
  const codeCell = (r: Row) => (
    <Link href={batchHref(r.batch.id, batchStepFor({ status: r.batch.status, pending: r.pending, sessions: r.sessions }))}>
      <strong>{r.batch.code}</strong>
    </Link>
  );

  return (
    <>
      <PageHeader title="Batches" />
      <nav className="tabs" aria-label="Show">
        {tab("cook", "To cook", toCook.length)}
        {tab("pack", "To pack", toPack.length)}
        {tab("closed", "Closed")}
      </nav>

      {show === "cook" && (
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
                {toCook.map((r) => (
                  <tr key={r.batch.id}>
                    <td>{codeCell(r)}</td>
                    <td>{sauceCell(r)}</td>
                    <td>{runCell(r)}</td>
                    <td>
                      {relDate(r.plannedFor)}
                      {r.batch.status !== "planned" && <> {badge(r)}</>}
                    </td>
                    <td className="small">{r.lines === 0 ? "no recipe lines" : `${r.pending} of ${r.lines} ingredients`}</td>
                    <td className="num">
                      <Link href={batchHref(r.batch.id, "cook")} className="btn sm">
                        Cook
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {show === "pack" && (
        <div className="card scroll">
          {toPack.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No cooked batches waiting. A batch moves here once all its ingredients are recorded.
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
                {toPack.map((r) => {
                  const step = batchStepFor({ status: r.batch.status, pending: r.pending, sessions: r.sessions });
                  return (
                    <tr key={r.batch.id}>
                      <td>{codeCell(r)}</td>
                      <td>{sauceCell(r)}</td>
                      <td>{runCell(r)}</td>
                      <td>{r.batch.producedOn ? relDate(r.batch.producedOn) : "—"}</td>
                      <td>
                        {badge(r)}
                        {r.sessions > 0 && <div className="small muted">ready to close</div>}
                      </td>
                      <td className="num">{r.sessions > 0 ? r.accepted : "—"}</td>
                      <td className="num">
                        <Link href={batchHref(r.batch.id, step)} className={`btn sm${step === "close" ? " secondary" : ""}`}>
                          {step === "close" ? "Close" : "Pack"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {show === "closed" && (
        <>
          <div className="card scroll">
            {closed.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                None yet. Batches land here when they are closed or marked as not made.
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
                    <th className="num">Jars</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((r) => (
                    <tr key={r.batch.id}>
                      <td>
                        <Link href={batchHref(r.batch.id, "close")}>{r.batch.code}</Link>
                      </td>
                      <td>{sauceCell(r)}</td>
                      <td>{runCell(r)}</td>
                      <td>{fmtDate(r.batch.producedOn)}</td>
                      <td>
                        {badge(r)}
                        {r.batch.closedAt ? <span className="small muted"> {fmtDate(dayOf(r.batch.closedAt))}</span> : null}
                      </td>
                      <td className="num">{r.sessions > 0 ? r.accepted : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="small muted">The 30 most recent. Packaging of a closed batch can still be edited from its Pack step.</p>
        </>
      )}
    </>
  );
}
