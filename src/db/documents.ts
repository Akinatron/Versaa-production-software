import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";
import { OperationError } from "./base";
import { dropFile, putFile } from "@/lib/files";

/*
 * Paperwork: the delivery note (albarán) that came with a delivery, and the
 * supplier's invoice for an order. One invoice can cover several deliveries,
 * so invoices belong to the order and delivery notes to the delivery.
 */

export type DocumentKind = (typeof t.documentKind.enumValues)[number];
export type DocumentRow = typeof t.documents.$inferSelect;

export const DOC_KIND: Record<DocumentKind, string> = { delivery_note: "Delivery note", invoice: "Invoice" };

/** A phone photo of a multi-page note can be large; 20 MB leaves room. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 10;

/** What a file really is, from its first bytes (never from its name). Only photos and PDFs. */
export function detectFileType(b: Uint8Array): { contentType: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return { contentType: "application/pdf", ext: ".pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", ext: ".jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return { contentType: "image/png", ext: ".png" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { contentType: "image/webp", ext: ".webp" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "heim", "heis", "hevc", "hevx"].includes(brand)) return { contentType: "image/heic", ext: ".heic" };
    if (["mif1", "msf1"].includes(brand)) return { contentType: "image/heif", ext: ".heif" };
  }
  return null;
}

export interface UploadFile {
  name: string;
  data: Uint8Array;
}

/** Keep a readable name: no folders, no control characters, not too long. */
function cleanName(name: string, ext: string) {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(-120);
  return base || `document${ext}`;
}

/** Check every file before anything is saved, so a bad file never leaves half a delivery behind. */
export function checkUploads(files: UploadFile[]) {
  const real = files.filter((f) => f.data.length > 0);
  if (real.length > MAX_FILES) throw new OperationError(`Attach at most ${MAX_FILES} files at once.`);
  return real.map((f) => {
    if (f.data.length > MAX_FILE_BYTES) throw new OperationError(`"${f.name}" is over 20 MB. Take the photo again at a lower size or upload a PDF.`);
    const type = detectFileType(f.data);
    if (!type) throw new OperationError(`"${f.name}" isn't a photo or PDF. Upload a JPG, PNG, HEIC or PDF.`);
    return { ...f, ...type, name: cleanName(f.name, type.ext) };
  });
}

export async function attachDocuments(
  db: DB,
  input: { kind: DocumentKind; receiptId?: string | null; purchaseOrderId?: string | null; files: UploadFile[]; userId?: string | null },
): Promise<DocumentRow[]> {
  const files = checkUploads(input.files);
  if (files.length === 0) throw new OperationError("Choose a photo or PDF first.");
  let supplierId: string | null = null;
  let receiptId: string | null = null;
  let purchaseOrderId: string | null = null;
  if (input.kind === "delivery_note") {
    const [r] = input.receiptId ? await db.select().from(t.receipts).where(eq(t.receipts.id, input.receiptId)) : [];
    if (!r) throw new OperationError("That delivery no longer exists.");
    receiptId = r.id;
    supplierId = r.supplierId;
  } else {
    const [po] = input.purchaseOrderId ? await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.id, input.purchaseOrderId)) : [];
    if (!po) throw new OperationError("That order no longer exists.");
    purchaseOrderId = po.id;
    supplierId = po.supplierId;
  }

  const saved: DocumentRow[] = [];
  for (const f of files) {
    const storageKey = await putFile(f.data, f.ext);
    try {
      const [row] = await db
        .insert(t.documents)
        .values({
          kind: input.kind,
          receiptId,
          purchaseOrderId,
          supplierId,
          fileName: f.name,
          contentType: f.contentType,
          sizeBytes: f.data.length,
          storageKey,
          uploadedBy: input.userId ?? null,
        })
        .returning();
      saved.push(row!);
    } catch (e) {
      await dropFile(storageKey).catch(() => {});
      throw e;
    }
  }
  return saved;
}

