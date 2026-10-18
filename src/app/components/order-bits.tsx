import Link from "next/link";
import Decimal from "decimal.js";
import type { OrderView } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { PO_STATUS } from "./labels";
import { markSentAction } from "../orders/actions";

const today = () => new Date().toISOString().slice(0, 10);

/** "Mark as sent": draft → sent, with the date it was sent. */
export function MarkSentForm({ poId, back, compact, expectedOn }: { poId: string; back: string; compact?: boolean; expectedOn?: string | null }) {
  return (
    <form action={markSentAction} className="row" style={{ gap: 6, alignItems: "end", flexWrap: compact ? "nowrap" : "wrap" }}>
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="back" value={back} />
      <div>
        {!compact && <label className="small">Sent on</label>}
        <input name="sentOn" type="date" defaultValue={today()} aria-label="Sent on" style={{ maxWidth: 150 }} />
      </div>
      {!compact && (
        <div>
          <label className="small">Expected delivery (optional)</label>
          <input name="expectedOn" type="date" defaultValue={expectedOn ?? ""} style={{ maxWidth: 150 }} />
        </div>
      )}
      <button type="submit" style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
        Mark as sent
      </button>
    </form>
  );
}

/** Orders made for a run, with their status: shown on the run. */
export function RunOrdersTable({ orders, back }: { orders: OrderView[]; back: string }) {
  if (orders.length === 0) return <p className="card muted small">No orders for this run yet.</p>;
  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Supplier</th>
            <th>Status</th>
            <th>Items</th>
            <th>Sent</th>
            <th>Expected</th>
            <th className="num">Cost</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const st = PO_STATUS[o.po.status]!;
            return (
              <tr key={o.po.id}>
                <td>
                  <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link>
                </td>
                <td>{o.supplier.name}</td>
                <td>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </td>
                <td className="small">
                  {o.lines.map((l) => (
                    <div key={l.line.id}>
                      {l.item.name}: {formatQty(new Decimal(l.line.quantity), l.item.stockUnit as UnitCode)}
                      {l.accepted.gt(0) && o.po.status !== "received" && <span className="muted"> · {formatQty(l.accepted, l.item.stockUnit as UnitCode)} in</span>}
                    </div>
                  ))}
                </td>
                <td>{o.po.orderedOn ?? "—"}</td>
                <td>{o.po.expectedOn ?? "—"}</td>
                <td className="num">{money(o.cost)}</td>
                <td>
                  {o.po.status === "draft" && <MarkSentForm poId={o.po.id} back={back} compact />}
                  {(o.po.status === "sent" || o.po.status === "partly_received") && <Link href={`/deliveries/new?po=${o.po.id}`}>Record delivery →</Link>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
