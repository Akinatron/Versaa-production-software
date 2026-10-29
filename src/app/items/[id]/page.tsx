import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { loadOffers, priceHistory } from "@/db/suppliers";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { describePrice } from "@/domain/pricing";
import { storageLabel } from "@/domain/storage";
import { shelfLifeOf } from "@/domain/shelf-life";
import { isBoughtKind } from "@/domain/item-kinds";
import { Flash } from "../../components/flash";
import { MOVEMENT } from "../../components/labels";
import { LotOrigin, lotQty } from "../../components/trace-format";
import { AddLinkForm, OfferForm, PriceHistory, PriceText } from "../../components/supplier-offer";
import { moveRankAction } from "../../suppliers/actions";
import { renameItemAction, setItemActiveAction } from "../../settings/actions";
import { PageHeader } from "../../components/ui/header";
import { fmtDate } from "../../components/ui/format";
import { History } from "../../components/history";
import { ItemStorageForm, StorageBadge } from "../../components/storage";
import { ShelfLifeForm } from "../../components/shelf-life";
import { SupplierPicker } from "../../components/pickers";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  ingredient: "Ingredient",
  packaging: "Packaging item",
  other: "Other item",
  finished: "Finished jars",
  bulk: "Cooked sauce",
};

/** Where "back" goes from the Stock tab: the Stock list showing this kind. */
const STOCK_LIST: Record<string, string> = {
  ingredient: "/stock",
  packaging: "/stock?show=packaging",
  other: "/stock?show=other",
  finished: "/stock?show=jars",
  bulk: "/stock",
};

/**
 * The card of one item: everything about it in one place, whichever page you
 * came from. The top is always shown; below it, a bought item has two tabs,
 * Stock (lots and movements) and Suppliers (who sells it and at what price).
 * Finished jars and cooked sauce are not bought, so they only have Stock.
 */
