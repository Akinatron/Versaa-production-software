import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadOffers, priceHistory } from "@/db/suppliers";
import { money } from "@/domain/pricing";
import { type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { ItemSelect } from "../../components/item-select";
import { PO_STATUS } from "../../components/labels";
import { OfferForm, PriceHistory, PriceText } from "../../components/supplier-offer";
import { linkAction, setSupplierActiveAction, updateSupplierAction } from "../actions";
import { loadOrders } from "@/db/purchasing";

export const dynamic = "force-dynamic";

const ordinal = (n: number) => (n === 1 ? "Favourite" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} choice`);

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const [supplier] = await db().select().from(t.suppliers).where(eq(t.suppliers.id, id));
  if (!supplier) notFound();
  const offers = await loadOffers(db(), { supplierId: id });
  const [items, links, others, recent] = await Promise.all([
    db().select().from(t.items).where(and(inArray(t.items.kind, ["ingredient", "packaging"]), eq(t.items.active, true))),
    db().select().from(t.supplierItems).where(eq(t.supplierItems.supplierId, id)),
    // How many suppliers each item has, to show the favourite order.
    offers.length ? loadOffers(db(), { itemIds: offers.map((o) => o.itemId) }) : Promise.resolve([]),
    db().select({ id: t.purchaseOrders.id }).from(t.purchaseOrders).where(eq(t.purchaseOrders.supplierId, id)).orderBy(desc(t.purchaseOrders.createdAt)).limit(10),
  ]);
  const history = await priceHistory(db(), offers.map((o) => o.supplierItemId));
  const orders = await loadOrders(db(), { ids: recent.map((r) => r.id) });
  // Linked items may be retired, so look them up separately from the active list.
  const linkedItems = offers.length ? await db().select().from(t.items).where(inArray(t.items.id, offers.map((o) => o.itemId))) : [];
  const anyItem = new Map(linkedItems.map((i) => [i.id, i]));
  const linked = new Set(offers.map((o) => o.itemId));
  const back = `/suppliers/${id}`;

  return (
    <>
      <p className="small" style={{ margin: "0 0 8px" }}>
        <Link href="/suppliers">← Suppliers</Link>
      </p>
      <h1>
        {supplier.name} {!supplier.active && <span className="badge">Not in use</span>}
      </h1>
      <p className="lead">{supplier.contact ?? "No contact saved."}</p>
      <Flash params={flash} />

      <h2>Items sold</h2>
      <p className="small muted">
        Prices are per pack as this supplier sells it (e.g. 12 € per 25 kg sack). Orders are rounded up to whole packs. These links also show on each item's page.
      </p>
      {offers.length === 0 && <p className="card muted">No items yet. Add the first one below.</p>}
      {offers.map((o) => {
        const item = anyItem.get(o.itemId)!;
        const unit = item.stockUnit as UnitCode;
        const count = others.filter((x) => x.itemId === o.itemId).length;
        const link = links.find((l) => l.id === o.supplierItemId);
        return (
          <div key={o.supplierItemId} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
              <div>
                <Link href={`/items/${item.id}`}>
                  <strong>{item.name}</strong>
                </Link>{" "}
                <span className={`badge ${o.rank === 1 ? "ok" : ""}`}>{ordinal(o.rank)}</span>
                {count > 1 && <span className="small muted"> of {count} suppliers</span>}
                <div>
                  <PriceText offer={o} unit={unit} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <OfferForm offer={o} unit={unit} back={back} supplierCode={link?.supplierCode} />
            </div>
            <PriceHistory rows={history.filter((h) => h.supplierItemId === o.supplierItemId)} unit={unit} />
          </div>
        );
      })}

      <h2>Add an item this supplier sells</h2>
      <form action={linkAction} className="card row" style={{ gap: 8 }}>
        <input type="hidden" name="supplierId" value={id} />
        <input type="hidden" name="back" value={back} />
        <div style={{ minWidth: 220 }}>
          <label>Item (required)</label>
          <ItemSelect
            name="itemId"
            items={items.filter((i) => !linked.has(i.id)).map((i) => ({ id: i.id, name: i.name, kind: i.kind, stockUnit: i.stockUnit as UnitCode }))}
          />
        </div>
        <div>
          <label>Pack size (in the item's unit)</label>
          <input name="packQty" type="number" min="0" step="any" placeholder="e.g. 25" />
        </div>
        <div>
          <label>Pack name</label>
          <input name="packName" type="text" placeholder="sack, box…" style={{ maxWidth: 120 }} />
        </div>
        <div>
          <label>Price per pack (€)</label>
          <input name="price" type="number" min="0" step="any" />
        </div>
        <button type="submit">Add item</button>
        <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
          Leave the pack size empty if they sell any quantity; the price is then per kg, L or unit.
        </p>
      </form>

      <h2>Recent orders</h2>
      <div className="card scroll">
        {orders.length === 0 ? (
          <p className="muted small">No orders yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Run</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.po.id}>
                  <td>
                    <Link href={`/orders/${o.po.id}`}>{o.po.code}</Link>
                  </td>
                  <td>
                    <span className={`badge ${PO_STATUS[o.po.status]!.cls}`}>{PO_STATUS[o.po.status]!.label}</span>
                  </td>
                  <td>{o.po.orderedOn ?? "—"}</td>
                  <td>{o.run ? <Link href={`/runs/${o.run.id}`}>{o.run.code}</Link> : <span className="muted">—</span>}</td>
                  <td className="num">{money(o.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Details</h2>
      <form action={updateSupplierAction} className="card grid">
        <input type="hidden" name="supplierId" value={id} />
        <div>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" defaultValue={supplier.name} required />
        </div>
        <div>
          <label htmlFor="contact">Contact</label>
          <input id="contact" name="contact" type="text" defaultValue={supplier.contact ?? ""} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} defaultValue={supplier.notes ?? ""} />
        </div>
        <div>
          <button type="submit">Save details</button>
        </div>
      </form>
      <form action={setSupplierActiveAction}>
        <input type="hidden" name="supplierId" value={id} />
        <input type="hidden" name="active" value={supplier.active ? "0" : "1"} />
        <button type="submit" className="link small">
          {supplier.active ? "Mark as not in use" : "Bring back into use"}
        </button>
      </form>
    </>
  );
}
