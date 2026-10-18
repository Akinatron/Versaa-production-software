import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { Flash } from "../../../components/flash";
import { BatchSteps } from "../../../components/batch-steps";
import { BatchPackRow } from "../../../components/batch-pack-row";
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
    .select({ product: t.products, format: t.formats })
    .from(t.products)
    .innerJoin(t.formats, eq(t.products.formatId, t.formats.id))
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
        })),
        ...products
          .filter((p) => !editing.lines.some((l) => l.product.id === p.product.id))
          .map((p) => ({
            id: p.product.id,
            name: p.product.name,
            fillMl: p.format.fillMl,
            filled: "",
            rejected: "",
          })),
      ]
    : [];
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

      {tr.sessions.length > 0 && (
        <>
          <h2 style={{ marginTop: 0 }}>
            Jars packed{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              · {tr.filledLitres.toString()} L filled
            </span>
          </h2>
          <div className="card scroll">
            <PackagingTable tr={tr} editHref={editable ? (sid) => `/batches/${batch.id}/pack?edit=${sid}#edit` : undefined} />
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
            {editSizes.map((s, i) => (
              <BatchPackRow key={s.id} index={i} productId={s.id} name={s.name} fillMl={s.fillMl} initialFilled={s.filled} initialRejected={s.rejected} />
            ))}
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
          <h2 style={tr.sessions.length === 0 ? { marginTop: 0 } : undefined}>
            {tr.sessions.length === 0 ? "Record the jars packed" : "Record another session"}
          </h2>
          <p className="small muted">
            Jars, lids and labels are used for every filled jar, rejects included. Only accepted jars (filled − rejected) go into stock. Leave a size empty if
            it wasn&apos;t packed.
          </p>
          <GuardedForm action={recordPack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <div className="row" style={{ marginBottom: 16 }}>
              <div>
                <label htmlFor="packedOn">Packed on</label>
                <input id="packedOn" name="packedOn" type="date" required defaultValue={todayIso()} />
              </div>
              <div>
                <label htmlFor="bestBefore">Best-before (if you have one)</label>
                <input id="bestBefore" name="bestBefore" type="date" />
              </div>
            </div>
            {products.length === 0 && <p className="muted">No active jar sizes for {sauce.name}.</p>}
            {products.map(({ product, format }, i) => (
              <BatchPackRow key={product.id} index={i} productId={product.id} name={product.name} fillMl={format.fillMl} />
            ))}
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
