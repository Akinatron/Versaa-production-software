import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { DB } from "./client";

export interface ItemStorage {
  /** The item's default (what new lots take). */
  default: string | null;
  /** Stock on hand by where its lots are kept; key "" = lots with no place set. */
  places: Map<string, Decimal>;
}

/** Where each ingredient's and jar's stock is kept, from its lots that still have stock. */
export async function storageByItem(db: DB): Promise<Map<string, ItemStorage>> {
  const [items, lots] = await Promise.all([
    db.execute<{ id: string; storage: string | null }>(sql`select id, storage::text from items where kind <> 'packaging'`),
    db.execute<{ item_id: string; storage: string | null; qty: string }>(sql`
      select l.item_id, l.storage::text, sum(b.qty) as qty
      from lots l join (select lot_id, sum(quantity) as qty from movements group by lot_id) b on b.lot_id = l.id
      where b.qty > 0
      group by l.item_id, l.storage`),
  ]);
  const out = new Map<string, ItemStorage>();
  for (const i of items) out.set(i.id, { default: i.storage, places: new Map() });
  for (const l of lots) out.get(l.item_id)?.places.set(l.storage ?? "", new Decimal(l.qty));
  return out;
}

/** True when the item has stock kept in `place`, or has no stock and defaults to it. "unset" matches nothing chosen. */
export function keptIn(s: ItemStorage | undefined, place: string): boolean {
  if (!s) return false;
  const key = place === "unset" ? "" : place;
  if (s.places.size) return s.places.has(key);
  return (s.default ?? "") === key;
}
