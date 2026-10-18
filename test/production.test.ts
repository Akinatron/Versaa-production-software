import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanCatalog, loadStockPositions } from "@/db/planning";
import { addSupplier, confirmRun, createRun, recordOpeningCount, recordReceipt } from "@/db/operations";
import { closeBatch, recordBatchOutput, recordConsumption, recordIncident, recordPackaging, undoConsumption } from "@/db/production";
import { addCustomer, cancelSalesOrder, createSalesOrder, deliverSalesOrder, finishedAvailability, recordOutflow } from "@/db/sales";
import { recordStockCount, recordWriteOff } from "@/db/adjustments";
import { traceBatch, traceForward, traceOutflow, findByCode } from "@/db/trace";
import { observedRejects, observedYields } from "@/db/history";
import { activateRecipeDraft, saveRecipeDraft, startRecipeDraft, addItem, setItemActive, addProduct, addFormat } from "@/db/catalog";
import { planProduction, targetsFromBatches } from "@/domain/planner";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

suite("production, packaging, sales and traceability", () => {
  let db: DB;
  const ids: Record<string, string> = {};
  let runId = "";
  let batchId = "";
  let onionDelivery = "";

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });

    // Stock: count everything Liberiaanse Kip needs generously, then a traceable onion delivery.
    const kip = (await loadPlanCatalog(db)).sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
    const pkg = (await loadPlanCatalog(db)).products.filter((p) => p.sauceId === kip.id).flatMap((p) => p.packaging.map((x) => x.itemId));
    const lines = [
      ...kip.recipe!.lines.filter((l) => l.itemId !== ids["ing-onions"]).map((l) => ({ itemId: l.itemId, quantity: "100" })),
      ...[...new Set(pkg)].map((itemId) => ({ itemId, quantity: "500" })),
      { itemId: ids["ing-onions"]!, quantity: "2" },
    ];
    await recordOpeningCount(db, { idempotencyKey: "open", countedOn: "2026-10-17", lines });
    const supplier = await addSupplier(db, { name: "Groente BV" });
    const r = await recordReceipt(db, {
      idempotencyKey: "rcv-onions",
      supplierId: supplier.id,
      receivedOn: "2026-10-18",
      deliveryRef: "DN-1",
      lines: [{ itemId: ids["ing-onions"]!, quantity: "20", supplierBatch: "ON-42", bestBefore: "2026-11-30" }],
    });
    const [lot] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r.receipt.id));
    onionDelivery = lot!.lotId;
  });
  afterAll(async () => db?.$client.end());

  it("confirming a run creates its batches, each pinned to the recipe version", async () => {
    const run = await createRun(db, { idempotencyKey: "run-k1", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 30 } });
    runId = run.id;
    await confirmRun(db, run.id);
    const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id));
    expect(batches.map((b) => b.code)).toEqual(["KIP-20261020-01"]);
    batchId = batches[0]!.id;
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => l.confirmedAt === null)).toBe(true);
    const onion = lines.find((l) => l.itemId === ids["ing-onions"])!;
    expect(onion.standardQty).toBe("7");
  });

  it("recording ingredients takes them from lots (earliest best-before first) and shrinks the reservation", async () => {
    const before = (await loadStockPositions(db))[ids["ing-onions"]!]!;
    expect(before.reservedEarlier.toString()).toBe("7");

    await recordConsumption(db, { idempotencyKey: "use-onion", batchId, itemId: ids["ing-onions"]!, quantity: "7.5", occurredOn: "2026-10-20" });
    // Retry with the same key does nothing.
    expect((await recordConsumption(db, { idempotencyKey: "use-onion", batchId, itemId: ids["ing-onions"]!, quantity: "7.5" })).alreadyRecorded).toBe(true);

    const after = (await loadStockPositions(db))[ids["ing-onions"]!]!;
    expect(after.onHand!.toString()).toBe("14.5");
    expect(after.reservedEarlier.toString()).toBe("0");

    // The delivery has a best-before, the opening lot doesn't, so the delivery is used first.
    const trace = await traceBatch(db, batchId);
    const onion = trace!.ingredientUse.find((u) => u.itemId === ids["ing-onions"])!;
    expect(onion.actual!.toString()).toBe("7.5");
    expect(onion.sources.map((s) => s.lot.supplierBatch)).toEqual(["ON-42"]);

    const [run] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    expect(run!.status).toBe("in_progress");
  });

  it("can't use more than is in stock, and undo puts stock back", async () => {
    await expect(
      recordConsumption(db, { idempotencyKey: "use-garlic-too-much", batchId, itemId: ids["ing-garlic"]!, quantity: "500" }),
    ).rejects.toThrow(/Not enough Garlic/);
    await recordConsumption(db, { idempotencyKey: "use-garlic", batchId, itemId: ids["ing-garlic"]!, quantity: "1" });
    await undoConsumption(db, { idempotencyKey: "undo-garlic", batchId, itemId: ids["ing-garlic"]!, reason: "Typed the wrong amount" });
    expect((await loadStockPositions(db))[ids["ing-garlic"]!]!.onHand!.toString()).toBe("100");
    const [line] = await db.select().from(t.batchConsumption).where(and(eq(t.batchConsumption.batchId, batchId), eq(t.batchConsumption.itemId, ids["ing-garlic"]!)));
    expect(line!.confirmedAt).toBeNull();
  });

  it("a confirmed zero is different from pending, and a batch can't close with pending lines", async () => {
    await expect(closeBatch(db, { idempotencyKey: "close-early", batchId })).rejects.toThrow(/Still pending/);
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
    for (const l of lines.filter((x) => x.confirmedAt === null)) {
      await recordConsumption(db, { idempotencyKey: `use-${l.itemId}`, batchId, itemId: l.itemId, quantity: l.itemId === ids["ing-garlic"] ? "0" : l.standardQty });
    }
    const trace = await traceBatch(db, batchId);
    const garlic = trace!.ingredientUse.find((u) => u.itemId === ids["ing-garlic"])!;
    expect(garlic.actual!.toString()).toBe("0");
    expect(garlic.sources).toHaveLength(0);
  });

  it("output becomes a bulk lot; packaging uses materials for every filled jar but only stocks accepted ones", async () => {
    await recordBatchOutput(db, { idempotencyKey: "out-1", batchId, producedOn: "2026-10-20", litres: "28", kg: "29.4" });
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const small = ids["Liberiaanse Kip 250 ml"]!;

    await expect(
      recordPackaging(db, { idempotencyKey: "pack-bad", batchId, packedOn: "2026-10-21", lines: [{ productId: big, filled: 5, rejected: 6 }] }),
    ).rejects.toThrow(/can't be more than/);

    await recordPackaging(db, {
      idempotencyKey: "pack-1",
      batchId,
      packedOn: "2026-10-21",
      bestBefore: "2027-01-21",
      lines: [
        { productId: big, filled: 30, rejected: 2 },
        { productId: small, filled: 20, rejected: 0 },
      ],
    });
    // Same submission twice: recorded once.
    await recordPackaging(db, { idempotencyKey: "pack-1", batchId, packedOn: "2026-10-21", lines: [{ productId: big, filled: 30, rejected: 2 }] });

    const avail = await finishedAvailability(db);
    expect(avail.find((a) => a.productId === big)!.onHand.toString()).toBe("28");
    expect(avail.find((a) => a.productId === small)!.onHand.toString()).toBe("20");

    // 30 + 20 filled jars used their materials; the large lid only for the 700 ml.
    const stock = await loadStockPositions(db);
    expect(stock[ids["pkg-large-lid"]!]!.onHand!.toString()).toBe("470");
    expect(stock[ids["pkg-700-ml-container"]!]!.onHand!.toString()).toBe("470");
    expect(stock[ids["pkg-250-ml-container"]!]!.onHand!.toString()).toBe("480");

    // Bulk: 28 L − (30 × 0.7 + 20 × 0.25) = 2 L left.
    const trace = await traceBatch(db, batchId);
    expect(trace!.bulk!.balance.toString()).toBe("2");
    expect(trace!.filledLitres.toString()).toBe("26");
    expect(trace!.jarsBySize.find((j) => j.productId === big)).toMatchObject({ filled: 30, rejected: 2, accepted: 28 });

    // Can't pack more than the bulk sauce left.
    await expect(
      recordPackaging(db, { idempotencyKey: "pack-2", batchId, packedOn: "2026-10-21", lines: [{ productId: big, filled: 5, rejected: 0 }] }),
    ).rejects.toThrow(/only 2 L/);
  });

  it("closing a batch needs a reason for leftover sauce, then closes the run and releases what's left reserved", async () => {
    await recordIncident(db, { batchId, type: "spill", note: "Dropped a tray of lids", occurredOn: "2026-10-21" });
    await expect(closeBatch(db, { idempotencyKey: "close-1", batchId })).rejects.toThrow(/2 L of bulk sauce is left/);
    const r = await closeBatch(db, { idempotencyKey: "close-1", batchId, leftoverReason: "Staff tasting and cleaning loss" });
    expect(r.runClosed).toBe(true);
    const [run] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.id, runId));
    expect(run!.status).toBe("closed");
    const open = await db.select().from(t.reservations).where(and(eq(t.reservations.runId, runId), sql`released_at is null`));
    expect(open).toHaveLength(0);
    await expect(recordConsumption(db, { idempotencyKey: "late", batchId, itemId: ids["ing-garlic"]!, quantity: "1" })).rejects.toThrow(/closed/);
  });

  it("history: closed batches give an observed yield and reject rate that the planner then uses", async () => {
    const y = (await observedYields(db)).get(ids["liberiaanse-kip"]!)!;
    expect(y.batches).toBe(1);
    expect(y.avgFilledLitres.toString()).toBe("26");
    expect(y.avgSellableLitres.toString()).toBe("24.6");
    const rj = (await observedRejects(db)).get(ids["Liberiaanse Kip 700 ml"]!)!;
    expect(rj.rate.toString()).toBe("0.0667");

    const catalog = await loadPlanCatalog(db);
    const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
    expect(kip.yield.source).toBe("observed");
    expect(kip.yield.litresPerBatch!.toString()).toBe("26");
  });

  it("a sales order reserves jars; delivering takes them out once, from the batch lot", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const shop = await addCustomer(db, { name: "Delicatessen De Kaai" });
    const { order } = await createSalesOrder(db, { idempotencyKey: "so-1", customerId: shop.id, orderedOn: "2026-10-22", lines: [{ productId: big, jars: 20, unitPrice: "6.50" }] });
    let a = (await finishedAvailability(db)).find((x) => x.productId === big)!;
    expect(a.onHand.toString()).toBe("28");
    expect(a.available.toString()).toBe("8");

    // Only 8 free for anyone else.
    await expect(
      recordOutflow(db, { idempotencyKey: "sample-too-many", type: "sample", destination: "Market", lines: [{ productId: big, jars: 9 }] }),
    ).rejects.toThrow(/8 available/);
    await recordOutflow(db, { idempotencyKey: "sample-1", type: "sample", destination: "Market tasting", occurredOn: "2026-10-22", lines: [{ productId: big, jars: 2 }] });

    const { outflow } = await deliverSalesOrder(db, { idempotencyKey: "deliver-1", salesOrderId: order.id, deliveredOn: "2026-10-23" });
    await deliverSalesOrder(db, { idempotencyKey: "deliver-1", salesOrderId: order.id });
    a = (await finishedAvailability(db)).find((x) => x.productId === big)!;
    expect(a.onHand.toString()).toBe("6");
    expect(a.reserved.toString()).toBe("0");

    const back = await traceOutflow(db, outflow.id);
    expect(back!.lines.map((l) => l.batchCode)).toEqual(["KIP-20261020-01"]);
    expect(back!.customer).toBe("Delicatessen De Kaai");
    await expect(cancelSalesOrder(db, order.id)).rejects.toThrow(/delivered/);
  });

  it("forward trace: from the onion delivery to the batch, jars in stock and where jars went", async () => {
    const f = await traceForward(db, onionDelivery);
    expect(f!.batches.map((b) => b.code)).toEqual(["KIP-20261020-01"]);
    expect(f!.batches[0]!.quantity.toString()).toBe("7.5");
    expect(f!.jarsInStock.toString()).toBe("26"); // 6 large + 20 small
    expect(f!.destinations.map((d) => [d.type, d.jars])).toEqual(
      expect.arrayContaining([
        ["sample", 2],
        ["sale", 20],
      ]),
    );
    expect((await findByCode(db, "kip-20261020-01"))?.kind).toBe("batch");
  });

  it("outbound: own use, tests, gifts and waste take jars out by reason, stay traceable and aren't sales", async () => {
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const before = (await finishedAvailability(db)).find((x) => x.productId === big)!.onHand;
    const { outflow } = await recordOutflow(db, { idempotencyKey: "test-1", type: "test", note: "Shelf-life check", occurredOn: "2026-10-24", lines: [{ productId: big, jars: 1 }] });
    await recordOutflow(db, { idempotencyKey: "test-1", type: "test", occurredOn: "2026-10-24", lines: [{ productId: big, jars: 1 }] });
    await recordOutflow(db, { idempotencyKey: "own-1", type: "internal_use", occurredOn: "2026-10-24", lines: [{ productId: big, jars: 1 }] });
    await expect(recordOutflow(db, { idempotencyKey: "waste-0", type: "waste", lines: [{ productId: big, jars: 1 }] })).rejects.toThrow(/why/);
    expect(outflow.code).toBe("TST-20261024-001");

    const after = (await finishedAvailability(db)).find((x) => x.productId === big)!.onHand;
    expect(before.minus(after).toString()).toBe("2");
    const moves = await db.select().from(t.movements).where(and(eq(t.movements.docType, "outflow"), eq(t.movements.docId, outflow.id)));
    expect(moves.map((m) => [m.type, m.quantity])).toEqual([["test", "-1"]]);

    const back = await traceOutflow(db, outflow.id);
    expect(back!.lines.map((l) => l.batchCode)).toEqual(["KIP-20261020-01"]);
    const sold = await db.execute<{ jars: number }>(sql`select coalesce(sum(ol.jars), 0)::int as jars from outflow_lines ol join outflows o on o.id = ol.outflow_id where o.type = 'sale'`);
    expect(sold[0]!.jars).toBe(20);
  });

  it("stock counts and write-offs post corrections with a reason, never edit the number", async () => {
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.code, "OPEN-20261017-001"));
    const before = new Decimal((await db.execute<{ q: string }>(sql`select sum(quantity) as q from movements where lot_id = ${lot!.id}`))[0]!.q);
    await expect(recordStockCount(db, { idempotencyKey: "cnt-0", reason: " ", lines: [{ lotId: lot!.id, counted: "1" }] })).rejects.toThrow(/why/);
    await recordStockCount(db, { idempotencyKey: "cnt-1", reason: "Monthly count", countedOn: "2026-10-31", lines: [{ lotId: lot!.id, counted: before.minus(1).toString() }] });
    await recordStockCount(db, { idempotencyKey: "cnt-1", reason: "Monthly count", lines: [{ lotId: lot!.id, counted: "0" }] });
    const moves = await db.select().from(t.movements).where(and(eq(t.movements.lotId, lot!.id), eq(t.movements.type, "count_correction")));
    expect(moves.map((m) => m.quantity)).toEqual(["-1"]);

    const [lid] = await db.select().from(t.lots).where(sql`item_id = ${ids["pkg-large-lid"]!}`);
    await recordWriteOff(db, { idempotencyKey: "wo-1", type: "waste", reason: "Dented lids", lines: [{ lotId: lid!.id, quantity: "3" }] });
    expect((await loadStockPositions(db))[ids["pkg-large-lid"]!]!.onHand!.toString()).toBe("467");
    await expect(recordWriteOff(db, { idempotencyKey: "wo-2", type: "waste", reason: "x", lines: [{ lotId: lid!.id, quantity: "9999" }] })).rejects.toThrow(/only has/);
  });

  it("a recipe change is a new version: old batches keep the version they used", async () => {
    const draft = await startRecipeDraft(db, ids["liberiaanse-kip"]!);
    expect(draft.versionNo).toBe(2);
    const lines = await db.select().from(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, draft.id));
    await expect(
      saveRecipeDraft(db, { versionId: draft.id, batchReferenceKg: "30", lines: [{ itemId: ids["ing-onions"]!, quantity: "8", unit: "L" }] }),
    ).rejects.toThrow(/stocked in kg/);
    await saveRecipeDraft(db, {
      versionId: draft.id,
      batchReferenceKg: "30",
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.itemId === ids["ing-onions"] ? "8" : l.quantity, unit: l.unit })),
    });
    await activateRecipeDraft(db, draft.id);

    const versions = await db.select().from(t.recipeVersions).where(eq(t.recipeVersions.sauceId, ids["liberiaanse-kip"]!));
    expect(versions.map((v) => [v.versionNo, v.status]).sort()).toEqual([
      [1, "retired"],
      [2, "active"],
    ]);
    const old = await traceBatch(db, batchId);
    expect(old!.recipe.versionNo).toBe(1);
    expect(old!.ingredientUse.find((u) => u.itemId === ids["ing-onions"])!.standard.toString()).toBe("7");
    await expect(saveRecipeDraft(db, { versionId: versions.find((v) => v.versionNo === 1)!.id, batchReferenceKg: "30", lines: [] })).rejects.toThrow(/Only a draft/);
  });

  it("catalog items are retired, not deleted, and not while a recipe uses them", async () => {
    await expect(setItemActive(db, ids["ing-onions"]!, false)).rejects.toThrow(/Still used/);
    const thyme = await addItem(db, { kind: "ingredient", name: "Thyme", stockUnit: "kg" });
    await setItemActive(db, thyme.id, false);
    const f = await addFormat(db, { name: "Mini 100 ml", capacityMl: 100 });
    const p = await addProduct(db, { sauceId: ids["liberiaanse-kip"]!, formatId: f.id });
    const plan = planProduction({ ...(await loadPlanCatalog(db)), stock: {}, targets: { [p.id]: 10 } });
    expect(plan.issues.some((i) => i.level === "blocker" && /no packaging list/.test(i.message))).toBe(true);
  });

  it("planning by batches and size split gives jar targets for the same planner", async () => {
    const catalog = await loadPlanCatalog(db);
    const kip = catalog.sauces.find((s) => s.id === ids["liberiaanse-kip"])!; // 26 L observed
    const big = ids["Liberiaanse Kip 700 ml"]!;
    const mid = ids["Liberiaanse Kip 500 ml"]!;
    const { targets, issues } = targetsFromBatches(catalog, { [kip.id]: { batches: 2, split: { [big]: 50, [mid]: 50 } } });
    expect(issues).toEqual([]);
    // 52 L: 26 L → 37 large jars filled (6.67% rejects → 34 sellable); 26 L → 52 medium (no reject data → 52).
    expect(targets[big]).toBe(34);
    expect(targets[mid]).toBe(52);
    const bad = targetsFromBatches(catalog, { [kip.id]: { batches: 1, split: { [big]: 60 } } });
    expect(bad.issues[0]!.message).toMatch(/60%/);
  });

  it("an undone extra ingredient goes away, a not-made batch frees its reservation, incidents record once", async () => {
    await db.insert(t.yieldFigures).values({ sauceId: ids["italiaanse-bolognese"]!, litresPerBatch: "30", source: "estimate" });
    const run = await createRun(db, { idempotencyKey: "run-b2", plannedFor: "2026-10-27", targets: { [ids["Italiaanse Bolognese 700 ml"]!]: 50 } });
    await confirmRun(db, run.id);
    const batches = await db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, run.id)).orderBy(t.productionBatches.code);
    expect(batches).toHaveLength(2);
    const [b1, b2] = batches;
    const onionsReserved = async () => (await loadStockPositions(db))[ids["ing-onions"]!]!.reservedEarlier.toString();
    const before = await onionsReserved();

    const bayLeaf = await addItem(db, { kind: "ingredient", name: "Bay leaves", stockUnit: "g" });
    await recordConsumption(db, { idempotencyKey: "extra-bay", batchId: b1!.id, itemId: bayLeaf.id, quantity: "0" });
    const [extra] = await db.select().from(t.batchConsumption).where(and(eq(t.batchConsumption.batchId, b1!.id), eq(t.batchConsumption.extra, true)));
    expect(extra!.itemId).toBe(bayLeaf.id);
    await undoConsumption(db, { idempotencyKey: "undo-extra", batchId: b1!.id, itemId: bayLeaf.id, reason: "Wrong batch" });
    expect(await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.id, extra!.id))).toHaveLength(0);

    const bolOnion = (await db.select().from(t.batchConsumption).where(and(eq(t.batchConsumption.batchId, b2!.id), eq(t.batchConsumption.itemId, ids["ing-onions"]!))))[0];
    await closeBatch(db, { idempotencyKey: "nm-1", batchId: b2!.id, notMade: true, leftoverReason: "Ran out of time" });
    expect(new Decimal(await onionsReserved()).toString()).toBe(new Decimal(before).minus(bolOnion!.plannedQty).toString());

    const i1 = await recordIncident(db, { idempotencyKey: "inc-1", batchId: b1!.id, type: "quality", note: "Too salty" });
    const i2 = await recordIncident(db, { idempotencyKey: "inc-1", batchId: b1!.id, type: "quality", note: "Too salty" });
    expect(i2.id).toBe(i1.id);
  });
});
