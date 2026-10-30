"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError } from "@/db/base";
import {
  addCustomer,
  cancelSalesOrder,
  createSalesOrder,
  deliverSalesOrder,
  recordOutflow,
  restoreSalesOrder,
  setOutflowDeleted,
  updateOutflow,
  updateSalesOrder,
} from "@/db/sales";
import { attempt, withOk } from "../components/flash";
import { keepInput } from "../components/keep-input";
import { rows } from "../components/item-select";
import { OUTFLOW_REASONS, type OutflowReason } from "../components/labels";
import { localPath, str } from "../components/form-values";
import { wholeNumber } from "@/domain/typed-number";


function wholeJars(v: string, what: string) {
  if (v === "") return 0;
  const n = wholeNumber(v);
  if (!Number.isInteger(n) || n < 0) throw new OperationError(`${what}: jars must be a whole number, 0 or more.`);
  return n;
}

function refresh() {
  revalidatePath("/outbound");
  revalidatePath("/stock");
  revalidatePath("/reports");
  revalidatePath("/trace");
}

export async function saveCustomer(form: FormData) {
  const back = str(form, "back");
  const safeBack = localPath(back, "/outbound/customers", ["/outbound"]);
  const c = await attempt("/outbound/customers" + (back ? `?back=${encodeURIComponent(back)}` : ""), () =>
    addCustomer(db(), { name: str(form, "name"), contact: str(form, "contact") || null, notes: str(form, "notes") || null }),
  );
  revalidatePath("/outbound");
  redirect(withOk(safeBack, `Added customer ${c.name}.`));
}

export async function saveSalesOrder(form: FormData) {
  return keepInput(async () => {
    const lines = rows(form, ["product", "jars", "price"])
      .filter((l) => l.product && l.jars !== "")
      .map((l) => ({ productId: l.product!, jars: wholeJars(l.jars!, "Order line"), unitPrice: l.price || null }));
    const r = await createSalesOrder(db(), {
      idempotencyKey: str(form, "key"),
      customerId: str(form, "customerId") || null,
      destination: str(form, "destination") || null,
      reference: str(form, "reference") || null,
      orderedOn: str(form, "orderedOn"),
      deliverBy: str(form, "deliverBy") || null,
      lines,
    });
    refresh();
    redirect(
      withOk(
        `/outbound/orders/${r.order.id}`,
        r.alreadyRecorded ? "That order was already saved." : `Order ${r.order.code} saved. The jars are now promised; stock goes down when you deliver.`,
      ),
    );
  });
}

export async function cancelOrder(form: FormData) {
  const id = str(form, "orderId");
  await attempt(`/outbound/orders/${id}`, () => cancelSalesOrder(db(), id, str(form, "reason")));
  refresh();
  redirect(withOk(`/outbound/orders/${id}`, "Order cancelled. Its jars are free again."));
}

export async function deliverOrder(form: FormData) {
  const id = str(form, "orderId");
  const r = await attempt(`/outbound/orders/${id}`, async () => {
    const lines = await db().select().from(t.salesOrderLines).where(eq(t.salesOrderLines.salesOrderId, id));
    const lots: Record<string, { lotId: string; jars: number }[]> = {};
    for (const productId of new Set(lines.map((l) => l.productId))) {
      if (str(form, `mode_${productId}`) !== "choose") continue;
      const chosen: { lotId: string; jars: number }[] = [];
      for (const [k, v] of form.entries()) {
        const prefix = `lot_${productId}_`;
        if (k.startsWith(prefix) && String(v).trim() !== "") chosen.push({ lotId: k.slice(prefix.length), jars: wholeJars(String(v).trim(), "Lot") });
      }
      const picked = chosen.filter((c) => c.jars > 0);
      if (!picked.length)
        throw new OperationError("You chose to pick lots yourself but didn't enter jars for any lot. Enter them, or use earliest best-before first.");
      lots[productId] = picked;
    }
    return deliverSalesOrder(db(), { idempotencyKey: str(form, "key"), salesOrderId: id, deliveredOn: str(form, "deliveredOn"), lots });
  });
  refresh();
  redirect(
    withOk(`/outbound/orders/${id}`, r.alreadyRecorded ? "That delivery was already recorded." : `Delivered as ${r.outflow.code}. The jars have left stock.`),
  );
}

