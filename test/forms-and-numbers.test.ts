import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError, positive, readNumber, zeroOrMore } from "@/db/base";
import { addSupplier, confirmRun, createRun, recordOpeningCount } from "@/db/operations";
import { loadPlanCatalog } from "@/db/planning";
import { recordIncident, recordIngredients, recordPackaging, updateIncident } from "@/db/production";
import { cancelPurchaseOrder, createPurchaseOrder, markOrderSent, restorePurchaseOrder } from "@/db/purchasing";
import { recordOutflow, updateOutflow } from "@/db/sales";
import { recordWriteOff } from "@/db/adjustments";
import { listChanges } from "@/db/changes";
import { lotBalance } from "@/db/ledger";
import { localPath } from "@/app/components/form-values";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Every form reads numbers the same way ("7,5" = "7.5") and says the same
 * thing when one is wrong; and the saves behind some buttons that change
 * stock or orders work as they say.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

describe("reading a typed number", () => {
  it("takes a comma or a point", () => {
    expect(readNumber("7,5", "Onions")!.toString()).toBe("7.5");
    expect(readNumber(" 7.5 ", "Onions")!.toString()).toBe("7.5");
    expect(readNumber("12", "Onions")!.toString()).toBe("12");
    expect(readNumber(",5", "Onions")!.toString()).toBe("0.5");
    expect(readNumber("", "Onions")).toBeNull();
    expect(readNumber(null, "Onions")).toBeNull();
    expect(readNumber(3, "Onions")!.toString()).toBe("3");
  });

  it("refuses what isn't a number, with a message instead of an error page", () => {
    for (const bad of ["abc", "7 kg", "1.250,5", "1,250.5", "1,2,3", "Infinity", "0x10"]) {
      expect(() => readNumber(bad, "Onions")).toThrow(OperationError);
      expect(() => readNumber(bad, "Onions")).toThrow(/Onions: ".*" is not a number/);
    }
  });

  it("checks the sign", () => {
    expect(() => zeroOrMore("-1", "Onions")).toThrow(/can't be negative/);
    expect(zeroOrMore("0", "Onions")!.toString()).toBe("0");
    expect(() => positive("0", "Onions")).toThrow(/must be more than 0/);
    expect(() => positive("", "Onions")).toThrow(/must be more than 0/);
  });
});

describe("going back after saving", () => {
  it("only goes to pages of this app", () => {
    expect(localPath("/orders/1", "/x")).toBe("/orders/1");
    expect(localPath("//evil.example", "/x")).toBe("/x");
    expect(localPath("/\\evil.example", "/x")).toBe("/x");
    expect(localPath("https://evil.example", "/x")).toBe("/x");
    expect(localPath("/runs/1", "/x", ["/orders"])).toBe("/x");
    expect(localPath("/orders?all=1", "/x", ["/orders"])).toBe("/orders?all=1");
    expect(localPath("/ordersx", "/x", ["/orders"])).toBe("/x");
  });
});

/** A confirmed run for 60 jars of 950 ml, with stock for everything. */
async function runReady() {
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
  return { db, big, batch: batches[0]! };
}

describe.skipIf(!testDbUrl)("forms that change stock", () => {
  it("Cook takes 7,5 kg written with a comma", async () => {
    const { db, batch } = await runReady();
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
    const first = lines[0]!;
    await recordIngredients(db, {
      idempotencyKey: "cook",
      batchId: batch.id,
      producedOn: "2026-10-20",
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.id === first.id ? "7,5" : l.plannedQty })),
    });
    const [used] = await db
      .select()
      .from(t.movements)
      .where(and(eq(t.movements.docType, "batch_consumption"), eq(t.movements.docId, first.id)));
    expect(used!.quantity).toBe("-7.5");
  });

  it("a write-off or an opening count with a wrong number says so", async () => {
    const { db } = await runReady();
    const [lot] = await db.select().from(t.lots).limit(1);
    await expect(recordWriteOff(db, { idempotencyKey: "wo", type: "waste", reason: "Mould", lines: [{ lotId: lot!.id, quantity: "2 kg" }] })).rejects.toThrow(
      /is not a number/,
    );
    // An item never counted yet (not in this sauce's recipe or packaging).
    const counted = new Set((await db.select({ id: t.movements.itemId }).from(t.movements)).map((m) => m.id));
    const fresh = (await db.select().from(t.items)).find((i) => !counted.has(i.id))!;
    await expect(recordOpeningCount(db, { idempotencyKey: "open-2", countedOn: "2026-10-18", lines: [{ itemId: fresh.id, quantity: "abc" }] })).rejects.toThrow(
      /is not a number/,
    );
  });

  it("correcting an outflow's details leaves its jars alone and goes in the history", async () => {
    const { db, big, batch } = await runReady();
    const lines = await db.select().from(t.batchConsumption).where(eq(t.batchConsumption.batchId, batch.id));
    await recordIngredients(db, { idempotencyKey: "cook", batchId: batch.id, producedOn: "2026-10-20", lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.plannedQty })) });
    await recordPackaging(db, { idempotencyKey: "pack", batchId: batch.id, packedOn: "2026-10-21", lines: [{ productId: big, filled: 10, rejected: 0 }] });
    const [lot] = await db.select().from(t.lots).where(eq(t.lots.batchId, batch.id));
    const { outflow } = await recordOutflow(db, { idempotencyKey: "smp", type: "sample", destination: "Market", occurredOn: "2026-10-22", lines: [{ productId: big, jars: 2 }] });
    await updateOutflow(db, { outflowId: outflow.id, reason: "Wrong day", occurredOn: "2026-10-23", destination: "Saturday market" });
    const [after] = await db.select().from(t.outflows).where(eq(t.outflows.id, outflow.id));
    expect(after!.occurredOn).toBe("2026-10-23");
    expect(after!.destination).toBe("Saturday market");
    expect((await lotBalance(db as never, lot!.id)).toNumber()).toBe(8);
    const changes = await listChanges(db, { code: outflow.code });
    expect(changes.some((c) => c.reason === "Wrong day")).toBe(true);
    await expect(updateOutflow(db, { outflowId: outflow.id, reason: "x", occurredOn: "23/10/2026" })).rejects.toThrow(/Enter the date/);
  });

  it("an incident can be corrected, and needs a real date", async () => {
    const { db, batch } = await runReady();
    const inc = await recordIncident(db, { batchId: batch.id, type: "other", note: "Lid didn't seal", occurredOn: "2026-10-20" });
    await updateIncident(db, { incidentId: inc.id, reason: "More detail", type: "other", note: "Two lids didn't seal", occurredOn: "2026-10-21" });
    const [row] = await db.select().from(t.incidents).where(eq(t.incidents.id, inc.id));
    expect(row!.note).toBe("Two lids didn't seal");
    await expect(updateIncident(db, { incidentId: inc.id, reason: "x", type: "other", note: "x", occurredOn: "2026-02-30" })).rejects.toThrow(OperationError);
  });
});

describe.skipIf(!testDbUrl)("cancelling and restoring a purchase order", () => {
  it("a sent order needs a reason, and comes back as sent", async () => {
    const db = await freshDb();
    dbs.push(db);
    const [onion] = await db.select().from(t.items).where(eq(t.items.code, "ing-onions"));
    const sup = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, { idempotencyKey: "po", supplierId: sup.id, lines: [{ itemId: onion!.id, quantity: "20", unitPrice: "1,25" }] });
    const [line] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    expect(line!.unitPrice).toBe("1.25");
    await markOrderSent(db, po.id, { sentOn: "2026-10-18" });
    await expect(cancelPurchaseOrder(db, po.id, "")).rejects.toThrow(/Say why/);
    await cancelPurchaseOrder(db, po.id, "Supplier closed");
    const [cancelled] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, po.id));
    expect(cancelled!.status).toBe("cancelled");
    await restorePurchaseOrder(db, po.id, "They opened again");
    const [back] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, po.id));
    expect(back!.status).toBe("sent");
  });
});
