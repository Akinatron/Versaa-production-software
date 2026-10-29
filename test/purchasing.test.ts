import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { loadStockPositions } from "@/db/planning";
import { addSupplier, createRun, planForRun, recordOpeningCount } from "@/db/operations";
import {
  closePurchaseOrder,
  createOrdersFromPlan,
  createPurchaseOrder,
  loadOrders,
  markOrderSent,
  orderPlan,
  planBudget,
  recordReceipt,
  updateDraftOrder,
} from "@/db/purchasing";
import { linkSupplierItem, loadOffers, lotUnitCosts, moveSupplierRank, priceHistory, setOffer, unlinkSupplierItem } from "@/db/suppliers";
import { buildBudget, roundToPacks, unitPrice } from "@/domain/pricing";
import { freshDb, testDbUrl } from "./helpers";

describe("pack rounding and budgets (no database)", () => {
  const sack = { packQty: new Decimal(25), price: new Decimal(12) };
  it("rounds up to whole packs", () => {
    expect(roundToPacks(18, sack)).toMatchObject({ packs: 1 });
    expect(roundToPacks(18, sack).quantity.toString()).toBe("25");
    expect(roundToPacks(30, sack).packs).toBe(2);
    expect(roundToPacks(30, sack).cost!.toString()).toBe("24");
    expect(roundToPacks(25, sack).packs).toBe(1);
  });
  it("orders the exact quantity when there is no pack size, and keeps unknown prices unknown", () => {
    const r = roundToPacks("3.5", { packQty: null, price: new Decimal(2) });
    expect(r.packs).toBeNull();
    expect(r.quantity.toString()).toBe("3.5");
    expect(r.cost!.toString()).toBe("7");
    expect(roundToPacks(3, { packQty: null, price: null }).cost).toBeNull();
    expect(roundToPacks(3, null).cost).toBeNull();
    expect(unitPrice(sack)!.toString()).toBe("0.48");
  });
  it("budget totals count lines without a price as missing, never as 0", () => {
    const b = buildBudget(
      [
        { itemId: "a", name: "Onions", kind: "ingredient", unit: "kg", priceText: "", columns: { total: { quantity: new Decimal(10), cost: new Decimal(5) } } },
        { itemId: "b", name: "Garlic", kind: "ingredient", unit: "kg", priceText: "", columns: { total: { quantity: new Decimal(1), cost: null } } },
        { itemId: "c", name: "Jar", kind: "packaging", unit: "unit", priceText: "", columns: { total: { quantity: new Decimal(100), cost: new Decimal(40) } } },
      ],
      ["total"],
    );
    expect(b.groups[0]!.totals.total!.cost.toString()).toBe("5");
    expect(b.groups[0]!.totals.total!.missing).toBe(1);
    expect(b.groups[1]!.totals.total!.cost.toString()).toBe("40");
    expect(b.total.total!.cost.toString()).toBe("45");
    expect(b.total.total!.missing).toBe(1);
  });
});

const suite = testDbUrl ? describe : describe.skip;

