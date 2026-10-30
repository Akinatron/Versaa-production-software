import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { planForRun, runTargets } from "@/db/operations";
import { frozenPlan } from "@/db/frozen-plan";
import { loadPlanCatalog } from "@/db/planning";
import { loadOrders, planBudget } from "@/db/purchasing";
import type { PlanResult } from "@/domain/planner";
import { Flash } from "../../components/flash";
import { PlanView } from "../../components/plan-view";
import { cancel, confirm, editDraft, restore } from "../actions";
import Link from "next/link";
import { EditedMark, History, ReasonField } from "../../components/history";
import { BatchRunSection } from "../../components/batch-run-section";
import { BudgetTable } from "../../components/budget-table";
import { budgetForTable } from "../../components/budget-format";
import { RunOrdersTable } from "../../components/order-bits";
import { NextStep, RunHeader, loadRun } from "../../components/run-steps";
import { fmtDate } from "../../components/ui/format";
import { dayOf } from "@/domain/dates";
import { idOrNotFound } from "@/lib/ids";
import { NumberInput } from "../../components/ui/number-input";
import { GuardedForm } from "../../components/unsaved-guard";

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
  idOrNotFound(id);
  const flash = await searchParams;
  const run = await loadRun(id);
  const finished = run.status === "closed" || run.status === "cancelled";
  const frozen = await frozenPlan(db(), id);
  // A closed or cancelled run doesn't change any more: its saved plan is enough, no need to work it out again.
  const live = finished && frozen ? null : await planForRun(db(), id);
  const shown = frozen ?? live!;
  const [orders, budget] = await Promise.all([loadOrders(db(), { runId: id }), planBudget(db(), live ?? shown)]);
  const shortCount = live ? live.requirements.filter((r) => r.status === "short").length : 0;
  const editing = run.status === "draft" && flash.edit === "1";

  const actions = editing ? null : (
    <>
      {run.status === "draft" && (
        <Link href={`/runs/${run.id}?edit=1`} className="btn secondary">
          Edit
        </Link>
      )}
      {(run.status === "draft" || run.status === "confirmed") && (
        <a href="#cancel" className="btn secondary">
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
      {editing ? <EditDraft runId={run.id} plannedFor={run.plannedFor} /> : <RunSummary result={shown} />}
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

      {run.status === "draft" && !editing && (
        <ul className="issues">
          <li>
            <strong>This run is a draft.</strong> Confirming saves this forecast to compare with what is actually produced and reserves the ingredients and
            packaging so other runs don&apos;t count on them. Nothing is taken from stock yet.
          </li>
        </ul>
      )}
      {run.status === "confirmed" && run.confirmedAt && (
        <p className="small muted" style={{ marginTop: -8 }}>
          Confirmed {fmtDate(dayOf(run.confirmedAt))}. Its stock is reserved and is used when production is recorded.
        </p>
      )}

      <PlanView result={shown} only={["issues"]} />

      <BatchRunSection runId={run.id} runStatus={run.status} frozen={frozen} />

      <h2>Orders for this run</h2>
      <RunOrdersTable orders={orders} back={`/runs/${id}`} />

      <h2>Budget</h2>
      {finished ? (
        <BudgetTable
          data={budgetForTable(budget, [{ key: "total", label: "Total cost" }])}
          note={`At the favourite supplier's current price, for everything the run needed. The batches' real cost is on each batch's Close step.`}
        />
      ) : (
        <BudgetTable
          data={budgetForTable(budget, [
            { key: "toBuy", label: "To buy" },
            { key: "total", label: "Total cost" },
          ])}
          note={`At the favourite supplier's current price. "To buy" is only what's missing, rounded up to whole packs; once batches are cooked it only counts what the run still has to use. "Total cost" is everything the run needs, including what is already in stock.`}
        />
      )}

      {frozen && (
        <details className="card">
          <summary>Forecast saved at confirmation</summary>
          <p className="small muted">This never changes, so you can compare it with the real result later.</p>
          <PlanView result={frozen} />
        </details>
      )}

      {(run.status === "draft" || run.status === "confirmed") && (
        <details className="card" id="cancel">
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

/** First thing on the run: how many batches and jars it makes. */
async function RunSummary({ result }: { result: PlanResult }) {
  const batches = result.sauces.reduce((a, s) => a + (s.batches ?? 0), 0);
  const unknownBatches = result.sauces.some((s) => s.batches === null);
  const target = result.products.reduce((a, p) => a + p.targetJars, 0);
  const toFill = result.products.reduce((a, p) => a + p.jarsToFill, 0);
  if (result.products.length === 0) return null;
  return (
    <>
      <div className="stats">
        <span>
          <span className="v">{unknownBatches ? "?" : batches}</span>
          <span className="l">{batches === 1 && !unknownBatches ? "batch" : "batches"}</span>
        </span>
        <span>
          <span className="v">{target}</span>
          <span className="l">sellable jars</span>
        </span>
        <span>
          <span className="v">{toFill}</span>
          <span className="l">jars to fill</span>
        </span>
      </div>
      <PlanView result={result} only={["production"]} batchesTitle="Batches per sauce" />
    </>
  );
}

/** Edit a draft: production date and sellable jars per size. */
async function EditDraft({ runId, plannedFor }: { runId: string; plannedFor: string }) {
  const [catalog, targets] = await Promise.all([loadPlanCatalog(db()), runTargets(db(), runId)]);
  // Sizes in the run that are no longer active still show, so nothing is dropped by accident.
  const known = new Set(catalog.products.map((p) => p.id));
  const missing = Object.keys(targets).filter((id) => !known.has(id));
  const extra = missing.length ? await db().select().from(t.products).where(inArray(t.products.id, missing)) : [];
  return (
    <GuardedForm action={editDraft} className="card">
      <input type="hidden" name="runId" value={runId} />
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Edit this draft</h2>
      </div>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="plannedFor">Production date</label>
        <input id="plannedFor" name="plannedFor" type="date" required defaultValue={plannedFor} />
      </div>
      <p className="small muted">Sellable jars of each sauce and size. Leave empty or 0 to drop a size.</p>
      <div className="grid">
        {catalog.sauces.map((s) => (
          <div key={s.id}>
            <h3 style={{ margin: "0 0 8px" }}>{s.name}</h3>
            {catalog.products
              .filter((p) => p.sauceId === s.id)
              .map((p) => (
                <div key={p.id} className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                  <label htmlFor={`t-${p.id}`} style={{ flex: 1, margin: 0 }}>
                    {p.formatName}
                  </label>
                  <NumberInput whole
                    id={`t-${p.id}`}
                    name={`t:${p.id}`}
                    defaultValue={targets[p.id] ?? ""}
                    placeholder="0"
                  />
                </div>
              ))}
          </div>
        ))}
        {extra.length > 0 && (
          <div>
            <h3 style={{ margin: "0 0 8px" }}>No longer in use</h3>
            {extra.map((p) => (
              <div key={p.id} className="row" style={{ marginBottom: 8, alignItems: "center" }}>
                <label htmlFor={`t-${p.id}`} style={{ flex: 1, margin: 0 }}>
                  {p.name}
                </label>
                <NumberInput whole id={`t-${p.id}`} name={`t:${p.id}`} defaultValue={targets[p.id] ?? ""} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
        <ReasonField id="run-edit" label="Why the change?" optional placeholder="e.g. a new order came in" />
      </div>
      <div className="form-actions">
        <button type="submit">Save changes</button>
        <Link href={`/runs/${runId}`} className="btn secondary">
          Cancel
        </Link>
      </div>
    </GuardedForm>
  );
}
