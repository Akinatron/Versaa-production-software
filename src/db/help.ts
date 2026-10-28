import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { DB } from "./client";
import { loadPlanInput } from "./planning";
import { loadOffers } from "./suppliers";
import { describePrice, favourite } from "@/domain/pricing";
import { UNITS, formatQty, type UnitCode } from "@/domain/quantity";
import { shelfLifeLabel, shelfLifeOf } from "@/domain/shelf-life";
import { storageLabel } from "@/domain/storage";

/*
 * What Help reads from the database: the "Start here" checklist, and the
 * optional "current setup" section of the AI manual.
 */

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** What is still missing, in a few words. */
  detail: string;
  href: string;
  slug: string;
  optional?: boolean;
}

const names = (list: { name: string }[], max = 3) =>
  list.length <= max
    ? list.map((x) => x.name).join(", ")
    : `${list
        .slice(0, max)
        .map((x) => x.name)
        .join(", ")} and ${list.length - max} more`;

/** The first set-up, ticked off from the data itself. */
export async function setupSteps(db: DB): Promise<SetupStep[]> {
  const input = await loadPlanInput(db, {});
  const { sauces, products } = input.catalog;
  const [extra, offers, runs] = await Promise.all([
    db.execute<{ id: string; name: string; kind: string; active: boolean; storage: string | null; shelf_life: number | null }>(
      sql`select id, name, kind::text, active, storage::text, shelf_life from items`,
    ),
    loadOffers(db),
    db.execute<{ n: number }>(sql`select count(*)::int as n from production_runs where confirmed_at is not null`),
  ]);
  const itemRow = new Map([...extra].map((r) => [r.id, r]));
  const bought = [...extra].filter((i) => i.active && (i.kind === "ingredient" || i.kind === "packaging"));
  const priced = new Set(offers.filter((o) => o.price !== null).map((o) => o.itemId));
  const jarItem = new Map<string, string>(
    [...(await db.execute<{ id: string; item_id: string }>(sql`select id, item_id from products`))].map((r) => [r.id, r.item_id]),
  );

  const noRecipe = sauces.filter((s) => !s.recipe);
  const noPack = products.filter((p) => p.packaging.length === 0);
  const noYield = sauces.filter((s) => s.yield.litresPerBatch === null);
  const noPrice = bought.filter((i) => !priced.has(i.id));
  const uncounted = bought.filter((i) => input.stock[i.id]?.onHand == null);
  const noShelf = products.filter((p) => {
    const it = itemRow.get(jarItem.get(p.id) ?? "");
    return !it || it.shelf_life == null || !it.storage;
  });

  return [
    {
      key: "catalog",
      label: "Sauces, sizes and products",
      done: products.length > 0,
      detail: products.length ? `${products.length} products` : "No products yet",
      href: "/settings/catalog",
      slug: "sauces-sizes-products",
    },
    {
      key: "items",
      label: "Ingredients and packaging items",
      done: bought.some((i) => i.kind === "ingredient") && bought.some((i) => i.kind === "packaging"),
      detail: `${bought.filter((i) => i.kind === "ingredient").length} ingredients, ${bought.filter((i) => i.kind === "packaging").length} packaging items`,
      href: "/settings/items",
      slug: "items",
    },
    {
      key: "recipes",
      label: "A recipe for every sauce",
      done: sauces.length > 0 && noRecipe.length === 0,
      detail: noRecipe.length ? `Missing: ${names(noRecipe)}` : `${sauces.length} sauces`,
      href: "/settings/recipes",
      slug: "recipes",
    },
    {
      key: "packaging",
      label: "A packaging list for every product",
      done: products.length > 0 && noPack.length === 0,
      detail: noPack.length ? `Missing: ${names(noPack)}` : `${products.length} products`,
      href: "/settings/packaging",
      slug: "packaging-lists",
    },
    {
      key: "yields",
      label: "Litres per batch for every sauce",
      done: sauces.length > 0 && noYield.length === 0,
      detail: noYield.length ? `Missing: ${names(noYield)}` : "Set",
      href: "/settings/yields",
      slug: "yields",
    },
    {
      key: "suppliers",
      label: "A supplier and price for every item",
      done: bought.length > 0 && noPrice.length === 0,
      detail: noPrice.length ? `${noPrice.length} of ${bought.length} items have no price yet` : "Every item has a price",
      href: "/suppliers",
      slug: "suppliers",
    },
    {
      key: "count",
      label: "Opening stock count",
      done: bought.length > 0 && uncounted.length === 0,
      detail: uncounted.length ? `${uncounted.length} of ${bought.length} items never counted` : "Everything counted",
      href: "/stock/count",
      slug: "opening-count",
    },
    {
      key: "shelf",
      label: "Shelf life and storage for each product",
      done: products.length > 0 && noShelf.length === 0,
      detail: noShelf.length ? `Missing on ${names(noShelf)}` : "Set",
      href: "/settings/catalog",
      slug: "shelf-life",
      optional: true,
    },
    {
      key: "run",
      label: "Confirm your first run",
      done: (runs[0]?.n ?? 0) > 0,
      detail: (runs[0]?.n ?? 0) > 0 ? "Done" : "Plan one and confirm it",
      href: "/plan",
      slug: "first-run",
    },
  ];
}

