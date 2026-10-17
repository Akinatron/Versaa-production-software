"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError } from "@/db/base";
import { addCustomer, cancelSalesOrder, createSalesOrder, deliverSalesOrder, recordOutflow } from "@/db/sales";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const OUTFLOW_TYPES = ["sale", "sample", "waste", "internal_use"] as const;
type OutflowType = (typeof OUTFLOW_TYPES)[number];

function wholeJars(v: string, what: string) {
  if (v === "") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new OperationError(`${what}: jars must be a whole number, 0 or more.`);
  return n;
}

function refresh() {
  revalidatePath("/sales");
  revalidatePath("/stock");
  revalidatePath("/trace");
}

export async function saveCustomer(form: FormData) {
  const back = str(form, "back");
  const safeBack = back.startsWith("/sales") ? back : "/sales/customers";
  const c = await attempt("/sales/customers" + (back ? `?back=${encodeURIComponent(back)}` : ""), () =>
    addCustomer(db(), { name: str(form, "name"), contact: str(form, "contact") || null, notes: str(form, "notes") || null }),
  );
  revalidatePath("/sales");
  redirect(withOk(safeBack, `Added customer ${c.name}.`));
}

export async function saveSalesOrder(form: FormData) {
  const r = await attempt("/sales/new", async () => {
    const lines = rows(form, ["product", "jars", "price"])
      .filter((l) => l.product && l.jars !== "")
      .map((l) => ({ productId: l.product!, jars: wholeJars(l.jars!, "Order line"), unitPrice: l.price || null }));
    return createSalesOrder(db(), {
      idempotencyKey: str(form, "key"),
      customerId: str(form, "customerId") || null,
      destination: str(form, "destination") || null,
      reference: str(form, "reference") || null,
      orderedOn: str(form, "orderedOn"),
      lines,
    });
  });
  refresh();
  redirect(withOk(`/sales/${r.order.id}`, r.alreadyRecorded ? "That order was already saved." : `Order ${r.order.code} saved. The jars are now promised; stock goes down when you deliver.`));
}

export async function cancelOrder(form: FormData) {
  const id = str(form, "orderId");
  await attempt(`/sales/${id}`, () => cancelSalesOrder(db(), id));
  refresh();
  redirect(withOk(`/sales/${id}`, "Order cancelled. Its jars are free again."));
}

export async function deliverOrder(form: FormData) {
  const id = str(form, "orderId");
  const r = await attempt(`/sales/${id}`, async () => {
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
      if (!picked.length) throw new OperationError("You chose to pick lots yourself but didn't enter jars for any lot. Enter them, or use earliest best-before first.");
      lots[productId] = picked;
    }
    return deliverSalesOrder(db(), { idempotencyKey: str(form, "key"), salesOrderId: id, deliveredOn: str(form, "deliveredOn"), lots });
  });
  refresh();
  redirect(withOk(`/sales/${id}`, r.alreadyRecorded ? "That delivery was already recorded." : `Delivered as ${r.outflow.code}. The jars have left stock.`));
}

export async function saveOutflow(form: FormData) {
  const type = str(form, "type") as OutflowType;
  const back = `/sales/outflow/new?type=${OUTFLOW_TYPES.includes(type) ? type : "sale"}`;
  const r = await attempt(back, async () => {
    if (!OUTFLOW_TYPES.includes(type)) throw new OperationError("Choose what kind of outflow this is.");
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
        if (!lot || !p || lot.itemId !== p.itemId) throw new OperationError(`Lot ${lot?.code ?? ""} is not ${p?.name ?? "that product"}. Pick a lot of the same product, or leave the lot empty.`);
      }
      return { productId: l.product!, jars, unitPrice: type === "sale" ? l.price || null : null, lots: l.lot ? [{ lotId: l.lot, jars }] : undefined };
    });
    return recordOutflow(db(), {
      idempotencyKey: str(form, "key"),
      type,
      customerId: str(form, "customerId") || null,
      destination: str(form, "destination") || null,
      reference: str(form, "reference") || null,
      note: str(form, "note") || null,
      occurredOn: str(form, "occurredOn"),
      lines,
    });
  });
  refresh();
  redirect(withOk("/sales", r.alreadyRecorded ? "That was already recorded." : `Recorded ${r.outflow.code}. The jars have left stock.`));
}
