import Link from "next/link";
import { batchTrace } from "./page-data";
import { db } from "@/db/client";
import type { LotSummary } from "@/db/trace";
import { BATCH_STATUS } from "./labels";
import { LotOrigin, lotQty } from "./trace-format";
import { fmtDate } from "./ui/format";
import { deliveryNotesForLots } from "@/db/documents";

/** Backward trace of one batch: the ingredient and packaging lots it used, with suppliers. */
export async function BatchBackward({ batchId, heading = true }: { batchId: string; heading?: boolean }) {
  const b = await batchTrace(batchId);
  if (!b) return <p className="muted">Batch not found.</p>;
  const st = BATCH_STATUS[b.batch.status];
  // The batch's own bulk sauce shows up as "used" by packaging; it isn't a bought material.
  const materials = b.materials.filter((m) => m.lot.itemKind !== "bulk");
  const notes = await deliveryNotesForLots(db(), [...b.ingredientUse.flatMap((u) => u.sources.map((s) => s.lot.id)), ...materials.map((m) => m.lot.id)]);
  const lotCell = (lot: LotSummary) => (
    <>
      <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link>
      <div className="small muted">
        <LotOrigin lot={lot} />
        {lot.bestBefore ? ` · best before ${fmtDate(lot.bestBefore, { year: true })}` : ""}
        {notes.get(lot.id)?.length ? (
          <>
            {" · "}
            {notes.get(lot.id)!.length === 1 ? (
              <a href={`/documents/${notes.get(lot.id)![0]!.id}`} target="_blank" rel="noopener">
                delivery note
              </a>
            ) : (
              <Link href={`/trace/lot/${lot.id}`}>delivery note ({notes.get(lot.id)!.length} files)</Link>
            )}
          </>
        ) : null}
      </div>
    </>
  );
  return (
    <div className="card scroll">
      {heading && (
        <h3 style={{ marginTop: 0 }}>
          Batch <Link href={`/batches/${b.batch.id}`}>{b.batch.code}</Link> <span className={`badge ${st?.cls ?? ""}`}>{st?.label ?? b.batch.status}</span>
        </h3>
      )}
      <p className="small muted" style={{ marginTop: 0 }}>
        {b.sauce.name}, recipe version {b.recipe.versionNo}, produced {b.batch.producedOn ? fmtDate(b.batch.producedOn, { year: true }) : "date not recorded"}.
      </p>
      <h4 style={{ margin: "8px 0 4px" }}>Ingredients used</h4>
      <table>
        <thead>
          <tr>
            <th>Ingredient</th>
            <th className="num">Used</th>
            <th>From lot (supplier, supplier batch)</th>
          </tr>
        </thead>
        <tbody>
          {b.ingredientUse.map((u) => (
            <tr key={u.itemId}>
              <td>
                {u.name}
                {u.extra && <div className="small muted">not in recipe</div>}
              </td>
              <td className="num">{u.actual === null ? <span className="badge warn">pending</span> : lotQty(u.actual, u.unit)}</td>
              <td>
                {u.actual === null ? (
                  <span className="muted">not recorded yet</span>
                ) : u.sources.length === 0 ? (
                  <span className="muted">none used (confirmed 0)</span>
                ) : (
                  u.sources.map((s) => (
                    <div key={s.lot.id} style={{ marginBottom: 4 }}>
                      {lotCell(s.lot)}
                      {u.sources.length > 1 && <div className="small">{lotQty(s.quantity, u.unit)} from this lot</div>}
                    </div>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 style={{ margin: "16px 0 4px" }}>Packaging materials used</h4>
      {materials.length === 0 ? (
        <p className="small muted">No packaging recorded yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">Used</th>
              <th>From lot</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.lot.id}>
                <td>{m.lot.itemName}</td>
                <td className="num">{lotQty(m.quantity, m.lot.unit)}</td>
                <td>{lotCell(m.lot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
