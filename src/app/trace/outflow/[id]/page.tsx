import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceOutflow } from "@/db/trace";
import { OUTFLOW, outflowBadge } from "../../../components/labels";
import { BatchBackward } from "../../../components/trace-backward";
import { who } from "../../../components/trace-format";
import { PageHeader } from "../../../components/ui/header";
import { fmtDate } from "../../../components/ui/format";
import { Flash } from "../../../components/flash";
import { DeletedNote, EditedMark, History, ReasonField } from "../../../components/history";
import { editOutflow, toggleOutflow } from "../../../outbound/actions";
import { customerList } from "../../../outbound/data";
import { idOrNotFound } from "@/lib/ids";

export const dynamic = "force-dynamic";

export default async function OutflowTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
  const flash = await searchParams;
  const tr = await traceOutflow(db(), id);
  if (!tr) notFound();
  const { out, customer, lines } = tr;
  const [order] = out.salesOrderId ? await db().select().from(t.salesOrders).where(eq(t.salesOrders.id, out.salesOrderId)) : [];
  const batchIds = [...new Set(lines.map((l) => l.lot.batchId).filter((x): x is string => !!x))];
  const priced = lines.filter((l) => l.line.unitPrice !== null);
  const revenue = priced.reduce((s, l) => s.plus(new Decimal(l.line.unitPrice!).mul(l.line.jars)), new Decimal(0));
  const total = lines.reduce((s, l) => s + l.line.jars, 0);
  const customers = out.type === "sale" && !out.deletedAt ? await customerList() : [];
  const isSale = out.type === "sale";

  return (
    <>
      <PageHeader
        back={{ href: "/outbound?show=history", label: "Outbound" }}
        title={out.code}
        status={{
          label: OUTFLOW[out.type] ?? out.type,
          cls: outflowBadge(out.type),
        }}
        lead={out.type === "sale" ? "Jars sold and delivered." : "Jars that left stock. This is not a sale."}
      />
      <EditedMark of={{ type: "outflow", id: out.id }} />
      <Flash params={flash} />
      {out.deletedAt && (
        <DeletedNote what={isSale ? "sale" : "outflow"} at={out.deletedAt} reason={out.deletedReason}>
          <form action={toggleOutflow} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <input type="hidden" name="outflowId" value={out.id} />
            <input type="hidden" name="deleted" value="0" />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <ReasonField id="o-restore" label="Why restore it?" />
            <button type="submit" className="secondary">
              Restore
            </button>
          </form>
        </DeletedNote>
      )}

      <div className="card grid">
        <div>
          <div className="small muted">Date</div>
          {fmtDate(out.occurredOn, { weekday: true, year: true })}
        </div>
        <div>
          <div className="small muted">Customer / destination</div>
          {who(customer, out.destination)}
        </div>
        <div>
          <div className="small muted">Reference</div>
          {out.reference ?? "—"}
        </div>
        <div>
          <div className="small muted">Sales order</div>
          {order ? <Link href={`/outbound/orders/${order.id}`}>{order.code}</Link> : "none (recorded directly)"}
        </div>
        {out.note && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="small muted">Note</div>
            {out.note}
          </div>
        )}
      </div>

      <h2>Jars</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Jars</th>
              <th>Jar lot</th>
              <th>Batch</th>
              <th className="num">Price per jar</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line.id}>
                <td>{l.product}</td>
                <td className="num">{l.line.jars}</td>
                <td>
                  <Link href={`/trace/lot/${l.lot.id}`}>{l.lot.code}</Link>
                  <div className="small muted">best before {l.lot.bestBefore ? fmtDate(l.lot.bestBefore, { year: true }) : "not recorded"}</div>
                </td>
                <td>
                  {l.lot.batchId ? (
                    <Link href={`/batches/${l.lot.batchId}`}>{l.batchCode ?? "view batch"}</Link>
                  ) : (
                    <span className="muted">no batch (counted stock)</span>
                  )}
                </td>
                <td className="num">
                  {l.line.unitPrice === null ? <span className="muted">not recorded</span> : `€ ${new Decimal(l.line.unitPrice).toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          {total} jars in total.
          {out.type === "sale" && priced.length > 0 && (
            <>
              {" "}
              Revenue from recorded prices: € {revenue.toFixed(2)}
              {priced.length < lines.length ? " (some lines have no price, so this is incomplete)" : ""}.
            </>
          )}
        </p>
      </div>

      {!out.deletedAt && (
        <>
          <details className="card">
            <summary>Correct the details</summary>
            <form action={editOutflow} className="grid" style={{ marginTop: 12 }}>
              <input type="hidden" name="outflowId" value={out.id} />
              <div>
                <label htmlFor="o-on">Date</label>
                <input id="o-on" name="occurredOn" type="date" required defaultValue={out.occurredOn} />
              </div>
              {isSale && (
                <>
                  <div>
                    <label htmlFor="o-customer">Customer</label>
                    <select id="o-customer" name="customerId" defaultValue={out.customerId ?? ""}>
                      <option value="">None</option>
                      {customers
                        .filter((c) => c.active || c.id === out.customerId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="o-dest">Destination</label>
                    <input id="o-dest" name="destination" defaultValue={out.destination ?? ""} />
                  </div>
                  <div>
                    <label htmlFor="o-ref">Reference</label>
                    <input id="o-ref" name="reference" defaultValue={out.reference ?? ""} />
                  </div>
                </>
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="o-note">Note{out.type === "waste" ? " (why written off)" : ""}</label>
                <input id="o-note" name="note" defaultValue={out.note ?? ""} required={out.type === "waste"} />
              </div>
              <div style={{ gridColumn: "1 / -1" }} className="row">
                <ReasonField id="o-reason" label="Why the correction?" />
                <button type="submit" style={{ alignSelf: "flex-end" }}>
                  Save
                </button>
              </div>
            </form>
            <p className="small muted">To change the jars or lots, delete this and record it again.</p>
          </details>
          <details className="card">
            <summary>Delete this {isSale ? "sale" : "outflow"}</summary>
            <form action={toggleOutflow} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <input type="hidden" name="outflowId" value={out.id} />
              <input type="hidden" name="deleted" value="1" />
              <input type="hidden" name="key" value={crypto.randomUUID()} />
              <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
                The jars go back into their lots.{order ? ` Sales order ${order.code} goes back to waiting for delivery.` : ""} It is kept on record and can be
                restored.
              </p>
              <ReasonField id="o-del" label="Why delete it?" placeholder="e.g. recorded twice" />
              <button type="submit" className="danger">
                Delete
              </button>
            </form>
          </details>
        </>
      )}
      <History of={{ type: "outflow", id: out.id }} />

      <h2>Backward: what went into these jars</h2>
      {batchIds.length === 0 ? (
        <p className="card muted">These jars don&apos;t come from a recorded batch, so there are no ingredient lots to show.</p>
      ) : (
        batchIds.map((b) => <BatchBackward key={b} batchId={b} />)
      )}
    </>
  );
}
