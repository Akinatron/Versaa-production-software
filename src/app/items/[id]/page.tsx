import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadOffers, priceHistory } from "@/db/suppliers";
import { UNITS, formatQty, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { OfferForm, PriceHistory, PriceText } from "../../components/supplier-offer";
import { linkAction, moveRankAction } from "../../suppliers/actions";

export const dynamic = "force-dynamic";

/** The card of one ingredient or packaging item: its suppliers in favourite order, prices and stock. */
export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const flash = await searchParams;
  const [item] = await db().select().from(t.items).where(eq(t.items.id, id));
  if (!item || (item.kind !== "ingredient" && item.kind !== "packaging")) notFound();
  const unit = item.stockUnit as UnitCode;
  const [offers, suppliers, stock, links, usedBy] = await Promise.all([
    loadOffers(db(), { itemIds: [id] }),
    db().select().from(t.suppliers).where(eq(t.suppliers.active, true)).orderBy(asc(t.suppliers.name)),
    db().execute<{ qty: string | null }>(sql`select sum(quantity) as qty from movements where item_id = ${id}`),
    db().select().from(t.supplierItems).where(eq(t.supplierItems.itemId, id)),
    db().execute<{ name: string }>(sql`
      select s.name from recipe_lines l join recipe_versions v on v.id = l.recipe_version_id join sauces s on s.id = v.sauce_id
      where v.status = 'active' and l.item_id = ${id}
      union
      select p.name from packaging_lines l join packaging_versions v on v.id = l.packaging_version_id join products p on p.id = v.product_id
      where v.status = 'active' and l.item_id = ${id}`),
  ]);
  const history = await priceHistory(db(), offers.map((o) => o.supplierItemId));
  const onHand = [...stock][0]?.qty;
  const linked = new Set(offers.map((o) => o.supplierId));
  const back = `/items/${id}`;
  const u = UNITS[unit].label;

  return (
    <>
      <p className="small" style={{ margin: "0 0 8px" }}>
        <Link href="/settings/items">← Ingredients & packaging items</Link>
      </p>
      <h1>
        {item.name} {!item.active && <span className="badge">Retired</span>}
      </h1>
      <p className="lead">
        {item.kind === "ingredient" ? "Ingredient" : "Packaging item"} · counted in {u} · in stock{" "}
        <Link href={`/stock/${id}`}>{onHand == null ? "not counted yet" : formatQty(new Decimal(onHand), unit)}</Link>
        {[...usedBy].length > 0 && <> · used by {[...usedBy].map((r) => r.name).join(", ")}</>}
      </p>
      <Flash params={flash} />

      <h2>Suppliers</h2>
      <p className="small muted">
        In order of preference. The first one is the favourite: it is preselected when ordering for a run and its price is used in budgets. The same links show on each supplier's page.
      </p>
      {offers.length === 0 && <p className="card muted">No supplier yet. Add one below.</p>}
      {offers.map((o, i) => {
        const link = links.find((l) => l.id === o.supplierItemId);
        return (
          <div key={o.supplierItemId} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
              <div>
                <span className="badge" style={{ marginRight: 6 }}>
                  {i + 1}
                </span>
                <Link href={`/suppliers/${o.supplierId}`}>
                  <strong>{o.supplierName}</strong>
                </Link>{" "}
                {i === 0 && <span className="badge ok">Favourite</span>}
                <div>
                  <PriceText offer={o} unit={unit} />
                </div>
              </div>
              {offers.length > 1 && (
                <form action={moveRankAction} className="row" style={{ gap: 6 }}>
                  <input type="hidden" name="supplierItemId" value={o.supplierItemId} />
                  <input type="hidden" name="back" value={back} />
                  {i > 0 && (
                    <button type="submit" name="to" value="first" style={{ padding: "6px 10px" }}>
                      Make favourite
                    </button>
                  )}
                  {i > 0 && (
                    <button type="submit" name="to" value="up" style={{ padding: "6px 10px", background: "var(--muted)" }} aria-label="Move up">
                      ↑
                    </button>
                  )}
                  {i < offers.length - 1 && (
                    <button type="submit" name="to" value="down" style={{ padding: "6px 10px", background: "var(--muted)" }} aria-label="Move down">
                      ↓
                    </button>
                  )}
                </form>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              <OfferForm offer={o} unit={unit} back={back} supplierCode={link?.supplierCode} />
            </div>
            <PriceHistory rows={history.filter((h) => h.supplierItemId === o.supplierItemId)} unit={unit} />
          </div>
        );
      })}

      <h2>Add a supplier for {item.name}</h2>
      {suppliers.filter((s) => !linked.has(s.id)).length === 0 ? (
        <p className="card small muted">
          Every supplier is already linked. <Link href="/suppliers">Add a new supplier</Link> first.
        </p>
      ) : (
        <form action={linkAction} className="card row" style={{ gap: 8 }}>
          <input type="hidden" name="itemId" value={id} />
          <input type="hidden" name="back" value={back} />
          <div style={{ minWidth: 200 }}>
            <label>Supplier (required)</label>
            <select name="supplierId" required defaultValue="">
              <option value="">Choose…</option>
              {suppliers
                .filter((s) => !linked.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label>Pack size ({u})</label>
            <input name="packQty" type="number" min="0" step="any" placeholder={item.kind === "packaging" ? "e.g. 100" : "e.g. 25"} />
          </div>
          <div>
            <label>Pack name</label>
            <input name="packName" type="text" placeholder="sack, box…" style={{ maxWidth: 120 }} />
          </div>
          <div>
            <label>Price per pack (€)</label>
            <input name="price" type="number" min="0" step="any" />
          </div>
          <button type="submit">Add supplier</button>
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            Leave the pack size empty if they sell any quantity; the price is then per {u === "units" ? "unit" : u}.
          </p>
        </form>
      )}
    </>
  );
}
