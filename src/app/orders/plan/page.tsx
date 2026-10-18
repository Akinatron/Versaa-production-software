import Link from "next/link";
import Decimal from "decimal.js";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { offersByItem } from "@/db/suppliers";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { Flash } from "../../components/flash";
import { OrderPlanner, type PlannerLine } from "../../components/order-planner";
import { createPlannedOrders } from "../actions";

export const dynamic = "force-dynamic";

/** Plan orders for a list of missing items without a run (from the planner, before saving a run). */
export default async function PlanOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const wanted = (params.items ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => {
      const [itemId, qty] = p.split(":");
      return { itemId: itemId!, qty: qty ?? "0" };
    })
    .filter((w) => /^[0-9a-f-]{36}$/.test(w.itemId));
  const [items, suppliers, offers] = await Promise.all([
    wanted.length ? db().select().from(t.items).where(inArray(t.items.id, wanted.map((w) => w.itemId))) : Promise.resolve([]),
    db().select({ id: t.suppliers.id, name: t.suppliers.name }).from(t.suppliers).where(eq(t.suppliers.active, true)).orderBy(asc(t.suppliers.name)),
    offersByItem(db(), wanted.map((w) => w.itemId)),
  ]);
  const lines: PlannerLine[] = wanted
    .map((w) => {
      const item = items.find((i) => i.id === w.itemId);
      if (!item || (item.kind !== "ingredient" && item.kind !== "packaging")) return null;
      return {
        itemId: item.id,
        name: item.name,
        kind: item.kind,
        unitLabel: UNITS[item.stockUnit as UnitCode].label,
        wholeUnits: item.stockUnit === "unit",
        missing: new Decimal(w.qty || 0).toString(),
        inDrafts: "0",
        offers: (offers.get(item.id) ?? []).map((o) => ({
          supplierId: o.supplierId,
          supplierName: o.supplierName,
          rank: o.rank,
          packQty: o.packQty?.toString() ?? null,
          packName: o.packName,
          price: o.price?.toString() ?? null,
        })),
      };
    })
    .filter((l): l is PlannerLine => l !== null);

  return (
    <>
      <p className="small" style={{ margin: "0 0 8px" }}>
        <Link href="/orders">← Orders</Link>
      </p>
      <h1>Order what's missing</h1>
      <p className="lead">
        One draft order per supplier, not linked to a run. To order for a run, save the plan as a run first and use its "Order" step, so the orders show on the run.
      </p>
      <Flash params={params} />
      {lines.length === 0 ? (
        <p className="card muted">Nothing to order.</p>
      ) : (
        <OrderPlanner lines={lines} suppliers={suppliers} runId={null} idempotencyKey={crypto.randomUUID()} action={createPlannedOrders} />
      )}
    </>
  );
}
