import type { ChangeView, EntityType, Ref } from "@/db/changes";
import { BUSINESS_TIME_ZONE, today } from "@/domain/dates";

/** Times in the history read in the business's own time zone. */
const TZ = BUSINESS_TIME_ZONE;
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** "18 Oct 10:42" (with the year when it isn't this year). */
export function fmtWhen(at: Date) {
  const day = DAY.format(at);
  const thisYear = today().slice(0, 4);
  return `${day.endsWith(thisYear) ? day.slice(0, -5) : day} ${TIME.format(at)}`;
}

export const ACTION_LABEL: Record<ChangeView["action"], { label: string; cls: string }> = {
  create: { label: "Created", cls: "neutral" },
  update: { label: "Changed", cls: "info" },
  delete: { label: "Deleted", cls: "bad" },
  restore: { label: "Restored", cls: "ok" },
  cancel: { label: "Cancelled", cls: "warn" },
  status: { label: "Step", cls: "neutral" },
};

export const AREA_LABEL: Record<string, string> = {
  production: "Production",
  packaging: "Packaging",
  purchasing: "Purchasing",
  sales: "Sales",
  stock: "Stock",
  settings: "Settings",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  run: "Run",
  batch: "Batch",
  packaging_session: "Packaging",
  incident: "Incident",
  purchase_order: "Order",
  receipt: "Delivery",
  lot: "Lot",
  item: "Item",
  supplier: "Supplier",
  sales_order: "Sales order",
  outflow: "Stock exit",
  stock_adjustment: "Stock correction",
  customer: "Customer",
  sauce: "Sauce",
  format: "Size",
  product: "Product",
  recipe: "Recipe",
  packaging_list: "Packaging list",
  yield: "Yield",
  document: "File",
};

/** Every record opens through one address that finds its page. */
export const openHref = (r: { type: EntityType; id: string }) => `/history/open/${r.type}/${r.id}`;

export const refLabel = (r: Ref) => r.code || ENTITY_LABEL[r.type];

/** A change, ready for the page (dates as text, so it can go to the browser). */
export interface ChangeRow {
  id: string;
  when: string;
  action: { label: string; cls: string };
  entity: { type: EntityType; id: string; label: string; href: string };
  summary: string;
  changes: { label: string; before: string | null; after: string | null }[];
  reason: string | null;
}

export function toRow(c: ChangeView): ChangeRow {
  return {
    id: c.id,
    when: fmtWhen(c.at),
    action: ACTION_LABEL[c.action],
    entity: { type: c.entityType, id: c.entityId, label: refLabel({ type: c.entityType, id: c.entityId, code: c.entityCode }), href: openHref({ type: c.entityType, id: c.entityId }) },
    summary: c.summary,
    changes: (c.changes ?? []).map((x) => ({ label: x.label, before: x.before ?? null, after: x.after ?? null })),
    reason: c.reason,
  };
}