/** This business's configuration as Markdown, for the AI manual. Holds recipes and prices, so it is only added when asked for. */
export async function setupMarkdown(db: DB): Promise<string> {
  const input = await loadPlanInput(db, {});
  const { sauces, products, items } = input.catalog;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const [rows, offers] = await Promise.all([
    db.execute<{
      id: string;
      name: string;
      kind: string;
      stock_unit: string;
      storage: string | null;
      shelf_life: number | null;
      shelf_life_unit: string | null;
    }>(sql`select id, name, kind::text, stock_unit::text, storage::text, shelf_life, shelf_life_unit::text from items where active order by name`),
    loadOffers(db),
  ]);
  const row = new Map([...rows].map((r) => [r.id, r]));
  const jarItem = new Map([...(await db.execute<{ id: string; item_id: string }>(sql`select id, item_id from products`))].map((r) => [r.id, r.item_id]));
  const shelf = (id: string | undefined) => {
    const r = id ? row.get(id) : undefined;
    return r ? shelfLifeLabel(shelfLifeOf({ shelfLife: r.shelf_life, shelfLifeUnit: r.shelf_life_unit })) : "not set";
  };
  const offersOf = (itemId: string) => offers.filter((o) => o.itemId === itemId).sort((a, b) => a.rank - b.rank);
  const unitOf = (id: string) => UNITS[(itemById.get(id)?.stockUnit ?? row.get(id)?.stock_unit ?? "unit") as UnitCode].label;
  const src = (s: string) => (s === "observed" ? "measured" : s === "estimate" ? "estimate" : "missing");
  const out: string[] = ["Taken from the app's data when this file was downloaded. It changes as the data changes."];

  out.push("### Sauces");
  for (const s of sauces) {
    const lpb = s.yield.litresPerBatch ? `${s.yield.litresPerBatch.toString()} L per batch (${src(s.yield.source)})` : "no litres-per-batch figure";
    const lines = [`- ${lpb}`];
    if (!s.recipe) lines.push("- No active recipe.");
    else {
      lines.push(`- Recipe v${s.recipe.versionNo}, for a batch of ${s.recipe.batchReferenceKg.toString()} kg:`);
      for (const l of s.recipe.lines) lines.push(`  - ${itemById.get(l.itemId)?.name ?? "?"}: ${formatQty(new Decimal(l.quantity), l.unit)}`);
    }
    out.push(`#### ${s.name}`, lines.join("\n"));
  }

  out.push(
    "### Products (sauce × jar size)",
    [
      "| Product | Fill per jar | Reject rate | Storage | Shelf life | Packaging per jar |",
      "| --- | --- | --- | --- | --- | --- |",
      ...products.map((p) => {
        const reject = p.reject.rate ? `${p.reject.rate.mul(100).toDecimalPlaces(1).toString()}% (${src(p.reject.source)})` : "unknown";
        const pkg = p.packaging.length ? p.packaging.map((x) => `${x.perJar} × ${itemById.get(x.itemId)?.name ?? "?"}`).join(", ") : "none";
        const it = jarItem.get(p.id);
        return `| ${p.name} | ${p.fillMl} ml | ${reject} | ${storageLabel(it ? row.get(it)?.storage : null)} | ${shelf(it)} | ${pkg} |`;
      }),
    ].join("\n"),
  );

  for (const [kind, title] of [
    ["ingredient", "Ingredients"],
    ["packaging", "Packaging items"],
    ["other", "Other items"],
  ] as const) {
    const list = [...rows].filter((r) => r.kind === kind);
    if (!list.length) continue;
    out.push(
      `### ${title}`,
      [
        `| Item | Unit | ${kind === "ingredient" ? "Storage | Shelf life | " : ""}Suppliers (favourite first, price) |`,
        `| --- | --- | ${kind === "ingredient" ? "--- | --- | " : ""}--- |`,
        ...list.map((r) => {
          const o = offersOf(r.id);
          const sup = o.length ? o.map((x) => `${x.supplierName}: ${describePrice(x, unitOf(r.id))}`).join("; ") : "none";
          return `| ${r.name} | ${unitOf(r.id)} | ${kind === "ingredient" ? `${storageLabel(r.storage)} | ${shelf(r.id)} | ` : ""}${sup} |`;
        }),
      ].join("\n"),
    );
  }

  const suppliers = [...new Set(offers.map((o) => o.supplierName))].sort();
  if (suppliers.length) {
    out.push(
      "### Suppliers",
      suppliers
        .map((s) => {
          const mine = offers.filter((o) => o.supplierName === s);
          const fav = mine.filter((o) => favourite(offersOf(o.itemId))?.supplierItemId === o.supplierItemId).length;
          return `- ${s}: sells ${mine.length} item${mine.length === 1 ? "" : "s"}, favourite for ${fav}`;
        })
        .join("\n"),
    );
  }
  return out.join("\n\n");
}
