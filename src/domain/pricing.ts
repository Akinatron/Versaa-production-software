import Decimal from "decimal.js";
import type { ItemKind } from "./planner";
import type { UnitCode } from "./quantity";

/*
 * Prices and budgets. Pure functions, shared by the run budget (block A)
 * and the batch budget (block B).
 *
 * A supplier price is stored for one pack as the supplier sells it
 * (12 € per 25 kg sack). Orders are rounded up to whole packs. When no pack
 * size is known, the price is per stock unit and the exact quantity is ordered.
 * A missing price is unknown (null), never 0.
 */

export interface Offer {
  supplierItemId: string;
  supplierId: string;
  supplierName: string;
  itemId: string;
  /** 1 = favourite. */
  rank: number;
  /** Pack size in the item's stock unit, or null when sold per unit. */
  packQty: Decimal | null;
  packName: string | null;
  /** Price of one pack, or of one stock unit when packQty is null. */
  price: Decimal | null;
  /** When the current price was set. */
  since: Date | null;
  /** False when the supplier is marked "Not in use". */
  supplierActive?: boolean;
  /** Set when the favourite is not in use and this cheapest supplier in use stands in for it. */
  standIn?: boolean;
}

/** Price per stock unit, or null when unknown. */
export function unitPrice(offer: Pick<Offer, "packQty" | "price"> | null | undefined): Decimal | null {
  if (!offer || offer.price === null) return null;
  if (offer.packQty === null) return offer.price;
  if (offer.packQty.lte(0)) return null;
  return offer.price.div(offer.packQty);
}

export interface PackRounding {
  /** Quantity to order, in the stock unit. */
  quantity: Decimal;
  /** Whole packs, or null when there is no pack size. */
  packs: number | null;
  /** Cost of that quantity, or null when the price is unknown. */
  cost: Decimal | null;
}

/**
 * Round what's missing up to whole packs: missing 18 kg in 25 kg sacks → 1
 * sack (25 kg); missing 30 kg → 2 sacks. With no pack size, order exactly.
 */
export function roundToPacks(missing: Decimal.Value, offer: Pick<Offer, "packQty" | "price"> | null | undefined, stockUnit?: UnitCode): PackRounding {
  const need = Decimal.max(0, new Decimal(missing));
  if (offer?.packQty && offer.packQty.gt(0)) {
    const packs = need.div(offer.packQty).ceil().toNumber();
    return { quantity: offer.packQty.mul(packs), packs, cost: offer.price === null ? null : offer.price.mul(packs) };
  }
  const quantity = stockUnit === "unit" ? need.ceil() : need;
  const price = offer?.price ?? null;
  return { quantity, packs: null, cost: price === null ? null : price.mul(quantity) };
}

/** The favourite (lowest rank) of an item's offers. */
export function favourite<T extends Pick<Offer, "rank">>(offers: T[]): T | null {
  return offers.length ? [...offers].sort((a, b) => a.rank - b.rank)[0]! : null;
}

/** Human text for a price, e.g. "12 € / 25 kg sack" or "0.40 € / unit". */
export function describePrice(offer: Pick<Offer, "packQty" | "packName" | "price">, unitLabel: string): string {
  if (offer.price === null) return "no price";
  const price = offer.packQty === null ? unitMoney(offer.price) : money(offer.price);
  if (offer.packQty === null) return `${price} / ${unitLabel === "units" ? "unit" : unitLabel}`;
  return `${price} / ${offer.packQty.toString()} ${unitLabel}${offer.packName ? ` ${offer.packName}` : ""}`;
}

/**
 * A price per unit: cents as usual, but cheap items keep the digits that
 * matter (0.035 €, 0.004 €), up to 4 decimals.
 */
export function unitMoney(v: Decimal | null): string {
  if (v === null) return "unknown";
  return v.decimalPlaces() <= 2 ? money(v) : `${v.toDecimalPlaces(4).toString()} €`;
}

export function money(v: Decimal | null): string {
  if (v === null) return "unknown";
  return `${v.toFixed(2)} €`;
}

// ---------------------------------------------------------------- budgets

export interface BudgetLineInput {
  itemId: string;
  name: string;
  kind: ItemKind;
  unit: UnitCode;
  /** One or more cost columns, e.g. { toBuy: …, total: … }. */
  columns: Record<string, { quantity: Decimal | null; cost: Decimal | null }>;
  /** Shown in the price column, e.g. "12 € / 25 kg". */
  priceText: string;
  /** Where the price came from, e.g. supplier name or lot code. */
  priceSource?: string;
}

export interface BudgetGroup {
  kind: ItemKind;
  lines: BudgetLineInput[];
  /** Per column: sum of known costs, how many lines had no price, and how many an unknown quantity. */
  totals: Record<string, BudgetTotal>;
}

export interface BudgetTotal {
  cost: Decimal;
  /** Lines with a quantity but no price. */
  missing: number;
  /** Lines whose quantity can't be worked out (e.g. stock never counted). */
  unknown: number;
}

export interface Budget {
  groups: BudgetGroup[];
  total: Record<string, BudgetTotal>;
}

/**
 * Group lines into Ingredients and Packaging with per-column totals. A line
 * with a quantity but no price is counted as missing, and a line whose
 * quantity is unknown as unknown, so a total is never presented as complete
 * when it isn't.
 */
export function buildBudget(lines: BudgetLineInput[], columns: string[]): Budget {
  const empty = (): Record<string, BudgetTotal> => Object.fromEntries(columns.map((c) => [c, { cost: new Decimal(0), missing: 0, unknown: 0 }]));
  const total = empty();
  const groups: BudgetGroup[] = (["ingredient", "packaging"] as const).map((kind) => {
    const own = lines.filter((l) => l.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    const totals = empty();
    for (const l of own) {
      for (const c of columns) {
        const col = l.columns[c];
        if (!col) continue;
        if (col.quantity === null) {
          totals[c]!.unknown++;
          total[c]!.unknown++;
          continue;
        }
        if (col.quantity.isZero()) continue;
        if (col.cost === null) {
          totals[c]!.missing++;
          total[c]!.missing++;
        } else {
          totals[c]!.cost = totals[c]!.cost.plus(col.cost);
          total[c]!.cost = total[c]!.cost.plus(col.cost);
        }
      }
    }
    return { kind, lines: own, totals };
  });
  return { groups, total };
}
