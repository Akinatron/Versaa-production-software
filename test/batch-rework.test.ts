import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { addSupplier, confirmRun, createPurchaseOrder, createRun, recordOpeningCount, recordReceipt } from "@/db/operations";
import { changePackaging, closeBatch, recordIngredients, recordPackaging } from "@/db/production";
import { recordOutflow } from "@/db/sales";
import { traceBatch } from "@/db/trace";
import { observedYields } from "@/db/history";
import { batchBudget } from "@/db/budget";
import { markOrderSent } from "@/db/purchasing";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

/*
 * Round 1, block B: one Record for all ingredients, manual split between
 * lots, corrections by difference, editing and deleting packaging, and the
 * real cost of a batch.
 */
suite("batch: record, correct, edit packaging, cost", () => {
  let db: DB;
  const ids: Record<string, string> = {};
  let batchId = "";
  let oldOnion = "";
  let newOnion = "";
  const onHand = async (code: string) => (await loadStockPositions(db))[ids[code]!]!.onHand!.toString();
  const useOf = async (code: string) => (await traceBatch(db, batchId))!.ingredientUse.find((u) => u.itemId === ids[code])!;

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });

    const catalog = await loadPlanCatalog(db);
    const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
    const pkg = catalog.products.filter((p) => p.sauceId === kip.id).flatMap((p) => p.packaging.map((x) => x.itemId));
    await recordOpeningCount(db, {
      idempotencyKey: "open",
      countedOn: "2026-10-17",
      lines: [
        ...kip.recipe!.lines.filter((l) => l.itemId !== ids["ing-onions"]).map((l) => ({ itemId: l.itemId, quantity: "100" })),
        ...[...new Set(pkg)].map((itemId) => ({ itemId, quantity: "500" })),
      ],
    });
    // Two onion deliveries: an old one about to expire and a new one, both priced.
    const supplier = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, {
      idempotencyKey: "po-onions-000",
      supplierId: supplier.id,
      lines: [
        { itemId: ids["ing-onions"]!, quantity: "4", unitPrice: "1.50" },
        { itemId: ids["ing-onions"]!, quantity: "20", unitPrice: "2" },
      ],
    });
    await markOrderSent(db, po.id, { sentOn: "2026-10-17" });
    const poLines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const r = await recordReceipt(db, {
      idempotencyKey: "rcv-onions",
      supplierId: supplier.id,
      receivedOn: "2026-10-18",
      lines: [
        { itemId: ids["ing-onions"]!, quantity: "4", supplierBatch: "OLD", bestBefore: "2026-10-25", purchaseOrderLineId: poLines.find((l) => l.unitPrice === "1.5")!.id },
        { itemId: ids["ing-onions"]!, quantity: "20", supplierBatch: "NEW", bestBefore: "2026-12-01", purchaseOrderLineId: poLines.find((l) => l.unitPrice === "2")!.id },
      ],
    });
    const lots = await db.select({ lot: t.lots }).from(t.receiptLines).innerJoin(t.lots, eq(t.receiptLines.lotId, t.lots.id)).where(eq(t.receiptLines.receiptId, r.receipt.id));
    oldOnion = lots.find((l) => l.lot.supplierBatch === "OLD")!.lot.id;
    newOnion = lots.find((l) => l.lot.supplierBatch === "NEW")!.lot.id;

    const run = await createRun(db, { idempotencyKey: "run-1", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 30 } });
    await confirmRun(db, run.id);
    const [b] = await db.select({ id: t.productionBatches.id }).from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    batchId = b!.id;
  });
  afterAll(async () => db?.$client.end());

  it("one Record saves every line at once, and a retry does nothing", async () => {
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
    const input = {
      idempotencyKey: "record-1",
      batchId,
      producedOn: "2026-10-20",
      lines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.itemId === ids["ing-garlic"] ? "2" : l.plannedQty,
        // Onions: 4 kg left over from the old delivery plus 3 kg of the new one.
        lots: l.itemId === ids["ing-onions"] ? [{ lotId: oldOnion, quantity: "4" }, { lotId: newOnion, quantity: "3" }] : undefined,
      })),
    };
    const r = await recordIngredients(db, input);
    expect(r.changed).toBe(lines.length);
    expect((await recordIngredients(db, input)).alreadyRecorded).toBe(true);

    const onion = await useOf("ing-onions");
    expect(onion.actual!.toString()).toBe("7");
    expect(onion.sources.map((s) => [s.lot.supplierBatch, s.quantity.toString()]).sort()).toEqual([
      ["NEW", "3"],
      ["OLD", "4"],
    ]);
    const [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.id, batchId));
    expect(b!.status).toBe("awaiting_packaging");
    expect(b!.producedOn).toBe("2026-10-20");
  });

  it("errors from several lines are reported together and nothing is saved", async () => {
    await expect(
      recordIngredients(db, {
        idempotencyKey: "bad",
        batchId,
        lines: [
          { itemId: ids["ing-garlic"]!, quantity: "" },
          { itemId: ids["ing-onions"]!, quantity: "999", lots: [{ lotId: newOnion, quantity: "999" }] },
        ],
      }),
    ).rejects.toThrow(/Garlic: enter the quantity.*Onions: lot .* only has/);
    expect((await useOf("ing-garlic")).actual!.toString()).toBe("2");
  });

  it("recording again corrects by the difference, from the same lot", async () => {
    const before = await onHand("ing-garlic");
    // Typed 2 kg but it was 3: 1 kg more.
    await recordIngredients(db, { idempotencyKey: "fix-1", batchId, lines: [{ itemId: ids["ing-garlic"]!, quantity: "3" }] });
    expect(await onHand("ing-garlic")).toBe(String(Number(before) - 1));
    const garlic = await useOf("ing-garlic");
    expect(garlic.actual!.toString()).toBe("3");
    expect(garlic.sources).toHaveLength(1);

    // Less onion (automatic): given back to the latest-expiring lot first.
    await recordIngredients(db, { idempotencyKey: "fix-2", batchId, lines: [{ itemId: ids["ing-onions"]!, quantity: "5" }] });
    const onion = await useOf("ing-onions");
    expect(onion.sources.map((s) => [s.lot.supplierBatch, s.quantity.toString()]).sort()).toEqual([["NEW", "1"], ["OLD", "4"]]);

    // Manual: move it all to the new lot.
    await recordIngredients(db, { idempotencyKey: "fix-3", batchId, lines: [{ itemId: ids["ing-onions"]!, quantity: "5", lots: [{ lotId: newOnion, quantity: "5" }] }] });
    const moved = await useOf("ing-onions");
    expect(moved.sources.map((s) => [s.lot.supplierBatch, s.quantity.toString()])).toEqual([["NEW", "5"]]);
    expect(await onHand("ing-onions")).toBe("19");
  });

  it("packaging can be edited: stock moves by the difference", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const { session } = await recordPackaging(db, { idempotencyKey: "pack-1", batchId, packedOn: "2026-10-21", bestBefore: "2027-01-21", lines: [{ productId: big, filled: 30, rejected: 2 }] });
    expect(await onHand("pkg-700-ml-container")).toBe("470");

    // It was 25 filled, 1 rejected.
    await changePackaging(db, { idempotencyKey: "edit-1", sessionId: session.id, packedOn: "2026-10-21", lines: [{ productId: big, filled: 25, rejected: 1 }] });
    await changePackaging(db, { idempotencyKey: "edit-1", sessionId: session.id, packedOn: "2026-10-21", lines: [{ productId: big, filled: 25, rejected: 1 }] });
    expect(await onHand("pkg-700-ml-container")).toBe("475");
    const tr = await traceBatch(db, batchId);
    expect(tr!.jarsBySize.find((j) => j.productId === big)).toMatchObject({ filled: 25, rejected: 1, accepted: 24 });
    expect(tr!.jarLots[0]!.balance.toString()).toBe("24");
    expect(tr!.filledLitres.toString()).toBe("17.5");
  });

  it("closing works without measured output; the batch cost uses each lot's price", async () => {
    await closeBatch(db, { idempotencyKey: "close", batchId });
    const budget = await batchBudget(db, batchId);
    const onion = budget.ingredients.lines.find((l) => l.itemId === ids["ing-onions"])!;
    expect(onion.quantity.toString()).toBe("5");
    expect(onion.knownCost.toString()).toBe("10"); // 5 kg × €2 from the new lot
    // The opening count has no price and nothing else was ordered: unknown, not 0.
    expect(budget.ingredients.complete).toBe(false);
    expect(budget.packaging.lines.length).toBeGreaterThan(0);
    expect(budget.total.complete).toBe(false);
    // Closed: ingredients are locked.
    await expect(recordIngredients(db, { idempotencyKey: "late", batchId, lines: [{ itemId: ids["ing-garlic"]!, quantity: "1" }] })).rejects.toThrow(/closed/);
    expect((await observedYields(db)).get(ids["liberiaanse-kip"]!)!.avgFilledLitres.toString()).toBe("17.5");
  });

  it("deleting packaging is refused when its jars have left stock, and works on a closed batch otherwise", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const [session] = await db.select().from(t.packagingSessions).where(eq(t.packagingSessions.batchId, batchId));
    await recordOutflow(db, { idempotencyKey: "sample", type: "sample", destination: "Market", lines: [{ productId: big, jars: 20 }] });
    await expect(changePackaging(db, { idempotencyKey: "del-1", sessionId: session!.id, delete: true })).rejects.toThrow(/only has 4 left.*already left stock/);
    await expect(
      changePackaging(db, { idempotencyKey: "edit-2", sessionId: session!.id, packedOn: "2026-10-21", lines: [{ productId: big, filled: 10, rejected: 0 }] }),
    ).rejects.toThrow(/already left stock/);

    // A second session on the same (closed) batch can't be recorded, but an existing one can be deleted.
    await expect(recordPackaging(db, { idempotencyKey: "pack-2", batchId, packedOn: "2026-10-22", lines: [{ productId: big, filled: 1, rejected: 0 }] })).rejects.toThrow(/closed/);
    const lidsBefore = await onHand("pkg-large-lid");
    await changePackaging(db, { idempotencyKey: "edit-3", sessionId: session!.id, packedOn: "2026-10-21", lines: [{ productId: big, filled: 22, rejected: 0 }] });
    expect(await onHand("pkg-large-lid")).toBe(String(Number(lidsBefore) + 3));
    // 22 accepted, 20 out: 2 left. Now lower the jars back to 20 accepted and delete is still refused (20 out).
    await expect(changePackaging(db, { idempotencyKey: "del-2", sessionId: session!.id, delete: true, reason: "test" })).rejects.toThrow(/only has 2 left/);
  });

  it("a deleted session is kept but leaves the batch, and stock is back", async () => {
    // A fresh batch to delete a session from, with no jars out.
    const run = await createRun(db, { idempotencyKey: "run-2", plannedFor: "2026-10-27", targets: { [ids["Liberiaanse Kip 250 ml"]!]: 10 } });
    await confirmRun(db, run.id);
    const [b] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    const small = ids["Liberiaanse Kip 250 ml"]!;
    const before = await onHand("pkg-250-ml-container");
    const { session } = await recordPackaging(db, { idempotencyKey: "pack-3", batchId: b!.id, packedOn: "2026-10-27", lines: [{ productId: small, filled: 10, rejected: 1 }] });
    expect(await onHand("pkg-250-ml-container")).toBe(String(Number(before) - 10));
    await changePackaging(db, { idempotencyKey: "del-3", sessionId: session.id, delete: true, reason: "Recorded on the wrong batch" });
    expect(await onHand("pkg-250-ml-container")).toBe(before);
    const tr = await traceBatch(db, b!.id);
    expect(tr!.sessions).toHaveLength(0);
    expect(tr!.jarLots[0]!.balance.toString()).toBe("0");
    const [kept] = await db.select().from(t.packagingSessions).where(and(eq(t.packagingSessions.id, session.id)));
    expect(kept!.deletedAt).not.toBeNull();
    expect(kept!.deletedReason).toBe("Recorded on the wrong batch");
    await expect(changePackaging(db, { idempotencyKey: "del-4", sessionId: session.id, delete: true })).rejects.toThrow(/already been deleted/);
    // Nothing recorded any more, so it can still be marked as not made.
    await closeBatch(db, { idempotencyKey: "nm", batchId: b!.id, notMade: true, leftoverReason: "Moved to next week" });
  });
});
