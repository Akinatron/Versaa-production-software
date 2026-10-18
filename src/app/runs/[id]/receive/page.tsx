import Link from "next/link";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { loadOrders } from "@/db/purchasing";
import { formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../../components/flash";
import { PO_STATUS } from "../../../components/labels";
import { MarkSentForm } from "../../../components/order-bits";
import { RunHeader, loadRun } from "../../../components/run-steps";
import { fmtDate } from "../../../components/ui/format";

export const dynamic = "force-dynamic";

/** Step 4: receive the run's orders. */
export default async function RunReceivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const run = await loadRun(id);
  const orders = await loadOrders(db(), { runId: id });
  const waiting = orders.filter((o) => o.po.status === "sent" || o.po.status === "partly_received");
  const drafts = orders.filter((o) => o.po.status === "draft");
  const done = orders.filter((o) => ["received", "closed", "cancelled"].includes(o.po.status));

  return (
    <>
      <RunHeader run={run} step="receive" />
      <Flash params={flash} />
      {orders.length === 0 && (
        <p className="card muted">
          No orders for this run. <Link href={`/runs/${id}/order`}>Plan them in step 3</Link>.
        </p>
      )}
      {waiting.length > 0 && <h2>Waiting for delivery</h2>}
      {waiting.map((o) => (
        <div key={o.po.id} className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <Link href={`/orders/${o.po.id}`}>
                <strong>{o.po.code}</strong>
              </Link>{" "}
              · {o.supplier.name} <span className={`badge ${PO_STATUS[o.po.status]!.cls}`}>{PO_STATUS[o.po.status]!.label}</span>
              <div className="small muted">
                Sent {fmtDate(o.po.orderedOn)}
                {o.po.expectedOn && ` · expected ${fmtDate(o.po.expectedOn)}`}
              </div>
            </div>
            <Link href={`/deliveries/new?po=${o.po.id}`} className="btn">
              Record delivery
            </Link>
          </div>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {o.lines.map((l) => {
              const u = l.item.stockUnit as UnitCode;
              return (
                <li key={l.line.id}>
                  {l.item.name}: {formatQty(l.pending, u)} still to come
                  {l.accepted.gt(0) && ` (${formatQty(l.accepted, u)} accepted`}
                  {l.accepted.gt(0) && l.rejected.gt(0) && `, ${formatQty(l.rejected, u)} refused`}
                  {l.accepted.gt(0) && ")"}
                  {l.accepted.isZero() && l.rejected.gt(0) && ` (${formatQty(l.rejected, u)} refused)`}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {drafts.length > 0 && (
        <>
          <h2>Not sent yet</h2>
          {drafts.map((o) => (
            <div key={o.po.id} className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link> · {o.supplier.name}
              </span>
              <MarkSentForm poId={o.po.id} back={`/runs/${id}/receive`} compact />
            </div>
          ))}
        </>
      )}
      {done.length > 0 && (
        <>
          <h2>Done</h2>
          <div className="card scroll">
            <table>
              <tbody>
                {done.map((o) => (
                  <tr key={o.po.id}>
                    <td>
                      <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link>
                    </td>
                    <td>{o.supplier.name}</td>
                    <td>
                      <span className={`badge ${PO_STATUS[o.po.status]!.cls}`}>{PO_STATUS[o.po.status]!.label}</span>
                    </td>
                    <td className="small">
                      {o.lines.map((l) => `${l.item.name} ${formatQty(l.accepted, l.item.stockUnit as UnitCode)}`).join(", ")}
                      {o.lines.some((l) => l.rejected.gt(0)) && (
                        <span className="muted">
                          {" "}
                          · refused:{" "}
                          {o.lines
                            .filter((l) => l.rejected.gt(0))
                            .map((l) => `${l.item.name} ${formatQty(new Decimal(l.rejected), l.item.stockUnit as UnitCode)}`)
                            .join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
