import Decimal from "decimal.js";
import { convert, type UnitCode } from "./quantity";

/*
 * Production planner: from target sellable jars to batches, ingredients,
 * packaging and what to buy.
 *
 * Rules from the brief this code enforces:
 * - The target is sellable jars. Rejects are added on top, never hidden.
 * - A 30 kg batch is never assumed to be 30 L. Litres per batch must come
 *   from observed history or an explicit, labelled estimate.
 * - Anything that cannot be calculated is `null` ("unknown"), never 0.
 * - Shared ingredients and packaging are summed across sauces and sizes.
 * - Stock already reserved by earlier production runs is not offered again.
 * - Planning reads stock; it never changes it.
 */

export type ItemKind = "ingredient" | "packaging";
export type Source = "observed" | "estimate" | "missing";

export interface PlanItem {
  id: string;
  name: string;
  kind: ItemKind;
  /** Unit stock is kept in (kg, L or unit). */
  stockUnit: UnitCode;
}

export interface RecipeLine {
  itemId: string;
  /** Quantity for one reference batch, exactly as recorded. */
  quantity: Decimal;
  unit: UnitCode;
}

export interface PlanSauce {
  id: string;
  name: string;
  /** The active recipe version, or null when the sauce has none. */
  recipe: { versionId: string; versionNo: number; batchReferenceKg: Decimal; lines: RecipeLine[] } | null;
  /** Litres of filled product one batch gives. */
  yield: { litresPerBatch: Decimal | null; source: Source; note?: string };
}

export interface PlanProduct {
  id: string;
  sauceId: string;
  name: string;
  /** Product volume in one jar, in ml. */
  fillMl: number;
  packaging: { itemId: string; perJar: number }[];
  /** Share of filled jars rejected at packaging (0–1), or null when unknown. */
  reject: { rate: Decimal | null; source: Source };
}

export interface StockPosition {
  /** Counted or recorded stock; null when this item has never been counted. */
  onHand: Decimal | null;
  /** Committed to production runs dated before this one. */
  reservedEarlier: Decimal;
  /** Ordered, not yet received, expected by the run date. */
  onOrder: Decimal;
}

export interface PlanInput {
  items: PlanItem[];
  sauces: PlanSauce[];
  products: PlanProduct[];
  stock: Record<string, StockPosition | undefined>;
  /** Target sellable jars per product id. */
  targets: Record<string, number>;
}

export type IssueLevel = "blocker" | "warning";
export interface Issue {
  level: IssueLevel;
  message: string;
}

export interface ProductLine {
  productId: string;
  name: string;
  targetJars: number;
  rejectRate: Decimal | null;
  rejectSource: Source;
  /** Jars to fill so that, after expected rejects, the target is met. */
  jarsToFill: number;
  /** True when every packaging component is fully available. */
  packable: boolean | null;
}

export interface SauceLine {
  sauceId: string;
  name: string;
  litresNeeded: Decimal;
  litresPerBatch: Decimal | null;
  yieldSource: Source;
  batches: number | null;
  /** Expected litres left over from producing whole batches. */
  surplusLitres: Decimal | null;
  recipeVersionNo: number | null;
}

export type CoverageStatus = "covered" | "short" | "unknown";

export interface RequirementLine {
  itemId: string;
  name: string;
  kind: ItemKind;
  unit: UnitCode;
  /** Total required, or null when some contribution is unknown. */
  required: Decimal | null;
  /** Where the requirement comes from (sauce or product name → quantity). */
  contributions: { from: string; quantity: Decimal | null }[];
  onHand: Decimal | null;
  reservedEarlier: Decimal;
  /** onHand − reservedEarlier, never below 0. */
  available: Decimal | null;
  onOrder: Decimal;
  /** What still has to be bought, or null when it can't be worked out. */
  toBuy: Decimal | null;
  status: CoverageStatus;
}

export interface PlanResult {
  products: ProductLine[];
  sauces: SauceLine[];
  requirements: RequirementLine[];
  issues: Issue[];
}

const ZERO = new Decimal(0);

export function validateTargets(targets: Record<string, number>): Issue[] {
  const issues: Issue[] = [];
  for (const [id, jars] of Object.entries(targets)) {
    if (!Number.isInteger(jars) || jars < 0) {
      issues.push({ level: "blocker", message: `Target for ${id} must be a whole number of jars, 0 or more.` });
    }
  }
  return issues;
}

