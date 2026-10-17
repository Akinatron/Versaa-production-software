import Decimal from "decimal.js";
import seed from "../../data/catalog-v1.json";
import { isUnitCode, type UnitCode } from "./quantity";
import type { PlanItem, PlanProduct, PlanSauce } from "./planner";

/**
 * The starting catalog Pablo provided (recipes, ingredients, packaging,
 * products), turned into stable codes. Quantities are kept exactly as given.
 */

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function unit(u: string): UnitCode {
  if (!isUnitCode(u)) throw new Error(`Unknown unit ${u}`);
  return u;
}

export interface SeedCatalog {
  items: (PlanItem & { kind: "ingredient" | "packaging" })[];
  sauces: { code: string; name: string; batchReferenceKg: Decimal; lines: { itemCode: string; quantity: Decimal; unit: UnitCode }[] }[];
  formats: { code: string; name: string; capacityMl: number }[];
  products: { code: string; name: string; sauceCode: string; formatCode: string; capacityMl: number; packaging: { itemCode: string; perJar: number }[] }[];
  /** Planning estimates of litres per batch, labelled as estimates. */
  yieldEstimates: { sauceCode: string; litresPerBatch: Decimal; note: string }[];
}

export function loadSeedCatalog(): SeedCatalog {
  const items: SeedCatalog["items"] = [
    ...seed.ingredients.map((i) => ({
      id: `ing-${slug(i.name)}`,
      name: i.name,
      kind: "ingredient" as const,
      stockUnit: unit(i.inventory_unit),
    })),
    ...seed.packaging_items.map((p) => ({
      id: `pkg-${slug(p.name)}`,
      name: p.name,
      kind: "packaging" as const,
      stockUnit: unit(p.unit),
    })),
  ];
  const ingByName = new Map(seed.ingredients.map((i) => [i.name, `ing-${slug(i.name)}`]));
  const pkgCode = (name: string) => {
    if (!seed.packaging_items.some((p) => p.name === name)) throw new Error(`Unknown packaging ${name}`);
    return `pkg-${slug(name)}`;
  };

  const sauces = seed.recipes.map((r) => ({
    code: slug(r.sauce),
    name: r.sauce,
    batchReferenceKg: new Decimal(r.batch_reference_kg),
    lines: r.lines.map((l) => {
      const code = ingByName.get(l.ingredient);
      if (!code) throw new Error(`Unknown ingredient ${l.ingredient}`);
      return { itemCode: code, quantity: new Decimal(l.quantity), unit: unit(l.unit) };
    }),
  }));

  const formats = [...new Map(seed.products.map((p) => [p.capacity_ml, p])).values()].map((p) => ({
    code: `f${p.capacity_ml}`,
    name: p.format,
    capacityMl: p.capacity_ml,
  }));

  const products = seed.products.map((p) => ({
    code: `${slug(p.sauce)}-${p.capacity_ml}`,
    name: `${p.sauce} ${p.format}`,
    sauceCode: slug(p.sauce),
    formatCode: `f${p.capacity_ml}`,
    capacityMl: p.capacity_ml,
    packaging: Object.entries(p.packaging_per_jar).map(([name, n]) => ({ itemCode: pkgCode(name), perJar: n })),
  }));

  const yieldEstimates = seed.yield.estimates.map((e) => {
    if (!seed.recipes.some((r) => r.sauce === e.sauce)) throw new Error(`Unknown sauce ${e.sauce}`);
    return { sauceCode: slug(e.sauce), litresPerBatch: new Decimal(e.litres_per_batch), note: seed.yield.note };
  });

  return { items, sauces, formats, products, yieldEstimates };
}

/** Planner inputs from the seed catalog, with yields and rejects unknown. */
export function seedPlanCatalog(): { items: PlanItem[]; sauces: PlanSauce[]; products: PlanProduct[] } {
  const c = loadSeedCatalog();
  return {
    items: c.items,
    sauces: c.sauces.map((s) => ({
      id: s.code,
      name: s.name,
      recipe: {
        versionId: `${s.code}-v1`,
        versionNo: 1,
        batchReferenceKg: s.batchReferenceKg,
        lines: s.lines.map((l) => ({ itemId: l.itemCode, quantity: l.quantity, unit: l.unit })),
      },
      yield: { litresPerBatch: null, source: "missing" },
    })),
    products: c.products.map((p) => ({
      id: p.code,
      sauceId: p.sauceCode,
      name: p.name,
      fillMl: p.capacityMl,
      packaging: p.packaging.map((x) => ({ itemId: x.itemCode, perJar: x.perJar })),
      reject: { rate: null, source: "missing" },
    })),
  };
}