suite("suppliers, orders and deliveries", () => {
  let db: DB;
  const ids: Record<string, string> = {};
  let groente: string, metro: string, glas: string;

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    groente = (await addSupplier(db, { name: "Groente BV" })).id;
    metro = (await addSupplier(db, { name: "Metro" })).id;
    glas = (await addSupplier(db, { name: "Glas & Co" })).id;
  });
  afterAll(async () => db?.$client.end());

  it("one link per supplier and item, ranked by favourite, with price history", async () => {
    const a = await linkSupplierItem(db, { supplierId: groente, itemId: ids["ing-onions"]!, packQty: "25", packName: "sack", price: "12" });
    const b = await linkSupplierItem(db, { supplierId: metro, itemId: ids["ing-onions"]!, price: "0.9" });
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    await expect(linkSupplierItem(db, { supplierId: metro, itemId: ids["ing-onions"]! })).rejects.toThrow(/already linked/);

    // The same rows are what both the supplier card and the item card read.
    expect((await loadOffers(db, { supplierId: groente })).map((o) => o.itemId)).toEqual([ids["ing-onions"]]);
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).map((o) => o.supplierName)).toEqual(["Groente BV", "Metro"]);

    // Changing a price keeps the old one with its date; saving the same price adds nothing.
    expect(await setOffer(db, a.id, { packQty: "25", packName: "sack", price: "13" })).toBe(true);
    expect(await setOffer(db, a.id, { packQty: "25", packName: "sack", price: "13" })).toBe(false);
    const hist = await priceHistory(db, [a.id]);
    expect(hist.map((h) => h.price)).toEqual(["13", "12"]);
    await expect(db.execute(sql`update supplier_item_prices set price = 1`)).rejects.toThrow();

    await moveSupplierRank(db, b.id, "first");
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).map((o) => o.supplierName)).toEqual(["Metro", "Groente BV"]);
    await moveSupplierRank(db, b.id, "down");
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).map((o) => o.supplierName)).toEqual(["Groente BV", "Metro"]);

    // Removing a link needs a reason, like every delete.
    await expect(unlinkSupplierItem(db, b.id, " ")).rejects.toThrow(/reason/);
    expect(await unlinkSupplierItem(db, b.id, "they stopped selling onions")).toMatchObject({ supplier: "Metro", wasFavourite: false, newFavourite: null });
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).map((o) => o.supplierName)).toEqual(["Groente BV"]);
    // Linking again brings back the same link and its history.
    const again = await linkSupplierItem(db, { supplierId: metro, itemId: ids["ing-onions"]! });
    expect(again.id).toBe(b.id);
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).find((o) => o.supplierId === metro)!.price!.toString()).toBe("0.9");

    // Removing the favourite says who the favourite is now.
    expect(await unlinkSupplierItem(db, a.id, "too expensive")).toMatchObject({ supplier: "Groente BV", wasFavourite: true, newFavourite: "Metro" });
    await linkSupplierItem(db, { supplierId: groente, itemId: ids["ing-onions"]! });
    await moveSupplierRank(db, a.id, "first");
    expect((await loadOffers(db, { itemIds: [ids["ing-onions"]!] })).map((o) => o.supplierName)).toEqual(["Groente BV", "Metro"]);
  });

  it("a run's missing items become one draft order per supplier, rounded to packs and linked to the run", async () => {
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "26", source: "estimate" });
    await recordOpeningCount(db, { idempotencyKey: "open", countedOn: "2026-10-17", lines: [{ itemId: ids["ing-onions"]!, quantity: "1" }, { itemId: ids["pkg-700-ml-container"]!, quantity: "0" }] });
    await linkSupplierItem(db, { supplierId: glas, itemId: ids["pkg-700-ml-container"]!, packQty: "100", packName: "box", price: "40" });
    const run = await createRun(db, { idempotencyKey: "run-po01", plannedFor: "2026-10-24", targets: { [ids["Liberiaanse Kip 700 ml"]!]: 10 } });
    const plan = await planForRun(db, run.id);
    const lines = await orderPlan(db, plan, run.id);
    const onions = lines.find((l) => l.itemId === ids["ing-onions"])!;
    expect(onions.missing.toString()).toBe("6"); // 7 kg needed, 1 kg in stock
    expect(onions.offers[0]!.supplierName).toBe("Groente BV");

    const budget = await planBudget(db, plan);
    const onionBudget = budget.groups[0]!.lines.find((l) => l.itemId === ids["ing-onions"])!;
    expect(onionBudget.columns.toBuy!.quantity!.toString()).toBe("25"); // one 25 kg sack
    expect(onionBudget.columns.toBuy!.cost!.toString()).toBe("13");
    expect(onionBudget.columns.total!.cost!.toString()).toBe("3.64"); // 7 kg × 13/25

    const orders = await createOrdersFromPlan(db, {
      idempotencyKey: "plan-1",
      runId: run.id,
      lines: [
        { itemId: ids["ing-onions"]!, supplierId: groente, packs: 1, neededQty: "6" },
        { itemId: ids["pkg-700-ml-container"]!, supplierId: glas, packs: 1, neededQty: "10" },
      ],
    });
    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.status === "draft" && o.runId === run.id)).toBe(true);
    // Repeating the same submission creates nothing new.
    expect((await createOrdersFromPlan(db, { idempotencyKey: "plan-1", runId: run.id, lines: [{ itemId: ids["ing-onions"]!, supplierId: groente, packs: 1 }] }))[0]!.id).toBe(
      orders.find((o) => o.supplierId === groente)!.id,
    );

    const views = await loadOrders(db, { runId: run.id });
    const onionLine = views.find((v) => v.supplier.id === groente)!.lines[0]!;
    expect(onionLine.line.quantity).toBe("25");
    expect(onionLine.line.packs).toBe(1);
    expect(onionLine.line.unitPrice).toBe("0.52");

    // Drafts for this run are no longer offered as missing.
    expect((await orderPlan(db, await planForRun(db, run.id), run.id)).find((l) => l.itemId === ids["ing-onions"])!.missing.toString()).toBe("0");

    // A draft can be changed; a sent order can't.
    const jarsPo = orders.find((o) => o.supplierId === glas)!;
    const [jarLine] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, jarsPo.id));
    await updateDraftOrder(db, jarsPo.id, { expectedOn: "2026-10-22", lines: [{ lineId: jarLine!.id, packs: 2 }] });
    const [changed] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.id, jarLine!.id));
    expect(changed!.quantity).toBe("200");
    await markOrderSent(db, jarsPo.id, { sentOn: "2026-10-18" });
    // A sent order can still be corrected, with a reason.
    await expect(updateDraftOrder(db, jarsPo.id, { lines: [] })).rejects.toThrow(/reason/);
  });

  it("a delivery adds only the accepted quantity; refused goods leave the order partly received until it is closed", async () => {
    const po = await createPurchaseOrder(db, { idempotencyKey: "loose-1", supplierId: groente, lines: [{ itemId: ids["ing-onions"]!, quantity: "50" }] });
    expect(po.runId).toBeNull(); // orders without a run are fine
    await expect(
      recordReceipt(db, { idempotencyKey: "rx-0", receivedOn: "2026-10-19", lines: [{ itemId: ids["ing-onions"]!, quantity: "1", purchaseOrderLineId: (await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id)))[0]!.id }] }),
    ).rejects.toThrow(/draft/);
    await markOrderSent(db, po.id);
    const [line] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    expect(line!.packs).toBe(2); // 50 kg = 2 sacks of 25 kg
    const before = (await loadStockPositions(db))[ids["ing-onions"]!]!.onHand!;

    const r = await recordReceipt(db, {
      idempotencyKey: "rx-1",
      supplierId: groente,
      receivedOn: "2026-10-19",
      receivedTime: "09:30",
      note: "Driver late",
      lines: [{ itemId: ids["ing-onions"]!, quantity: "25", rejectedQuantity: "25", damageNote: "Wet sack", purchaseOrderLineId: line!.id }],
    });
    expect(r.receipt.receivedTime).toBe("09:30");
    const after = (await loadStockPositions(db))[ids["ing-onions"]!]!;
    expect(after.onHand!.minus(before).toString()).toBe("25");
    const [view] = await loadOrders(db, { ids: [po.id] });
    expect(view!.po.status).toBe("partly_received");
    expect(view!.lines[0]!.rejected.toString()).toBe("25");
    expect(view!.lines[0]!.pending.toString()).toBe("25");

    await closePurchaseOrder(db, po.id, "Refused sack not replaced");
    const [closed] = await loadOrders(db, { ids: [po.id] });
    expect(closed!.po.status).toBe("closed");
    expect(closed!.lines[0]!.pending.toString()).toBe("0");

    // The lot from this order is costed at the order price; opening stock falls back to the favourite.
    const [rl] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r.receipt.id));
    const [openLot] = await db.select().from(t.lots).where(sql`${t.lots.code} like 'OPEN-%' and ${t.lots.itemId} = ${ids["ing-onions"]}`);
    const costs = await lotUnitCosts(db, [
      { lotId: rl!.lotId!, itemId: ids["ing-onions"]! },
      { lotId: openLot!.id, itemId: ids["ing-onions"]! },
    ]);
    expect(costs.get(rl!.lotId!)).toMatchObject({ source: "lot" });
    expect(costs.get(rl!.lotId!)!.unitPrice!.toString()).toBe("0.52");
    expect(costs.get(openLot!.id)).toMatchObject({ source: "favourite", supplierName: "Groente BV" });
  });

  it("a fully refused line creates no lot and adds no stock", async () => {
    const before = (await loadStockPositions(db))[ids["ing-onions"]!]!.onHand!;
    await recordReceipt(db, { idempotencyKey: "rx-2", receivedOn: "2026-10-20", lines: [{ itemId: ids["ing-onions"]!, quantity: "0", rejectedQuantity: "5", damageNote: "Rotten" }] });
    const [rl] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.damageNote, "Rotten"));
    expect(rl!.lotId).toBeNull();
    expect((await loadStockPositions(db))[ids["ing-onions"]!]!.onHand!.toString()).toBe(before.toString());
  });
});