export function planProduction(input: PlanInput): PlanResult {
  const issues = validateTargets(input.targets);
  if (issues.length > 0) return { products: [], sauces: [], requirements: [], issues };

  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const saucesById = new Map(input.sauces.map((s) => [s.id, s]));

  // Accumulated requirements: itemId → contributions.
  const contributions = new Map<string, { from: string; quantity: Decimal | null }[]>();
  const addNeed = (itemId: string, from: string, quantity: Decimal | null) => {
    const list = contributions.get(itemId) ?? [];
    list.push({ from, quantity });
    contributions.set(itemId, list);
  };

  // 1. Products: jars to fill, packaging needs, litres per sauce.
  const litresBySauce = new Map<string, Decimal>();
  const productLines: ProductLine[] = [];
  for (const product of input.products) {
    const target = input.targets[product.id] ?? 0;
    if (target === 0) continue;

    let jarsToFill = target;
    const rate = product.reject.rate;
    if (rate === null) {
      issues.push({
        level: "warning",
        message: `${product.name}: reject rate unknown, so no extra jars are planned for rejects. If any jars are rejected you will get fewer than ${target}.`,
      });
    } else if (rate.gte(1) || rate.lt(0)) {
      issues.push({ level: "blocker", message: `${product.name}: reject rate must be between 0% and 100%.` });
    } else {
      jarsToFill = new Decimal(target).div(new Decimal(1).minus(rate)).ceil().toNumber();
    }

    for (const part of product.packaging) {
      addNeed(part.itemId, product.name, new Decimal(jarsToFill).mul(part.perJar));
    }
    if (product.packaging.length === 0) {
      issues.push({ level: "blocker", message: `${product.name}: no packaging list is set up.` });
    }

    const litres = new Decimal(jarsToFill).mul(product.fillMl).div(1000);
    litresBySauce.set(product.sauceId, (litresBySauce.get(product.sauceId) ?? ZERO).plus(litres));

    productLines.push({
      productId: product.id,
      name: product.name,
      targetJars: target,
      rejectRate: rate,
      rejectSource: product.reject.source,
      jarsToFill,
      packable: null,
    });
  }

  // 2. Sauces: batches from litres and yield; ingredients from the recipe.
  const sauceLines: SauceLine[] = [];
  for (const [sauceId, litresNeeded] of litresBySauce) {
    const sauce = saucesById.get(sauceId);
    if (!sauce) throw new Error(`Unknown sauce ${sauceId}`);
    const lpb = sauce.yield.litresPerBatch;

    let batches: number | null = null;
    let surplus: Decimal | null = null;
    if (lpb === null || lpb.lte(0)) {
      issues.push({
        level: "blocker",
        message: `${sauce.name}: no litres-per-batch figure yet, so batches and ingredients can't be calculated. Enter an estimate in Settings → Yields, or record a batch.`,
      });
    } else {
      batches = litresNeeded.div(lpb).ceil().toNumber();
      surplus = lpb.mul(batches).minus(litresNeeded);
      if (sauce.yield.source === "estimate") {
        issues.push({
          level: "warning",
          message: `${sauce.name}: batches use an estimate of ${lpb.toString()} L per batch, not measured results.`,
        });
      }
    }

    if (!sauce.recipe) {
      issues.push({ level: "blocker", message: `${sauce.name}: no active recipe.` });
    } else {
      for (const line of sauce.recipe.lines) {
        const item = itemsById.get(line.itemId);
        if (!item) throw new Error(`Recipe line points at unknown item ${line.itemId}`);
        const perBatch = convert(line.quantity, line.unit, item.stockUnit);
        addNeed(item.id, sauce.name, batches === null ? null : perBatch.mul(batches));
      }
    }

    sauceLines.push({
      sauceId,
      name: sauce.name,
      litresNeeded,
      litresPerBatch: lpb,
      yieldSource: sauce.yield.source,
      batches,
      surplusLitres: surplus,
      recipeVersionNo: sauce.recipe?.versionNo ?? null,
    });
  }

  // 3. Coverage per item.
  const requirements: RequirementLine[] = [];
  for (const [itemId, contribs] of contributions) {
    const item = itemsById.get(itemId);
    if (!item) throw new Error(`Unknown item ${itemId}`);
    const merged = mergeContributions(contribs);
    const required = merged.some((c) => c.quantity === null)
      ? null
      : merged.reduce((sum, c) => sum.plus(c.quantity as Decimal), ZERO);

    const pos = input.stock[itemId] ?? { onHand: null, reservedEarlier: ZERO, onOrder: ZERO };
    const available = pos.onHand === null ? null : Decimal.max(ZERO, pos.onHand.minus(pos.reservedEarlier));

    let toBuy: Decimal | null = null;
    let status: CoverageStatus = "unknown";
    if (required !== null && available !== null) {
      toBuy = Decimal.max(ZERO, required.minus(available).minus(pos.onOrder));
      if (item.stockUnit === "unit") toBuy = toBuy.ceil();
      status = toBuy.isZero() ? "covered" : "short";
    }

    requirements.push({
      itemId,
      name: item.name,
      kind: item.kind,
      unit: item.stockUnit,
      required,
      contributions: merged,
      onHand: pos.onHand,
      reservedEarlier: pos.reservedEarlier,
      available,
      onOrder: pos.onOrder,
      toBuy,
      status,
    });
  }

  const uncounted = requirements.filter((r) => r.onHand === null).length;
  if (uncounted > 0) {
    issues.push({
      level: "warning",
      message: `${uncounted} item(s) have no stock count yet, so their coverage is unknown. Record an opening stock count.`,
    });
  }

  // 4. A product is packable only when every component is fully available
  //    from stock (orders not yet received don't count).
  const reqById = new Map(requirements.map((r) => [r.itemId, r]));
  for (const line of productLines) {
    const product = input.products.find((p) => p.id === line.productId)!;
    const parts = product.packaging.map((p) => reqById.get(p.itemId)!);
    if (parts.some((r) => r.available === null || r.required === null)) line.packable = null;
    else line.packable = parts.every((r) => (r.available as Decimal).gte(r.required as Decimal));
  }

  requirements.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "ingredient" ? -1 : 1));
  return { products: productLines, sauces: sauceLines, requirements, issues };
}

