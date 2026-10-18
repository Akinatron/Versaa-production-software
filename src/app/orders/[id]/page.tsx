import Link from "next/link";
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
import { cancelOrder, closeOrderAction, updateDraftAction } from "../actions";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
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
  const open = po.status === "sent" || po.status === "partly_received";
  const back = `/orders/${id}`;
  const u = (unit: string) => UNITS[unit as UnitCode].label;

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
            · created {fmtDate(po.createdAt.toISOString().slice(0, 10))}
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
      <Flash params={flash} />

      {po.status === "draft" && (
        <div className="card">
          <strong>Not sent yet.</strong>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            Place the order with {supplier.name}, then mark it as sent. Until then it doesn't count as on order.
          </p>
          <MarkSentForm poId={po.id} back={back} expectedOn={po.expectedOn} />
        </div>
      )}

      {po.status === "draft" ? (
        <form action={updateDraftAction}>
          <input type="hidden" name="poId" value={po.id} />
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
                          <input
                            name={`packs_${i}`}
                            type="number"
                            min={0}
                            step={1}
                            defaultValue={l.line.packs ?? ""}
                            aria-label="Packs"
                            style={{ maxWidth: 80 }}
                          />
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
                          <input name={`qty_${i}`} type="number" min={0} step="any" defaultValue={l.line.quantity} aria-label="Quantity" />
                          <span className="small">{u(l.item.stockUnit)}</span>
                          <input type="hidden" name={`packs_${i}`} value="" />
                        </div>
                      )}
                    </td>
                    <td>
                      <input name={`price_${i}`} type="number" min={0} step="any" defaultValue={l.line.unitPrice ?? ""} aria-label="Price per unit" />
                    </td>
                    <td className="num">{l.line.unitPrice ? money(new Decimal(l.line.quantity).mul(l.line.unitPrice)) : "no price"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">Set a quantity to 0 to remove the line.</p>
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
          <div className="form-actions">
            <button type="submit">Save draft</button>
            <button type="submit" formAction={cancelOrder} className="danger">
              Cancel order
            </button>
          </div>
        </form>
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
                      <Link href={`/items/${l.item.id}`}>{l.item.name}</Link>
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
      {po.note && po.status !== "draft" && (
        <p className="card small" style={{ whiteSpace: "pre-wrap" }}>
          {po.note}
        </p>
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
                    <tr key={rl.id}>
                      <td>
                        {fmtDate(r.receivedOn)}
                        {r.receivedTime && ` ${r.receivedTime}`}
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

      {open && (
        <>
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
                  Closing stops waiting for what hasn't arrived. What arrived stays in stock and on record.
                </p>
              </form>
            ) : (
              <form action={cancelOrder} className="row">
                <input type="hidden" name="poId" value={po.id} />
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="danger">
                  Cancel order
                </button>
                <span className="small muted">Nothing has arrived yet, so the order can be cancelled.</span>
              </form>
            )}
          </details>
        </>
      )}
    </>
  );
}
