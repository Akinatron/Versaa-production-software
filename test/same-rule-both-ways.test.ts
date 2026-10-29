import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addSupplier, confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { loadPlanCatalog } from "@/db/planning";
import { recordIngredients, recordPackaging } from "@/db/production";
import { createSalesOrder, deliverSalesOrder, recordOutflow, setOutflowDeleted } from "@/db/sales";
import { correctReceipt, recordReceipt } from "@/db/purchasing";
import { recordWriteOff } from "@/db/adjustments";
import { setItemShelfLife } from "@/db/catalog";
import { lotBalance } from "@/db/ledger";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Rules that apply both when something is recorded and when it is restored or
 * corrected:
 * - restoring a deleted outflow checks the jars like a new outflow does
 *   (per lot, all its lines together, and not jars promised to other orders);
 * - a lot created by correcting a delivery gets its best-before from the
 *   item's shelf life, like a lot from a new delivery;
 * - finished jars can't be written off as stock adjustments.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

/** 10 jars of 700 ml in batch 1's lot and 5 in batch 2's. */
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
  const big = ids["Liberiaanse Kip 700 ml"]!;
  const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [big]: 60 } });
  await confirmRun(db, run.id);
  const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
  const lots: string[] = [];
  for (const [i, b] of batches.entries()) {
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, b.id));
    await recordIngredients(db, { idempotencyKey: `cook-${i}`, batchId: b.id, producedOn: "2026-10-20", lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.plannedQty })) });
    await recordPackaging(db, { idempotencyKey: `pack-${i}`, batchId: b.id, packedOn: `2026-10-2${i + 1}`, lines: [{ productId: big, filled: i === 0 ? 10 : 5, rejected: 0 }] });
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.batchId, b.id));
    lots.push(lot!.id);
  }
  return { db, big, lotA: lots[0]!, lotB: lots[1]! };
}

describe.skipIf(!testDbUrl)("restoring a deleted outflow", () => {
  it("adds up the lines that take jars from the same lot", async () => {
    const { db, big, lotA, lotB } = await jarsInTwoLots();
    const { order } = await createSalesOrder(db, {
      idempotencyKey: "so",
      destination: "Shop",
      lines: [
        { productId: big, jars: 6, unitPrice: "3" },
        { productId: big, jars: 2, unitPrice: "0" },
      ],
    });
    const { outflow } = await deliverSalesOrder(db, { idempotencyKey: "dl", salesOrderId: order.id, lots: { [big]: [{ lotId: lotA, jars: 8 }] } });
    expect((await lotBalance(db as never, lotA)).toNumber()).toBe(2);
    await setOutflowDeleted(db, { idempotencyKey: "del", outflowId: outflow.id, deleted: true, reason: "Never left" });
    // 3 samples from lot A: 7 left there, 5 in lot B.
    await recordOutflow(db, { idempotencyKey: "smp", type: "sample", destination: "Market", lines: [{ productId: big, jars: 3, lots: [{ lotId: lotA, jars: 3 }] }] });
    await expect(setOutflowDeleted(db, { idempotencyKey: "res", outflowId: outflow.id, deleted: false, reason: "It did leave" })).rejects.toThrow(
      /lot .* only has 7 jars left, 8 needed/,
    );
    expect((await lotBalance(db as never, lotA)).toNumber()).toBe(7);
    expect((await lotBalance(db as never, lotB)).toNumber()).toBe(5);
  });

  it("doesn't take jars promised to another sales order", async () => {
    const { db, big } = await jarsInTwoLots();
    const { order: first } = await createSalesOrder(db, { idempotencyKey: "so-1", destination: "Bar", lines: [{ productId: big, jars: 8 }] });
    const { outflow } = await deliverSalesOrder(db, { idempotencyKey: "dl-1", salesOrderId: first.id });
    await setOutflowDeleted(db, { idempotencyKey: "del", outflowId: outflow.id, deleted: true, reason: "Entered by mistake" });
    // 15 jars in stock, 8 promised to the first order again; a second order promises 8 more.
    await createSalesOrder(db, { idempotencyKey: "so-2", destination: "Shop", lines: [{ productId: big, jars: 8 }] });
    await expect(setOutflowDeleted(db, { idempotencyKey: "res", outflowId: outflow.id, deleted: false, reason: "It did leave" })).rejects.toThrow(
      /8 jars needed, 7 available \(15 in stock, 8 promised to other orders\)/,
    );
  });

  it("still works when the jars are there and free", async () => {
    const { db, big } = await jarsInTwoLots();
    const { order } = await createSalesOrder(db, { idempotencyKey: "so", destination: "Bar", lines: [{ productId: big, jars: 8 }] });
    const { outflow } = await deliverSalesOrder(db, { idempotencyKey: "dl", salesOrderId: order.id });
    await setOutflowDeleted(db, { idempotencyKey: "del", outflowId: outflow.id, deleted: true, reason: "Entered by mistake" });
    await setOutflowDeleted(db, { idempotencyKey: "res", outflowId: outflow.id, deleted: false, reason: "It did leave" });
    const [so] = await db.select().from(t.salesOrders).where(eq(t.salesOrders.id, order.id));
    expect(so!.status).toBe("delivered");
  });
});

describe.skipIf(!testDbUrl)("correcting a delivery", () => {
  it("gives a new lot the best-before from the item's shelf life", async () => {
    const db = await freshDb();
    dbs.push(db);
    const [onion] = await db.select().from(t.items).where(eq(t.items.code, "ing-onions"));
    await setItemShelfLife(db, onion!.id, "6", "months");
    const sup = await addSupplier(db, { name: "Groente BV" });
    const { receipt } = await recordReceipt(db, {
      idempotencyKey: "rc",
      supplierId: sup.id,
      receivedOn: "2026-10-01",
      lines: [{ itemId: onion!.id, quantity: "0", rejectedQuantity: "20" }],
    });
    const [line] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, receipt.id));
    expect(line!.lotId).toBeNull();
    await correctReceipt(db, {
      idempotencyKey: "fix",
      receiptId: receipt.id,
      reason: "They were fine",
      receivedOn: "2026-10-01",
      lines: [{ lineId: line!.id, quantity: "20", rejectedQuantity: "0" }],
    });
    const [after] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.id, line!.id));
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.id, after!.lotId!));
    expect(lot!.bestBefore).toBe("2027-04-01");
    expect(lot!.storage).toBe(onion!.storage);
  });
});

describe.skipIf(!testDbUrl)("writing off stock", () => {
  it("refuses finished jars, which leave with a stock exit", async () => {
    const { db, lotA } = await jarsInTwoLots();
    await expect(recordWriteOff(db, { idempotencyKey: "wo", type: "waste", reason: "Broken", lines: [{ lotId: lotA, quantity: "2" }] })).rejects.toThrow(
      /Record a stock exit/,
    );
    expect((await lotBalance(db as never, lotA)).toNumber()).toBe(10);
  });
});
