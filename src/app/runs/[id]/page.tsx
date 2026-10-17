import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { planForRun } from "@/db/operations";
import type { PlanResult } from "@/domain/planner";
import { Flash } from "../../components/flash";
import { PlanView, orderLinkFor } from "../../components/plan-view";
import { RUN_STATUS } from "../../components/labels";
import { cancel, confirm } from "../actions";
import { BatchRunSection } from "../../components/batch-run-section";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const [run] = await db().select().from(t.productionRuns).where(eq(t.productionRuns.id, id));
  if (!run) notFound();
  const [snapshot] = await db().select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, id));
  const live = await planForRun(db(), id);
  const frozen = snapshot ? (snapshot.data as PlanResult) : null;
  const orderLink = orderLinkFor(live);
  const status = RUN_STATUS[run.status]!;

  return (
    <>
      <h1>
        {run.code} <span className={`badge ${status.cls}`}>{status.label}</span>
      </h1>
      <p className="lead">Production date {run.plannedFor}.</p>
      <Flash params={flash} />

      <div className="card row">
        {run.status === "draft" && (
          <form action={confirm}>
            <input type="hidden" name="runId" value={run.id} />
            <button type="submit">Confirm run</button>
          </form>
        )}
        {(run.status === "draft" || run.status === "confirmed") && (
          <form action={cancel}>
            <input type="hidden" name="runId" value={run.id} />
            <button type="submit" style={{ background: "var(--muted)" }}>
              Cancel run
            </button>
          </form>
        )}
        {orderLink && <a href={orderLink}>Order what's missing →</a>}
        <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
          {run.status === "draft"
            ? "Confirming saves this forecast so it can be compared with what is actually produced, and reserves the ingredients and packaging so other runs don't count on them. Nothing is taken from stock yet."
            : run.status === "confirmed"
              ? `Confirmed ${run.confirmedAt?.toISOString().slice(0, 16).replace("T", " ")}. Stock is reserved; it is used when production is recorded.`
              : null}
        </p>
      </div>

      <BatchRunSection runId={run.id} runStatus={run.status} frozen={frozen} />

      {frozen && (
        <>
          <h2>Forecast saved at confirmation</h2>
          <p className="small muted">This never changes, so you can compare it with the real result later.</p>
          <details className="card">
            <summary>Show saved forecast</summary>
            <PlanView result={frozen} />
          </details>
          <h2>Current stock check</h2>
        </>
      )}
      <PlanView result={live} />
    </>
  );
}
