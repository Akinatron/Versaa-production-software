"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { recordReceipt } from "@/db/operations";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

export async function saveDelivery(form: FormData) {
  const po = String(form.get("po") ?? "");
  const lines = rows(form, ["item", "qty", "pol", "batch", "bb"]).map((r) => ({
    itemId: r.item!,
    quantity: r.qty!,
    purchaseOrderLineId: r.pol || null,
    supplierBatch: r.batch || null,
    bestBefore: r.bb || null,
  }));
  const r = await attempt(`/deliveries/new${po ? `?po=${po}` : ""}`, () =>
    recordReceipt(db(), {
      idempotencyKey: String(form.get("key")),
      supplierId: String(form.get("supplierId") ?? "") || null,
      receivedOn: String(form.get("receivedOn") ?? ""),
      deliveryRef: String(form.get("deliveryRef") ?? "") || null,
      lines,
    }),
  );
  revalidatePath("/deliveries");
  revalidatePath("/stock");
  revalidatePath("/orders");
  redirect(withOk("/deliveries", r.alreadyRecorded ? "That delivery was already recorded." : "Delivery recorded and added to stock."));
}
