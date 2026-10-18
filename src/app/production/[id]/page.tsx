import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { lotsOf, type LotInfo } from "@/db/lot-use";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { BatchSteps } from "../../components/batch-steps";
import { recordIngredientsAction } from "../actions";
import { IngredientsForm, type IngredientLine } from "./ingredients-form";
import { fmtDate } from "../../components/ui/format";

export const dynamic = "force-dynamic";

// Narrow screens: the ingredient table turns into one card per ingredient.
const css = `
.bl td[data-label]::before { content: none; }
@media (max-width: 700px) {
  .bl thead { display: none; }
  .bl, .bl tbody, .bl tr, .bl td { display: block; width: 100%; }
  .bl tr.line { border-top: 2px solid var(--border); padding: 8px 0; }
  .bl td { border: 0; padding: 4px 0; }
  .bl td.num { text-align: left; white-space: normal; }
  .bl td[data-label]::before { content: attr(data-label) ": "; color: var(--muted); font-size: 0.85rem; display: block; }
}`;

const lotLabel = (l: LotInfo) => `${l.code}${l.supplierBatch ? ` · ${l.supplierBatch}` : ""} · BB ${l.bestBefore ?? "none"}`;

export default async function ProductionBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const tr = await traceBatch(db(), id).catch(() => null);
  if (!tr) notFound();
  const { batch, run, sauce, recipe } = tr;
  const open = batch.status !== "closed" && batch.status !== "cancelled";

  const ingredients = await db()
    .select()
    .from(t.items)
    .where(and(eq(t.items.kind, "ingredient"), eq(t.items.active, true)))
    .orderBy(asc(t.items.name));
  const lots = await db().transaction((tx) => lotsOf(tx, [...new Set([...tr.ingredientUse.map((l) => l.itemId), ...ingredients.map((i) => i.id)])]));

  // Lots a line can use: those with stock, plus the ones it already took from (even if now empty).
  const optionsFor = (itemId: string, used: Map<string, string>) =>
    lots
      .filter((l) => l.itemId === itemId && (l.balance.gt(0) || used.has(l.id)))
      .map((l) => ({
        id: l.id,
        label: lotLabel(l),
        available: l.balance.plus(used.get(l.id) ?? 0).toString(),
      }));

  const lines: IngredientLine[] = tr.ingredientUse.map((l) => {
    const used = new Map(l.sources.map((s) => [s.lot.id, s.quantity.toString()]));
    return {
      itemId: l.itemId,
      name: l.name,
      unit: l.unit,
      standard: l.extra ? null : l.planned.toString(),
      recorded: l.actual !== null,
      actual: l.actual?.toString() ?? null,
      split: l.sources.map((s) => ({
        lotId: s.lot.id,
        qty: s.quantity.toString(),
      })),
      lots: optionsFor(l.itemId, used),
    };
  });
  const onBatch = new Set(lines.map((l) => l.itemId));
  const extras: IngredientLine[] = ingredients
    .filter((i) => !onBatch.has(i.id))
    .map((i) => ({
      itemId: i.id,
      name: i.name,
      unit: i.stockUnit,
      standard: null,
      recorded: false,
      actual: null,
      split: [],
      lots: optionsFor(i.id, new Map()),
    }));
  const pending = lines.filter((l) => !l.recorded).length;

  return (
    <>
      <style>{css}</style>
      <BatchSteps batch={batch} sauceName={sauce.name} run={run} current="production" versionNo={recipe.versionNo} />
      <Flash params={flash} />
      {open ? (
        <>
          <p className="muted">
            Planned quantities are filled in. Change any that differ (0 if none was used) and press <strong>Record</strong>.{" "}
            {pending > 0 ? (
              <strong className="text-warn">
                {pending} of {lines.length} still to record.
              </strong>
            ) : (
              <span className="text-ok">All recorded.</span>
            )}
          </p>
          <details className="small muted" style={{ marginBottom: 16 }}>
            <summary style={{ fontWeight: 500 }}>How lots and corrections work</summary>
            Each ingredient comes from the lot with the earliest best-before. Use &quot;Split between lots&quot; to take it from several (for example what was
            left of an old delivery plus the new one). To correct a mistake later, change the quantity here and press Record again: stock moves by the
            difference.
          </details>
          <IngredientsForm
            key={crypto.randomUUID()}
            action={recordIngredientsAction}
            batchId={batch.id}
            idemKey={crypto.randomUUID()}
            producedOn={batch.producedOn ?? run.plannedFor}
            lines={lines}
            extras={extras}
          />
          {pending === 0 && (
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <Link href={`/packaging/${batch.id}`} className="btn secondary">
                Record the jars
              </Link>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="small muted">
            {batch.status === "closed" ? "This batch is closed, so its ingredients can't be changed any more." : "This batch was marked as not made."}{" "}
            Production date: {batch.producedOn ? fmtDate(batch.producedOn) : "not recorded"}.
          </p>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th className="num">Recipe</th>
                  <th className="num">Used</th>
                  <th>Lots</th>
                </tr>
              </thead>
              <tbody>
                {tr.ingredientUse.map((l) => (
                  <tr key={l.itemId}>
                    <td>{l.name}</td>
                    <td className="num">{l.extra ? "not in recipe" : formatQty(l.standard, l.unit as UnitCode)}</td>
                    <td className="num">{l.actual ? formatQty(l.actual, l.unit as UnitCode) : "not recorded"}</td>
                    <td className="small">{l.sources.map((s) => `${s.lot.code}: ${s.quantity.toString()} ${l.unit}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
