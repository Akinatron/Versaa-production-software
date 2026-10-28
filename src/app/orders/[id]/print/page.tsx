import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { loadOrders } from "@/db/purchasing";
import { money } from "@/domain/pricing";
import { linePrice, lineQuantity, longDate, orderTotal } from "@/domain/order-message";
import { orderMessageData } from "../../message-data";
import { PrintButton } from "../../../components/print-button";

export const dynamic = "force-dynamic";

const w = {
  title: "Purchase order",
  date: "Date",
  to: "Supplier",
  item: "Item",
  code: "Supplier code",
  qty: "Quantity",
  price: "Price",
  cost: "Amount",
  total: "Approximate total",
  by: "Wanted by",
  ref: "Your reference",
  print: "Print or save as PDF",
  back: "Back to the order",
};

export default async function PrintOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const withPrices = q.prices === "1";
  const [order] = await loadOrders(db(), { ids: [id] });
  if (!order || order.po.status === "cancelled") notFound();
  const m = await orderMessageData(db(), order);
  const lines = m.lines.filter((l) => new Decimal(l.quantity).gt(0));
  const hasCodes = lines.some((l) => l.supplierCode);
  const total = orderTotal(lines);

  return (
    <div className="print-doc">
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 20 }}>
        <Link href={`/orders/${id}`}>{w.back}</Link>
        <PrintButton label={w.print} auto />
      </div>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.3rem" }}>Versaa</div>
          <h1 style={{ margin: "6px 0 0" }}>
            {w.title} {m.code}
          </h1>
        </div>
        <div className="small" style={{ textAlign: "right" }}>
          {w.date}: {longDate(m.date)}
        </div>
      </header>
      <p style={{ margin: "20px 0" }}>
        <span className="small muted">{w.to}</span>
        <br />
        <strong>{m.supplierName}</strong>
        {order.supplier.contact && (
          <>
            <br />
            <span className="small" style={{ whiteSpace: "pre-wrap" }}>
              {order.supplier.contact}
            </span>
          </>
        )}
      </p>
      <table>
        <thead>
          <tr>
            <th>{w.item}</th>
            {hasCodes && <th>{w.code}</th>}
            <th className="num">{w.qty}</th>
            {withPrices && <th className="num">{w.price}</th>}
            {withPrices && <th className="num">{w.cost}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              {hasCodes && <td>{l.supplierCode ?? ""}</td>}
              <td className="num">{lineQuantity(l)}</td>
              {withPrices && <td className="num">{linePrice(l)?.replace(/ each$/, "") ?? ""}</td>}
              {withPrices && <td className="num">{l.unitPrice ? money(new Decimal(l.quantity).mul(l.unitPrice)) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {withPrices && total && (
        <p style={{ textAlign: "right", marginTop: 10 }}>
          <strong>
            {w.total}: {money(total)}
          </strong>
        </p>
      )}
      {(m.expectedOn || m.reference) && (
        <p style={{ marginTop: 20 }}>
          {m.expectedOn && (
            <>
              {w.by}: <strong>{longDate(m.expectedOn)}</strong>
              <br />
            </>
          )}
          {m.reference && (
            <>
              {w.ref}: {m.reference}
            </>
          )}
        </p>
      )}
    </div>
  );
}
