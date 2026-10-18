import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { planForRun } from "@/db/operations";
import { loadOrders, planBudget } from "@/db/purchasing";
import type { PlanResult } from "@/domain/planner";
import { Flash } from "../../components/flash";
import { PlanView } from "../../components/plan-view";
import { cancel, confirm, restore } from "../actions";
import { EditedMark, History, ReasonField } from "../../components/history";
import { BatchRunSection } from "../../components/batch-run-section";
import { BudgetTable } from "../../components/budget-table";
import { budgetForTable } from "../../components/budget-format";
import { RunOrdersTable } from "../../components/order-bits";
import { NextStep, RunHeader, loadRun } from "../../components/run-steps";
import { fmtDate } from "../../components/ui/format";

export const dynamic = "force-dynamic";

/** Step 1: what the run makes, its batches, its orders and its budget. */
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const run = await loadRun(id);
  const [snapshot] = await db().select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, id));
  const live = await planForRun(db(), id);
  const frozen = snapshot ? (snapshot.data as PlanResult) : null;
  const [orders, budget] = await Promise.all([loadOrders(db(), { runId: id }), planBudget(db(), live)]);
  const shortCount = live.requirements.filter((r) => r.status === "short").length;

  const actions = (
    <>
      {(run.status === "draft" || run.status === "confirmed") && (
        <a href="#cancel" className="btn secondary edit-only">
          {run.status === "draft" ? "Discard" : "Cancel run"}
        </a>
      )}
      {run.status === "draft" && (
        <form action={confirm}>
          <input type="hidden" name="runId" value={run.id} />
          <button type="submit">Confirm run</button>
        </form>
      )}
    </>
  );

  return (
    <>
      <RunHeader run={run} step="run" actions={actions} />
      <EditedMark of={{ type: "run", id: run.id }} />
      <Flash params={flash} />
      {run.status === "cancelled" && !run.confirmedAt && (
        <form action={restore} className="card row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="runId" value={run.id} />
          <div style={{ flex: "1 1 100%" }}>
            <strong>This draft was discarded.</strong>
            <div className="small muted">Restore it to keep planning with it.</div>
          </div>
          <ReasonField id="run-restore" label="Why restore it?" />
          <button type="submit" className="secondary">
            Restore draft
          </button>
        </form>
      )}

      {run.status === "draft" && (
        <ul className="issues">
          <li>
            <strong>This run is a draft.</strong> Confirming saves this forecast to compare with what is actually produced and reserves the ingredients and
            packaging so other runs don&apos;t count on them. Nothing is taken from stock yet.
          </li>
        </ul>
      )}
      {run.status === "confirmed" && run.confirmedAt && (
        <p className="small muted" style={{ marginTop: -8 }}>
          Confirmed {fmtDate(run.confirmedAt.toISOString().slice(0, 10))}. Its stock is reserved and is used when production is recorded.
        </p>
      )}

      <PlanView result={frozen ?? live} only={["issues", "production"]} batchesTitle="Batches per sauce" />

      <BatchRunSection runId={run.id} runStatus={run.status} frozen={frozen} />

      <h2>Orders for this run</h2>
      <RunOrdersTable orders={orders} back={`/runs/${id}`} />

      <h2>Budget</h2>
      <BudgetTable
        data={budgetForTable(budget, [
          { key: "toBuy", label: "To buy" },
          { key: "total", label: "Total cost" },
        ])}
        note={`At the favourite supplier's current price. "To buy" is only what's missing, rounded up to whole packs; "Total cost" is everything the run needs, including what is already in stock.`}
      />

      {frozen && (
        <details className="card">
          <summary>Forecast saved at confirmation</summary>
          <p className="small muted">This never changes, so you can compare it with the real result later.</p>
          <PlanView result={frozen} />
        </details>
      )}

      {(run.status === "draft" || run.status === "confirmed") && (
        <details className="card edit-only" id="cancel">
          <summary>{run.status === "draft" ? "Discard this draft" : "Cancel this run"}</summary>
          <form action={cancel} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="runId" value={run.id} />
            <p className="small muted" style={{ flex: "1 1 100%", margin: 0 }}>
              {run.status === "draft"
                ? "The draft is kept on record and can be restored."
                : "Its batches are cancelled and its reserved stock is freed. A cancelled run can't come back; you would plan it again."}
            </p>
            <ReasonField id="run-cancel" optional={run.status === "draft"} placeholder="e.g. the order was cancelled" />
            <button type="submit" className="danger">
              {run.status === "draft" ? "Discard draft" : "Cancel run"}
            </button>
          </form>
        </details>
      )}
      <History of={{ type: "run", id: run.id }} open={false} />

      <NextStep href={`/runs/${id}/stock`}>
        Stock vs need
        {shortCount > 0 ? ` (${shortCount} item${shortCount === 1 ? "" : "s"} to buy)` : ""}
      </NextStep>
    </>
  );
}
