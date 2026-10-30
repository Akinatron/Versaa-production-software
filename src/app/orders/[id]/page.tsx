import Link from "next/link";
import { isOnTheWay } from "@/domain/status";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadOrders } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { UNITS, formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { PO_STATUS } from "../../components/labels";
import { MarkSentForm } from "../../components/order-bits";
import { cancelOrder, closeOrderAction, restoreOrder, updateDraftAction } from "../actions";
import { EditedMark, History, ReasonField } from "../../components/history";
import { GuardedForm, UnsavedGroup, WhenSaved } from "../../components/unsaved-guard";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";
import { documentsFor, removedDocumentsFor } from "@/db/documents";
import { DocList, RemovedDocs } from "../../components/documents";
import { DocUpload } from "../../components/doc-upload";
import { SendOrder } from "../../components/send-order";
import { orderMessageData } from "../message-data";
import { dayOf } from "@/domain/dates";
import { idOrNotFound } from "@/lib/ids";
import { NumberInput } from "../../components/ui/number-input";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
  const flash = await searchParams;
  const [order] = await loadOrders(db(), { ids: [id] });
  if (!order) notFound();
  const { po, supplier, run, lines } = order;
  const st = PO_STATUS[po.status]!;
  const lineIds = lines.map((l) => l.line.id);
  const receipts = lineIds.length
    ? await db()
        .select({ rl: t.receiptLines, r: t.receipts, lot: t.lots })
        .from(t.receiptLines)
        .innerJoin(t.receipts, eq(t.receiptLines.receiptId, t.receipts.id))
        .leftJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id))
        .where(inArray(t.receiptLines.purchaseOrderLineId, lineIds))
        .orderBy(t.receipts.receivedOn)
    : [];
  const deliveries = [...new Map(receipts.filter(({ r }) => !r.deletedAt).map(({ r }) => [r.id, r])).values()];
  const docs = await documentsFor(db(), { purchaseOrderIds: [po.id], receiptIds: deliveries.map((r) => r.id) });
  const removedDocs = await removedDocumentsFor(db(), { purchaseOrderIds: [po.id], receiptIds: deliveries.map((r) => r.id) });
  const invoices = docs.filter((d) => d.kind === "invoice");
  const message = po.status === "cancelled" ? null : await orderMessageData(db(), order);
  const sendOrder = message && <SendOrder poId={po.id} contact={supplier.contact} order={message} />;
  const open = isOnTheWay(po.status);
  const back = `/orders/${id}`;
  const u = (unit: string) => UNITS[unit as UnitCode].label;
  const editForm = (correcting: boolean) => (
    <GuardedForm action={updateDraftAction}>
      <input type="hidden" name="poId" value={po.id} />
      {correcting && <input type="hidden" name="correcting" value="1" />}
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Price per unit (€)</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.line.id}>
                <td>
                  {l.item.name}
                  {l.line.neededQty && (
                    <div className="small muted">
                      needed {l.line.neededQty} {u(l.item.stockUnit)}
                    </div>
                  )}
                  <input type="hidden" name={`line_${i}`} value={l.line.id} />
                </td>
                <td>
                  {l.line.packQty ? (
                    <div
                      className="row"
                      style={{
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "nowrap",
                      }}
                    >
                      <NumberInput whole name={`packs_${i}`} required defaultValue={l.line.packs ?? ""} aria-label="Packs" style={{ maxWidth: 80 }} />
                      <span className="small">
                        × {l.line.packQty} {u(l.item.stockUnit)}
                      </span>
                      <input type="hidden" name={`qty_${i}`} value={l.line.quantity} />
                    </div>
                  ) : (
                    <div
                      className="row"
                      style={{
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "nowrap",
                      }}
                    >
                      <NumberInput name={`qty_${i}`} required defaultValue={l.line.quantity} aria-label="Quantity" />
                      <span className="small">{u(l.item.stockUnit)}</span>
                      <input type="hidden" name={`packs_${i}`} value="" />
                    </div>
                  )}
                </td>
                <td>
                  <NumberInput name={`price_${i}`} defaultValue={l.line.unitPrice ?? ""} aria-label="Price per unit" />
                </td>
                <td className="num">{l.line.unitPrice ? money(new Decimal(l.line.quantity).mul(l.line.unitPrice)) : "no price"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          {correcting
            ? "A line can't go below what has already arrived. Set a quantity to 0 to remove a line nothing arrived for."
            : "Set a quantity to 0 to remove the line."}
        </p>
      </div>
      <div className="card grid">
        <div>
          <label htmlFor="expectedOn">Expected delivery</label>
          <input id="expectedOn" name="expectedOn" type="date" defaultValue={po.expectedOn ?? ""} />
        </div>
        <div>
          <label htmlFor="reference">Supplier reference</label>
          <input id="reference" name="reference" type="text" defaultValue={po.reference ?? ""} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="note">Note</label>
          <textarea id="note" name="note" rows={2} defaultValue={po.note ?? ""} />
        </div>
      </div>
      {correcting && (
        <div className="card">
          <ReasonField id="po-reason" label="Why the correction?" placeholder="e.g. supplier changed the price" />
        </div>
      )}
      <div className="form-actions">
        <button type="submit">{correcting ? "Save correction" : "Save draft"}</button>
      </div>
    </GuardedForm>
  );

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={po.code}
        status={st}
        lead={
          <>
            <Link href={`/suppliers/${supplier.id}`}>{supplier.name}</Link> ·{" "}
            {run ? (
              <>
                for run <Link href={`/runs/${run.id}`}>{run.code}</Link>
              </>
            ) : (
              "restock (no run)"
            )}{" "}
            · created {fmtDate(dayOf(po.createdAt))}
            {po.orderedOn && ` · sent ${fmtDate(po.orderedOn)}`}
            {po.expectedOn && ` · expected ${fmtDate(po.expectedOn)}`}
            {po.reference && ` · ref ${po.reference}`}
          </>
        }
        actions={
          open ? (
            <Link href={`/deliveries/new?po=${po.id}`} className="btn">
              Record delivery
            </Link>
          ) : undefined
        }
      />
      <EditedMark of={{ type: "purchase_order", id: po.id }} />
      <Flash params={flash} />
      {po.status === "cancelled" && (
        <form action={restoreOrder} className="card row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="poId" value={po.id} />
          <div style={{ flexBasis: "100%" }}>
            <strong>This order was cancelled.</strong>
            <div className="small muted">Restore it to bring it back as {po.orderedOn ? "sent" : "a draft"}.</div>
          </div>
          <ReasonField id="po-restore" label="Why restore it?" />
          <button type="submit" className="secondary">
            Restore order
          </button>
        </form>
      )}

      {po.status === "draft" ? (
        // Lines first: the message and "Mark as sent" below use what is saved, so they wait while there are unsaved changes.
        <UnsavedGroup>
          {editForm(false)}
          <WhenSaved note="Save the draft first: the message and Mark as sent use the saved quantities.">
            <div className="card">
              <strong>Not sent yet.</strong>
              <p className="small muted" style={{ margin: "4px 0 8px" }}>
                Place the order with {supplier.name}, then mark it as sent. Until then it doesn't count as on order.
              </p>
              {sendOrder}
              <hr style={{ margin: "16px 0" }} />
              <MarkSentForm poId={po.id} back={back} />
            </div>
          </WhenSaved>
        </UnsavedGroup>
      ) : (
        <div className="card scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Ordered</th>
                <th className="num">Accepted</th>
                <th className="num">Refused</th>
                <th className="num">Still to come</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const unit = l.item.stockUnit as UnitCode;
                return (
                  <tr key={l.line.id}>
                    <td>
                      <Link href={`/items/${l.item.id}?tab=suppliers`}>{l.item.name}</Link>
                      {l.line.packs !== null && l.line.packQty && (
                        <div className="small muted">
                          {l.line.packs} × {l.line.packQty} {u(unit)}
                        </div>
                      )}
                    </td>
                    <td className="num">{formatQty(new Decimal(l.line.quantity), unit)}</td>
                    <td className="num">{formatQty(l.accepted, unit)}</td>
                    <td className="num">{l.rejected.gt(0) ? formatQty(l.rejected, unit) : "—"}</td>
                    <td className="num">{open ? formatQty(l.pending, unit) : "—"}</td>
                    <td className="num">{l.line.unitPrice ? money(new Decimal(l.line.quantity).mul(l.line.unitPrice)) : "no price"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small" style={{ marginBottom: 0 }}>
            Total {money(order.cost)}
            {order.cost === null && " (some lines have no price)"}
          </p>
        </div>
      )}
      {po.status !== "draft" && po.status !== "cancelled" && (
        <details className="card">
          <summary>Correct this order</summary>
          <p className="small muted">Change quantities, prices, the expected date or the reference. The change and its reason go in the history.</p>
          {editForm(true)}
        </details>
      )}
      {open && sendOrder && (
        <details className="card">
          <summary>Send to supplier again</summary>
          <p className="small muted">The order as a message to copy into an email or WhatsApp, or to print or save as a PDF.</p>
          {sendOrder}
        </details>
      )}
      {po.note && po.status !== "draft" && (
        <p className="card small" style={{ whiteSpace: "pre-wrap" }}>
          {po.note}
        </p>
      )}

      {(po.status !== "draft" || docs.length > 0) && (
        <>
          <h2>Paperwork</h2>
          <div className="card">
            <div className="paperwork">
              <div className="head">
                <strong>Invoice</strong>
                <DocUpload kind="invoice" poId={po.id} back={back} label={invoices.length ? "Add another file" : "Add invoice"} />
              </div>
              {invoices.length === 0 && <span className="small muted">No invoice yet. One invoice can cover several deliveries.</span>}
              <DocList docs={invoices} back={back} />
            </div>
            {deliveries.map((r) => {
              const notes = docs.filter((d) => d.receiptId === r.id);
              return (
                <div key={r.id} className="paperwork">
                  <div className="head">
                    <strong>
                      Delivery note, {fmtDate(r.receivedOn)}
                      {r.deliveryRef && (
                        <span className="muted small" style={{ fontWeight: 400 }}>
                          {" "}
                          · no. {r.deliveryRef}
                        </span>
                      )}
                    </strong>
                    <DocUpload kind="delivery_note" receiptId={r.id} back={back} label={notes.length ? "Add another file" : "Add delivery note"} />
                  </div>
                  {notes.length === 0 && <span className="small muted">No photo or PDF of this delivery note yet.</span>}
                  <DocList docs={notes} back={back} />
                </div>
              );
            })}
            <RemovedDocs docs={removedDocs} back={back} />
            {deliveries.length === 0 && po.status !== "draft" && (
              <p className="small muted" style={{ margin: "14px 0 0" }}>
                Delivery notes are added with each delivery.
              </p>
            )}
          </div>
        </>
      )}

      {receipts.length > 0 && (
        <>
          <h2>Deliveries</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th className="num">Accepted</th>
                  <th className="num">Refused</th>
                  <th>Damage</th>
                  <th>Lot</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map(({ rl, r, lot }) => {
                  const item = lines.find((l) => l.line.id === rl.purchaseOrderLineId)!.item;
                  const unit = item.stockUnit as UnitCode;
                  return (
                    <tr key={rl.id} className={r.deletedAt ? "is-deleted" : undefined}>
                      <td>
                        <Link href={`/deliveries/${r.id}`}>
                          {fmtDate(r.receivedOn)}
                          {r.receivedTime && ` ${r.receivedTime}`}
                        </Link>
                        {r.deletedAt && <span className="badge neutral"> deleted</span>}
                        {r.note && <div className="small muted">{r.note}</div>}
                      </td>
                      <td>{item.name}</td>
                      <td className="num">{formatQty(new Decimal(rl.quantity), unit)}</td>
                      <td className="num">{new Decimal(rl.rejectedQty).gt(0) ? formatQty(new Decimal(rl.rejectedQty), unit) : "—"}</td>
                      <td className="small">{rl.damageNote ?? "—"}</td>
                      <td>{lot ? <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link> : <span className="muted">none</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(open || po.status === "draft") && (
        <details className="card" style={{ marginTop: 32 }}>
          <summary>{po.status === "partly_received" ? "Close this order" : "Cancel this order"}</summary>
          {po.status === "partly_received" ? (
            <form action={closeOrderAction} className="row">
              <input type="hidden" name="poId" value={po.id} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <label htmlFor="cnote">Why (optional)</label>
                <input id="cnote" name="note" type="text" placeholder="e.g. refused sack won't be replaced" />
              </div>
              <button type="submit" className="secondary">
                Close order
              </button>
              <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                Closing stops waiting for what hasn&apos;t arrived. What arrived stays in stock and on record.
              </p>
            </form>
          ) : (
            <form action={cancelOrder} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="poId" value={po.id} />
              <input type="hidden" name="back" value={back} />
              <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                Nothing has arrived yet, so the order can be cancelled. It stays on record and can be restored.
              </p>
              <ReasonField id="po-cancel" optional={po.status === "draft"} placeholder="e.g. found it cheaper elsewhere" />
              <button type="submit" className="danger">
                Cancel order
              </button>
            </form>
          )}
        </details>
      )}
      <History of={{ type: "purchase_order", id: po.id }} />
    </>
  );
}
