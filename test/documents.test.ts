import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addSupplier } from "@/db/operations";
import { createPurchaseOrder, markOrderSent, recordReceipt } from "@/db/purchasing";
import {
  attachDocuments,
  checkUploads,
  deliveryNotesForLots,
  detectFileType,
  documentById,
  documentsFor,
  lotPaperwork,
  removeDocument,
  supplierDocuments,
} from "@/db/documents";
import { freshDb, testDbUrl } from "./helpers";

const pdf = () => new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const heic = () => new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);

describe("what an uploaded file is (no database)", () => {
  it("tells photos and PDFs from their first bytes, not their name", () => {
    expect(detectFileType(pdf())?.contentType).toBe("application/pdf");
    expect(detectFileType(jpeg())?.contentType).toBe("image/jpeg");
    expect(detectFileType(heic())?.contentType).toBe("image/heic");
    expect(detectFileType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectFileType(new TextEncoder().encode("<html>"))).toBeNull();
  });
  it("refuses anything else, and cleans the file name", () => {
    expect(() => checkUploads([{ name: "evil.pdf", data: new TextEncoder().encode("<script>") }])).toThrow(/isn't a photo or PDF/);
    expect(() => checkUploads([{ name: "big.jpg", data: new Uint8Array(21 * 1024 * 1024).fill(0xff) }])).toThrow(/over 20 MB/);
    const [f] = checkUploads([{ name: '../../etc/"albarán".pdf', data: pdf() }]);
    expect(f!.name).toBe("albarán.pdf");
    expect(checkUploads([{ name: "empty", data: new Uint8Array() }])).toHaveLength(0);
  });
});

const suite = testDbUrl ? describe : describe.skip;

suite("delivery notes and invoices", () => {
  let db: DB;
  let dir: string;
  let supplierId: string;
  let onions: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "versaa-uploads-"));
    process.env.UPLOADS_DIR = dir;
    db = await freshDb();
    onions = (await db.select().from(t.items).where(eq(t.items.code, "ing-onions")))[0]!.id;
    supplierId = (await addSupplier(db, { name: "Groente BV" })).id;
  });
  afterAll(async () => {
    await db?.$client.end();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the delivery note with the delivery and the invoice with the order, and shows both from the lot", async () => {
    const po = await createPurchaseOrder(db, { idempotencyKey: "doc-po", supplierId, lines: [{ itemId: onions, quantity: "20" }] });
    await markOrderSent(db, po.id);
    const [pol] = await db.select().from(t.purchaseOrderLines).where(eq(t.purchaseOrderLines.purchaseOrderId, po.id));
    const half = (key: string) =>
      recordReceipt(db, {
        idempotencyKey: key,
        supplierId,
        receivedOn: "2026-10-18",
        deliveryRef: key,
        lines: [{ itemId: onions, quantity: "10", purchaseOrderLineId: pol!.id }],
      });
    const r1 = await half("A-1");
    const r2 = await half("A-2");

    const [note] = await attachDocuments(db, { kind: "delivery_note", receiptId: r1.receipt.id, files: [{ name: "albaran.jpg", data: jpeg() }] });
    expect(note!.supplierId).toBe(supplierId);
    expect(new Uint8Array(await readFile(path.join(dir, note!.storageKey)))).toEqual(jpeg());
    // One invoice for both deliveries.
    const [inv] = await attachDocuments(db, { kind: "invoice", purchaseOrderId: po.id, files: [{ name: "factura.pdf", data: pdf() }] });

    const [lot1] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r1.receipt.id));
    const [lot2] = await db.select().from(t.receiptLines).where(eq(t.receiptLines.receiptId, r2.receipt.id));
    const p1 = await lotPaperwork(db, lot1!.lotId!);
    expect(p1!.deliveryNotes.map((d) => d.id)).toEqual([note!.id]);
    expect(p1!.invoices.map((d) => d.id)).toEqual([inv!.id]);
    const p2 = await lotPaperwork(db, lot2!.lotId!);
    expect(p2!.deliveryNotes).toHaveLength(0);
    expect(p2!.invoices.map((d) => d.id)).toEqual([inv!.id]);
    expect(p2!.order?.code).toBe(po.code);

    const byLot = await deliveryNotesForLots(db, [lot1!.lotId!, lot2!.lotId!]);
    expect(byLot.get(lot1!.lotId!)?.map((d) => d.fileName)).toEqual(["albaran.jpg"]);
    expect(byLot.has(lot2!.lotId!)).toBe(false);

    const sup = await supplierDocuments(db, supplierId);
    expect(sup.map((s) => s.doc.kind).sort()).toEqual(["delivery_note", "invoice"]);
    expect(sup.find((s) => s.doc.kind === "invoice")!.poCode).toBe(po.code);

    // Removing hides it but keeps the record and the file.
    await removeDocument(db, note!.id, "Wrong photo");
    expect(await documentById(db, note!.id)).toBeNull();
    expect(await documentsFor(db, { receiptIds: [r1.receipt.id] })).toHaveLength(0);
    const [kept] = await db.select().from(t.documents).where(eq(t.documents.id, note!.id));
    expect(kept!.removedAt).not.toBeNull();
    await expect(readFile(path.join(dir, kept!.storageKey))).resolves.toBeTruthy();
  });

  it("refuses files that aren't photos or PDFs, and documents without a delivery or order", async () => {
    const [r] = await db.select().from(t.receipts).limit(1);
    await expect(
      attachDocuments(db, { kind: "delivery_note", receiptId: r!.id, files: [{ name: "x.pdf", data: new TextEncoder().encode("hello") }] }),
    ).rejects.toThrow(/isn't a photo or PDF/);
    await expect(attachDocuments(db, { kind: "delivery_note", receiptId: null, files: [{ name: "a.pdf", data: pdf() }] })).rejects.toThrow(/no longer exists/);
    await expect(attachDocuments(db, { kind: "invoice", purchaseOrderId: r!.id, files: [{ name: "a.pdf", data: pdf() }] })).rejects.toThrow(/no longer exists/);
    await expect(attachDocuments(db, { kind: "invoice", purchaseOrderId: null, files: [] })).rejects.toThrow(/Choose a photo or PDF/);
  });
});
