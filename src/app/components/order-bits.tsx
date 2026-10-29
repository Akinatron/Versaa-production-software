import Link from "next/link";
import { isOnTheWay } from "@/domain/status";
import Decimal from "decimal.js";
import type { OrderView } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { PO_STATUS } from "./labels";
import { markSentAction } from "../orders/actions";
import { fmtDate } from "./ui/format";
import { OrderItems } from "./order-items";
import { today } from "@/domain/dates";


/** "Mark as sent": draft → sent, with the date it was sent. */
export function MarkSentForm({ poId, back, compact }: { poId: string; back: string; compact?: boolean }) {
  return (
    <form
      action={markSentAction}
      className="row"
      style={{
        gap: 6,
        alignItems: "end",
        flexWrap: compact ? "nowrap" : "wrap",
      }}
    >
      <input type="hidden" name="poId" value={poId} />
      <input type="hidden" name="back" value={back} />
      {compact ? (
        <input type="hidden" name="sentOn" value={today()} />
      ) : (
        <div>
          <label className="small">Sent on</label>
          <input name="sentOn" type="date" defaultValue={today()} style={{ maxWidth: 160 }} />
        </div>
      )}
      <button type="submit" className={compact ? "sm" : undefined} title={compact ? "Marks it as sent today. To use another date, open the order." : undefined}>
        {compact ? "Mark as sent today" : "Mark as sent"}
      </button>
    </form>
  );
}

/** Orders made for a run, with their status: shown on the run. */
export function RunOrdersTable({ orders, back }: { orders: OrderView[]; back: string }) {
  if (orders.length === 0) return <p className="card muted">No orders for this run yet. Step 3 creates them from what&apos;s missing.</p>;
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
                <td className="nowrap">
                  <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link>
                </td>
                <td>{o.supplier.name}</td>
                <td>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </td>
                <td className="small">
                  <OrderItems
                    lines={o.lines.map((l) => ({
                      id: l.line.id,
                      text: `${l.item.name}: ${formatQty(new Decimal(l.line.quantity), l.item.stockUnit as UnitCode)}`,
                      note: l.accepted.gt(0) && o.po.status !== "received" ? `${formatQty(l.accepted, l.item.stockUnit as UnitCode)} in` : null,
                    }))}
                  />
                </td>
                <td className="nowrap">{fmtDate(o.po.orderedOn)}</td>
                <td className="nowrap">{fmtDate(o.po.expectedOn)}</td>
                <td className="num">{money(o.cost)}</td>
                <td>
                  {o.po.status === "draft" && <MarkSentForm poId={o.po.id} back={back} compact />}
                  {isOnTheWay(o.po.status) && (
                    <Link href={`/deliveries/new?po=${o.po.id}`} className="btn secondary sm">
                      Record delivery
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
