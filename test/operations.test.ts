import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadPlanInput, loadStockPositions } from "@/db/planning";
import {
  addSupplier,
  cancelRun,
  confirmRun,
  createPurchaseOrder,
  createRun,
  markOrderSent,
  planForRun,
  recordOpeningCount,
  recordReceipt,
} from "@/db/operations";
import { freshDb, testDbUrl } from "./helpers";

const suite = testDbUrl ? describe : describe.skip;

suite("recording operations", () => {
  let db: DB;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
  });
  afterAll(async () => db?.$client.end());

  const onHand = async (code: string) => (await loadStockPositions(db))[ids[code]!]?.onHand?.toString() ?? null;

  it("opening count: creates a lot per line, records a confirmed zero, and can't be repeated", async () => {
    const r = await recordOpeningCount(db, {
      idempotencyKey: "open-1",
      countedOn: "2026-10-17",
      lines: [
        { itemId: ids["ing-onions"]!, quantity: "12.5", bestBefore: "2026-11-01" },
        { itemId: ids["pkg-700-ml-container"]!, quantity: "0" },
        { itemId: ids["pkg-large-lid"]!, quantity: "" }, // left blank = not counted
      ],
    });
    expect(r.created).toBe(2);
    expect(await onHand("ing-onions")).toBe("12.5");
    expect(await onHand("pkg-700-ml-container")).toBe("0");
    expect(await onHand("pkg-large-lid")).toBeNull();

    const again = await recordOpeningCount(db, { idempotencyKey: "open-1", lines: [{ itemId: ids["ing-onions"]!, quantity: "12.5" }] });
    expect(again.alreadyRecorded).toBe(true);
    expect(await onHand("ing-onions")).toBe("12.5");

    await expect(
      recordOpeningCount(db, { idempotencyKey: "open-2", lines: [{ itemId: ids["ing-onions"]!, quantity: "1" }] }),
    ).rejects.toThrow(/Already counted/);
  });

  it("rejects fractional jars, lids and labels", async () => {
    await expect(
      recordOpeningCount(db, { idempotencyKey: "open-3", lines: [{ itemId: ids["pkg-small-lid"]!, quantity: "2.5" }] }),
    ).rejects.toThrow(/whole units/);
  });

  it("an order shows as on order but doesn't add stock; deliveries do, partial ones too", async () => {
    const supplier = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, {
      idempotencyKey: "po-key-0001",
      supplierId: supplier.id,
      lines: [
        { itemId: ids["ing-onions"]!, quantity: "20" },
        { itemId: ids["ing-garlic"]!, quantity: "2" },
      ],
    });
    expect(await onHand("ing-onions")).toBe("12.5");
    // A new order is a draft: prepared, not sent, so not "on order" yet.
    expect(po.status).toBe("draft");
    expect(po.orderedOn).toBeNull();
    let stock = await loadStockPositions(db);
    expect(stock[ids["ing-onions"]!]?.onOrder.toString() ?? "0").toBe("0");
    const sent = await markOrderSent(db, po.id, { sentOn: "2026-10-17" });
    expect(sent.po.status).toBe("sent");
    expect(sent.po.orderedOn).toBe("2026-10-17");
    stock = await loadStockPositions(db);
    expect(stock[ids["ing-onions"]!]!.onOrder.toString()).toBe("20");

    const [onionLine, garlicLine] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id)).orderBy(t.purchaseOrderLines.itemId);
    const lineFor = (itemId: string) => [onionLine, garlicLine].find((l) => l!.itemId === itemId)!;

    await recordReceipt(db, {
      idempotencyKey: "rcv-1",
      supplierId: supplier.id,
      receivedOn: "2026-10-18",
      deliveryRef: "DN-551",
      lines: [{ itemId: ids["ing-onions"]!, quantity: "15", purchaseOrderLineId: lineFor(ids["ing-onions"]!).id, supplierBatch: "ON-77", bestBefore: "2026-11-15" }],
    });
    expect(await onHand("ing-onions")).toBe("27.5");
    stock = await loadStockPositions(db);
    expect(stock[ids["ing-onions"]!]!.onOrder.toString()).toBe("5");
    const [order] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, po.id));
    expect(order!.status).toBe("partly_received");

    // Same delivery submitted twice: recorded once.
    const dup = await recordReceipt(db, {
      idempotencyKey: "rcv-1",
      receivedOn: "2026-10-18",
      lines: [{ itemId: ids["ing-onions"]!, quantity: "15" }],
    });
    expect(dup.alreadyRecorded).toBe(true);
    expect(await onHand("ing-onions")).toBe("27.5");

    // The delivery keeps its origin on its own lot.
    const lots = await db.select().from(t.lots).where(eq(t.lots.itemId, ids["ing-onions"]!));
    expect(lots).toHaveLength(2);
    const delivered = lots.find((l) => l.deliveryRef === "DN-551")!;
    expect(delivered.supplierBatch).toBe("ON-77");
    expect(delivered.bestBefore).toBe("2026-11-15");

    await recordReceipt(db, {
      idempotencyKey: "rcv-2",
      receivedOn: "2026-10-19",
      lines: [
        { itemId: ids["ing-onions"]!, quantity: "5", purchaseOrderLineId: lineFor(ids["ing-onions"]!).id },
        { itemId: ids["ing-garlic"]!, quantity: "2", purchaseOrderLineId: lineFor(ids["ing-garlic"]!).id },
      ],
    });
    const [done] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, po.id));
    expect(done!.status).toBe("received");
  });

  it("confirming a run needs a yield figure, then freezes the forecast and reserves stock", async () => {
    const run = await createRun(db, { idempotencyKey: "run-aaaa", plannedFor: "2026-10-24", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 10 } });
    await expect(confirmRun(db, run.id)).rejects.toThrow(/litres-per-batch/);

    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "26", source: "estimate" });
    const ok = await confirmRun(db, run.id);
    expect(ok.run.status).toBe("confirmed");
    expect((await confirmRun(db, run.id)).alreadyConfirmed).toBe(true);

    // 1 batch of Liberiaanse Kip needs 7 kg onions: reserved, stock unchanged.
    const stock = await loadStockPositions(db);
    expect(stock[ids["ing-onions"]!]!.reservedEarlier.toString()).toBe("7");
    expect(await onHand("ing-onions")).toBe("32.5");

    // The frozen forecast can't be edited.
    await expect(db.execute(sql`update forecast_snapshots set data = '{}'`)).rejects.toThrow();
  });

  it("a second run is not offered stock the first run reserved", async () => {
    const run2 = await createRun(db, { idempotencyKey: "run-bbbb", plannedFor: "2026-10-25", targets: { [ids["Liberiaanse Kip 250 ml"]!]: 10 } });
    const plan = await planForRun(db, run2.id);
    const onions = plan.requirements.find((r) => r.name === "Onions")!;
    expect(onions.onHand!.toString()).toBe("32.5");
    expect(onions.reservedEarlier.toString()).toBe("7");
    expect(onions.available!.toString()).toBe("25.5");

    // The first run, looking at itself, still sees its own stock as available.
    const [first] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.code, "RUN-20261024-RUN-"));
    const own = await planForRun(db, first!.id);
    expect(own.requirements.find((r) => r.name === "Onions")!.reservedEarlier.toString()).toBe("0");
  });

  it("cancelling a run releases its reservations", async () => {
    const runs = await db.select().from(t.productionRuns).where(eq(t.productionRuns.status, "confirmed"));
    await cancelRun(db, runs[0]!.id, "Not needed");
    const stock = await loadStockPositions(db);
    expect(stock[ids["ing-onions"]!]!.reservedEarlier.toString()).toBe("0");
    const input = await loadPlanInput(db, {});
    expect(input.stock[ids["ing-onions"]!]!.onHand!.toString()).toBe("32.5");
  });
});
