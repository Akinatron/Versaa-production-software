/*
 * Production targets from sales orders.
 *
 * For each product: jars on pending orders due by the chosen date, minus jars
 * already in stock, minus jars still to come from confirmed runs. What's left
 * is the proposed target. Orders without a delivery date always count, since
 * nothing says they can wait. No minimum stock is added.
 */

export interface DemandOrderLine {
  orderId: string;
  productId: string;
  jars: number;
  /** Delivery date the customer asked for, or null. */
  deliverBy: string | null;
}

export interface DemandInput {
  lines: DemandOrderLine[];
  /** Finished jars on hand per product id. */
  inStock: Record<string, number>;
  /** Jars still to come from confirmed or in-progress runs, per product id. */
  inRuns: Record<string, number>;
  /** ISO date; orders due later are left out. Null takes every pending order. */
  until: string | null;
}

export interface DemandLine {
  productId: string;
  ordered: number;
  inStock: number;
  inRuns: number;
  /** ordered − inStock − inRuns, never below 0. */
  toMake: number;
}

export interface DemandResult {
  lines: DemandLine[];
  /** Proposed sellable jar targets, only products with something to make. */
  targets: Record<string, number>;
  ordersCounted: number;
  /** Pending orders left out because they are due after `until`. */
  ordersLater: number;
}

export function demandFromOrders(input: DemandInput): DemandResult {
  const counted = new Set<string>();
  const later = new Set<string>();
  const ordered = new Map<string, number>();
  for (const l of input.lines) {
    if (input.until && l.deliverBy && l.deliverBy > input.until) {
      later.add(l.orderId);
      continue;
    }
    counted.add(l.orderId);
    ordered.set(l.productId, (ordered.get(l.productId) ?? 0) + l.jars);
  }
  // An order is "later" only if none of it counted (lines share the order's date anyway).
  for (const id of counted) later.delete(id);

  const lines: DemandLine[] = [];
  const targets: Record<string, number> = {};
  for (const [productId, n] of ordered) {
    const inStock = Math.max(0, input.inStock[productId] ?? 0);
    const inRuns = Math.max(0, input.inRuns[productId] ?? 0);
    const toMake = Math.max(0, n - inStock - inRuns);
    lines.push({ productId, ordered: n, inStock, inRuns, toMake });
    if (toMake > 0) targets[productId] = toMake;
  }
  return { lines, targets, ordersCounted: counted.size, ordersLater: later.size };
}
