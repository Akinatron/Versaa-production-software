import { asc, eq } from "drizzle-orm";
import { isOnTheWay } from "@/domain/status";
import Link from "next/link";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { planForRun } from "@/db/operations";
import { loadOrders, orderPlan } from "@/db/purchasing";
import { UNITS } from "@/domain/quantity";
import { Flash } from "../../../components/flash";
import { OrderPlanner, type PlannerLine } from "../../../components/order-planner";
import { RunOrdersTable } from "../../../components/order-bits";
import { NextStep, RunHeader, loadRun } from "../../../components/run-steps";
import { createPlannedOrders } from "../../../orders/actions";
import { idOrNotFound } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Step 3: plan the order. Only what's missing, split by supplier. */
export default async function RunOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  idOrNotFound(id);
  const flash = await searchParams;
  const run = await loadRun(id);
  const live = await planForRun(db(), id);
  const [plan, suppliers, orders] = await Promise.all([
    orderPlan(db(), live, id),
    db().select({ id: t.suppliers.id, name: t.suppliers.name }).from(t.suppliers).where(eq(t.suppliers.active, true)).orderBy(asc(t.suppliers.name)),
    loadOrders(db(), { runId: id }),
  ]);
  const lines: PlannerLine[] = plan
    .filter((l) => l.missing.gt(0))
    .map((l) => ({
      itemId: l.itemId,
      name: l.name,
      kind: l.kind,
      unitLabel: UNITS[l.unit].label,
      wholeUnits: l.unit === "unit",
      missing: l.missing.toString(),
      inDrafts: l.inDrafts.toString(),
      offers: l.offers.map((o) => ({
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        rank: o.rank,
        ...(o.standIn ? { standIn: true } : {}),
        packQty: o.packQty?.toString() ?? null,
        packName: o.packName,
        price: o.price?.toString() ?? null,
      })),
    }));
  const closed = run.status === "cancelled" || run.status === "closed";
  const unknown = live.requirements.filter((r) => r.status === "unknown");

  return (
    <>
      <RunHeader run={run} step="order" />
      <Flash params={flash} />
      {closed ? (
        <p className="card muted">This run is {run.status}; nothing more to order.</p>
      ) : lines.length === 0 ? (
        <p className="card">
          Nothing left to order for this run
          {orders.some((o) => o.po.status === "draft") ? ": what's missing is already in draft orders below. Mark them as sent once placed." : "."}
        </p>
      ) : (
        <>
          <p className="small muted">
            Only what's missing after stock, other runs' reservations and orders already sent
            {orders.some((o) => o.po.status === "draft") ? " and this run's drafts" : ""}. The favourite supplier is preselected; change it per item if needed.
            Prices and pack sizes come from each <Link href="/suppliers">supplier</Link>.
          </p>
          <OrderPlanner lines={lines} suppliers={suppliers} runId={id} idempotencyKey={crypto.randomUUID()} action={createPlannedOrders} />
        </>
      )}
      {unknown.length > 0 && (
        <p className="small muted">
          Not listed because their stock or need is unknown: {unknown.map((r) => r.name).join(", ")}. <Link href="/stock/count">Count them</Link> first, or
          order them by hand from <Link href={`/orders/new?run=${id}`}>a new order</Link>.
        </p>
      )}
      <h2>Orders for this run</h2>
      <RunOrdersTable orders={orders} back={`/runs/${id}/order`} />
      {orders.some((o) => isOnTheWay(o.po.status)) && <NextStep href={`/runs/${id}/receive`}>Receive deliveries</NextStep>}
    </>
  );
}
