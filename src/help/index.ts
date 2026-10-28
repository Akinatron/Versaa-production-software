import type { AreaKey, Article } from "./types";
import { start } from "./articles/start";
import { make } from "./articles/make";
import { buy } from "./articles/buy";
import { keep } from "./articles/keep";
import { sell } from "./articles/sell";
import { settings } from "./articles/settings";
import { basics } from "./articles/basics";

export { FAQ } from "./faq";
export { GLOSSARY } from "./glossary";
export type { Article, Block, Faq, Term, AreaKey } from "./types";

/** Areas in the order Help and the manual show them; the work areas match the side menu. */
export const AREAS: { key: AreaKey; label: string; lead: string }[] = [
  { key: "start", label: "Start here", lead: "What Versaa does and how to set it up." },
  { key: "make", label: "Make", lead: "Plan runs, then cook, pack and close batches." },
  { key: "buy", label: "Buy", lead: "Order from suppliers and receive deliveries." },
  { key: "keep", label: "Keep", lead: "Stock, counts, storage, best-before, trace and history." },
  { key: "sell", label: "Sell", lead: "Sales orders, stock exits, customers and reports." },
  { key: "settings", label: "Settings", lead: "Recipes, packaging, items, products and yields." },
  { key: "basics", label: "How it works", lead: "Statuses, codes, corrections and units." },
];

export const ARTICLES: Article[] = [...start, ...make, ...buy, ...keep, ...sell, ...settings, ...basics];

const bySlug = new Map(ARTICLES.map((a) => [a.slug, a]));

export function getArticle(slug: string): Article | undefined {
  return bySlug.get(slug);
}

export function articlesIn(area: AreaKey): Article[] {
  return ARTICLES.filter((a) => a.area === area);
}

export function areaLabel(area: AreaKey): string {
  return AREAS.find((a) => a.key === area)?.label ?? area;
}
