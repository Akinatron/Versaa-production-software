import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { UNITS, dimensionOf, formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../../components/flash";
import { DefaultSubmit, SettingsBack, VERSION_STATUS, VersionHistory, fmtDate } from "../../../components/settings-versions";
import { activateRecipe, discardRecipe, saveRecipe, startRecipe } from "../../actions";

export const dynamic = "force-dynamic";

type Line = typeof t.recipeLines.$inferSelect;
type Item = typeof t.items.$inferSelect;

const MASS: UnitCode[] = ["kg", "g"];
const VOLUME: UnitCode[] = ["L", "ml"];
const unitsFor = (item: Item | undefined) =>
  !item ? null : dimensionOf(item.stockUnit as UnitCode) === "volume" ? VOLUME : dimensionOf(item.stockUnit as UnitCode) === "mass" ? MASS : null;

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ sauceId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { sauceId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(sauceId)) notFound();
  const [sauce] = await db().select().from(t.sauces).where(eq(t.sauces.id, sauceId));
  if (!sauce) notFound();

  const versions = await db().select().from(t.recipeVersions).where(eq(t.recipeVersions.sauceId, sauceId)).orderBy(desc(t.recipeVersions.versionNo));
  const ids = versions.map((v) => v.id);
  const [lines, items, used] = await Promise.all([
    ids.length ? db().select().from(t.recipeLines).where(inArray(t.recipeLines.recipeVersionId, ids)) : Promise.resolve([] as Line[]),
    db().select().from(t.items).where(eq(t.items.kind, "ingredient")),
    ids.length
      ? db()
          .select({ v: t.productionBatches.recipeVersionId, n: sql<number>`count(*)::int` })
          .from(t.productionBatches)
          .where(inArray(t.productionBatches.recipeVersionId, ids))
          .groupBy(t.productionBatches.recipeVersionId)
      : Promise.resolve([] as { v: string; n: number }[]),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const linesOf = (id: string) => lines.filter((l) => l.recipeVersionId === id).sort((a, b) => a.position - b.position);
  const active = versions.find((v) => v.status === "active");
  const draft = versions.find((v) => v.status === "draft");
  const viewing = sp.v ? versions.find((v) => v.id === sp.v) : undefined;
  const extra = Math.max(1, Math.min(20, Number(sp.extra) || 2));
  const back = `/settings/recipes/${sauceId}`;

  return (
    <>
      <SettingsBack href="/settings/recipes" label="Recipes" />
      <h1>Recipe: {sauce.name}</h1>
      <p className="lead">
        Quantities for one reference batch, exactly as recorded. A change is made as a new version: batches already made keep the version they used.
      </p>
      <Flash params={sp} />

      {!draft && (
        <form action={startRecipe} className="card row" style={{ alignItems: "center" }}>
          <input type="hidden" name="sauceId" value={sauce.id} />
          <button type="submit">{active ? "Change recipe" : "Set up recipe"}</button>
          <span className="small muted" style={{ flex: 1, minWidth: 220 }}>
            {active
              ? `Starts a draft (v${Math.max(0, ...versions.map((v) => v.versionNo)) + 1}) copied from v${active.versionNo}. Nothing changes for planning until you activate it.`
              : "Starts an empty draft. Planning needs an active recipe for this sauce."}
          </span>
        </form>
      )}

      {draft && (
        <section id="editor">
          <h2>
            Draft v{draft.versionNo} <span className={`badge ${VERSION_STATUS.draft!.cls}`}>{VERSION_STATUS.draft!.label}</span>
          </h2>
          {sp.confirm === "1" ? (
            <ConfirmActivate draftLines={linesOf(draft.id)} activeLines={active ? linesOf(active.id) : []} activeNo={active?.versionNo} draft={draft} activeRef={active?.batchReferenceKg} itemById={itemById} sauceId={sauce.id} back={back} />
          ) : (
            <>
              <form action={saveRecipe} className="card">
                <DefaultSubmit name="intent" value="save" />
                <input type="hidden" name="sauceId" value={sauce.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <input type="hidden" name="extra" value={extra} />
                <p className="small muted" style={{ marginTop: 0 }}>
                  Choose each ingredient, its quantity for one batch and the unit. Mass items (kg) take g or kg; liquid items (L) take ml or L. Leave a row
                  empty to ignore it.
                </p>
                <div style={{ maxWidth: 220, marginBottom: 12 }}>
                  <label htmlFor="ref">Batch size (finished kg, required)</label>
                  <input id="ref" name="batchReferenceKg" type="number" min="0.1" step="any" defaultValue={draft.batchReferenceKg} required />
                </div>
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Ingredient</th>
                        <th>Quantity per batch</th>
                        <th>Unit</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...linesOf(draft.id), ...Array.from({ length: extra }, () => null)].map((l, i) => {
                        const item = l ? itemById.get(l.itemId) : undefined;
                        const allowed = unitsFor(item);
                        return (
                          <tr key={i}>
                            <td className="muted">{i + 1}</td>
                            <td style={{ minWidth: 200 }}>
                              <select name={`item_${i}`} defaultValue={l?.itemId ?? ""} aria-label={`Ingredient, row ${i + 1}`}>
                                <option value="">— choose —</option>
                                {[...items]
                                  .filter((x) => x.active || x.id === l?.itemId)
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name} (stock in {UNITS[x.stockUnit as UnitCode].label})
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td>
                              <input name={`qty_${i}`} type="number" min="0" step="any" inputMode="decimal" defaultValue={l?.quantity ?? ""} aria-label={`Quantity, row ${i + 1}`} />
                            </td>
                            <td>
                              <select name={`unit_${i}`} defaultValue={l?.unit ?? ""} aria-label={`Unit, row ${i + 1}`} style={{ minWidth: 90 }}>
                                {!allowed && <option value="">—</option>}
                                {allowed ? (
                                  allowed.map((u) => (
                                    <option key={u} value={u}>
                                      {UNITS[u].label}
                                    </option>
                                  ))
                                ) : (
                                  <>
                                    <optgroup label="Mass (kg items)">
                                      <option value="g">g</option>
                                      <option value="kg">kg</option>
                                    </optgroup>
                                    <optgroup label="Volume (L items)">
                                      <option value="ml">ml</option>
                                      <option value="L">L</option>
                                    </optgroup>
                                  </>
                                )}
                              </select>
                            </td>
                            <td>
                              {l && (
                                <button type="submit" name="intent" value={`remove:${i}`} style={{ background: "var(--muted)", padding: "6px 12px" }}>
                                  Remove
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="submit" name="intent" value="addrow" style={{ background: "var(--muted)" }}>
                    + Add row
                  </button>
                  <span className="small muted">Saves the draft and adds an empty row.</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label htmlFor="note">What changed and why (recommended)</label>
                  <textarea id="note" name="note" rows={2} defaultValue={draft.note ?? ""} placeholder="e.g. less salt after tasting on 12 Oct" />
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button type="submit" name="intent" value="save">
                    Save draft
                  </button>
                  <button type="submit" name="intent" value="activate" style={{ background: "var(--ok)" }}>
                    Save and activate…
                  </button>
                </div>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  Saving keeps the draft for later; planning still uses {active ? `v${active.versionNo}` : "no recipe"}. Activating asks you to confirm first.
                </p>
              </form>
              <form action={discardRecipe} className="row" style={{ alignItems: "center", marginBottom: 16 }}>
                <input type="hidden" name="sauceId" value={sauce.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <button type="submit" style={{ background: "var(--bad)", padding: "6px 12px" }}>
                  Discard draft
                </button>
                <span className="small muted">Throws this draft away. The active recipe stays as it is.</span>
              </form>
            </>
          )}
        </section>
      )}

      {viewing && viewing.status !== "active" && viewing.status !== "draft" && (
        <>
          <h2>
            Viewing v{viewing.versionNo} <span className={`badge ${VERSION_STATUS[viewing.status]?.cls ?? ""}`}>{VERSION_STATUS[viewing.status]?.label}</span>
          </h2>
          <VersionCard v={viewing} lines={linesOf(viewing.id)} itemById={itemById} />
          <p className="small">
            <Link href={back}>Hide</Link>
          </p>
        </>
      )}

      <h2>Active recipe</h2>
      {active ? (
        <VersionCard v={active} lines={linesOf(active.id)} itemById={itemById} />
      ) : (
        <p className="card">
          <span className="badge bad">No active recipe</span> Plans for {sauce.name} can't calculate ingredients until a recipe is activated.
        </p>
      )}

      <h2>Version history</h2>
      {versions.length === 0 ? (
        <p className="card muted">No versions yet.</p>
      ) : (
        <VersionHistory
          versions={versions.map((v) => ({ ...v, lines: linesOf(v.id).length, used: used.find((u) => u.v === v.id)?.n ?? 0 }))}
          viewHref={(id) => (id === draft?.id ? `${back}#editor` : id === active?.id ? back : `${back}?v=${id}`)}
          usedLabel="Batches made"
          current={viewing?.id}
        />
      )}
    </>
  );
}

function VersionCard({ v, lines, itemById }: { v: typeof t.recipeVersions.$inferSelect; lines: Line[]; itemById: Map<string, Item> }) {
  return (
    <div className="card scroll">
      <p className="small muted" style={{ marginTop: 0 }}>
        v{v.versionNo} · batch size {v.batchReferenceKg} kg · activated {fmtDate(v.activatedAt)}
        {v.note && <> · note: {v.note}</>}
      </p>
      <table>
        <thead>
          <tr>
            <th>Ingredient</th>
            <th className="num">Per batch</th>
            <th>Stock unit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const item = itemById.get(l.itemId);
            return (
              <tr key={l.id}>
                <td>
                  {item?.name ?? "?"} {item && !item.active && <span className="badge">retired item</span>}
                </td>
                <td className="num">{formatQty(new Decimal(l.quantity), l.unit as UnitCode)}</td>
                <td className="muted">{item ? UNITS[item.stockUnit as UnitCode].label : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmActivate({
  draftLines,
  activeLines,
  activeNo,
  activeRef,
  draft,
  itemById,
  sauceId,
  back,
}: {
  draftLines: Line[];
  activeLines: Line[];
  activeNo?: number;
  activeRef?: string;
  draft: typeof t.recipeVersions.$inferSelect;
  itemById: Map<string, Item>;
  sauceId: string;
  back: string;
}) {
  const name = (id: string) => itemById.get(id)?.name ?? "?";
  const q = (l: Line) => formatQty(new Decimal(l.quantity), l.unit as UnitCode);
  const changes: string[] = [];
  for (const d of draftLines) {
    const a = activeLines.find((x) => x.itemId === d.itemId);
    if (!a) changes.push(`Added ${name(d.itemId)}: ${q(d)}`);
    else if (!new Decimal(a.quantity).eq(d.quantity) || a.unit !== d.unit) changes.push(`${name(d.itemId)}: ${q(a)} → ${q(d)}`);
  }
  for (const a of activeLines) if (!draftLines.some((d) => d.itemId === a.itemId)) changes.push(`Removed ${name(a.itemId)} (was ${q(a)})`);
  if (activeRef && !new Decimal(activeRef).eq(draft.batchReferenceKg)) changes.push(`Batch size: ${activeRef} kg → ${draft.batchReferenceKg} kg`);

  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <strong>Activate v{draft.versionNo}?</strong>
      <p style={{ margin: "8px 0" }}>Batches already made keep the version they used. New plans use this version.</p>
      <p className="small muted" style={{ margin: "0 0 4px" }}>
        {activeNo ? `Changes compared with v${activeNo} (which will be retired):` : "This becomes the first active recipe."}
      </p>
      {activeNo && (changes.length ? (
        <ul style={{ marginTop: 0 }}>
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="small"><span className="badge warn">No changes</span> The draft is the same as v{activeNo}.</p>
      ))}
      {draft.note && <p className="small">Note: {draft.note}</p>}
      <div className="row" style={{ alignItems: "center" }}>
        <form action={activateRecipe}>
          <input type="hidden" name="sauceId" value={sauceId} />
          <input type="hidden" name="versionId" value={draft.id} />
          <button type="submit" style={{ background: "var(--ok)" }}>
            Activate v{draft.versionNo}
          </button>
        </form>
        <Link href={`${back}#editor`}>Back to editing</Link>
      </div>
    </div>
  );
}
