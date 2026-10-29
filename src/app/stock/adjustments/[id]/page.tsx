import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { ADJUSTMENT_NAME as KIND } from "@/domain/status";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../../components/flash";
import { PageHeader } from "../../../components/ui/header";
import { fmtDate } from "../../../components/ui/format";
import { DeletedNote, History, ReasonField } from "../../../components/history";
import { toggleAdjustment } from "../../actions";
import { dayOf } from "@/domain/dates";
import { idOrNotFound } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** One stock count or write-off: what it changed, and the way to undo it. */
export default async function AdjustmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
  const flash = await searchParams;
  const [row] = await db().select({ a: t.stockAdjustments }).from(t.stockAdjustments).where(eq(t.stockAdjustments.id, id));
  if (!row) notFound();
  const { a } = row;
  const moves = await db()
    .select({ m: t.movements, lot: t.lots, item: t.items })
    .from(t.movements)
    .innerJoin(t.lots, eq(t.movements.lotId, t.lots.id))
    .innerJoin(t.items, eq(t.movements.itemId, t.items.id))
    .where(and(eq(t.movements.docType, "stock_adjustment"), eq(t.movements.docId, a.id)))
    .orderBy(t.movements.createdAt);
  const what = KIND[a.type] ?? "Stock correction";

  return (
    <>
      <PageHeader back={{ href: "/stock", label: "Stock" }} title={`${what}, ${fmtDate(a.occurredOn, { year: true })}`} lead={a.reason} />
      <Flash params={flash} />
      {a.deletedAt && (
        <DeletedNote what={what.toLowerCase()} at={a.deletedAt} reason={a.deletedReason}>
          <form action={toggleAdjustment} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="adjustmentId" value={a.id} />
            <input type="hidden" name="deleted" value="0" />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <ReasonField id="a-restore" label="Why restore it?" />
            <button type="submit" className="secondary">
              Restore
            </button>
          </form>
        </DeletedNote>
      )}
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Item</th>
              <th>Lot</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {moves.map(({ m, lot, item }) => (
              <tr key={m.id} className={m.changeId ? "muted" : undefined}>
                <td>
                  {fmtDate(dayOf(m.occurredAt), { year: true })}
                  {m.changeId && <div className="small">{m.reason}</div>}
                </td>
                <td>
                  <Link href={`/items/${item.id}?tab=stock`}>{item.name}</Link>
                </td>
                <td>
                  <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link>
                </td>
                <td className="num">
                  {new Decimal(m.quantity).gt(0) ? "+" : ""}
                  {formatQty(new Decimal(m.quantity), item.stockUnit as UnitCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!a.deletedAt && (
        <details className="card">
          <summary>Delete this {what.toLowerCase()}</summary>
          <form action={toggleAdjustment} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="adjustmentId" value={a.id} />
            <input type="hidden" name="deleted" value="1" />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
              Stock goes back to how it was before. Refused if what it added has already been used. It stays on record and can be restored.
            </p>
            <ReasonField id="a-del" label="Why delete it?" placeholder="e.g. counted the wrong shelf" />
            <button type="submit" className="danger">
              Delete
            </button>
          </form>
        </details>
      )}
      <History of={{ type: "stock_adjustment", id: a.id }} />
    </>
  );
}
