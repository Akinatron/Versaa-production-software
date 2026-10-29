import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../components/flash";
import { PageHeader, Empty } from "../components/ui/header";
import { fmtDate } from "../components/ui/format";
import { documentsFor } from "@/db/documents";
import { DocList } from "../components/documents";
import { DocUpload } from "../components/doc-upload";
import { addDays, today } from "@/domain/dates";

export const dynamic = "force-dynamic";

const RECENT_DAYS = 90;

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const showDeleted = params.deleted === "1";
  // The last 90 days, unless all were asked for.
  const showAll = params.all === "1";
  const since = addDays(today(), -RECENT_DAYS);
  const receipts = await db()
    .select({ r: t.receipts, supplier: t.suppliers.name })
    .from(t.receipts)
    .leftJoin(t.suppliers, eq(t.receipts.supplierId, t.suppliers.id))
    .where(and(showDeleted ? undefined : isNull(t.receipts.deletedAt), showAll ? undefined : gte(t.receipts.receivedOn, since)))
    .orderBy(desc(t.receipts.receivedOn), desc(t.receipts.createdAt));
  // Only the lines of the deliveries shown.
  const ids = receipts.map((r) => r.r.id);
  const lines = ids.length
    ? await db()
        .select({ line: t.receiptLines, item: t.items, lot: t.lots })
        .from(t.receiptLines)
        .innerJoin(t.items, eq(t.receiptLines.itemId, t.items.id))
        .leftJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id))
        .where(inArray(t.receiptLines.receiptId, ids))
    : [];
  const linesOf = new Map<string, typeof lines>();
  for (const l of lines) linesOf.set(l.line.receiptId, [...(linesOf.get(l.line.receiptId) ?? []), l]);
  const query = (p: { deleted?: boolean; all?: boolean }) => {
    const q = new URLSearchParams();
    if (p.deleted) q.set("deleted", "1");
    if (p.all) q.set("all", "1");
    return q.size ? `/deliveries?${q}` : "/deliveries";
  };
  const docs = await documentsFor(db(), { receiptIds: receipts.map((r) => r.r.id) });

  return (
    <>
      <PageHeader
        title="Deliveries"
        actions={
          <Link href="/deliveries/new" className="btn">
            Record a delivery
          </Link>
        }
      />
      <Flash params={params} />
      <p className="small">
        {showAll ? `All deliveries. ` : `Deliveries from the last ${RECENT_DAYS} days. `}
        <Link href={query({ deleted: showDeleted, all: !showAll })}>{showAll ? `Only the last ${RECENT_DAYS} days` : "Show older ones too"}</Link>
        {" · "}
        <Link href={query({ deleted: !showDeleted, all: showAll })}>{showDeleted ? "Hide deleted deliveries" : "Show deleted deliveries too"}</Link>
      </p>
      {receipts.length === 0 &&
        (showAll ? (
          <Empty title="No deliveries yet">
            <p>When goods arrive, record them here. Stock goes up and each line becomes a traceable lot.</p>
          </Empty>
        ) : (
          <p className="card muted">No deliveries in the last {RECENT_DAYS} days.</p>
        ))}
      {receipts.map(({ r, supplier }) => (
        <section key={r.id} className="card scroll">
          <div className="card-head">
            <h2 className={r.deletedAt ? "is-deleted" : undefined}>
              <Link href={`/deliveries/${r.id}`}>{supplier ?? "No supplier"}</Link>
              <span className="muted small" style={{ fontWeight: 400 }}>
                {" "}
                {fmtDate(r.receivedOn, { weekday: true })}
                {r.receivedTime && ` ${r.receivedTime.slice(0, 5)}`}
                {r.deliveryRef && ` · note ${r.deliveryRef}`}
              </span>
            </h2>
            <div className="more">
              <DocUpload
                kind="delivery_note"
                receiptId={r.id}
                back="/deliveries"
                label={docs.some((d) => d.receiptId === r.id) ? "Add another file" : "Add delivery note"}
              />
            </div>
          </div>
          {r.note && <p className="small muted">{r.note}</p>}
          <DocList docs={docs.filter((d) => d.receiptId === r.id)} back="/deliveries" />
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Accepted</th>
                <th className="num">Refused</th>
                <th>Damage</th>
                <th>Lot</th>
                <th>Supplier batch</th>
                <th>Best before</th>
              </tr>
            </thead>
            <tbody>
              {(linesOf.get(r.id) ?? []).map(({ line, item, lot }) => (
                  <tr key={line.id}>
                    <td>
                      <Link href={`/items/${item.id}?tab=stock`}>{item.name}</Link>
                    </td>
                    <td className="num">{formatQty(new Decimal(line.quantity), item.stockUnit as UnitCode)}</td>
                    <td className="num">{new Decimal(line.rejectedQty).gt(0) ? formatQty(new Decimal(line.rejectedQty), item.stockUnit as UnitCode) : "—"}</td>
                    <td className="small">{line.damageNote ?? "—"}</td>
                    <td>{lot ? <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link> : <span className="muted">none</span>}</td>
                    <td>{lot?.supplierBatch ?? "—"}</td>
                    <td>{lot?.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
