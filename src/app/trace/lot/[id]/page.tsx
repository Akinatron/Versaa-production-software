import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { inArray } from "drizzle-orm";
import * as t from "@/db/schema";
import { lotsByIds, traceForward } from "@/db/trace";
import { OUTFLOW } from "../../../components/labels";
import { BatchBackward } from "../../../components/trace-backward";
import { LotOrigin, batchCodes, jars, lotQty, who } from "../../../components/trace-format";
import { PageHeader } from "../../../components/ui/header";
import { fmtDate } from "../../../components/ui/format";
import { lotPaperwork } from "@/db/documents";
import { DocList } from "../../../components/documents";
import { DocUpload } from "../../../components/doc-upload";
import { TraceFlow } from "../../../components/trace-flow";
import { lotFlow } from "../../../components/trace-flow-data";
import { Flash } from "../../../components/flash";
import { EditedMark, History, ReasonField } from "../../../components/history";
import { editLot } from "../../actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  ingredient: "Ingredient",
  packaging: "Packaging",
  finished: "Finished jars",
  bulk: "Bulk sauce",
};

export default async function LotTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const tr = await traceForward(db(), id);
  if (!tr) notFound();
  const { lot, batches, jarLots, destinations, jarsInStock, jarsOut } = tr;
  const codes = await batchCodes([lot.batchId, ...jarLots.map((l) => l.batchId)]);
  const isMade = lot.itemKind === "finished" || lot.itemKind === "bulk";
  const affected = lot.itemKind === "finished" && lot.batchId ? [{ batchId: lot.batchId, code: codes.get(lot.batchId) ?? "batch" }] : batches;
  const inStock = jarLots.filter((l) => l.balance.gt(0));
  // Sauce from affected batches that hasn't been put in jars yet.
  const bulkIds = affected.length
    ? (
        await db()
          .select({ id: t.productionBatches.bulkLotId })
          .from(t.productionBatches)
          .where(
            inArray(
              t.productionBatches.id,
              affected.map((b) => b.batchId),
            ),
          )
      )
        .map((r) => r.id)
        .filter((x): x is string => !!x && x !== lot.id)
    : [];
  const bulkLeft = (await lotsByIds(db(), bulkIds)).filter((l) => l.balance.gt(0));

  // Jars already out, grouped by where they went.
  const out = new Map<string, { type: string; who: string; jars: number }>();
  for (const d of destinations) {
    const named = who(d.customer, d.destination);
    // Non-sales (own use, tests, gifts, waste) usually have no destination: name them by their reason.
    const w = named !== "—" ? named : d.type === "sale" ? "No destination recorded" : (OUTFLOW[d.type] ?? d.type);
    const k = `${d.type}|${w}`;
    out.set(k, {
      type: d.type,
      who: w,
      jars: (out.get(k)?.jars ?? 0) + d.jars,
    });
  }
  const paperwork = await lotPaperwork(db(), lot.id);
  const flow = await lotFlow(lot.id);
  const back = `/trace/lot/${lot.id}`;
  const sorted = [...destinations].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.code.localeCompare(b.code)));

  return (
    <>
      <PageHeader
        back={{ href: "/trace", label: "Trace" }}
        title={`Lot ${lot.code}`}
        lead={
          <>
            <Link href={`/stock/${lot.itemId}`}>{lot.itemName}</Link> · {KIND[lot.itemKind] ?? lot.itemKind}
          </>
        }
      />
      <EditedMark of={{ type: "lot", id: lot.id }} />
      <Flash params={flash} />

      {flow && <TraceFlow columns={flow.columns} edges={flow.edges} />}

      <div className="card grid">
        <div>
          <div className="small muted">Where it came from</div>
          <LotOrigin lot={lot} batchCode={lot.batchId ? codes.get(lot.batchId) : null} />
        </div>
        <div>
          <div className="small muted">{isMade ? "Made or packed on" : "Received on"}</div>
          {lot.receivedOn ? fmtDate(lot.receivedOn, { year: true }) : "not recorded"}
        </div>
        <div>
          <div className="small muted">Best before</div>
          {lot.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : "not recorded"}
        </div>
        <div>
          <div className="small muted">Still in stock</div>
          <strong>{lotQty(lot.balance, lot.unit, lot.itemKind)}</strong>
        </div>
      </div>

      {paperwork && (
        <div className="card">
          <div className="paperwork">
            <div className="head">
              <strong>
                Delivery note
                <span className="muted small" style={{ fontWeight: 400 }}>
                  {" "}
                  · delivered {fmtDate(paperwork.receipt.receivedOn, { year: true })}
                  {paperwork.receipt.deliveryRef && `, no. ${paperwork.receipt.deliveryRef}`}
                </span>
              </strong>
              <DocUpload
                kind="delivery_note"
                receiptId={paperwork.receipt.id}
                back={back}
                label={paperwork.deliveryNotes.length ? "Add another file" : "Add delivery note"}
              />
            </div>
            {paperwork.deliveryNotes.length === 0 && <span className="small muted">No photo or PDF of the delivery note yet.</span>}
            <DocList docs={paperwork.deliveryNotes} />
          </div>
          {paperwork.order && (
            <div className="paperwork">
              <div className="head">
                <strong>
                  Invoice
                  <span className="muted small" style={{ fontWeight: 400 }}>
                    {" "}
                    · order <Link href={`/orders/${paperwork.order.id}`}>{paperwork.order.code}</Link>
                  </span>
                </strong>
                <DocUpload kind="invoice" poId={paperwork.order.id} back={back} label={paperwork.invoices.length ? "Add another file" : "Add invoice"} />
              </div>
              {paperwork.invoices.length === 0 && <span className="small muted">No invoice yet.</span>}
              <DocList docs={paperwork.invoices} />
            </div>
          )}
        </div>
      )}

      <h2>Recall summary</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          If this lot had a problem, this is everything it reached, from recorded production and outflows.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Batches affected:</strong>{" "}
            {affected.length === 0
              ? lot.itemKind === "ingredient" || lot.itemKind === "packaging"
                ? "none, this lot hasn't been used in production."
                : "none recorded."
              : affected.map((b, i) => (
                  <span key={b.batchId}>
                    {i > 0 && ", "}
                    <Link href={`/batches/${b.batchId}`}>{b.code}</Link>
                  </span>
                ))}
          </li>
          {!isMade && lot.balance.gt(0) && (
            <li>
              <strong>Unused, still in stock:</strong> {lotQty(lot.balance, lot.unit, lot.itemKind)} of this lot.
            </li>
          )}
          <li>
            <strong>Jars still in stock:</strong> {jars(jarsInStock)}
            {inStock.length > 0 && (
              <>
                {": "}
                {inStock.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 && ", "}
                    {l.balance.toString()} in <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                  </span>
                ))}
              </>
            )}
          </li>
          {bulkLeft.length > 0 && (
            <li>
              <strong>Sauce not yet in jars:</strong>{" "}
              {bulkLeft.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ", "}
                  {lotQty(l.balance, l.unit, l.itemKind)} in <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                </span>
              ))}
            </li>
          )}
          <li>
            <strong>Jars already out:</strong> {jars(jarsOut)}
            {out.size > 0 && (
              <ul style={{ paddingLeft: 20 }}>
                {[...out.values()].map((o) => (
                  <li key={`${o.type}|${o.who}`}>
                    {o.who}: {jars(o.jars)} {o.who !== OUTFLOW[o.type] && <span className="small muted">({OUTFLOW[o.type] ?? o.type})</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
      </div>

      <h2>Forward: where it went</h2>
      {!isMade && (
        <div className="card scroll">
          <h3 style={{ marginTop: 0 }}>Batches that used this lot</h3>
          {batches.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Not used in any batch yet.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="num">Used from this lot</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batchId}>
                    <td>
                      <Link href={`/batches/${b.batchId}`}>{b.code}</Link>
                    </td>
                    <td className="num">{lotQty(b.quantity, lot.unit, lot.itemKind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {lot.itemKind !== "finished" && (
        <div className="card scroll">
          <h3 style={{ marginTop: 0 }}>Jar lots made</h3>
          {jarLots.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No jars packed from {lot.itemKind === "bulk" ? "this batch" : "these batches"} yet.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Jar lot</th>
                  <th>Product</th>
                  <th>Best before</th>
                  <th className="num">Jars still in stock</th>
                </tr>
              </thead>
              <tbody>
                {jarLots.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/trace/lot/${l.id}`}>{l.code}</Link>
                    </td>
                    <td>{l.itemName}</td>
                    <td>{l.bestBefore ? fmtDate(l.bestBefore, { year: true }) : <span className="muted">not recorded</span>}</td>
                    <td className="num">{l.balance.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="card scroll">
        <h3 style={{ marginTop: 0 }}>Every destination</h3>
        {sorted.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No jars have left stock yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Customer / destination</th>
                <th>Reference</th>
                <th>Jar lot</th>
                <th className="num">Jars</th>
                <th>Outflow</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={`${d.outflowId}-${d.lotId}-${i}`}>
                  <td>{fmtDate(d.occurredOn, { year: true })}</td>
                  <td>{OUTFLOW[d.type] ?? d.type}</td>
                  <td>{who(d.customer, d.destination)}</td>
                  <td>{d.reference ?? "—"}</td>
                  <td>
                    {d.lotCode}
                    <div className="small muted">{d.productName}</div>
                  </td>
                  <td className="num">{d.jars}</td>
                  <td>
                    <Link href={`/trace/outflow/${d.outflowId}`}>{d.code}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isMade && lot.batchId && (
        <>
          <h2>Backward: what went into it</h2>
          <BatchBackward batchId={lot.batchId} />
        </>
      )}
      <details className="card edit-only" style={{ marginTop: 32 }}>
        <summary>Correct the best-before{isMade ? "" : " or supplier batch"}</summary>
        <form action={editLot} className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
          <input type="hidden" name="lotId" value={lot.id} />
          {!isMade && (
            <div>
              <label htmlFor="l-batch">Supplier batch</label>
              <input id="l-batch" name="supplierBatch" defaultValue={lot.supplierBatch ?? ""} />
            </div>
          )}
          <div>
            <label htmlFor="l-bb">Best before</label>
            <input id="l-bb" name="bestBefore" type="date" defaultValue={lot.bestBefore ?? ""} />
          </div>
          <ReasonField id="l-reason" placeholder="e.g. misread the label" />
          <button type="submit" className="secondary">
            Save
          </button>
        </form>
      </details>
      <History of={{ type: "lot", id: lot.id }} />
    </>
  );
}
