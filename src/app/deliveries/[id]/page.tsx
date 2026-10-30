import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { UNITS, formatQty, type UnitCode } from "@/domain/quantity";
import { documentsFor, removedDocumentsFor } from "@/db/documents";
import { Flash } from "../../components/flash";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";
import { DocList, RemovedDocs } from "../../components/documents";
import { DocUpload } from "../../components/doc-upload";
import { DeletedNote, EditedMark, History, ReasonField } from "../../components/history";
import { GuardedForm } from "../../components/unsaved-guard";
import { correctDelivery, toggleDelivery } from "../actions";
import { idOrNotFound } from "@/lib/ids";
import { NumberInput } from "../../components/ui/number-input";

export const dynamic = "force-dynamic";

/** One delivery: what arrived, its paperwork, and the way to correct or delete it. */
export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
  const flash = await searchParams;
  const [row] = await db()
    .select({ r: t.receipts, supplier: t.suppliers })
    .from(t.receipts)
    .leftJoin(t.suppliers, eq(t.receipts.supplierId, t.suppliers.id))
    .where(eq(t.receipts.id, id));
  if (!row) notFound();
  const { r, supplier } = row;
  const lines = await db()
    .select({ line: t.receiptLines, item: t.items, lot: t.lots, po: t.purchaseOrders })
    .from(t.receiptLines)
    .innerJoin(t.items, eq(t.receiptLines.itemId, t.items.id))
    .leftJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id))
    .leftJoin(t.purchaseOrderLines, eq(t.receiptLines.purchaseOrderLineId, t.purchaseOrderLines.id))
    .leftJoin(t.purchaseOrders, eq(t.purchaseOrderLines.purchaseOrderId, t.purchaseOrders.id))
    .where(eq(t.receiptLines.receiptId, r.id));
  const orders = [...new Map(lines.filter((l) => l.po).map((l) => [l.po!.id, l.po!])).values()];
  const back = `/deliveries/${r.id}`;
  const [docs, removed] = await Promise.all([documentsFor(db(), { receiptIds: [r.id] }), removedDocumentsFor(db(), { receiptIds: [r.id] })]);
  const deleted = !!r.deletedAt;
  const u = (unit: string) => UNITS[unit as UnitCode].label;

  return (
    <>
      <PageHeader
        back={{ href: "/deliveries", label: "Deliveries" }}
        title={`Delivery of ${fmtDate(r.receivedOn, { weekday: true })}`}
        lead={
          <>
            {supplier ? <Link href={`/suppliers/${supplier.id}`}>{supplier.name}</Link> : "No supplier"}
            {r.receivedTime && ` · ${r.receivedTime.slice(0, 5)}`}
            {r.deliveryRef && ` · note ${r.deliveryRef}`}
            {orders.map((po) => (
              <span key={po.id}>
                {" "}
                · order <Link href={`/orders/${po.id}`}>{po.code}</Link>
              </span>
            ))}
          </>
        }
      />
      <EditedMark of={{ type: "receipt", id: r.id }} />
      <Flash params={flash} />

      {deleted && (
        <DeletedNote what="delivery" at={r.deletedAt!} reason={r.deletedReason}>
          <form action={toggleDelivery} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="receiptId" value={r.id} />
            <input type="hidden" name="deleted" value="0" />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <ReasonField id="rcv-restore" label="Why restore it?" />
            <button type="submit" className="secondary">
              Restore delivery
            </button>
          </form>
        </DeletedNote>
      )}

      {r.note && <p className="card small">{r.note}</p>}
      <div className="card scroll">
        <table className={deleted ? "is-deleted" : undefined}>
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
            {lines.map(({ line, item, lot }) => (
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
      </div>

      <h2>Delivery note</h2>
      <div className="card">
        <div className="paperwork">
          <div className="head">
            <strong>Files</strong>
            {!deleted && <DocUpload kind="delivery_note" receiptId={r.id} back={back} label={docs.length ? "Add another file" : "Add delivery note"} />}
          </div>
          {docs.length === 0 && <span className="small muted">No photo or PDF of this delivery note yet.</span>}
          <DocList docs={docs} back={deleted ? undefined : back} />
          <RemovedDocs docs={removed} back={back} />
        </div>
      </div>

      {!deleted && (
        <>
          <details className="card" style={{ marginTop: 32 }}>
            <summary>Correct this delivery</summary>
            <p className="small muted">
              A changed accepted amount moves the lot by the difference. It can&apos;t go below what has already been used from the lot.
            </p>
            <GuardedForm action={correctDelivery}>
              <input type="hidden" name="receiptId" value={r.id} />
              <input type="hidden" name="key" value={crypto.randomUUID()} />
              <div className="row" style={{ marginBottom: 16 }}>
                <div>
                  <label htmlFor="d-on">Date</label>
                  <input id="d-on" name="receivedOn" type="date" required defaultValue={r.receivedOn} />
                </div>
                <div>
                  <label htmlFor="d-time">Time (optional)</label>
                  <input id="d-time" name="receivedTime" type="time" defaultValue={r.receivedTime?.slice(0, 5) ?? ""} />
                </div>
                <div>
                  <label htmlFor="d-ref">Delivery note no.</label>
                  <input id="d-ref" name="deliveryRef" defaultValue={r.deliveryRef ?? ""} />
                </div>
                <div style={{ flex: "1 1 220px" }}>
                  <label htmlFor="d-note">Note</label>
                  <input id="d-note" name="note" defaultValue={r.note ?? ""} />
                </div>
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Accepted</th>
                      <th>Refused</th>
                      <th>Damage</th>
                      <th>Supplier batch</th>
                      <th>Best before</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(({ line, item, lot }, i) => (
                      <tr key={line.id}>
                        <td>
                          {item.name}
                          <input type="hidden" name={`line_${i}`} value={line.id} />
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                            <NumberInput
                              name={`qty_${i}`}
                              required
                              defaultValue={line.quantity}
                              aria-label={`${item.name} accepted`}
                              style={{ maxWidth: 110 }}
                            />
                            <span className="small">{u(item.stockUnit)}</span>
                          </div>
                        </td>
                        <td>
                          <NumberInput
                            name={`rej_${i}`}
                            defaultValue={line.rejectedQty}
                            aria-label={`${item.name} refused`}
                            style={{ maxWidth: 110 }}
                          />
                        </td>
                        <td>
                          <input name={`dmg_${i}`} defaultValue={line.damageNote ?? ""} aria-label={`${item.name} damage`} />
                        </td>
                        <td>
                          <input name={`batch_${i}`} defaultValue={lot?.supplierBatch ?? ""} aria-label={`${item.name} supplier batch`} />
                        </td>
                        <td>
                          <input name={`bb_${i}`} type="date" defaultValue={lot?.bestBefore ?? ""} aria-label={`${item.name} best before`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
                <ReasonField id="d-reason" label="Why the correction?" placeholder="e.g. one sack was counted twice" />
                <button type="submit">Save correction</button>
              </div>
            </GuardedForm>
          </details>

          <details className="card">
            <summary>Delete this delivery</summary>
            <form action={toggleDelivery} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <input type="hidden" name="receiptId" value={r.id} />
              <input type="hidden" name="deleted" value="1" />
              <input type="hidden" name="key" value={crypto.randomUUID()} />
              <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                Its stock is taken back out and its orders count it as not arrived. Refused if some of it has already been used. The delivery is kept on record
                and can be restored.
              </p>
              <ReasonField id="d-del" label="Why delete it?" placeholder="e.g. recorded twice" />
              <button type="submit" className="danger">
                Delete delivery
              </button>
            </form>
          </details>
        </>
      )}
      <History of={{ type: "receipt", id: r.id }} />
    </>
  );
}
