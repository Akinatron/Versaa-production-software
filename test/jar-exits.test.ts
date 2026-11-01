import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { loadPlanCatalog } from "@/db/planning";
import { changePackaging, recordIngredients, recordPackaging } from "@/db/production";
import { createSalesOrder, deliverSalesOrder, finishedAvailability, recordOutflow } from "@/db/sales";
import { lotBalance } from "@/db/ledger";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Jars leaving stock:
 * - lots picked by hand work when an order has the same size on two lines;
 * - broken jars can be written off even when they are promised to an order,
 *   and the app says which orders are now short;
 * - the same when a packaging session is lowered or deleted.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

/** 10 jars of 950 ml in batch 1's lot and 5 in batch 2's. */
async function jarsInTwoLots() {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
  for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
  for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
  await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
  const catalog = await loadPlanCatalog(db);
  const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
  const pkg = [...new Set(catalog.products.filter((p) => p.sauceId === kip.id).flatMap((p) => p.packaging.map((x) => x.itemId)))];
  await recordOpeningCount(db, {
    idempotencyKey: "open",
    countedOn: "2026-10-17",
    lines: [...kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: "1000" })), ...pkg.map((itemId) => ({ itemId, quantity: "500" }))],
  });
  const big = ids["Liberiaanse Kip 950 ml"]!;
  const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [big]: 60 } });
  await confirmRun(db, run.id);
  const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
  const lots: string[] = [];
  for (const [i, b] of batches.entries()) {
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, b.id));
    await recordIngredients(db, {
      idempotencyKey: `cook-${i}`,
      batchId: b.id,
      producedOn: "2026-10-20",
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.plannedQty })),
    });
    await recordPackaging(db, {
      idempotencyKey: `pack-${i}`,
      batchId: b.id,
      packedOn: `2026-10-2${i + 1}`,
      lines: [{ productId: big, filled: i === 0 ? 10 : 5, rejected: 0 }],
    });
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.batchId, b.id));
    lots.push(lot!.id);
  }
  return { db, big, lotA: lots[0]!, lotB: lots[1]! };
}

describe.skipIf(!testDbUrl)("picking lots by hand", () => {
  it("works when the order has the same size on two lines", async () => {
    const { db, big, lotA, lotB } = await jarsInTwoLots();
    const { order } = await createSalesOrder(db, {
      idempotencyKey: "so",
      destination: "Shop",
      lines: [
        { productId: big, jars: 6, unitPrice: "3" },
        { productId: big, jars: 2, unitPrice: "0" },
      ],
    });
    await expect(deliverSalesOrder(db, { idempotencyKey: "bad", salesOrderId: order.id, lots: { [big]: [{ lotId: lotA, jars: 6 }] } })).rejects.toThrow(
      /add up to 6 jars, not 8/,
    );
    await deliverSalesOrder(db, {
      idempotencyKey: "dl",
      salesOrderId: order.id,
      lots: {
        [big]: [
          { lotId: lotB, jars: 5 },
          { lotId: lotA, jars: 3 },
        ],
      },
    });
    expect((await lotBalance(db as never, lotB)).toString()).toBe("0");
    expect((await lotBalance(db as never, lotA)).toString()).toBe("7");
    const lines = await db.select().from(t.outflowLines);
    expect(lines.map((l) => l.jars).sort()).toEqual([1, 2, 5].sort());
  });
});

describe.skipIf(!testDbUrl)("writing off jars promised to an order", () => {
  it("is allowed, and says the order is now short", async () => {
    const { db, big } = await jarsInTwoLots();
    await createSalesOrder(db, { idempotencyKey: "so", destination: "Shop", lines: [{ productId: big, jars: 15 }] });
    // All 15 are promised: a sale can't take them, but broken jars are broken.
    await expect(recordOutflow(db, { idempotencyKey: "sale", type: "sale", lines: [{ productId: big, jars: 2 }] })).rejects.toThrow(/0 available/);
    const r = await recordOutflow(db, { idempotencyKey: "waste", type: "waste", note: "dropped a tray", lines: [{ productId: big, jars: 2 }] });
    expect(r.short).toEqual(["Liberiaanse Kip 950 ml: sales orders are now 2 jars short."]);
    expect((await finishedAvailability(db)).find((a) => a.productId === big)!.onHand.toString()).toBe("13");
    await expect(recordOutflow(db, { idempotencyKey: "waste2", type: "waste", note: "x", lines: [{ productId: big, jars: 14 }] })).rejects.toThrow(
      /13 in stock/,
    );
  });
});

describe.skipIf(!testDbUrl)("lowering or deleting packaging whose jars are promised", () => {
  it("is allowed, and says which orders are now short", async () => {
    const { db, big, lotB } = await jarsInTwoLots();
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.id, lotB));
    const [session] = await db.select().from(t.packagingSessions).where(eq(t.packagingSessions.batchId, lot!.batchId!));
    await createSalesOrder(db, { idempotencyKey: "so", destination: "Shop", lines: [{ productId: big, jars: 12 }] });
    // 15 in stock, 12 promised: taking 2 out leaves 13, still enough.
    const lower = await changePackaging(db, {
      idempotencyKey: "lower",
      sessionId: session!.id,
      reason: "miscounted",
      packedOn: session!.packedOn,
      lines: [{ productId: big, filled: 3, rejected: 0 }],
    });
    expect(lower.short).toEqual([]);
    // Deleting the rest (3 more) leaves 10 for 12 promised.
    const del = await changePackaging(db, { idempotencyKey: "del", sessionId: session!.id, delete: true, reason: "wrong batch" });
    expect(del.short).toEqual(["Liberiaanse Kip 950 ml: sales orders are now 2 jars short."]);
    expect((await lotBalance(db as never, lotB)).toString()).toBe("0");
  });
});
