import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError } from "./base";
import { diff, logChange } from "./changes";
import { favourite, unitPrice, type Offer } from "@/domain/pricing";

/*
 * Suppliers and what they sell. A supplier ↔ item link is one row
 * (`supplier_items`), shown on both the supplier card and the item card, so a
 * change made on either card shows on the other. Prices are append-only
 * (`supplier_item_prices`): changing a price adds a row and keeps the old one
 * with its date.
 */

type Exec = Pick<DB, "select" | "insert" | "update" | "execute">;

const optDecimal = (v: Decimal.Value | null | undefined, what: string): Decimal | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  let d: Decimal;
  try {
    d = new Decimal(String(v).replace(",", "."));
  } catch {
    throw new OperationError(`${what}: "${v}" is not a number.`);
  }
  if (d.isNaN() || d.lt(0)) throw new OperationError(`${what} can't be negative.`);
  return d;
};

// ---------------------------------------------------------------- suppliers

export async function updateSupplier(db: DB, supplierId: string, input: { name: string; contact?: string | null; notes?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new OperationError("Supplier name is required.");
  const [before] = await db.select().from(t.suppliers).where(eq(t.suppliers.id, supplierId));
  if (!before) throw new OperationError("Supplier not found.");
  const after = { name, contact: input.contact?.trim() || null, notes: input.notes?.trim() || null };
  const changes = diff([
    ["Name", before.name, after.name],
    ["Contact", before.contact, after.contact],
    ["Notes", before.notes, after.notes],
  ]);
  if (!changes.length) return;
  await db.update(t.suppliers).set(after).where(eq(t.suppliers.id, supplierId));
  await logChange(db, { action: "update", area: "purchasing", entity: { type: "supplier", id: supplierId, code: name }, summary: `Details of ${name} changed`, changes });
}

export async function setSupplierActive(db: DB, supplierId: string, active: boolean) {
  const [s] = await db.update(t.suppliers).set({ active }).where(eq(t.suppliers.id, supplierId)).returning();
  if (s)
    await logChange(db, {
      action: "status",
      area: "purchasing",
      entity: { type: "supplier", id: s.id, code: s.name },
      summary: active ? `${s.name} back in use` : `${s.name} marked as not in use`,
    });
}

async function linkRefs(tx: Exec, supplierId: string, itemId: string) {
  const [sup] = await tx.select().from(t.suppliers).where(eq(t.suppliers.id, supplierId));
  const [item] = await tx.select().from(t.items).where(eq(t.items.id, itemId));
  return { sup, item, links: [{ type: "item" as const, id: itemId, code: item?.name }] };
}

const offerText = (o: { packQty: Decimal | string | null; packName?: string | null; price: Decimal | string | null } | undefined | null) => {
  if (!o) return null;
  const pack = o.packQty != null ? `${o.packName ? `${o.packName} of ` : "pack of "}${new Decimal(o.packQty)}` : null;
  const price = o.price != null ? `${new Decimal(o.price)} €` : null;
  return [price, pack ? `per ${pack}` : null].filter(Boolean).join(" ") || null;
};

// ---------------------------------------------------------------- links and prices

export interface OfferInput {
  packQty?: Decimal.Value | null;
  packName?: string | null;
  price?: Decimal.Value | null;
}

function parseOffer(input: OfferInput) {
  const packQty = optDecimal(input.packQty, "Pack size");
  if (packQty !== null && packQty.isZero()) throw new OperationError("Pack size must be more than 0, or left empty.");
  return { packQty, packName: input.packName?.trim() || null, price: optDecimal(input.price, "Price") };
}

/**
 * Link a supplier and an item (from either card). A new link goes last in the
 * item's favourite order. Linking again an item that was removed brings the
 * same link back, with its price history.
 */
export async function linkSupplierItem(
  db: DB,
  input: { supplierId: string; itemId: string; supplierCode?: string | null; note?: string | null } & OfferInput,
) {
  if (!input.supplierId || !input.itemId) throw new OperationError("Choose a supplier and an item.");
  const offer = parseOffer(input);
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(t.items).where(eq(t.items.id, input.itemId));
    if (!item || (item.kind !== "ingredient" && item.kind !== "packaging")) throw new OperationError("Only ingredients and packaging are bought from suppliers.");
    if (offer.packQty && item.stockUnit === "unit" && !offer.packQty.isInteger()) throw new OperationError(`${item.name} is counted in whole units, so the pack size must be whole.`);
    const [existing] = await tx
      .select()
      .from(t.supplierItems)
      .where(and(eq(t.supplierItems.supplierId, input.supplierId), eq(t.supplierItems.itemId, input.itemId)));
    if (existing?.active) throw new OperationError("This supplier is already linked to this item. Change its price instead.");
    const rank = await nextRank(tx, input.itemId);
    let link: typeof t.supplierItems.$inferSelect;
    if (existing) {
      [link] = await tx
        .update(t.supplierItems)
        .set({ active: true, rank, supplierCode: input.supplierCode?.trim() || existing.supplierCode, note: input.note?.trim() || existing.note })
        .where(eq(t.supplierItems.id, existing.id))
        .returning() as [typeof link];
    } else {
      [link] = await tx
        .insert(t.supplierItems)
        .values({ supplierId: input.supplierId, itemId: input.itemId, rank, supplierCode: input.supplierCode?.trim() || null, note: input.note?.trim() || null })
        .returning() as [typeof link];
    }
    if (offer.packQty !== null || offer.price !== null) await addPriceIfChanged(tx, link.id, offer);
    const r = await linkRefs(tx, input.supplierId, input.itemId);
    await logChange(tx, {
      action: "create",
      area: "purchasing",
      entity: { type: "supplier", id: input.supplierId, code: r.sup?.name },
      summary: `${r.sup?.name ?? "Supplier"} now sells ${r.item?.name ?? "item"}`,
      changes: diff([["Price", null, offerText(offer)]]),
      links: r.links,
    });
    return link;
  });
}

