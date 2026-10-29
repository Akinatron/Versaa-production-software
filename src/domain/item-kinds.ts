/**
 * What kind of thing an item is. Ingredients, packaging and "other" are bought
 * from suppliers and kept in stock; only ingredients go in recipes and only
 * packaging goes in a product's packaging list, so the planner never counts
 * "other" items (cleaning products, gloves, gas…). Finished jars and bulk
 * sauce are made, not bought.
 */
export const BOUGHT_KINDS = ["ingredient", "packaging", "other"] as const;
export type BoughtKind = (typeof BOUGHT_KINDS)[number];

export const KIND_PLURAL: Record<BoughtKind, string> = { ingredient: "Ingredients", packaging: "Packaging", other: "Other" };

export const isBoughtKind = (kind: string | null | undefined): kind is BoughtKind => (BOUGHT_KINDS as readonly string[]).includes(kind ?? "");

/** Code prefix for a new item of this kind. */
export const KIND_CODE_PREFIX: Record<BoughtKind, string> = { ingredient: "ing", packaging: "pkg", other: "oth" };
