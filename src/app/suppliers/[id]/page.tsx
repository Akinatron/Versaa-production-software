import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadOffers, priceHistory } from "@/db/suppliers";
import { money } from "@/domain/pricing";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { ItemPicker } from "../../components/pickers";
import { PO_STATUS } from "../../components/labels";
import { AddLinkForm, MakeFavourite, OfferForm, PriceHistory, PriceText } from "../../components/supplier-offer";
import { setSupplierActiveAction, updateSupplierAction } from "../actions";
import { loadOrders } from "@/db/purchasing";
import { PageHeader } from "../../components/ui/header";
import { History } from "../../components/history";
import { fmtDate } from "../../components/ui/format";
import { supplierDocuments } from "@/db/documents";
import { DocList } from "../../components/documents";
import { BOUGHT_KINDS, KIND_PLURAL, type BoughtKind } from "@/domain/item-kinds";

export const dynamic = "force-dynamic";

const ordinal = (n: number) => (n === 1 ? "Favourite" : `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"} choice`);

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const [supplier] = await db().select().from(t.suppliers).where(eq(t.suppliers.id, id));
  if (!supplier) notFound();
  const offers = await loadOffers(db(), { supplierId: id });
  const [items, links, others, recent] = await Promise.all([
    db()
      .select()
      .from(t.items)
      .where(and(inArray(t.items.kind, [...BOUGHT_KINDS]), eq(t.items.active, true))),
    db().select().from(t.supplierItems).where(eq(t.supplierItems.supplierId, id)),
    // How many suppliers each item has, to show the favourite order.
    offers.length ? loadOffers(db(), { itemIds: offers.map((o) => o.itemId) }) : Promise.resolve([]),
    db()
      .select({ id: t.purchaseOrders.id })
      .from(t.purchaseOrders)
      .where(eq(t.purchaseOrders.supplierId, id))
      .orderBy(desc(t.purchaseOrders.createdAt))
      .limit(10),
  ]);
  const history = await priceHistory(
    db(),
    offers.map((o) => o.supplierItemId),
  );
  const [orders, paperwork] = await Promise.all([loadOrders(db(), { ids: recent.map((r) => r.id) }), supplierDocuments(db(), id)]);
  const docInfo = new Map(paperwork.map((p) => [p.doc.id, p]));
  // Linked items may be retired, so look them up separately from the active list.
  const linkedItems = offers.length
    ? await db()
        .select()
        .from(t.items)
        .where(
          inArray(
            t.items.id,
            offers.map((o) => o.itemId),
          ),
        )
    : [];
  const anyItem = new Map(linkedItems.map((i) => [i.id, i]));
  const linked = new Set(offers.map((o) => o.itemId));
  const back = `/suppliers/${id}`;

  return (
    <>
      <PageHeader
        back={{ href: "/suppliers", label: "Suppliers" }}
        title={supplier.name}
        status={supplier.active ? null : { label: "Not in use", cls: "neutral" }}
        lead={supplier.contact ?? "No contact saved."}
        actions={
          supplier.active ? (
            <Link href={`/orders/new?supplier=${id}`} className="btn secondary">
              New order
            </Link>
          ) : null
        }
      />
      <Flash params={flash} />

      <h2>Items sold</h2>
      <p className="small muted">
        Price for a quantity as this supplier sells it (e.g. 12 € for a 25 kg sack); orders are rounded up to whole packs. The favourite is preselected when
        ordering. These are the same links shown on each item&apos;s card.
      </p>
      {offers.length === 0 && <p className="card muted">No items yet. Add the first one below.</p>}
      {offers.length > 0 && (
        <ul className="offerlist card">
          {offers.map((o) => {
            const item = anyItem.get(o.itemId)!;
            const unit = item.stockUnit as UnitCode;
            const count = others.filter((x) => x.itemId === o.itemId).length;
            const link = links.find((l) => l.id === o.supplierItemId);
            return (
              <li key={o.supplierItemId} id={`offer-${o.supplierItemId}`}>
                <div className="card-head">
                  <Link href={`/items/${item.id}`}>
                    <strong>{item.name}</strong>
                  </Link>
                  <span className={`badge ${o.rank === 1 ? "ok" : "neutral"}`}>{ordinal(o.rank)}</span>
                  {count > 1 && <span className="small muted">of {count} suppliers</span>}
                  {o.rank !== 1 && (
                    <span style={{ marginLeft: "auto" }}>
                      <MakeFavourite supplierItemId={o.supplierItemId} back={back} />
                    </span>
                  )}
                </div>
                <div>
                  <PriceText offer={o} unit={unit} />
                </div>
                <OfferForm offer={o} unit={unit} back={back} supplierCode={link?.supplierCode} open={flash.edit === o.supplierItemId} />
                <PriceHistory rows={history.filter((h) => h.supplierItemId === o.supplierItemId)} unit={unit} />
              </li>
            );
          })}
        </ul>
      )}

      <h2>Add an item this supplier sells</h2>
      <AddLinkForm
        supplierId={id}
        back={back}
        button="Add item"
        canBeFavourite
        chooser={
          <ItemPicker
            items={items
              .filter((i) => !linked.has(i.id))
              .sort((a, b) => BOUGHT_KINDS.indexOf(a.kind as BoughtKind) - BOUGHT_KINDS.indexOf(b.kind as BoughtKind) || a.name.localeCompare(b.name))
              .map((i) => ({
                id: i.id,
                label: i.name,
                hint: UNITS[i.stockUnit as UnitCode].label,
                group: KIND_PLURAL[i.kind as BoughtKind],
              }))}
          />
        }
      />

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
                  <td>{o.po.orderedOn ? fmtDate(o.po.orderedOn) : "—"}</td>
                  <td>{o.run ? <Link href={`/runs/${o.run.id}`}>{o.run.code}</Link> : <span className="muted">—</span>}</td>
                  <td className="num">{money(o.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Paperwork</h2>
      <div className="card">
        {paperwork.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No delivery notes or invoices yet. Add them on each delivery and order.
          </p>
        ) : (
          <DocList
            docs={paperwork.map((p) => p.doc)}
            showKind
            extra={(d) => {
              const p = docInfo.get(d.id)!;
              if (d.purchaseOrderId)
                return (
                  <>
                    for <Link href={`/orders/${d.purchaseOrderId}`}>{p.poCode}</Link> ·{" "}
                  </>
                );
              return (
                <>
                  delivered {fmtDate(p.receivedOn)}
                  {p.deliveryRef && `, no. ${p.deliveryRef}`} ·{" "}
                </>
              );
            }}
          />
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
        <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="secondary">
            Save details
          </button>
        </div>
      </form>
      <form action={setSupplierActiveAction}>
        <input type="hidden" name="supplierId" value={id} />
        <input type="hidden" name="active" value={supplier.active ? "0" : "1"} />
        <button type="submit" className="link small">
          {supplier.active ? "Mark as not in use" : "Bring back into use"}
        </button>
      </form>
      <History of={{ type: "supplier", id }} />
    </>
  );
}
