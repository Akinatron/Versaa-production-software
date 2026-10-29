import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { addSupplier, cancelRun, confirmRun, createRun, recordOpeningCount } from "./operations";
import { cancelPurchaseOrder, closePurchaseOrder, createPurchaseOrder, markOrderSent, recordReceipt } from "./purchasing";
import { linkSupplierItem } from "./suppliers";
import { closeBatch, recordIncident, recordIngredients, recordPackaging } from "./production";
import { addCustomer, createSalesOrder, deliverSalesOrder, recordOutflow } from "./sales";
import { recordStockCount, recordWriteOff, setAdjustmentDeleted } from "./adjustments";
import { addItem, saveRecipeDraft, setItemStorage, startRecipeDraft } from "./catalog";
import { attachDocuments } from "./documents";
import { seedYieldEstimates } from "./seed";
import { addDays, today } from "@/domain/dates";

/*
 * The test data shown by developer mode's "Mock data". It is made with the
 * same functions the app's own pages use, in the order things would happen,
 * so stock, reservations, yields and the history all add up. Dates are counted
 * from today, so "expires soon" and "deliver by" always look current.
 *
 * Every price here is invented, for testing only.
 */

const day = (offset: number) => addDays(today(), offset);

/** A stable made-up number between min and max for a name, so the same item always gets the same price. */
function pseudo(name: string, min: number, max: number) {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const f = ((h >>> 0) % 1000) / 1000;
  return Math.round((min + f * (max - min)) * 100) / 100;
}

