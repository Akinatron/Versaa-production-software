"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  OperationError,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createOrdersFromPlan,
  createPurchaseOrder,
  markOrderSent,
  updateDraftOrder,
} from "@/db/operations";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

const str = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const backTo = (form: FormData, fallback: string) => {
  const b = str(form, "back");
  return b.startsWith("/orders") || b.startsWith("/runs") ? b : fallback;
};

function refresh() {
  revalidatePath("/orders", "layout");
  revalidatePath("/runs", "layout");
  revalidatePath("/suppliers", "layout");
  revalidatePath("/");
}

export async function saveOrder(form: FormData) {
  const lines = rows(form, ["item", "qty", "price"]).map((r) => ({ itemId: r.item!, quantity: r.qty!, unitPrice: r.price || null }));
  const supplierId = str(form, "supplierId");
  const runId = str(form, "runId") || null;
  const po = await attempt(`/orders/new${runId ? `?run=${runId}` : ""}`, async () => {
    if (!supplierId) throw new OperationError("Choose a supplier.");
    return createPurchaseOrder(db(), {
      idempotencyKey: str(form, "key"),
      supplierId,
      runId,
      expectedOn: str(form, "expectedOn") || null,
      reference: str(form, "reference") || null,
      lines,
    });
  });
  refresh();
  redirect(withOk(`/orders/${po.id}`, "Draft order saved. Mark it as sent once you've placed it with the supplier."));
}

/** From the order planner: one draft order per supplier. */
export async function createPlannedOrders(form: FormData) {
  const runId = str(form, "runId") || null;
  const lines = rows(form, ["item", "sup", "packs", "qty", "need"]).map((r) => ({
    itemId: r.item!,
    supplierId: r.sup!,
    packs: r.packs ? Number(r.packs) : null,
    quantity: r.qty || null,
    neededQty: r.need || null,
  }));
  const back = runId ? `/runs/${runId}/order` : "/orders";
  const orders = await attempt(back, () => createOrdersFromPlan(db(), { idempotencyKey: str(form, "key"), runId, lines }));
  refresh();
  const msg = `${orders.length} draft order${orders.length === 1 ? "" : "s"} created (${orders.map((o) => o.code).join(", ")}). Mark each as sent once placed.`;
  redirect(withOk(runId ? `/runs/${runId}/order` : "/orders", msg));
}

export async function markSentAction(form: FormData) {
  const id = str(form, "poId");
  const back = backTo(form, "/orders");
  const r = await attempt(back, () => markOrderSent(db(), id, { sentOn: str(form, "sentOn") || null, expectedOn: str(form, "expectedOn") || null }));
  refresh();
  redirect(withOk(back, r.alreadySent ? `${r.po.code} was already sent.` : `${r.po.code} marked as sent on ${r.po.orderedOn}. It now counts as on order.`));
}

export async function updateDraftAction(form: FormData) {
  const id = str(form, "poId");
  const lines = rows(form, ["line", "qty", "packs", "price"]).map((r) => ({
    lineId: r.line!,
    quantity: r.qty,
    packs: r.packs !== undefined && r.packs !== "" ? Number(r.packs) : null,
    unitPrice: r.price,
  }));
  await attempt(`/orders/${id}`, () =>
    updateDraftOrder(db(), id, { expectedOn: str(form, "expectedOn") || null, reference: str(form, "reference"), note: str(form, "note"), lines }),
  );
  refresh();
  redirect(withOk(`/orders/${id}`, "Draft saved."));
}

export async function closeOrderAction(form: FormData) {
  const id = str(form, "poId");
  await attempt(`/orders/${id}`, () => closePurchaseOrder(db(), id, str(form, "note")));
  refresh();
  redirect(withOk(`/orders/${id}`, "Order closed. What didn't arrive is no longer expected."));
}

export async function cancelOrder(form: FormData) {
  const id = str(form, "poId");
  const back = backTo(form, "/orders");
  await attempt(back, () => cancelPurchaseOrder(db(), id));
  refresh();
  redirect(withOk(back, "Order cancelled."));
}