async function nextRank(tx: Exec, itemId: string) {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${t.supplierItems.rank}), 0)::int` })
    .from(t.supplierItems)
    .where(and(eq(t.supplierItems.itemId, itemId), eq(t.supplierItems.active, true)));
  return (row?.n ?? 0) + 1;
}

async function addPriceIfChanged(tx: Exec, supplierItemId: string, offer: ReturnType<typeof parseOffer>) {
  const [current] = await tx
    .select()
    .from(t.supplierItemPrices)
    .where(eq(t.supplierItemPrices.supplierItemId, supplierItemId))
    .orderBy(sql`${t.supplierItemPrices.createdAt} desc`)
    .limit(1);
  const same = (a: string | null | undefined, b: Decimal | null) => (a == null ? b === null : b !== null && new Decimal(a).eq(b));
  if (current && same(current.packQty, offer.packQty) && same(current.price, offer.price) && (current.packName ?? null) === offer.packName) return false;
  await tx.insert(t.supplierItemPrices).values({
    supplierItemId,
    packQty: offer.packQty?.toString() ?? null,
    packName: offer.packName,
    price: offer.price?.toString() ?? null,
  });
  return true;
}

/** Set a new price or pack size. The previous one stays in the history with its date. */
export async function setOffer(db: DB, supplierItemId: string, input: OfferInput & { supplierCode?: string | null; note?: string | null }) {
  const offer = parseOffer(input);
  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(t.supplierItems).where(eq(t.supplierItems.id, supplierItemId));
    if (!link || !link.active) throw new OperationError("Supplier link not found.");
    const [item] = await tx.select().from(t.items).where(eq(t.items.id, link.itemId));
    if (offer.packQty && item?.stockUnit === "unit" && !offer.packQty.isInteger()) throw new OperationError(`${item.name} is counted in whole units, so the pack size must be whole.`);
    if (input.supplierCode !== undefined || input.note !== undefined) {
      await tx
        .update(t.supplierItems)
        .set({
          ...(input.supplierCode !== undefined ? { supplierCode: input.supplierCode?.trim() || null } : {}),
          ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        })
        .where(eq(t.supplierItems.id, supplierItemId));
    }
    const [prev] = await tx
      .select()
      .from(t.supplierItemPrices)
      .where(eq(t.supplierItemPrices.supplierItemId, supplierItemId))
      .orderBy(sql`${t.supplierItemPrices.createdAt} desc`)
      .limit(1);
    const changed = await addPriceIfChanged(tx, supplierItemId, offer);
    const changes = diff([
      ["Price", offerText(prev), changed ? offerText(offer) : offerText(prev)],
      ...(input.supplierCode !== undefined ? [["Supplier code", link.supplierCode, input.supplierCode?.trim() || null] as [string, unknown, unknown]] : []),
      ...(input.note !== undefined ? [["Note", link.note, input.note?.trim() || null] as [string, unknown, unknown]] : []),
    ]);
    if (changes.length) {
      const r = await linkRefs(tx, link.supplierId, link.itemId);
      await logChange(tx, {
        action: "update",
        area: "purchasing",
        entity: { type: "supplier", id: link.supplierId, code: r.sup?.name },
        summary: `${r.item?.name ?? "Item"} from ${r.sup?.name ?? "supplier"} changed`,
        changes,
        links: r.links,
      });
    }
    return changed;
  });
}

/** Remove a supplier from an item. The link and its prices are kept for history. */
export async function unlinkSupplierItem(db: DB, supplierItemId: string) {
  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(t.supplierItems).where(eq(t.supplierItems.id, supplierItemId));
    if (!link) throw new OperationError("Supplier link not found.");
    await tx.update(t.supplierItems).set({ active: false }).where(eq(t.supplierItems.id, supplierItemId));
    await renumber(tx, link.itemId);
    const r = await linkRefs(tx, link.supplierId, link.itemId);
    await logChange(tx, {
      action: "delete",
      area: "purchasing",
      entity: { type: "supplier", id: link.supplierId, code: r.sup?.name },
      summary: `${r.sup?.name ?? "Supplier"} no longer sells ${r.item?.name ?? "item"}`,
      links: r.links,
    });
  });
}

async function renumber(tx: Exec, itemId: string, first?: string) {
  const links = await tx
    .select()
    .from(t.supplierItems)
    .where(and(eq(t.supplierItems.itemId, itemId), eq(t.supplierItems.active, true)))
    .orderBy(t.supplierItems.rank, t.supplierItems.createdAt);
  const ordered = first ? [...links.filter((l) => l.id === first), ...links.filter((l) => l.id !== first)] : links;
  for (const [i, l] of ordered.entries()) {
    if (l.rank !== i + 1) await tx.update(t.supplierItems).set({ rank: i + 1 }).where(eq(t.supplierItems.id, l.id));
  }
}

/** Move a supplier up or down in an item's favourite order, or make it the favourite. */
export async function moveSupplierRank(db: DB, supplierItemId: string, to: "up" | "down" | "first") {
  return db.transaction(async (tx) => {
    const [link] = await tx.select().from(t.supplierItems).where(eq(t.supplierItems.id, supplierItemId));
    if (!link || !link.active) throw new OperationError("Supplier link not found.");
    await renumber(tx, link.itemId);
    const r = await linkRefs(tx, link.supplierId, link.itemId);
    const log = () =>
      logChange(tx, {
        action: "update",
        area: "purchasing",
        entity: { type: "item", id: link.itemId, code: r.item?.name },
        summary: to === "first" ? `${r.sup?.name} made the favourite supplier of ${r.item?.name}` : `${r.sup?.name} moved ${to} in the suppliers of ${r.item?.name}`,
        links: [{ type: "supplier", id: link.supplierId, code: r.sup?.name }],
      });
    if (to === "first") {
      await renumber(tx, link.itemId, link.id);
      await log();
      return;
    }
    const links = await tx
      .select()
      .from(t.supplierItems)
      .where(and(eq(t.supplierItems.itemId, link.itemId), eq(t.supplierItems.active, true)))
      .orderBy(t.supplierItems.rank);
    const i = links.findIndex((l) => l.id === link.id);
    const j = to === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= links.length) return;
    await tx.update(t.supplierItems).set({ rank: links[j]!.rank }).where(eq(t.supplierItems.id, links[i]!.id));
    await tx.update(t.supplierItems).set({ rank: links[i]!.rank }).where(eq(t.supplierItems.id, links[j]!.id));
    await log();
  });
}

// ---------------------------------------------------------------- reading offers

/**
 * Current offers (active links with their newest price), sorted by item then
 * favourite order. Filter by items and/or supplier.
 */
export async function loadOffers(db: Exec, filter: { itemIds?: string[]; supplierId?: string } = {}): Promise<Offer[]> {
  if (filter.itemIds && filter.itemIds.length === 0) return [];
  const conds = [eq(t.supplierItems.active, true)];
  if (filter.itemIds) conds.push(inArray(t.supplierItems.itemId, filter.itemIds));
  if (filter.supplierId) conds.push(eq(t.supplierItems.supplierId, filter.supplierId));
  const links = await db
    .select({ link: t.supplierItems, supplier: t.suppliers })
    .from(t.supplierItems)
    .innerJoin(t.suppliers, eq(t.supplierItems.supplierId, t.suppliers.id))
    .where(and(...conds))
    .orderBy(t.supplierItems.itemId, t.supplierItems.rank);
  if (links.length === 0) return [];
  const prices = await db.execute<{ supplier_item_id: string; pack_qty: string | null; pack_name: string | null; price: string | null; created_at: string }>(sql`
    select distinct on (supplier_item_id) supplier_item_id, pack_qty, pack_name, price, created_at
    from supplier_item_prices where supplier_item_id in (${sql.join(links.map((l) => sql`${l.link.id}`), sql`, `)})
    order by supplier_item_id, created_at desc`);
  const byLink = new Map([...prices].map((p) => [p.supplier_item_id, p]));
  return links.map(({ link, supplier }) => {
    const p = byLink.get(link.id);
    return {
      supplierItemId: link.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      itemId: link.itemId,
      rank: link.rank,
      packQty: p?.pack_qty != null ? new Decimal(p.pack_qty) : null,
      packName: p?.pack_name ?? null,
      price: p?.price != null ? new Decimal(p.price) : null,
      since: p ? new Date(p.created_at) : null,
    };
  });
}

/** Offers grouped by item, favourite first. */
export async function offersByItem(db: Exec, itemIds: string[]): Promise<Map<string, Offer[]>> {
  const out = new Map<string, Offer[]>();
  for (const o of await loadOffers(db, { itemIds })) out.set(o.itemId, [...(out.get(o.itemId) ?? []), o]);
  return out;
}

/** Every price a link has had, newest first. */
export async function priceHistory(db: Exec, supplierItemIds: string[]) {
  if (supplierItemIds.length === 0) return [];
  return db
    .select()
    .from(t.supplierItemPrices)
    .where(inArray(t.supplierItemPrices.supplierItemId, supplierItemIds))
    .orderBy(sql`${t.supplierItemPrices.createdAt} desc`);
}

// ---------------------------------------------------------------- costing lots (for the batch budget)

export interface LotCost {
  /** Price per stock unit, or null when unknown. */
  unitPrice: Decimal | null;
  /** "lot": price paid on the order this lot arrived with; "favourite": no lot price, favourite supplier's current price. */
  source: "lot" | "favourite" | null;
  /** Supplier the price came from, when known. */
  supplierName: string | null;
}

/**
 * Cost per stock unit of each lot: the price on the purchase order line it
 * was received against; if the lot has no price (opening stock, a delivery
 * without an order or without a price), the favourite supplier's current price.
 */
export async function lotUnitCosts(db: Exec, lots: { lotId: string; itemId: string }[]): Promise<Map<string, LotCost>> {
  const out = new Map<string, LotCost>();
  if (lots.length === 0) return out;
  const lotIds = [...new Set(lots.map((l) => l.lotId))];
  const paid = await db.execute<{ lot_id: string; unit_price: string | null; supplier: string | null }>(sql`
    select rl.lot_id, pl.unit_price, s.name as supplier
    from receipt_lines rl
    join purchase_order_lines pl on pl.id = rl.purchase_order_line_id
    join purchase_orders o on o.id = pl.purchase_order_id
    join suppliers s on s.id = o.supplier_id
    where rl.lot_id in (${sql.join(lotIds.map((id) => sql`${id}`), sql`, `)}) and pl.unit_price is not null`);
  const paidBy = new Map([...paid].map((p) => [p.lot_id, p]));
  const fav = await offersByItem(db, [...new Set(lots.map((l) => l.itemId))]);
  for (const { lotId, itemId } of lots) {
    const p = paidBy.get(lotId);
    if (p?.unit_price != null) {
      out.set(lotId, { unitPrice: new Decimal(p.unit_price), source: "lot", supplierName: p.supplier });
      continue;
    }
    const f = favourite(fav.get(itemId) ?? []);
    const up = unitPrice(f);
    out.set(lotId, up === null ? { unitPrice: null, source: null, supplierName: null } : { unitPrice: up, source: "favourite", supplierName: f!.supplierName });
  }
  return out;
}
