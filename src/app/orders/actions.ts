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
import { restorePurchaseOrder } from "@/db/purchasing";
import { attempt, withOk } from "../components/flash";
import { keepInput } from "../components/keep-input";
import { rows } from "../components/item-select";
import { fmtDate } from "../components/ui/format";
import { backOr, str } from "../components/form-values";
import { wholeNumber } from "@/domain/typed-number";

const backTo = (form: FormData, fallback: string) => backOr(form, fallback, ["/orders", "/runs"]);

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
  return keepInput(async () => {
    if (!supplierId) throw new OperationError("Choose a supplier.");
    const po = await createPurchaseOrder(db(), {
      idempotencyKey: str(form, "key"),
      supplierId,
      runId,
      expectedOn: str(form, "expectedOn") || null,
      reference: str(form, "reference") || null,
      lines,
    });
    refresh();
    redirect(withOk(`/orders/${po.id}`, "Draft order saved. Mark it as sent once you've placed it with the supplier."));
  });
}

/** From the order planner: one draft order per supplier. */
export async function createPlannedOrders(form: FormData) {
  const runId = str(form, "runId") || null;
  const lines = rows(form, ["item", "sup", "packs", "qty", "need"]).map((r) => ({
    itemId: r.item!,
    supplierId: r.sup!,
    packs: r.packs ? wholeNumber(r.packs) : null,
    quantity: r.qty || null,
    neededQty: r.need || null,
  }));
  return keepInput(async () => {
    const orders = await createOrdersFromPlan(db(), { idempotencyKey: str(form, "key"), runId, lines });
    refresh();
    const msg = `${orders.length} draft order${orders.length === 1 ? "" : "s"} created (${orders.map((o) => o.code).join(", ")}). Mark each as sent once placed.`;
    redirect(withOk(runId ? `/runs/${runId}/order` : "/orders", msg));
  });
}

export async function markSentAction(form: FormData) {
  const id = str(form, "poId");
  const back = backTo(form, "/orders");
  const r = await attempt(back, () => markOrderSent(db(), id, { sentOn: str(form, "sentOn") || null, expectedOn: str(form, "expectedOn") || null }));
  refresh();
  redirect(withOk(back, r.alreadySent ? `${r.po.code} was already sent.` : `${r.po.code} marked as sent on ${fmtDate(r.po.orderedOn)}. It now counts as on order.`));
}

export async function updateDraftAction(form: FormData) {
  return keepInput(async () => {
    const id = str(form, "poId");
    const lines = rows(form, ["line", "qty", "packs", "price"]).map((r) => ({
      lineId: r.line!,
      quantity: r.qty,
      packs: r.packs !== undefined && r.packs !== "" ? wholeNumber(r.packs) : null,
      unitPrice: r.price,
    }));
    await updateDraftOrder(db(), id, {
      expectedOn: str(form, "expectedOn") || null,
      reference: str(form, "reference"),
      note: str(form, "note"),
      reason: str(form, "reason"),
      lines,
    });
    refresh();
    redirect(withOk(`/orders/${id}`, str(form, "correcting") ? "Order corrected." : "Draft saved."));
  });
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
  await attempt(back, () => cancelPurchaseOrder(db(), id, str(form, "reason")));
  refresh();
  redirect(withOk(back, "Order cancelled."));
}

export async function restoreOrder(form: FormData) {
  const id = str(form, "poId");
  await attempt(`/orders/${id}`, () => restorePurchaseOrder(db(), id, str(form, "reason")));
  refresh();
  redirect(withOk(`/orders/${id}`, "Order restored."));
}
