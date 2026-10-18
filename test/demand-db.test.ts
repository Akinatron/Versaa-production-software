import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { confirmRun, createRun } from "@/db/operations";
import { cancelSalesOrder, createSalesOrder } from "@/db/sales";
import { loadOrderDemand } from "@/db/demand";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

suite("plan from sales orders (database)", () => {
  let db: DB;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDb();
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
  });
  afterAll(async () => db?.$client.end());

  it("saves the delivery date and refuses one before the order date", async () => {
    const r = await createSalesOrder(db, {
      idempotencyKey: "so-1",
      destination: "Market",
      orderedOn: "2026-10-18",
      deliverBy: "2026-10-25",
      lines: [{ productId: ids["Liberiaanse Kip 700 ml"]!, jars: 50 }],
    });
    expect(r.order.deliverBy).toBe("2026-10-25");
    await expect(
      createSalesOrder(db, { idempotencyKey: "so-x", destination: "Market", orderedOn: "2026-10-18", deliverBy: "2026-10-01", lines: [{ productId: ids["Liberiaanse Kip 700 ml"]!, jars: 1 }] }),
    ).rejects.toThrow(/before the order date/);
  });

  it("orders minus jars coming from confirmed runs; later, cancelled and draft don't count", async () => {
    await createSalesOrder(db, { idempotencyKey: "so-2", destination: "Shop", orderedOn: "2026-10-18", deliverBy: "2026-12-01", lines: [{ productId: ids["Liberiaanse Kip 700 ml"]!, jars: 20 }] });
    const gone = await createSalesOrder(db, { idempotencyKey: "so-3", destination: "Shop", orderedOn: "2026-10-18", lines: [{ productId: ids["Liberiaanse Kip 700 ml"]!, jars: 99 }] });
    await cancelSalesOrder(db, gone.order.id);

    const run = await createRun(db, { idempotencyKey: "run-1", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 30 } });
    await confirmRun(db, run.id);
    await createRun(db, { idempotencyKey: "run-2", plannedFor: "2026-10-21", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 500 } });

    const soon = await loadOrderDemand(db, "2026-10-31");
    expect(soon.lines).toEqual([{ productId: ids["Liberiaanse Kip 700 ml"], ordered: 50, inStock: 0, inRuns: 30, toMake: 20 }]);
    expect(soon.ordersCounted).toBe(1);
    expect(soon.ordersLater).toBe(1);
    expect(soon.draftRuns).toBe(1);

    const all = await loadOrderDemand(db, null);
    expect(all.targets).toEqual({ [ids["Liberiaanse Kip 700 ml"]!]: 40 });
  });
});
