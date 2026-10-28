/*
 * The parts "Delete database" offers and what each one depends on. Kept apart
 * from wipe.ts (which talks to the database) so the confirmation window in
 * the browser can use it too.
 */

export const WIPE_PARTS = ["activity", "suppliers", "recipes", "items", "catalog"] as const;
export type WipePart = (typeof WIPE_PARTS)[number];

export const WIPE_INFO: Record<WipePart, { label: string; text: string; needs: WipePart[]; why?: string }> = {
  activity: {
    label: "Activity",
    text: "Runs, batches, purchase orders, deliveries, stock and lots, customers and outbound, uploaded paperwork and the change history.",
    needs: [],
  },
  suppliers: {
    label: "Suppliers",
    text: "Suppliers and their prices.",
    needs: ["activity"],
    why: "orders, deliveries and lots name their supplier",
  },
  recipes: {
    label: "Recipes & packaging lists",
    text: "Every recipe version and every product's packaging list.",
    needs: ["activity"],
    why: "batches were made with a recipe and packed with a packaging list",
  },
  items: {
    label: "Items",
    text: "Ingredients, packaging and other items.",
    needs: ["recipes", "suppliers", "activity"],
    why: "recipes, packaging lists, suppliers and stock all use these items",
  },
  catalog: {
    label: "Sauces, sizes & products",
    text: "Sauces, jar sizes, products and their yield and reject figures.",
    needs: ["recipes", "activity"],
    why: "recipes, runs, batches and stock belong to a sauce or product",
  },
};

/** The chosen parts plus everything they depend on. */
export function withDependencies(parts: Iterable<string>): Set<WipePart> {
  const out = new Set<WipePart>();
  const add = (p: WipePart) => {
    if (out.has(p)) return;
    out.add(p);
    WIPE_INFO[p].needs.forEach(add);
  };
  for (const p of parts) if ((WIPE_PARTS as readonly string[]).includes(p)) add(p as WipePart);
  return out;
}

export interface WipeCounts {
  runs: number;
  batches: number;
  orders: number;
  deliveries: number;
  lots: number;
  salesOrders: number;
  history: number;
  documents: number;
  suppliers: number;
  recipes: number;
  packagingLists: number;
  items: number;
  sauces: number;
  products: number;
}