/** A one-page PDF that says it's a test document. */
function testPdf(title: string): Uint8Array {
  const text = `${title} - test document (mock data)`.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const MOCK_SUPPLIERS = ["Mock Foods A", "Mock Foods B", "Mock Packaging A", "Mock Packaging B"] as const;

/** Fill an empty, freshly seeded database with test data for every stage. */
export async function loadMockData(db: DB) {
  // The 30 L per batch estimates, as `pnpm db:seed` adds them.
  await seedYieldEstimates(db);
  const items = await db.select().from(t.items);
  const item = (code: string) => {
    const i = items.find((x) => x.code === code);
    if (!i) throw new Error(`Mock data: item ${code} is not in the starting catalog.`);
    return i;
  };
  const products = await db
    .select({ p: t.products, s: t.sauces, f: t.formats })
    .from(t.products)
    .innerJoin(t.sauces, eq(t.products.sauceId, t.sauces.id))
    .innerJoin(t.formats, eq(t.products.formatId, t.formats.id));
  const product = (sauceCode: string, ml: number) => {
    const p = products.find((x) => x.s.code === sauceCode && x.f.capacityMl === ml);
    if (!p) throw new Error(`Mock data: product ${sauceCode} ${ml} ml is not in the starting catalog.`);
    return p.p.id;
  };
  const KIP = "liberiaanse-kip";
  const BOL = "italiaanse-bolognese";
  const TIK = "indiase-tikka-masala";

  // ---------------------------------------------------------------- where ingredients are kept
  const FREEZER = ["ing-chicken-thighs", "ing-minced-beef"];
  const FRIDGE = [
    "ing-bell-peppers",
    "ing-chilli-peppers",
    "ing-fresh-basil",
    "ing-leeks",
    "ing-mushrooms",
    "ing-tomatoes",
    "ing-lemon-juice",
    "ing-diced-tomatoes",
  ];
  for (const i of items.filter((x) => x.kind === "ingredient")) {
    await setItemStorage(db, i.id, FREEZER.includes(i.code) ? "freezer" : FRIDGE.includes(i.code) ? "fridge" : "room");
  }

  // ---------------------------------------------------------------- suppliers and prices
  const suppliers = [];
  for (const name of MOCK_SUPPLIERS) suppliers.push(await addSupplier(db, { name, contact: "test@example.com" }));
  const [foodsA, foodsB, packA, packB] = suppliers as [
    (typeof suppliers)[number],
    (typeof suppliers)[number],
    (typeof suppliers)[number],
    (typeof suppliers)[number],
  ];
  const ingredients = items.filter((i) => i.kind === "ingredient").sort((a, b) => a.code.localeCompare(b.code));
  const packaging = items.filter((i) => i.kind === "packaging").sort((a, b) => a.code.localeCompare(b.code));

  // Foods A sells every ingredient; Foods B every other one, at a different price,
  // and is the favourite for a few of them.
  for (const [n, i] of ingredients.entries()) {
    const sack = i.stockUnit === "L" ? 5 : n % 3 === 0 ? 25 : n % 3 === 1 ? 10 : 1;
    const perUnit = pseudo(i.code, 0.8, 14);
    await linkSupplierItem(db, {
      supplierId: foodsA.id,
      itemId: i.id,
      packQty: String(sack),
      packName: i.stockUnit === "L" ? "can" : sack > 1 ? "sack" : "bag",
      price: (perUnit * sack).toFixed(2),
    });
    // B also sells what the mock orders to it ask for.
    if (n % 2 === 0 || ["ing-onions", "ing-bell-peppers", "ing-kerrie-surinamese-masala"].includes(i.code)) {
      const bSack = sack === 1 ? 1 : sack / 5 >= 2 ? sack / 5 : sack;
      await linkSupplierItem(db, {
        supplierId: foodsB.id,
        itemId: i.id,
        packQty: String(bSack),
        packName: bSack > 1 ? "box" : "bag",
        price: (perUnit * bSack * (n % 4 === 0 ? 0.9 : 1.15)).toFixed(2),
        favourite: n % 4 === 0,
      });
    }
  }
  // Packaging A sells every packaging item in boxes; Packaging B the containers, lids and Tikka labels, cheaper or dearer.
  for (const [n, i] of packaging.entries()) {
    const per = i.code.includes("container")
      ? pseudo(i.code, 0.35, 0.7)
      : i.code.includes("lid-label") || i.code.includes("bottle-label")
        ? pseudo(i.code, 0.04, 0.12)
        : pseudo(i.code, 0.1, 0.25);
    const box = i.code.includes("label") ? 500 : 100;
    await linkSupplierItem(db, {
      supplierId: packA.id,
      itemId: i.id,
      packQty: String(box),
      packName: i.code.includes("label") ? "roll" : "box",
      price: (per * box).toFixed(2),
    });
    if (i.code.includes("container") || i.code.endsWith("lid") || i.code.includes("tikka")) {
      const bBox = i.code.includes("label") ? 1000 : 250;
      await linkSupplierItem(db, {
        supplierId: packB.id,
        itemId: i.id,
        packQty: String(bBox),
        packName: i.code.includes("label") ? "roll" : "pallet layer",
        price: (per * bBox * (n % 2 === 0 ? 0.85 : 1.1)).toFixed(2),
        favourite: n % 2 === 0,
      });
    }
  }
  // Two "other" items, bought like the rest but never planned.
  const gloves = await addItem(db, { kind: "other", name: "Nitrile gloves", stockUnit: "unit" });
  const spray = await addItem(db, { kind: "other", name: "Cleaning spray", stockUnit: "L" });
  await linkSupplierItem(db, { supplierId: foodsB.id, itemId: gloves.id, packQty: "100", packName: "box", price: "8.90" });
  await linkSupplierItem(db, { supplierId: packA.id, itemId: gloves.id, packQty: "200", packName: "box", price: "16.50" });
  await linkSupplierItem(db, { supplierId: foodsB.id, itemId: spray.id, packQty: "5", packName: "can", price: "14.00" });

  // ---------------------------------------------------------------- opening stock, a month ago
  await recordOpeningCount(db, {
    idempotencyKey: "mock-opening",
    countedOn: day(-30),
    lines: [
      ...ingredients.map((i) => ({ itemId: i.id, quantity: i.stockUnit === "L" ? "30" : "60", bestBefore: day(120) })),
      ...packaging.map((i) => ({ itemId: i.id, quantity: "400" })),
      { itemId: gloves.id, quantity: "150" },
      { itemId: spray.id, quantity: "10" },
    ],
  });

  // ---------------------------------------------------------------- deliveries before the first run
  // Closed order: Foods B, part of it refused and not replaced. Its invoice is attached.
  const poClosed = await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-closed",
    supplierId: foodsB.id,
    reference: "B-1001",
    lines: [
      { itemId: item("ing-onions").id, quantity: "20" },
      { itemId: item("ing-bell-peppers").id, quantity: "10" },
    ],
  });
  await markOrderSent(db, poClosed.id, { sentOn: day(-26), expectedOn: day(-24) });
  const closedLines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, poClosed.id));
  const lineOf = (lines: (typeof t.purchaseOrderLines.$inferSelect)[], code: string) => lines.find((l) => l.itemId === item(code).id)!;
  const rxB = await recordReceipt(db, {
    idempotencyKey: "mock-rx-b1",
    supplierId: foodsB.id,
    receivedOn: day(-24),
    receivedTime: "09:15",
    deliveryRef: "DN-B-4471",
    lines: [
      {
        itemId: item("ing-onions").id,
        quantity: "20",
        purchaseOrderLineId: lineOf(closedLines, "ing-onions").id,
        supplierBatch: "ON-2210",
        bestBefore: day(40),
      },
      {
        itemId: item("ing-bell-peppers").id,
        quantity: "8",
        rejectedQuantity: "2",
        damageNote: "Bruised, sent back with the driver",
        purchaseOrderLineId: lineOf(closedLines, "ing-bell-peppers").id,
        supplierBatch: "BP-87",
        bestBefore: day(-10),
      },
    ],
  });
  await closePurchaseOrder(db, poClosed.id, "Refused peppers not replaced");
  await attachDocuments(db, {
    kind: "invoice",
    purchaseOrderId: poClosed.id,
    files: [{ name: "invoice-B-1001.pdf", data: testPdf("Invoice B-1001") }],
  });
  await attachDocuments(db, {
    kind: "delivery_note",
    receiptId: rxB.receipt.id,
    files: [{ name: "delivery-note-B-4471.pdf", data: testPdf("Delivery note DN-B-4471") }],
  });

  // Received in full: containers from Packaging A, with its delivery note.
  const poJars = await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-jars",
    supplierId: packA.id,
    lines: [
      { itemId: item("pkg-700-ml-container").id, packs: 2 },
      { itemId: item("pkg-250-ml-container").id, packs: 1 },
    ],
  });
  await markOrderSent(db, poJars.id, { sentOn: day(-22) });
  const jarLines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, poJars.id));
  const rxJars = await recordReceipt(db, {
    idempotencyKey: "mock-rx-jars",
    supplierId: packA.id,
    receivedOn: day(-20),
    deliveryRef: "PA-9902",
    lines: jarLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, purchaseOrderLineId: l.id })),
  });
  await attachDocuments(db, {
    kind: "delivery_note",
    receiptId: rxJars.receipt.id,
    files: [{ name: "delivery-note-PA-9902.pdf", data: testPdf("Delivery note PA-9902") }],
  });

  // Cancelled before it was sent.
  const poCancelled = await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-cancelled",
    supplierId: packA.id,
    lines: [{ itemId: item("pkg-large-lid").id, packs: 2 }],
  });
  await cancelPurchaseOrder(db, poCancelled.id, "Ordered from the other supplier instead");

  // ---------------------------------------------------------------- a finished run: cooked, packed, closed
  const batchesOf = (runId: string) => db.select().from(t.productionBatches).where(eq(t.productionBatches.runId, runId));
  const cookAll = async (batchId: string, on: string, key: string) => {
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batchId));
    await recordIngredients(db, { idempotencyKey: key, batchId, producedOn: on, lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.standardQty })) });
  };
  const done = await createRun(db, {
    idempotencyKey: "mock-run-done",
    plannedFor: day(-18),
    targets: { [product(KIP, 700)]: 30, [product(KIP, 250)]: 20, [product(BOL, 700)]: 40 },
  });
  await confirmRun(db, done.id);
  for (const b of await batchesOf(done.id)) {
    const kip = b.sauceId === products.find((p) => p.s.code === KIP)!.s.id;
    await cookAll(b.id, day(-18), `mock-cook-${b.code}`);
    await recordPackaging(db, {
      idempotencyKey: `mock-pack-${b.code}`,
      batchId: b.id,
      packedOn: day(-17),
      // Kip expires soon, so Today shows the alert.
      bestBefore: kip ? day(12) : day(90),
      lines: kip
        ? [
            { productId: product(KIP, 700), filled: 30, rejected: 1 },
            { productId: product(KIP, 250), filled: 22, rejected: 2 },
          ]
        : [{ productId: product(BOL, 700), filled: 41, rejected: 1 }],
    });
    if (kip) await recordIncident(db, { batchId: b.id, type: "spill", note: "Knocked over a tray of filled 250 ml jars", occurredOn: day(-17) });
    await closeBatch(db, { idempotencyKey: `mock-close-${b.code}`, batchId: b.id });
  }

  // ---------------------------------------------------------------- a run in production
  // Bolognese is half packed, Kip is cooked and waits to be packed, Tikka is still to cook.
  const busy = await createRun(db, {
    idempotencyKey: "mock-run-busy",
    plannedFor: day(-2),
    targets: { [product(BOL, 500)]: 40, [product(KIP, 700)]: 30, [product(TIK, 500)]: 40 },
  });
  await confirmRun(db, busy.id);
  for (const b of await batchesOf(busy.id)) {
    const code = products.find((p) => p.s.id === b.sauceId)!.s.code;
    if (code === TIK) continue;
    await cookAll(b.id, day(-2), `mock-cook-${b.code}`);
    if (code === BOL)
      await recordPackaging(db, {
        idempotencyKey: `mock-pack-${b.code}`,
        batchId: b.id,
        packedOn: day(-1),
        bestBefore: day(88),
        lines: [{ productId: product(BOL, 500), filled: 18, rejected: 0 }],
      });
  }

  // ---------------------------------------------------------------- a run waiting for its purchases
  const next = await createRun(db, { idempotencyKey: "mock-run-next", plannedFor: day(6), targets: { [product(TIK, 700)]: 60, [product(KIP, 500)]: 40 } });
  await confirmRun(db, next.id);
  // Partly delivered: the chicken came, half the tomatoes are still to come.
  const poPart = await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-part",
    supplierId: foodsA.id,
    runId: next.id,
    lines: [
      { itemId: item("ing-chicken-thighs").id, quantity: "30" },
      { itemId: item("ing-tomatoes").id, quantity: "40" },
    ],
  });
  await markOrderSent(db, poPart.id, { sentOn: day(-3), expectedOn: day(-1) });
  const partLines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, poPart.id));
  await recordReceipt(db, {
    idempotencyKey: "mock-rx-part",
    supplierId: foodsA.id,
    receivedOn: day(-1),
    deliveryRef: "DN-A-310",
    lines: [
      {
        itemId: item("ing-chicken-thighs").id,
        quantity: lineOf(partLines, "ing-chicken-thighs").quantity,
        purchaseOrderLineId: lineOf(partLines, "ing-chicken-thighs").id,
        supplierBatch: "CH-5512",
        bestBefore: day(9),
      },
      {
        itemId: item("ing-tomatoes").id,
        quantity: "20",
        purchaseOrderLineId: lineOf(partLines, "ing-tomatoes").id,
        supplierBatch: "TO-118",
        bestBefore: day(14),
      },
    ],
  });
  // Sent, on the way.
  const poSent = await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-sent",
    supplierId: packB.id,
    runId: next.id,
    lines: [
      { itemId: item("pkg-700-ml-container").id, packs: 1 },
      { itemId: item("pkg-tikka-bottle-label-700").id, packs: 1 },
    ],
  });
  await markOrderSent(db, poSent.id, { sentOn: day(-1), expectedOn: day(3) });
  // Still a draft.
  await createPurchaseOrder(db, {
    idempotencyKey: "mock-po-draft",
    supplierId: foodsB.id,
    runId: next.id,
    expectedOn: day(4),
    lines: [
      { itemId: item("ing-kerrie-surinamese-masala").id, quantity: "3" },
      { itemId: item("ing-ground-cumin").id, quantity: "1" },
    ],
  });

  // ---------------------------------------------------------------- a draft run and a cancelled one
  await createRun(db, { idempotencyKey: "mock-run-draft", plannedFor: day(13), targets: { [product(BOL, 700)]: 50, [product(BOL, 250)]: 24 } });
  const dropped = await createRun(db, { idempotencyKey: "mock-run-cancelled", plannedFor: day(9), targets: { [product(TIK, 250)]: 30 } });
  await cancelRun(db, dropped.id, "The shop moved its order to next month");

  // ---------------------------------------------------------------- customers and jars going out
  const shop = await addCustomer(db, { name: "Delicatessen De Kaai", contact: "shop@example.com" });
  const market = await addCustomer(db, { name: "Market stall Zuid" });
  const { order: soDone } = await createSalesOrder(db, {
    idempotencyKey: "m001-delivered",
    customerId: shop.id,
    orderedOn: day(-14),
    reference: "Order 77",
    lines: [{ productId: product(KIP, 700), jars: 10, unitPrice: "6.50" }],
  });
  await deliverSalesOrder(db, { idempotencyKey: "mock-deliver-so1", salesOrderId: soDone.id, deliveredOn: day(-13) });
  await createSalesOrder(db, {
    idempotencyKey: "m002-open",
    customerId: market.id,
    orderedOn: day(-1),
    deliverBy: day(4),
    lines: [
      { productId: product(BOL, 700), jars: 12, unitPrice: "6.20" },
      { productId: product(KIP, 250), jars: 6, unitPrice: "3.40" },
    ],
  });
  await recordOutflow(db, {
    idempotencyKey: "mock-sample",
    type: "sample",
    destination: "Tasting at the market",
    occurredOn: day(-12),
    lines: [{ productId: product(KIP, 700), jars: 2 }],
  });
  await recordOutflow(db, {
    idempotencyKey: "mock-internal",
    type: "internal_use",
    destination: "Staff lunch",
    occurredOn: day(-10),
    lines: [{ productId: product(BOL, 700), jars: 1 }],
  });
  await recordOutflow(db, {
    idempotencyKey: "mock-waste",
    type: "waste",
    note: "Jar cracked on the shelf",
    occurredOn: day(-8),
    lines: [{ productId: product(KIP, 250), jars: 1 }],
  });

  // ---------------------------------------------------------------- corrections, with reasons
  const [onionLot] = await db
    .select()
    .from(t.lots)
    .where(and(eq(t.lots.itemId, item("ing-onions").id), eq(t.lots.supplierBatch, "ON-2210")));
  const onionLeft = await db.execute<{ q: string }>(
    // What the ledger says is left in that lot.
    sql`select coalesce(sum(quantity), 0)::text as q from movements where lot_id = ${onionLot!.id}`,
  );
  await recordStockCount(db, {
    idempotencyKey: "mock-count",
    countedOn: day(-5),
    reason: "Recount after the market",
    lines: [{ lotId: onionLot!.id, counted: Decimal.max(0, new Decimal([...onionLeft][0]!.q).minus(1.5)).toString() }],
  });
  const [garlicLot] = await db
    .select()
    .from(t.lots)
    .where(eq(t.lots.itemId, item("ing-garlic").id));
  const { adjustment } = await recordWriteOff(db, {
    idempotencyKey: "mock-writeoff",
    type: "waste",
    reason: "Mouldy bulbs",
    occurredOn: day(-4),
    lines: [{ lotId: garlicLot!.id, quantity: "0.5" }],
  });
  await setAdjustmentDeleted(db, { idempotencyKey: "mock-writeoff-del", adjustmentId: adjustment.id, deleted: true, reason: "Entered twice by mistake" });
  await setAdjustmentDeleted(db, {
    idempotencyKey: "mock-writeoff-undo",
    adjustmentId: adjustment.id,
    deleted: false,
    reason: "It wasn't a duplicate after all",
  });

  // ---------------------------------------------------------------- a recipe change not activated yet
  const bolognese = products.find((p) => p.s.code === BOL)!.s;
  const draft = await startRecipeDraft(db, bolognese.id);
  const draftLines = await db.select().from(t.recipeLines).where(eq(t.recipeLines.recipeVersionId, draft.id));
  await saveRecipeDraft(db, {
    versionId: draft.id,
    batchReferenceKg: draft.batchReferenceKg,
    note: "Trying more basil (test)",
    lines: draftLines
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        itemId: l.itemId,
        unit: l.unit,
        quantity: l.itemId === item("ing-fresh-basil").id ? new Decimal(l.quantity).mul(1.5).toString() : l.quantity,
      })),
  });
}
