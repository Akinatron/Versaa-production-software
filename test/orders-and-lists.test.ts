import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addSupplier } from "@/db/operations";
import { createPurchaseOrder, loadOrders, markOrderSent, recordReceipt, setReceiptDeleted } from "@/db/purchasing";
import { freshDb, testDbUrl } from "./helpers";

/*
 * The Orders list adds up what arrived per line in one query, leaves out old
 * finished orders unless asked, and the tables it reads have their indexes.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

describe.skipIf(!testDbUrl)("the orders list", () => {
  it("adds up accepted and refused per line, and leaves deleted deliveries out", async () => {
    const db = await freshDb();
    dbs.push(db);
    const [onion] = await db.select().from(t.items).where(eq(t.items.code, "ing-onions"));
    const [garlic] = await db.select().from(t.items).where(eq(t.items.code, "ing-garlic"));
    const sup = await addSupplier(db, { name: "Groente BV" });
    const po = await createPurchaseOrder(db, {
      idempotencyKey: "po",
      supplierId: sup.id,
      lines: [
        { itemId: onion!.id, quantity: "20", unitPrice: "1" },
        { itemId: garlic!.id, quantity: "5", unitPrice: "4" },
      ],
    });
    await markOrderSent(db, po.id, { sentOn: "2026-10-18" });
    const poLines = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const onionLine = poLines.find((l) => l.itemId === onion!.id)!;
    await recordReceipt(db, {
      idempotencyKey: "rc-1",
      supplierId: sup.id,
      receivedOn: "2026-10-19",
      lines: [{ itemId: onion!.id, quantity: "8", rejectedQuantity: "2", purchaseOrderLineId: onionLine.id }],
    });
    const second = await recordReceipt(db, {
      idempotencyKey: "rc-2",
      supplierId: sup.id,
      receivedOn: "2026-10-20",
      lines: [{ itemId: onion!.id, quantity: "5", purchaseOrderLineId: onionLine.id }],
    });
    await setReceiptDeleted(db, { idempotencyKey: "rd", receiptId: second.receipt.id, deleted: true, reason: "Wrong order" });

    const [view] = await loadOrders(db, { ids: [po.id] });
    const o = view!.lines.find((l) => l.item.id === onion!.id)!;
    const g = view!.lines.find((l) => l.item.id === garlic!.id)!;
    expect(o.accepted.toString()).toBe("8");
    expect(o.rejected.toString()).toBe("2");
    expect(o.pending.toString()).toBe("12");
    expect(g.accepted.toString()).toBe("0");
    expect(g.pending.toString()).toBe("5");
  });

  it("shows open orders always and finished ones only from the given day", async () => {
    const db = await freshDb();
    dbs.push(db);
    const [onion] = await db.select().from(t.items).where(eq(t.items.code, "ing-onions"));
    const sup = await addSupplier(db, { name: "Groente BV" });
    const old = await createPurchaseOrder(db, { idempotencyKey: "old", supplierId: sup.id, lines: [{ itemId: onion!.id, quantity: "1", unitPrice: "1" }] });
    const open = await createPurchaseOrder(db, { idempotencyKey: "open", supplierId: sup.id, lines: [{ itemId: onion!.id, quantity: "1", unitPrice: "1" }] });
    await db.update(t.purchaseOrders).set({ status: "received", createdAt: new Date("2025-01-10T10:00:00Z") }).where(eq(t.purchaseOrders.id, old.id));
    await db.update(t.purchaseOrders).set({ createdAt: new Date("2025-01-10T10:00:00Z") }).where(eq(t.purchaseOrders.id, open.id));

    const recent = await loadOrders(db, { doneSince: "2026-08-01" });
    expect(recent.map((o) => o.po.id)).toEqual([open.id]);
    const all = await loadOrders(db);
    expect(all.map((o) => o.po.id).sort()).toEqual([old.id, open.id].sort());
  });

  it("has indexes on the columns lists look rows up by", async () => {
    const db = await freshDb();
    dbs.push(db);
    const rows = await db.execute<{ indexname: string }>(sql`select indexname from pg_indexes where schemaname = 'public'`);
    const names = new Set([...rows].map((r) => r.indexname));
    for (const n of ["movements_doc", "receipt_lines_receipt", "receipt_lines_po_line", "purchase_order_lines_po", "reservations_sales_order", "outflow_lines_outflow"])
      expect(names.has(n), n).toBe(true);
  });
});