/** Take a document off the delivery or order. The row and the file are kept, only marked removed. */
export async function removeDocument(db: DB, id: string, userId?: string | null) {
  const [row] = await db
    .update(t.documents)
    .set({ removedAt: new Date(), removedBy: userId ?? null })
    .where(and(eq(t.documents.id, id), isNull(t.documents.removedAt)))
    .returning();
  return row ?? null;
}

export async function documentById(db: DB, id: string) {
  const [row] = await db
    .select()
    .from(t.documents)
    .where(and(eq(t.documents.id, id), isNull(t.documents.removedAt)));
  return row ?? null;
}

/** Documents still in place for these deliveries and/or orders, oldest first. */
export async function documentsFor(db: DB, f: { receiptIds?: string[]; purchaseOrderIds?: string[] }): Promise<DocumentRow[]> {
  const any: SQL[] = [];
  if (f.receiptIds?.length) any.push(inArray(t.documents.receiptId, f.receiptIds));
  if (f.purchaseOrderIds?.length) any.push(inArray(t.documents.purchaseOrderId, f.purchaseOrderIds));
  if (any.length === 0) return [];
  return db
    .select()
    .from(t.documents)
    .where(and(isNull(t.documents.removedAt), or(...any)))
    .orderBy(t.documents.createdAt);
}

/** A supplier's paperwork, newest first, with the delivery or order each belongs to. */
export async function supplierDocuments(db: DB, supplierId: string, limit = 30) {
  return db
    .select({
      doc: t.documents,
      receivedOn: t.receipts.receivedOn,
      deliveryRef: t.receipts.deliveryRef,
      poCode: t.purchaseOrders.code,
    })
    .from(t.documents)
    .leftJoin(t.receipts, eq(t.documents.receiptId, t.receipts.id))
    .leftJoin(t.purchaseOrders, eq(t.documents.purchaseOrderId, t.purchaseOrders.id))
    .where(and(eq(t.documents.supplierId, supplierId), isNull(t.documents.removedAt)))
    .orderBy(desc(t.documents.createdAt))
    .limit(limit);
}

/**
 * The paperwork behind a delivered lot: the delivery note of the delivery it
 * came in, and the invoice of the order that delivery was for.
 */
export async function lotPaperwork(db: DB, lotId: string) {
  const lines = await db
    .select({ receipt: t.receipts, poId: t.purchaseOrderLines.purchaseOrderId, poCode: t.purchaseOrders.code })
    .from(t.receiptLines)
    .innerJoin(t.receipts, eq(t.receiptLines.receiptId, t.receipts.id))
    .leftJoin(t.purchaseOrderLines, eq(t.receiptLines.purchaseOrderLineId, t.purchaseOrderLines.id))
    .leftJoin(t.purchaseOrders, eq(t.purchaseOrderLines.purchaseOrderId, t.purchaseOrders.id))
    .where(eq(t.receiptLines.lotId, lotId));
  const line = lines[0];
  if (!line) return null;
  const docs = await documentsFor(db, { receiptIds: [line.receipt.id], purchaseOrderIds: line.poId ? [line.poId] : [] });
  return {
    receipt: line.receipt,
    order: line.poId ? { id: line.poId, code: line.poCode! } : null,
    deliveryNotes: docs.filter((d) => d.kind === "delivery_note"),
    invoices: docs.filter((d) => d.kind === "invoice"),
  };
}

/** Delivery notes behind each of these lots (lot id → its delivery's notes), for trace tables. */
export async function deliveryNotesForLots(db: DB, lotIds: string[]) {
  const out = new Map<string, DocumentRow[]>();
  if (lotIds.length === 0) return out;
  const rows = await db
    .select({ lotId: t.receiptLines.lotId, doc: t.documents })
    .from(t.receiptLines)
    .innerJoin(t.documents, and(eq(t.documents.receiptId, t.receiptLines.receiptId), isNull(t.documents.removedAt)))
    .where(inArray(t.receiptLines.lotId, lotIds))
    .orderBy(t.documents.createdAt);
  for (const r of rows) {
    if (!r.lotId) continue;
    out.set(r.lotId, [...(out.get(r.lotId) ?? []), r.doc]);
  }
  return out;
}
