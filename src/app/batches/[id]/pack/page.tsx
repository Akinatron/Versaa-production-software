import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { storageLabel } from "@/domain/storage";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { Flash } from "../../../components/flash";
import { BatchSteps } from "../../../components/batch-steps";
import { PackRows } from "../../../components/batch-pack-row";
import { PackDates } from "../../../components/pack-dates";
import { shelfLifeOf } from "@/domain/shelf-life";
import { SauceName } from "../../../components/sauce-name";
import { packFormMaterials, plannedJarsForBatch, type PackMaterial, type PackStock } from "@/db/production";
import { PackagingTable } from "../../../components/packaging-table";
import { ConfirmButton, GuardedForm } from "../../../components/unsaved-guard";
import { deletePack, editPack, recordPack, restorePack } from "../../pack-actions";
import { fmtDate } from "../../../components/ui/format";
import { History, ReasonField } from "../../../components/history";
import { fmtWhen } from "../../../components/history-format";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

export default async function PackagingBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tr = await traceBatch(db(), id).catch(() => null);
  if (!tr) notFound();
  const { batch, run, sauce, recipe } = tr;
  const open = batch.status !== "closed" && batch.status !== "cancelled";
  const editable = batch.status !== "cancelled";
  const pending = tr.ingredientUse.filter((l) => l.actual === null).length;

  const products = await db()
    .select({ product: t.products, format: t.formats, storage: t.items.storage, shelfLife: t.items.shelfLife, shelfLifeUnit: t.items.shelfLifeUnit })
    .from(t.products)
    .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
    .innerJoin(t.items, eq(t.products.itemId, t.items.id))
    .where(and(eq(t.products.sauceId, sauce.id), eq(t.products.active, true)))
    .orderBy(desc(t.formats.capacityMl));

  const editing = editable && sp.edit ? tr.sessions.find((s) => s.id === sp.edit) : undefined;
  // Sizes in the edit form: those in the session (even if since retired) plus the active ones.
  const editSizes = editing
    ? [
        ...editing.lines.map((l) => ({
          id: l.product.id,
          name: l.product.name,
          fillMl: l.line.fillMl,
          filled: String(l.line.filled),
          rejected: String(l.line.rejected),
          packagingVersionId: l.line.packagingVersionId as string | null,
        })),
        ...products
          .filter((p) => !editing.lines.some((l) => l.product.id === p.product.id))
          .map((p) => ({
            id: p.product.id,
            name: p.product.name,
            fillMl: p.format.fillMl,
            filled: "",
            rejected: "",
            packagingVersionId: null as string | null,
          })),
      ]
    : [];
  const showForm = !!editing || open;
  const [plan, pack] = await Promise.all([
    plannedJarsForBatch(db(), batch),
    showForm
      ? packFormMaterials(
          db(),
          editing ? editSizes.map((s) => ({ productId: s.id, packagingVersionId: s.packagingVersionId })) : products.map((p) => ({ productId: p.product.id })),
          editing?.id,
        )
      : Promise.resolve({ materials: {} as Record<string, PackMaterial[]>, stock: {} as Record<string, PackStock> }),
  ]);
  const plannedOf = new Map(plan?.sizes.map((p) => [p.productId, p.perBatch]) ?? []);
  const deleted = await db()
    .select({ s: t.packagingSessions, by: t.users.name })
    .from(t.packagingSessions)
    .leftJoin(t.users, eq(t.packagingSessions.deletedBy, t.users.id))
    .where(and(eq(t.packagingSessions.batchId, batch.id), sql`${t.packagingSessions.deletedAt} is not null`))
    .orderBy(desc(t.packagingSessions.deletedAt));
  const editLot = editing ? tr.jarLots.find((l) => editing.lines.some((x) => x.line.finishedLotId === l.id && l.bestBefore)) : undefined;

  return (
    <>
      <BatchSteps
        batch={batch}
        sauceName={sauce.name}
        sauceColor={sauce.color}
        run={run}
        current="pack"
        versionNo={recipe.versionNo}
        progress={{ cooked: pending === 0, packed: tr.sessions.length > 0 }}
        actions={
          open && tr.sessions.length > 0 && !editing ? (
            <Link href={`/batches/${batch.id}/close`} className="btn secondary edit-only">
              Finished packing: close batch
            </Link>
          ) : undefined
        }
      />
      <Flash params={sp} />
      {pending > 0 && open && (
        <ul className="issues">
          <li className="warn">
            {pending} ingredient {pending === 1 ? "line is" : "lines are"} not recorded yet. You can pack already, but{" "}
            <Link href={`/batches/${batch.id}/cook`}>record the ingredients</Link> before closing.
          </li>
        </ul>
      )}

      {plan && (
        <>
          <h2 style={{ marginTop: 0 }}>Planned jars</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Size</th>
                  <th className="num">To fill in this batch</th>
                  <th className="num">Filled so far</th>
                  <th className="num">Left</th>
                </tr>
              </thead>
              <tbody>
                {plan.sizes.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      <SauceName name={p.name} color={sauce.color} />
                    </td>
                    <td className="num">{p.perBatch}</td>
                    <td className="num">{p.batchFilled}</td>
                    <td className="num">{Math.max(0, p.perBatch - p.batchFilled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginBottom: 0 }}>
              From the forecast saved when <Link href={`/runs/${run.id}`}>{run.code}</Link> was confirmed: jars to fill, rejects allowed for.
              {plan.batchCount > 1 &&
                ` The run fills ${plan.sizes.map((p) => `${p.runToFill} × ${p.name}`).join(", ")} over ${plan.batchCount} batches of ${sauce.name}; this is one batch's share (${plan.sizes
                  .map((p) => `${p.runFilled} ${p.name}`)
                  .join(", ")} filled so far across the run).`}
            </p>
          </div>
        </>
      )}

      {tr.sessions.length > 0 && (
        <>
          <h2 style={plan ? undefined : { marginTop: 0 }}>
            Jars packed{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              · {tr.filledLitres.toString()} L filled
            </span>
          </h2>
          <div className="card scroll">
            <PackagingTable tr={tr} editHref={editable ? (sid) => `/batches/${batch.id}/pack?edit=${sid}#edit` : undefined} />
            {tr.jarLots.length > 0 && (
              <div className="row" style={{ gap: 8, margin: "10px 10px 6px" }}>
                {tr.jarLots.map((l) => (
                  <Link key={l.id} href={`/trace/lot/${l.id}/labels`} className="btn secondary sm">
                    Print labels · {l.itemName}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {editing && (
        <>
          <h2 id="edit">Edit the packaging of {fmtDate(editing.packedOn)}</h2>
          <p className="small muted">
            Change the numbers and save; stock is corrected by the difference (materials back to or from their lots, accepted jars in or out of the finished
            lot). This works even when the batch is closed. If jars from this session have already left stock and too few are left, the change is refused.
          </p>
          <GuardedForm action={editPack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="sessionId" value={editing.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <div className="row" style={{ marginBottom: 16 }}>
              <div>
                <label htmlFor="e-packedOn">Packed on</label>
                <input id="e-packedOn" name="packedOn" type="date" required defaultValue={editing.packedOn} />
              </div>
              <div>
                <label htmlFor="e-bestBefore">Best-before (optional)</label>
                <input id="e-bestBefore" name="bestBefore" type="date" defaultValue={editLot?.bestBefore ?? ""} />
              </div>
            </div>
            <PackRows
              stock={pack.stock}
              sizes={editSizes.map((s) => ({
                productId: s.id,
                name: s.name,
                fillMl: s.fillMl,
                initialFilled: s.filled,
                initialRejected: s.rejected,
                planned: plannedOf.get(s.id) ?? null,
                materials: pack.materials[s.id] ?? [],
              }))}
            />
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="e-note">Note (optional)</label>
              <input id="e-note" name="note" defaultValue={editing.note ?? ""} />
            </div>
            <ReasonField id="e-reason" label="Why the correction?" placeholder="e.g. miscounted the rejects" />
            <div className="form-actions">
              <button type="submit">Save changes</button>
              <Link href={`/batches/${batch.id}/pack`} className="btn secondary">
                Cancel
              </Link>
            </div>
          </GuardedForm>
          <form action={deletePack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="sessionId" value={editing.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <strong>Delete this packaging session</strong>
            <p className="small muted" style={{ margin: "4px 0 12px" }}>
              Its accepted jars are taken out of stock and its jars, lids and labels are put back. The session is only marked as deleted, so traceability is
              kept.
            </p>
            <div className="row">
              <ReasonField id="del-reason" placeholder="e.g. recorded twice" />
              <ConfirmButton message={`Delete the packaging session of ${fmtDate(editing.packedOn)}?`} className="danger">
                Delete session
              </ConfirmButton>
            </div>
          </form>
        </>
      )}

      {open && !editing && (
        <div className="edit-only">
          <h2 style={tr.sessions.length === 0 && !plan ? { marginTop: 0 } : undefined}>
            {tr.sessions.length === 0 ? "Record the jars packed" : "Record another session"}
          </h2>
          <p className="small muted">
            Jars, lids and labels are used for every filled jar, rejects included. Only accepted jars (filled − rejected) go into stock. Leave a size empty if
            it wasn&apos;t packed.
          </p>
          <GuardedForm action={recordPack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <PackDates today={todayIso()} sizes={products.map((p) => ({ name: p.product.name, shelf: shelfLifeOf(p) }))} />
            {products.length === 0 && <p className="muted">No active jar sizes for {sauce.name}.</p>}
            <PackRows
              stock={pack.stock}
              sizes={products.map(({ product, format, storage }) => ({
                productId: product.id,
                name: product.name,
                fillMl: format.fillMl,
                storage: storage ? storageLabel(storage) : null,
                planned: plannedOf.get(product.id) ?? null,
                materials: pack.materials[product.id] ?? [],
              }))}
            />
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="pack-note">Note (optional)</label>
              <input id="pack-note" name="note" />
            </div>
            <div className="form-actions">
              <button type="submit">Save packaging session</button>
            </div>
          </GuardedForm>
        </div>
      )}
      {deleted.length > 0 && (
        <details className="card">
          <summary>
            <strong>Deleted sessions</strong> <span className="muted small">· {deleted.length}</span>
          </summary>
          <p className="small muted">
            Kept for traceability. Restoring one puts its figures back: its jars go into stock again and its materials are used again.
          </p>
          <ul className="worklist">
            {deleted.map(({ s, by }) => (
              <li key={s.id}>
                <div className="what">
                  <span className="is-deleted">Packaging of {fmtDate(s.packedOn)}</span>
                  <div className="sub">
                    Deleted {fmtWhen(s.deletedAt!)}
                    {by ? ` by ${by}` : ""}
                    {s.deletedReason ? `: “${s.deletedReason}”` : ""}
                  </div>
                  {editable && (
                    <form action={restorePack} className="row" style={{ marginTop: 8 }}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="key" value={crypto.randomUUID()} />
                      <ReasonField id={`res-${s.id}`} label="Why restore it?" />
                      <button type="submit" className="secondary">
                        Restore
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!open && (
        <p className="small muted">
          {batch.status === "closed"
            ? "This batch is closed: no new sessions, but the ones above can still be edited or deleted."
            : "This batch was marked as not made."}
        </p>
      )}
      <History of={{ type: "batch", id: batch.id }} />
    </>
  );
}
