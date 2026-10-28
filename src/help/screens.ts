/*
 * Which help article explains each screen, for the "?" in every page header.
 * Kept apart from the articles so the browser only loads this small list.
 * A test checks that every screen of the app is listed here.
 */

export const SCREEN_HELP: [route: string, slug: string][] = [
  ["/", "today"],
  ["/plan", "plan-production"],
  ["/runs", "runs"],
  ["/runs/[id]", "runs"],
  ["/runs/[id]/stock", "runs"],
  ["/runs/[id]/order", "order-whats-missing"],
  ["/runs/[id]/receive", "record-delivery"],
  ["/batches", "batches"],
  ["/batches/[id]", "batches"],
  ["/batches/[id]/cook", "cook-batch"],
  ["/batches/[id]/pack", "pack-batch"],
  ["/batches/[id]/close", "close-batch"],
  ["/production", "batches"],
  ["/production/[id]", "batches"],
  ["/packaging", "batches"],
  ["/packaging/[id]", "batches"],
  ["/orders", "orders"],
  ["/orders/new", "order-by-hand"],
  ["/orders/plan", "order-whats-missing"],
  ["/orders/[id]", "orders"],
  ["/orders/[id]/print", "send-order"],
  ["/deliveries", "record-delivery"],
  ["/deliveries/new", "record-delivery"],
  ["/deliveries/[id]", "correct-delivery"],
  ["/suppliers", "suppliers"],
  ["/suppliers/[id]", "suppliers"],
  ["/items/[id]", "item-card"],
  ["/stock", "stock"],
  ["/stock/count", "opening-count"],
  ["/stock/adjust", "correct-stock"],
  ["/stock/adjustments/[id]", "correct-stock"],
  ["/stock/[itemId]", "item-card"],
  ["/trace", "trace"],
  ["/trace/lot/[id]", "trace"],
  ["/trace/lot/[id]/labels", "jar-labels"],
  ["/trace/outflow/[id]", "stock-exit"],
  ["/history", "history"],
  ["/outbound", "outbound"],
  ["/outbound/new", "stock-exit"],
  ["/outbound/orders/new", "sales-orders"],
  ["/outbound/orders/[id]", "deliver-order"],
  ["/outbound/customers", "customers"],
  ["/reports", "reports"],
  ["/settings", "settings"],
  ["/settings/recipes", "recipes"],
  ["/settings/recipes/[sauceId]", "recipes"],
  ["/settings/packaging", "packaging-lists"],
  ["/settings/packaging/[productId]", "packaging-lists"],
  ["/settings/items", "items"],
  ["/settings/catalog", "sauces-sizes-products"],
  ["/settings/yields", "yields"],
];

const compiled = SCREEN_HELP.map(([route, slug]) => ({
  re: new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`),
  slug,
}));

/** The help article for a path, or null (Help's own pages have none). */
export function helpSlugFor(path: string): string | null {
  if (path === "/help" || path.startsWith("/help/")) return null;
  return compiled.find((c) => c.re.test(path))?.slug ?? null;
}
