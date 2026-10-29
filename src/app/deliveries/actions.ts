"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { recordReceipt } from "@/db/operations";
import { correctReceipt, setReceiptDeleted } from "@/db/purchasing";
import { attachDocuments, checkUploads } from "@/db/documents";
import { filesFrom } from "../documents/files-from";
import { attempt, keepInput, withOk } from "../components/flash";
import { rows } from "../components/item-select";

export async function saveDelivery(form: FormData) {
  return keepInput(async () => {
    const po = String(form.get("po") ?? "");
    const lines = rows(form, ["item", "qty", "rej", "dmg", "pol", "batch", "bb", "st"]).map((r) => ({
      itemId: r.item!,
      quantity: r.qty!,
      rejectedQuantity: r.rej || null,
      damageNote: r.dmg || null,
      purchaseOrderLineId: r.pol || null,
      supplierBatch: r.batch || null,
      bestBefore: r.bb || null,
      storage: r.st || null,
    }));
    const files = await filesFrom(form, "docs");
    // A bad file is refused before anything is recorded.
    await checkUploads(files);
    const r = await recordReceipt(db(), {
      idempotencyKey: String(form.get("key")),
      supplierId: String(form.get("supplierId") ?? "") || null,
      receivedOn: String(form.get("receivedOn") ?? ""),
      receivedTime: String(form.get("receivedTime") ?? "") || null,
      note: String(form.get("note") ?? "") || null,
      deliveryRef: String(form.get("deliveryRef") ?? "") || null,
      lines,
    });
    if (files.length > 0 && !r.alreadyRecorded) {
      await attachDocuments(db(), { kind: "delivery_note", receiptId: r.receipt.id, files });
    }
    revalidatePath("/deliveries");
    revalidatePath("/stock");
    revalidatePath("/orders", "layout");
    revalidatePath("/runs", "layout");
    redirect(withOk(po ? `/orders/${po}` : "/deliveries", r.alreadyRecorded ? "That delivery was already recorded." : "Delivery recorded and added to stock."));
  });
}

function refreshDelivery(id: string) {
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${id}`);
  revalidatePath("/stock", "layout");
  revalidatePath("/orders", "layout");
  revalidatePath("/runs", "layout");
  revalidatePath("/trace", "layout");
}

export async function correctDelivery(form: FormData) {
  return keepInput(async () => {
    const id = String(form.get("receiptId") ?? "");
    const lines = rows(form, ["line", "qty", "rej", "dmg", "batch", "bb"]).map((r) => ({
      lineId: r.line!,
      quantity: r.qty ?? null,
      rejectedQuantity: r.rej || "0",
      damageNote: r.dmg || null,
      supplierBatch: r.batch ?? undefined,
      bestBefore: r.bb ?? undefined,
    }));
    const r = await correctReceipt(db(), {
      idempotencyKey: String(form.get("key")),
      receiptId: id,
      reason: String(form.get("reason") ?? ""),
      receivedOn: String(form.get("receivedOn") ?? ""),
      receivedTime: String(form.get("receivedTime") ?? "") || null,
      deliveryRef: String(form.get("deliveryRef") ?? "") || null,
      note: String(form.get("note") ?? "") || null,
      lines,
    });
    refreshDelivery(id);
    redirect(withOk(`/deliveries/${id}`, r?.alreadyRecorded ? "That correction was already saved." : "Delivery corrected. Stock moved by the difference."));
  });
}

export async function toggleDelivery(form: FormData) {
  const id = String(form.get("receiptId") ?? "");
  const deleted = form.get("deleted") === "1";
  await attempt(`/deliveries/${id}`, () =>
    setReceiptDeleted(db(), { idempotencyKey: String(form.get("key")), receiptId: id, deleted, reason: String(form.get("reason") ?? "") }),
  );
  refreshDelivery(id);
  redirect(
    withOk(`/deliveries/${id}`, deleted ? "Delivery deleted. Its stock was taken back out; the record is kept." : "Delivery restored. Its stock is back."),
  );
}