function mergeContributions(list: { from: string; quantity: Decimal | null }[]) {
  const byFrom = new Map<string, Decimal | null>();
  for (const c of list) {
    const prev = byFrom.get(c.from);
    if (!byFrom.has(c.from)) byFrom.set(c.from, c.quantity);
    else byFrom.set(c.from, prev === null || c.quantity === null ? null : prev!.plus(c.quantity));
  }
  return [...byFrom.entries()].map(([from, quantity]) => ({ from, quantity }));
}

/**
 * Second way to plan: number of batches per sauce and how to split each
 * sauce's volume across sizes (percentages). Turns that into sellable jar
 * targets, so it leads to exactly the same plan as entering jars.
 *
 * Jars to fill per size = floor(litres × share ÷ fill per jar); the sellable
 * target removes expected rejects when the reject rate is known.
 */
export function targetsFromBatches(
  input: Pick<PlanInput, "sauces" | "products">,
  bySauce: Record<string, { batches: number; split: Record<string, number> }>,
): { targets: Record<string, number>; issues: Issue[] } {
  const targets: Record<string, number> = {};
  const issues: Issue[] = [];
  for (const [sauceId, { batches, split }] of Object.entries(bySauce)) {
    if (!batches) continue;
    const sauce = input.sauces.find((s) => s.id === sauceId);
    if (!sauce) continue;
    if (!Number.isInteger(batches) || batches < 0) {
      issues.push({ level: "blocker", message: `${sauce.name}: batches must be a whole number.` });
      continue;
    }
    const total = Object.values(split).reduce((a, b) => a + (b || 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      issues.push({ level: "blocker", message: `${sauce.name}: the size split adds up to ${total}%, not 100%.` });
      continue;
    }
    const lpb = sauce.yield.litresPerBatch;
    if (lpb === null || lpb.lte(0)) {
      issues.push({ level: "blocker", message: `${sauce.name}: no litres-per-batch figure yet, so batches can't be turned into jars.` });
      continue;
    }
    const litres = lpb.mul(batches);
    for (const product of input.products.filter((p) => p.sauceId === sauceId)) {
      const share = split[product.id] ?? 0;
      if (share <= 0) continue;
      const fill = litres.mul(share).div(100).mul(1000).div(product.fillMl).floor();
      const rate = product.reject.rate;
      const sellable = rate === null ? fill : fill.mul(new Decimal(1).minus(rate)).floor();
      targets[product.id] = sellable.toNumber();
    }
  }
  return { targets, issues };
}