export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const [item] = await db().select().from(t.items).where(eq(t.items.id, id));
  if (!item) notFound();
  const bought = isBoughtKind(item.kind);
  const tab: "stock" | "suppliers" = bought && (flash.tab === "suppliers" || flash.edit) ? "suppliers" : "stock";
  const unit = item.stockUnit as UnitCode;
  const u = UNITS[unit].label;
  const q = (v: Decimal.Value) => lotQty(v, unit, item.kind);
  const here = `/items/${id}?tab=${tab}`;

  const [lots, offers, usedBy] = await Promise.all([
    db()
      .select({
        lot: t.lots,
        supplier: t.suppliers.name,
        batchCode: t.productionBatches.code,
        balance: sql<string>`coalesce((select sum(m.quantity) from movements m where m.lot_id = ${t.lots.id}), 0)`,
      })
      .from(t.lots)
      .leftJoin(t.suppliers, eq(t.lots.supplierId, t.suppliers.id))
      .leftJoin(t.productionBatches, eq(t.lots.batchId, t.productionBatches.id))
      .where(eq(t.lots.itemId, id))
      .orderBy(t.lots.receivedOn, t.lots.createdAt),
    bought ? loadOffers(db(), { itemIds: [id] }) : Promise.resolve([]),
    bought
      ? db().execute<{ name: string }>(sql`
      select s.name from recipe_lines l join recipe_versions v on v.id = l.recipe_version_id join sauces s on s.id = v.sauce_id
      where v.status = 'active' and l.item_id = ${id}
      union
      select p.name from packaging_lines l join packaging_versions v on v.id = l.packaging_version_id join products p on p.id = v.product_id
      where v.status = 'active' and l.item_id = ${id}`)
      : Promise.resolve([] as { name: string }[]),
  ]);
  const used = [...usedBy].map((r) => r.name);
  const withStock = lots.filter((l) => new Decimal(l.balance).gt(0));
  const empty = lots.filter((l) => !new Decimal(l.balance).gt(0));
  const total = lots.reduce((s, l) => s.plus(l.balance), new Decimal(0));
  const hasStorage = item.kind !== "packaging" && item.kind !== "other";
  const tabHref = (k: string) => `/items/${id}?tab=${k}`;

  return (
    <>
      <PageHeader
        back={tab === "suppliers" ? { href: "/settings/items", label: "Items" } : { href: STOCK_LIST[item.kind] ?? "/stock", label: "Stock" }}
        title={item.name}
        status={item.active ? null : { label: "Retired", cls: "neutral" }}
        lead={
          <>
            {KIND[item.kind] ?? item.kind} · counted in {item.kind === "finished" ? "jars" : u}
            {used.length > 0 && <> · used by {used.join(", ")}</>}
          </>
        }
        actions={
          bought &&
          item.active && (
            <Link href={`/orders/new?${offers[0] ? `supplier=${offers[0].supplierId}&` : ""}items=${id}:`} className="btn secondary">
              Order
            </Link>
          )
        }
      />
      <Flash params={flash} />

      <div className="stats">
        <div>
          <div className="v">{lots.length ? q(total) : "Not counted"}</div>
          <div className="l">in stock now</div>
        </div>
        <div>
          <div className="v">{withStock.length}</div>
          <div className="l">{withStock.length === 1 ? "lot" : "lots"} with stock</div>
        </div>
        {hasStorage && (
          <div>
            <div className="v">{storageLabel(item.storage)}</div>
            <div className="l">kept in</div>
          </div>
        )}
        {bought && (
          <Link href={tabHref("suppliers")}>
            <div className="v">{offers[0] ? offers[0].supplierName : "No supplier"}</div>
            <div className="l">{offers[0] ? `favourite · ${describePrice(offers[0], u)}` : "add one"}</div>
          </Link>
        )}
      </div>

      {bought ? (
        <details className="card item-details">
          <summary>Item details: storage{item.kind === "ingredient" ? ", shelf life" : ""}, name, retire</summary>
          <dl className="item-facts">
            {item.kind === "ingredient" && (
              <>
                <dt>Kept in</dt>
                <dd>
                  <ItemStorageForm itemId={item.id} value={item.storage} back={here} label={`Storage for ${item.name}`} />
                  <div className="small muted">New lots take this; you can change it for one lot on the lot&apos;s page.</div>
                </dd>
                <dt>Shelf life</dt>
                <dd>
                  <ShelfLifeForm itemId={item.id} value={shelfLifeOf(item)} back={here} label={`Shelf life of ${item.name}`} />
                </dd>
              </>
            )}
            <dt>Name</dt>
            <dd>
              <form action={renameItemAction} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="back" value={here} />
                <input name="name" type="text" defaultValue={item.name} required aria-label={`New name for ${item.name}`} style={{ minWidth: 180 }} />
                <button type="submit" className="secondary sm">
                  Rename
                </button>
              </form>
            </dd>
            <dt>Status</dt>
            <dd>
              <div className="row" style={{ gap: 10 }}>
                {item.active ? <span className="badge ok">In use</span> : <span className="badge">Retired</span>}
                <form action={setItemActiveAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="active" value={item.active ? "0" : "1"} />
                  <input type="hidden" name="back" value={here} />
                  <button type="submit" className={item.active ? "danger sm" : "secondary sm"}>
                    {item.active ? "Retire" : "Bring back"}
                  </button>
                </form>
              </div>
              <div className="small muted">
                {item.active && used.length
                  ? `Remove it from ${used.join(", ")} first.`
                  : "A retired item leaves lists and new recipes; its stock and history stay."}
              </div>
            </dd>
          </dl>
        </details>
      ) : (
        hasStorage &&
        item.kind === "finished" && (
          <p className="small muted">
            Where filled jars are kept and their shelf life are set per product in <Link href="/settings/catalog">Settings → Sauces, sizes &amp; products</Link>
            .
          </p>
        )
      )}

      {bought && (
        <nav className="tabs item-tabs" aria-label="Show">
          <Link href={tabHref("stock")} aria-current={tab === "stock" ? "page" : undefined}>
            Stock
          </Link>
          <Link href={tabHref("suppliers")} aria-current={tab === "suppliers" ? "page" : undefined}>
            Suppliers ({offers.length})
          </Link>
        </nav>
      )}

      {tab === "stock" ? (
        <StockTab item={item} lots={lots} withStock={withStock} empty={empty} q={q} hasStorage={hasStorage} />
      ) : (
        <SuppliersTab item={item} offers={offers} here={here} edit={flash.edit} />
      )}

      <History of={{ type: "item", id }} />
    </>
  );
}

