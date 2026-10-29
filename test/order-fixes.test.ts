import { afterAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addSupplier, createPurchaseOrder } from "@/db/operations";
import { cancelPurchaseOrder, markOrderSent, recordReceipt, setReceiptDeleted, updateDraftOrder } from "@/db/purchasing";
import { linePrice } from "@/domain/order-message";
import { describePrice, unitMoney } from "@/domain/pricing";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Supplier orders:
 * - an empty quantity is an error, not a removal (0 removes a line);
 * - a line whose delivery was deleted can't be removed, with a clear message;
 * - restoring a delivery of a cancelled order reopens the order;
 * - cheap unit prices keep their digits.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup() {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
  for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
  const sup = await addSupplier(db, { name: "Groente BV" });
  const po = await createPurchaseOrder(db, {
    idempotencyKey: "po",
    supplierId: sup.id,
    lines: [
      { itemId: ids["ing-onions"]!, quantity: "20", unitPrice: "1" },
      { itemId: ids["ing-garlic"]!, quantity: "5", unitPrice: "4" },
    ],
  });
  const lines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
  const onionLine = lines.find((l) => l.itemId === ids["ing-onions"])!;
  return { db, ids, sup, po, onionLine };
}

describe.skipIf(!testDbUrl)("editing an order", () => {
  it("an empty quantity is an error; 0 removes the line", async () => {
    const { db, po, onionLine } = await setup();
    await expect(updateDraftOrder(db, po.id, { lines: [{ lineId: onionLine.id, quantity: "" }] })).rejects.toThrow(/enter a quantity \(0 removes the line\)/);
    expect(await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id))).toHaveLength(2);
    await updateDraftOrder(db, po.id, { lines: [{ lineId: onionLine.id, quantity: "0" }] });
    expect(await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id))).toHaveLength(1);
  });
});

describe.skipIf(!testDbUrl)("an order whose delivery was deleted", () => {
  async function deliveredThenDeleted() {
    const s = await setup();
    await markOrderSent(s.db, s.po.id, { sentOn: "2026-10-18" });
    const r = await recordReceipt(s.db, {
      idempotencyKey: "rc",
      supplierId: s.sup.id,
      receivedOn: "2026-10-19",
      lines: [{ itemId: s.ids["ing-onions"]!, quantity: "20", purchaseOrderLineId: s.onionLine.id }],
    });
    await setReceiptDeleted(s.db, { idempotencyKey: "rd", receiptId: r.receipt.id, deleted: true, reason: "wrong order" });
    return { ...s, receiptId: r.receipt.id };
  }

  it("says why that line can't be removed", async () => {
    const { db, po, onionLine } = await deliveredThenDeleted();
    await expect(updateDraftOrder(db, po.id, { reason: "not needed", lines: [{ lineId: onionLine.id, quantity: "0" }] })).rejects.toThrow(
      /deleted delivery is still on record/,
    );
  });

  it("is reopened when the delivery is restored after cancelling", async () => {
    const { db, po, receiptId } = await deliveredThenDeleted();
    await cancelPurchaseOrder(db, po.id, "not needed");
    await setReceiptDeleted(db, { idempotencyKey: "rr", receiptId, deleted: false, reason: "it did arrive" });
    const [after] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, po.id));
    expect(after!.status).toBe("partly_received");
  });
});

describe("unit prices", () => {
  it("keep up to 4 decimals for cheap items, 2 otherwise", () => {
    expect(unitMoney(new Decimal("0.035"))).toBe("0.035 €");
    expect(unitMoney(new Decimal("0.004"))).toBe("0.004 €");
    expect(unitMoney(new Decimal("0.123456"))).toBe("0.1235 €");
    expect(unitMoney(new Decimal("3.2"))).toBe("3.20 €");
    expect(linePrice({ name: "Lids", quantity: "1000", unit: "unit", unitPrice: "0.035" })).toBe("0.035 €/unit");
    expect(describePrice({ packQty: null, packName: null, price: new Decimal("0.004") }, "units")).toBe("0.004 € / unit");
  });
});
