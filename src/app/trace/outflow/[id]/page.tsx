import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { traceOutflow } from "@/db/trace";
import { OUTFLOW } from "../../../components/labels";
import { BatchBackward } from "../../../components/trace-backward";
import { who } from "../../../components/trace-format";

export const dynamic = "force-dynamic";

export default async function OutflowTracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await traceOutflow(db(), id);
  if (!tr) notFound();
  const { out, customer, lines } = tr;
  const [order] = out.salesOrderId ? await db().select().from(t.salesOrders).where(eq(t.salesOrders.id, out.salesOrderId)) : [];
  const batchIds = [...new Set(lines.map((l) => l.lot.batchId).filter((x): x is string => !!x))];
  const priced = lines.filter((l) => l.line.unitPrice !== null);
  const revenue = priced.reduce((s, l) => s.plus(new Decimal(l.line.unitPrice!).mul(l.line.jars)), new Decimal(0));
  const total = lines.reduce((s, l) => s + l.line.jars, 0);

  return (
    <>
      <h1>
        {out.code} <span className={`badge ${out.type === "sale" ? "ok" : out.type === "waste" ? "bad" : "warn"}`}>{OUTFLOW[out.type] ?? out.type}</span>
      </h1>
      <p className="lead">{out.type === "sale" ? "Jars sold and delivered." : "Jars that left stock. This is not a sale."}</p>

      <div className="card grid">
        <div>
          <div className="small muted">Date</div>
          {out.occurredOn}
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
          {order ? <Link href={`/sales/${order.id}`}>{order.code}</Link> : "none (recorded directly)"}
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
                  <div className="small muted">best before {l.lot.bestBefore ?? "not recorded"}</div>
                </td>
                <td>{l.lot.batchId ? <Link href={`/batches/${l.lot.batchId}`}>{l.batchCode ?? "view batch"}</Link> : <span className="muted">no batch (counted stock)</span>}</td>
                <td className="num">{l.line.unitPrice === null ? <span className="muted">not recorded</span> : `€ ${new Decimal(l.line.unitPrice).toFixed(2)}`}</td>
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

      <h2>Backward: what went into these jars</h2>
      {batchIds.length === 0 ? (
        <p className="card muted">These jars don&apos;t come from a recorded batch, so there are no ingredient lots to show.</p>
      ) : (
        batchIds.map((b) => <BatchBackward key={b} batchId={b} />)
      )}
      <p>
        <Link href="/sales">← Sales</Link> · <Link href="/trace">Trace something else</Link>
      </p>
    </>
  );
}
