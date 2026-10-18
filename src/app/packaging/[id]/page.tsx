import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceBatch } from "@/db/trace";
import { Flash } from "../../components/flash";
import { BatchSteps } from "../../components/batch-steps";
import { BatchPackRow } from "../../components/batch-pack-row";
import { PackagingTable } from "../../components/packaging-table";
import { ConfirmButton, GuardedForm } from "../../components/unsaved-guard";
import { deletePack, editPack, recordPack } from "../actions";

export const dynamic = "force-dynamic";

const big = { fontSize: "1.1rem", padding: "12px" } as const;
const bigBtn = { fontSize: "1.05rem", padding: "12px 22px" } as const;
const todayIso = () => new Date().toISOString().slice(0, 10);

export default async function PackagingBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
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
        ...editing.lines.map((l) => ({ id: l.product.id, name: l.product.name, fillMl: l.line.fillMl, filled: String(l.line.filled), rejected: String(l.line.rejected) })),
        ...products
          .filter((p) => !editing.lines.some((l) => l.product.id === p.product.id))
          .map((p) => ({ id: p.product.id, name: p.product.name, fillMl: p.format.fillMl, filled: "", rejected: "" })),
      ]
    : [];
  const editLot = editing ? tr.jarLots.find((l) => editing.lines.some((x) => x.line.finishedLotId === l.id && l.bestBefore)) : undefined;

  return (
    <>
      <BatchSteps batch={batch} sauceName={sauce.name} run={run} current="packaging" versionNo={recipe.versionNo} />
      <Flash params={sp} />
      {pending > 0 && open && (
        <ul className="issues">
          <li className="warn">
            {pending} ingredient line(s) of this batch are not recorded yet. You can pack already, but <Link href={`/production/${batch.id}`}>record the ingredients</Link>{" "}
            before closing.
          </li>
        </ul>
      )}

      <h2 style={{ marginTop: 0 }}>Jars packed</h2>
      <p className="small muted">
        Litres from this batch: <strong>{tr.filledLitres.toString()} L</strong> (jars filled × ml per jar, rejects included).
      </p>
      <div className="card scroll">
        <PackagingTable tr={tr} editHref={editable ? (sid) => `/packaging/${batch.id}?edit=${sid}#edit` : undefined} />
      </div>

      {editing && (
        <>
          <h2 id="edit">Edit the packaging of {editing.packedOn}</h2>
          <p className="small muted">
            Change the numbers and save; stock is corrected by the difference (materials back to or from their lots, accepted jars in or out of the finished lot). This
            works even when the batch is closed. If jars from this session have already left stock and too few are left, the change is refused.
          </p>
          <GuardedForm action={editPack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="sessionId" value={editing.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <label htmlFor="e-packedOn">Packaging date (required)</label>
                <input id="e-packedOn" name="packedOn" type="date" required defaultValue={editing.packedOn} style={big} />
              </div>
              <div>
                <label htmlFor="e-bestBefore">Best-before (optional)</label>
                <input id="e-bestBefore" name="bestBefore" type="date" defaultValue={editLot?.bestBefore ?? ""} style={big} />
              </div>
            </div>
            {editSizes.map((s, i) => (
              <BatchPackRow key={s.id} index={i} productId={s.id} name={s.name} fillMl={s.fillMl} initialFilled={s.filled} initialRejected={s.rejected} />
            ))}
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="e-note">Note (optional)</label>
              <input id="e-note" name="note" defaultValue={editing.note ?? ""} style={big} />
            </div>
            <div className="row">
              <button type="submit" style={bigBtn}>
                Save changes
              </button>
              <Link href={`/packaging/${batch.id}`}>Cancel</Link>
            </div>
          </GuardedForm>
          <form action={deletePack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="sessionId" value={editing.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <strong>Delete this packaging session</strong>
            <p className="small muted" style={{ margin: "4px 0 12px" }}>
              Its accepted jars are taken out of stock and its jars, lids and labels are put back. The session is only marked as deleted, so traceability is kept.
            </p>
            <div className="row">
              <div style={{ flex: "1 1 260px" }}>
                <label htmlFor="del-reason">Why? (optional)</label>
                <input id="del-reason" name="reason" style={big} placeholder="e.g. recorded twice" />
              </div>
              <ConfirmButton message={`Delete the packaging session of ${editing.packedOn}?`} style={{ ...bigBtn, background: "var(--bad)" }}>
                Delete session
              </ConfirmButton>
            </div>
          </form>
        </>
      )}

      {open && !editing && (
        <>
          <h2>Record a packaging session</h2>
          <p className="small muted">
            Packaging materials (jars, lids, labels) are used for <strong>every filled jar</strong>, rejects included, earliest best-before first. Only{" "}
            <strong>accepted</strong> jars (filled − rejected) go into stock.
          </p>
          <GuardedForm action={recordPack} className="card">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <label htmlFor="packedOn">Packaging date (required)</label>
                <input id="packedOn" name="packedOn" type="date" required defaultValue={todayIso()} style={big} />
              </div>
              <div>
                <label htmlFor="bestBefore">Best-before (optional)</label>
                <input id="bestBefore" name="bestBefore" type="date" style={big} />
              </div>
              <p className="small muted" style={{ flex: "1 1 220px", margin: 0 }}>
                Best-before: only if you have one. It is never guessed; leave it empty if unknown.
              </p>
            </div>
            {products.length === 0 && <p className="muted">No active jar sizes for {sauce.name}.</p>}
            {products.map(({ product, format }, i) => (
              <BatchPackRow key={product.id} index={i} productId={product.id} name={product.name} fillMl={format.fillMl} />
            ))}
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="pack-note">Note (optional)</label>
              <input id="pack-note" name="note" style={big} />
            </div>
            <p className="small muted">Leave a size empty if it wasn&apos;t packed in this session.</p>
            <button type="submit" style={bigBtn}>
              Save packaging session
            </button>
          </GuardedForm>
        </>
      )}
      {!open && (
        <p className="small muted">
          {batch.status === "closed" ? "This batch is closed: no new sessions, but the ones above can still be edited or deleted." : "This batch was marked as not made."}
        </p>
      )}
      {open && tr.sessions.length > 0 && !editing && (
        <p>
          Finished packing? <Link href={`/batches/${batch.id}`}>Close the batch</Link>.
        </p>
      )}
    </>
  );
}