type Item = typeof t.items.$inferSelect;
type LotRow = { lot: typeof t.lots.$inferSelect; supplier: string | null; batchCode: string | null; balance: string };

async function StockTab({
  item,
  lots,
  withStock,
  empty,
  q,
  hasStorage,
}: {
  item: Item;
  lots: LotRow[];
  withStock: LotRow[];
  empty: LotRow[];
  q: (v: Decimal.Value) => string;
  hasStorage: boolean;
}) {
  const history = await db()
    .select({ m: t.movements, lot: t.lots.code })
    .from(t.movements)
    .innerJoin(t.lots, eq(t.movements.lotId, t.lots.id))
    .where(eq(t.movements.itemId, item.id))
    .orderBy(desc(t.movements.occurredAt), desc(t.movements.createdAt));

  const lotTable = (list: LotRow[]) => (
    <table>
      <thead>
        <tr>
          <th>Lot</th>
          <th>Where it came from</th>
          <th>{item.kind === "finished" || item.kind === "bulk" ? "Made / packed" : "Received"}</th>
          <th>Best before</th>
          {hasStorage && <th>Kept in</th>}
          <th className="num">Left</th>
        </tr>
      </thead>
      <tbody>
        {list.map(({ lot, supplier, batchCode, balance }) => (
          <tr key={lot.id}>
            <td>
              <Link href={`/trace/lot/${lot.id}`}>{lot.code}</Link>
            </td>
            <td>
              <LotOrigin lot={{ ...lot, supplierName: supplier }} batchCode={batchCode} />
            </td>
            <td>{lot.receivedOn ? fmtDate(lot.receivedOn, { year: true }) : "—"}</td>
            <td>{lot.bestBefore ? fmtDate(lot.bestBefore, { year: true }) : <span className="muted">not recorded</span>}</td>
            {hasStorage && (
              <td>
                <StorageBadge value={lot.storage} quietUnset />
              </td>
            )}
            <td className="num">{q(balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="row" style={{ gap: 8, margin: "4px 0 12px" }}>
        <Link href={`/stock/adjust?item=${item.id}`} className="btn secondary">
          Correct the count
        </Link>
        {item.kind !== "finished" ? (
          <Link href={`/stock/adjust?mode=writeoff&item=${item.id}`} className="btn secondary">
            Write off
          </Link>
        ) : (
          <Link href="/outbound/new" className="btn secondary">
            Record a stock exit
          </Link>
        )}
      </div>
      <h2>Lots with stock</h2>
      <div className="card scroll">
        {withStock.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {lots.length ? "Nothing in stock." : "Not counted yet."}
          </p>
        ) : (
          lotTable(withStock)
        )}
      </div>
      {empty.length > 0 && (
        <details className="card scroll">
          <summary>Used-up lots ({empty.length})</summary>
          {lotTable(empty)}
        </details>
      )}
      <h2>Stock movements</h2>
      <div className="card scroll">
        {history.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing recorded yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>What happened</th>
                <th>Lot</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ m, lot }) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.occurredAt.toISOString().slice(0, 10), { year: true })}</td>
                  <td>
                    {m.docType && m.docId ? (
                      <Link href={`/history/open/${m.docType}/${m.docId}`}>{MOVEMENT[m.type] ?? m.type}</Link>
                    ) : (
                      (MOVEMENT[m.type] ?? m.type)
                    )}
                    {m.reason && <div className="small muted">{m.reason}</div>}
                  </td>
                  <td>
                    <Link href={`/trace/lot/${m.lotId}`}>{lot}</Link>
                  </td>
                  <td className="num">
                    {new Decimal(m.quantity).gt(0) ? "+" : ""}
                    {q(m.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

async function SuppliersTab({ item, offers, here, edit }: { item: Item; offers: Awaited<ReturnType<typeof loadOffers>>; here: string; edit?: string }) {
  const unit = item.stockUnit as UnitCode;
  const [suppliers, links, history] = await Promise.all([
    db().select().from(t.suppliers).where(eq(t.suppliers.active, true)).orderBy(asc(t.suppliers.name)),
    db().select().from(t.supplierItems).where(eq(t.supplierItems.itemId, item.id)),
    priceHistory(
      db(),
      offers.map((o) => o.supplierItemId),
    ),
  ]);
  const linked = new Set(offers.map((o) => o.supplierId));
  return (
    <>
      <p className="small muted">
        In order of preference. The first one is the favourite: it is preselected when ordering for a run and its price is used in budgets. The same links show
        on each supplier&apos;s page.
      </p>
      {offers[0]?.supplierActive === false && (
        <p className="small text-warn">
          The first supplier is marked &quot;Not in use&quot;, so orders and budgets use the cheapest supplier in use instead
          {offers.some((o) => o.supplierActive !== false) ? "." : ". There is none: add one below."}
        </p>
      )}
      {offers.length === 0 && <p className="card muted">No supplier yet. Add one below.</p>}
      {offers.length > 0 && (
        <ul className="offerlist card">
          {offers.map((o, i) => {
            const link = links.find((l) => l.id === o.supplierItemId);
            return (
              <li key={o.supplierItemId} id={`offer-${o.supplierItemId}`}>
                <div className="card-head">
                  <span className="small muted">{i + 1}.</span>
                  <Link href={`/suppliers/${o.supplierId}`}>
                    <strong>{o.supplierName}</strong>
                  </Link>
                  {i === 0 && o.supplierActive !== false && <span className="badge ok">Favourite</span>}
                  {o.supplierActive === false && <span className="badge warn">Not in use</span>}
                  {offers.length > 1 && (
                    <form action={moveRankAction} className="row" style={{ gap: 6, marginLeft: "auto" }}>
                      <input type="hidden" name="supplierItemId" value={o.supplierItemId} />
                      <input type="hidden" name="back" value={here} />
                      {i > 0 && (
                        <button type="submit" name="to" value="first" className="secondary sm">
                          Make favourite
                        </button>
                      )}
                      {i > 0 && (
                        <button type="submit" name="to" value="up" className="secondary sm" aria-label="Move up">
                          Up
                        </button>
                      )}
                      {i < offers.length - 1 && (
                        <button type="submit" name="to" value="down" className="secondary sm" aria-label="Move down">
                          Down
                        </button>
                      )}
                    </form>
                  )}
                </div>
                <PriceText offer={o} unit={unit} />
                <OfferForm offer={o} itemName={item.name} unit={unit} back={here} supplierCode={link?.supplierCode} open={edit === o.supplierItemId} />
                <PriceHistory rows={history.filter((h) => h.supplierItemId === o.supplierItemId)} unit={unit} />
              </li>
            );
          })}
        </ul>
      )}

      <h2>Add a supplier for {item.name}</h2>
      <AddLinkForm
        itemId={item.id}
        back={here}
        unitLabel={UNITS[unit].label}
        button="Add supplier"
        canBeFavourite={offers.length > 0}
        chooser={<SupplierPicker suppliers={suppliers.filter((s) => !linked.has(s.id)).map((s) => ({ id: s.id, label: s.name }))} />}
      />
    </>
  );
}
