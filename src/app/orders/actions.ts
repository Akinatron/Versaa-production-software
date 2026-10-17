"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { OperationError, cancelPurchaseOrder, createPurchaseOrder } from "@/db/operations";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

export async function saveOrder(form: FormData) {
  const lines = rows(form, ["item", "qty", "price"]).map((r) => ({ itemId: r.item!, quantity: r.qty!, unitPrice: r.price || null }));
  const supplierId = String(form.get("supplierId") ?? "");
  await attempt("/orders/new", async () => {
    if (!supplierId) throw new OperationError("Choose a supplier.");
    return createPurchaseOrder(db(), {
      idempotencyKey: String(form.get("key")),
      supplierId,
      expectedOn: String(form.get("expectedOn") ?? "") || null,
      reference: String(form.get("reference") ?? "") || null,
      lines,
    });
  });
  revalidatePath("/orders");
  redirect(withOk("/orders", "Order saved. It shows as 'on order' until the delivery is recorded."));
}

export async function cancelOrder(form: FormData) {
  await attempt("/orders", () => cancelPurchaseOrder(db(), String(form.get("poId"))));
  revalidatePath("/orders");
  redirect(withOk("/orders", "Order cancelled."));
}
