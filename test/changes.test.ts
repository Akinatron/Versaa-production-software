import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { addSupplier, cancelRun, confirmRun, createPurchaseOrder, createRun, recordOpeningCount, recordReceipt, restoreRun } from "@/db/operations";
import { changePackaging, closeBatch, recordIngredients, recordIncident, recordPackaging, restoreBatch, setIncidentDeleted } from "@/db/production";
import { cancelSalesOrder, createSalesOrder, deliverSalesOrder, finishedAvailability, restoreSalesOrder, setOutflowDeleted, updateSalesOrder } from "@/db/sales";
import { correctReceipt, markOrderSent, setReceiptDeleted, updateDraftOrder, updateLot } from "@/db/purchasing";
import { recordWriteOff, setAdjustmentDeleted } from "@/db/adjustments";
import { changesFor, editedInfo, listChanges } from "@/db/changes";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

/*
 * The change history: every action is recorded with who, when, before and
 * after; it shows on every record it touched; deletes are marks that can be
 * restored, and stock follows.
 */
suite("change history, deleting and restoring", () => {
  let db: DB;
  const ids: Record<string, string> = {};
  let runId = "";
  let batchId = "";
  let receiptId = "";
  let onionLot = "";
  const onHand = async (code: string) => (await loadStockPositions(db))[ids[code]!]!.onHand!.toString();

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
    const supplier = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, { idempotencyKey: "po-1", supplierId: supplier.id, lines: [{ itemId: ids["ing-onions"]!, quantity: "30", unitPrice: "2" }] });
    await markOrderSent(db, po.id, { sentOn: "2026-10-17" });
    const [line] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const r = await recordReceipt(db, {
      idempotencyKey: "rcv-1",
      supplierId: supplier.id,
      receivedOn: "2026-10-18",
      deliveryRef: "ALB-77",
      lines: [{ itemId: ids["ing-onions"]!, quantity: "30", supplierBatch: "G-1", purchaseOrderLineId: line!.id }],
    });
    receiptId = r.receipt.id;
    onionLot = (await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, receiptId)))[0]!.lotId!;
  });
  afterAll(async () => db?.$client.end());

  it("a delivery can be corrected and deleted while unused, and restored; the order follows", async () => {
    await expect(correctReceipt(db, { idempotencyKey: "c0", receiptId, reason: "", receivedOn: "2026-10-18", lines: [] })).rejects.toThrow(/reason/);
    const [rl] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, receiptId));
    await correctReceipt(db, { idempotencyKey: "c1", receiptId, reason: "Scale was off", receivedOn: "2026-10-18", deliveryRef: "ALB-77", lines: [{ lineId: rl!.id, quantity: "25", bestBefore: "2026-12-01" }] });
    expect(await onHand("ing-onions")).toBe("25");
    const [po] = await db.select().from(t.purchaseOrders);
    expect(po!.status).toBe("partly_received");

    const onLot = await changesFor(db, { type: "lot", id: onionLot });
    const fix = onLot.find((c) => c.action === "update")!;
    expect(fix.reason).toBe("Scale was off");
    expect(fix.changes).toContainEqual({ label: "Onions accepted", before: "30 kg", after: "25 kg" });
    // The order's page shows it too.
    expect((await changesFor(db, { type: "purchase_order", id: po!.id })).some((c) => c.id === fix.id)).toBe(true);

    await setReceiptDeleted(db, { idempotencyKey: "d1", receiptId, deleted: true, reason: "Wrong supplier" });
    expect(await onHand("ing-onions")).toBe("0");
    expect((await db.select().from(t.purchaseOrders))[0]!.status).toBe("sent");
    await setReceiptDeleted(db, { idempotencyKey: "d2", receiptId, deleted: false, reason: "It was right after all" });
    expect(await onHand("ing-onions")).toBe("25");
    expect((await db.select().from(t.purchaseOrders))[0]!.status).toBe("partly_received");

    // With the invoice price, a sent order can be corrected.
    await updateDraftOrder(db, po!.id, { reason: "Invoice price", lines: [{ lineId: (await db.select().from(t.purchaseOrderLines))[0]!.id, quantity: "30", unitPrice: "1.8" }] });
    const poChanges = await changesFor(db, { type: "purchase_order", id: po!.id }, { own: true });
    expect(poChanges[0]!.changes).toContainEqual({ label: "Onions price", before: "2 €/kg", after: "1.8 €/kg" });
  });

  it("ingredient corrections show on the batch, its run and the lot", async () => {
    const run = await createRun(db, { idempotencyKey: "run-1", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 30 } });
    runId = run.id;
    await confirmRun(db, run.id);
    batchId = (await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id)))[0]!.id;
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
    await recordIngredients(db, { idempotencyKey: "rec-1", batchId, producedOn: "2026-10-20", lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.itemId === ids["ing-onions"] ? "5" : l.plannedQty })) });
    await expect(recordIngredients(db, { idempotencyKey: "rec-2", batchId, lines: [{ itemId: ids["ing-onions"]!, quantity: "6" }] })).rejects.toThrow(/reason/);
    await recordIngredients(db, { idempotencyKey: "rec-2", batchId, reason: "Weighed again", lines: [{ itemId: ids["ing-onions"]!, quantity: "6" }] });

    const onRun = await changesFor(db, { type: "run", id: runId });
    const corrected = onRun.find((c) => c.summary.includes("corrected"))!;
    expect(corrected.entityType).toBe("batch");
    expect(corrected.changes[0]!.label).toBe("Onions");
    expect(corrected.changes[0]!.before).toMatch(/^5 kg/);
    expect(corrected.changes[0]!.after).toMatch(/^6 kg/);
    // "Only this run" leaves the batch's own changes out.
    expect((await changesFor(db, { type: "run", id: runId }, { own: true })).some((c) => c.id === corrected.id)).toBe(false);
    expect((await changesFor(db, { type: "lot", id: onionLot })).some((c) => c.id === corrected.id)).toBe(true);
    // The correction's movement points back at the history.
    const moves = await db.select().from(t.movements).where(eq(t.movements.changeId, corrected.id));
    expect(moves.map((m) => m.quantity)).toEqual(["-1"]);
    expect((await editedInfo(db, "batch", [batchId])).get(batchId)?.count).toBe(1);
  });

  it("a deleted packaging session can be restored with its figures; incidents too", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const { session } = await recordPackaging(db, { idempotencyKey: "pack-1", batchId, packedOn: "2026-10-21", lines: [{ productId: big, filled: 30, rejected: 2 }] });
    await changePackaging(db, { idempotencyKey: "del", sessionId: session.id, delete: true, reason: "Wrong batch" });
    expect((await finishedAvailability(db)).find((a) => a.productId === big)!.onHand.toString()).toBe("0");
    await changePackaging(db, { idempotencyKey: "res", sessionId: session.id, restore: true, reason: "It was this batch" });
    expect((await finishedAvailability(db)).find((a) => a.productId === big)!.onHand.toString()).toBe("28");
    const [s] = await db.select().from(t.packagingSessions).where(eq(t.packagingSessions.id, session.id));
    expect(s!.deletedAt).toBeNull();
    const actions = (await changesFor(db, { type: "packaging_session", id: session.id })).map((c) => c.action);
    expect(actions).toEqual(["restore", "delete", "create"]);

    const inc = await recordIncident(db, { batchId, type: "spill", note: "2 jars dropped" });
    await setIncidentDeleted(db, { incidentId: inc.id, deleted: true, reason: "Double entry" });
    await setIncidentDeleted(db, { incidentId: inc.id, deleted: false, reason: "Not a double" });
    expect((await changesFor(db, { type: "batch", id: batchId })).filter((c) => c.entityType === "incident")).toHaveLength(3);
  });

  it("a delivered sale can be deleted (jars back, order to deliver again) and restored", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const { order } = await createSalesOrder(db, { idempotencyKey: "so-1", destination: "Shop", lines: [{ productId: big, jars: 10 }] });
    await updateSalesOrder(db, { salesOrderId: order.id, reason: "Customer wants more", destination: "Shop", orderedOn: order.orderedOn, lines: [{ productId: big, jars: 12 }] });
    const { outflow } = await deliverSalesOrder(db, { idempotencyKey: "deliver-1", salesOrderId: order.id });
    const avail = async () => (await finishedAvailability(db)).find((a) => a.productId === big)!;
    expect((await avail()).onHand.toString()).toBe("16");

    await setOutflowDeleted(db, { idempotencyKey: "od-1", outflowId: outflow.id, deleted: true, reason: "Never left" });
    expect((await avail()).onHand.toString()).toBe("28");
    expect((await avail()).reserved.toString()).toBe("12");
    expect((await db.select().from(t.salesOrders))[0]!.status).toBe("pending");

    await setOutflowDeleted(db, { idempotencyKey: "od-2", outflowId: outflow.id, deleted: false, reason: "It did leave" });
    expect((await avail()).onHand.toString()).toBe("16");
    expect((await avail()).reserved.toString()).toBe("0");
    expect((await db.select().from(t.salesOrders))[0]!.status).toBe("delivered");
    await expect(cancelSalesOrder(db, order.id, "x")).rejects.toThrow(/delivered/);

    const { order: o2 } = await createSalesOrder(db, { idempotencyKey: "so-2", destination: "Shop", lines: [{ productId: big, jars: 1 }] });
    await cancelSalesOrder(db, o2.id, "Changed their mind");
    await restoreSalesOrder(db, o2.id, "Back on");
    expect((await avail()).reserved.toString()).toBe("1");
  });

  it("a write-off can be undone and redone; a lot's best-before correction is kept", async () => {
    await recordWriteOff(db, { idempotencyKey: "wo-1", type: "waste", reason: "Mould", lines: [{ lotId: onionLot, quantity: "2" }] });
    const before = await onHand("ing-onions");
    const [adj] = await db.select().from(t.stockAdjustments);
    await setAdjustmentDeleted(db, { idempotencyKey: "ad-1", adjustmentId: adj!.id, deleted: true, reason: "Not mouldy" });
    expect(Number(await onHand("ing-onions"))).toBe(Number(before) + 2);
    await setAdjustmentDeleted(db, { idempotencyKey: "ad-2", adjustmentId: adj!.id, deleted: false, reason: "It was" });
    expect(await onHand("ing-onions")).toBe(before);

    await updateLot(db, { lotId: onionLot, reason: "Label read wrong", bestBefore: "2026-11-30" });
    const lotChange = (await changesFor(db, { type: "lot", id: onionLot }, { own: true }))[0]!;
    expect(lotChange.changes).toContainEqual({ label: "Best-before", before: "2026-12-01", after: "2026-11-30" });
  });

  it("a batch marked as not made can come back; a discarded draft run too", async () => {
    const run = await createRun(db, { idempotencyKey: "run-2", plannedFor: "2026-10-25", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 60 } });
    await confirmRun(db, run.id);
    const [b1] = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    await closeBatch(db, { idempotencyKey: "nm", batchId: b1!.id, notMade: true, leftoverReason: "No time" });
    await restoreBatch(db, { batchId: b1!.id, reason: "We made it after all" });
    expect((await db.select().from(t.productionBatches).where(eq(t.productionBatches.id, b1!.id)))[0]!.status).toBe("planned");

    const draft = await createRun(db, { idempotencyKey: "run-3", plannedFor: "2026-10-30", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 10 } });
    await cancelRun(db, draft.id);
    await restoreRun(db, draft.id, "Still want it");
    expect((await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, draft.id)))[0]!.status).toBe("draft");
    await cancelRun(db, run.id, "Too much");
    await expect(restoreRun(db, run.id, "x")).rejects.toThrow(/Plan it again/);
  });

  it("the History page filters by area and code", async () => {
    const packaging = await listChanges(db, { area: "packaging" });
    expect(packaging.length).toBeGreaterThan(0);
    expect(packaging.every((c) => c.area === "packaging")).toBe(true);
    expect((await listChanges(db, { code: "ALB-77" })).length).toBeGreaterThan(0);
  });

  it("history rows can't be changed or deleted", async () => {
    const [row] = await listChanges(db, { limit: 1 });
    await expect(db.update(t.changeLog).set({ summary: "x" }).where(eq(t.changeLog.id, row!.id))).rejects.toThrow();
  });
});