export async function saveOutflow(form: FormData) {
  return keepInput(async () => {
    const type = str(form, "type") as OutflowReason;
    const known = OUTFLOW_REASONS.includes(type);
    const isSale = type === "sale";
    if (!known) throw new OperationError("Choose why the jars are leaving.");
    const raw = rows(form, ["product", "jars", "lot", "price"]).filter((l) => l.product && l.jars !== "");
    const lotIds = raw.map((l) => l.lot).filter((x): x is string => !!x);
    const lotRows = lotIds.length ? await db().select().from(t.lots).where(inArray(t.lots.id, lotIds)) : [];
    const productIds = raw.map((l) => l.product!);
    const products = productIds.length ? await db().select().from(t.products).where(inArray(t.products.id, productIds)) : [];
    const lines = raw.map((l) => {
      const jars = wholeJars(l.jars!, "Line");
      const p = products.find((x) => x.id === l.product);
      if (l.lot) {
        const lot = lotRows.find((x) => x.id === l.lot);
        if (!lot || !p || lot.itemId !== p.itemId)
          throw new OperationError(`Lot ${lot?.code ?? ""} is not ${p?.name ?? "that product"}. Pick a lot of the same product, or leave the lot empty.`);
      }
      return { productId: l.product!, jars, unitPrice: isSale ? l.price || null : null, lots: l.lot ? [{ lotId: l.lot, jars }] : undefined };
    });
    const r = await recordOutflow(db(), {
      idempotencyKey: str(form, "key"),
      type,
      // Only sales carry a customer, destination and reference.
      customerId: isSale ? str(form, "customerId") || null : null,
      destination: isSale ? str(form, "destination") || null : null,
      reference: isSale ? str(form, "reference") || null : null,
      note: str(form, "note") || null,
      occurredOn: str(form, "occurredOn"),
      lines,
    });
    refresh();
    const short = r.short.length ? ` Check your sales orders: ${r.short.join(" ")}` : "";
    redirect(withOk("/outbound", r.alreadyRecorded ? "That was already recorded." : `Recorded ${r.outflow.code}. The jars have left stock.${short}`));
  });
}

export async function restoreOrder(form: FormData) {
  const id = str(form, "orderId");
  await attempt(`/outbound/orders/${id}`, () => restoreSalesOrder(db(), id, str(form, "reason")));
  refresh();
  redirect(withOk(`/outbound/orders/${id}`, "Order restored. Its jars are promised again."));
}

export async function editOrder(form: FormData) {
  return keepInput(async () => {
    const id = str(form, "orderId");
    const lines = rows(form, ["product", "jars", "price"])
      .filter((l) => l.product && l.jars !== "")
      .map((l) => ({ productId: l.product!, jars: wholeJars(l.jars!, "Order line"), unitPrice: l.price || null }))
      .filter((l) => l.jars > 0);
    await updateSalesOrder(db(), {
      salesOrderId: id,
      reason: str(form, "reason"),
      customerId: str(form, "customerId") || null,
      destination: str(form, "destination") || null,
      reference: str(form, "reference") || null,
      orderedOn: str(form, "orderedOn"),
      deliverBy: str(form, "deliverBy") || null,
      lines,
    });
    refresh();
    redirect(withOk(`/outbound/orders/${id}`, "Order corrected."));
  });
}

const outflowPath = (id: string) => `/trace/outflow/${id}`;

export async function editOutflow(form: FormData) {
  const id = str(form, "outflowId");
  await attempt(outflowPath(id), () =>
    updateOutflow(db(), {
      outflowId: id,
      reason: str(form, "reason"),
      occurredOn: str(form, "occurredOn"),
      customerId: form.has("customerId") ? str(form, "customerId") || null : undefined,
      destination: form.has("destination") ? str(form, "destination") || null : undefined,
      reference: form.has("reference") ? str(form, "reference") || null : undefined,
      note: str(form, "note") || null,
    }),
  );
  refresh();
  revalidatePath(outflowPath(id));
  redirect(withOk(outflowPath(id), "Corrected."));
}

export async function toggleOutflow(form: FormData) {
  const id = str(form, "outflowId");
  const deleted = str(form, "deleted") === "1";
  await attempt(outflowPath(id), () => setOutflowDeleted(db(), { idempotencyKey: str(form, "key"), outflowId: id, deleted, reason: str(form, "reason") }));
  refresh();
  revalidatePath(outflowPath(id));
  redirect(withOk(outflowPath(id), deleted ? "Deleted. The jars are back in stock; the record is kept." : "Restored. The jars have left stock again."));
}
