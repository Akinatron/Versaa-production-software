"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError } from "@/db/operations";
import {
  activatePackagingDraft,
  activateRecipeDraft,
  addFormat,
  addItem,
  addProduct,
  addSauce,
  discardPackagingDraft,
  discardRecipeDraft,
  renameItem,
  saveRecipeDraft,
  savePackagingDraft,
  setFormatActive,
  setFormatFill,
  setItemActive,
  setProductActive,
  setSauceActive,
  setSauceColor,
  startPackagingDraft,
  startRecipeDraft,
} from "@/db/catalog";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

const str = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const back = (form: FormData, fallback: string) => {
  const b = str(form, "back");
  return b.startsWith("/settings") ? b : fallback;
};

function refresh() {
  revalidatePath("/settings", "layout");
  revalidatePath("/plan");
  revalidatePath("/");
}

// ---------------------------------------------------------------- yields and rejects

const yieldForm = z.object({
  sauceId: z.uuid(),
  litresPerBatch: z.coerce.number().positive("Litres per batch must be more than 0").max(1000),
  note: z.string().trim().max(500).optional(),
});

/** Adds a new estimate. Older figures are kept, so past plans stay explainable. */
export async function addYieldEstimate(form: FormData) {
  const path = back(form, "/settings/yields");
  const parsed = yieldForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`${path}?error=${encodeURIComponent("Enter litres per batch, more than 0.")}`);
  const data = parsed.data;
  await db().insert(t.yieldFigures).values({
    sauceId: data.sauceId,
    litresPerBatch: String(data.litresPerBatch),
    source: "estimate",
    note: data.note || null,
  });
  refresh();
  redirect(withOk(path, `Estimate of ${data.litresPerBatch} L per batch saved.`));
}

const rejectForm = z.object({
  productId: z.uuid(),
  percent: z.coerce.number().min(0).max(99),
  note: z.string().trim().max(500).optional(),
});

export async function addRejectEstimate(form: FormData) {
  const path = back(form, "/settings/yields");
  const parsed = rejectForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`${path}?error=${encodeURIComponent("Enter a reject percentage between 0 and 99.")}`);
  const data = parsed.data;
  await db().insert(t.rejectFigures).values({
    productId: data.productId,
    rate: String(data.percent / 100),
    source: "estimate",
    note: data.note || null,
  });
  refresh();
  redirect(withOk(path, `Reject estimate of ${data.percent}% saved.`));
}

// ---------------------------------------------------------------- recipes

export async function startRecipe(form: FormData) {
  const sauceId = str(form, "sauceId");
  const path = `/settings/recipes/${sauceId}`;
  await attempt(path, () => startRecipeDraft(db(), sauceId));
  refresh();
  redirect(`${path}#editor`);
}

export async function saveRecipe(form: FormData) {
  const sauceId = str(form, "sauceId");
  const versionId = str(form, "versionId");
  const intent = str(form, "intent");
  const path = `/settings/recipes/${sauceId}`;
  const all = rows(form, ["item", "qty", "unit"]);
  const remove = intent.startsWith("remove:") ? Number(intent.slice(7)) : -1;
  const lines = all.filter((_, i) => i !== remove).map((r) => ({ itemId: r.item!, quantity: r.qty!, unit: r.unit! }));
  const extra = Math.min(20, Number(str(form, "extra")) || 2);
  await attempt(`${path}?extra=${extra}`, () =>
    saveRecipeDraft(db(), { versionId, batchReferenceKg: str(form, "batchReferenceKg"), note: str(form, "note"), lines }),
  );
  refresh();
  if (intent === "activate") redirect(`${path}?confirm=1#editor`);
  if (intent === "addrow") redirect(`${path}?extra=${extra + 1}#editor`);
  if (remove >= 0) redirect(withOk(`${path}?extra=${extra}`, "Line removed from the draft.") + "#editor");
  redirect(withOk(path, "Draft saved. It is not used for planning until you activate it.") + "#editor");
}

export async function activateRecipe(form: FormData) {
  const sauceId = str(form, "sauceId");
  const path = `/settings/recipes/${sauceId}`;
  await attempt(path, () => activateRecipeDraft(db(), str(form, "versionId")));
  refresh();
  redirect(withOk(path, "New recipe version is active. New plans use it; batches already made keep the version they used."));
}

export async function discardRecipe(form: FormData) {
  const sauceId = str(form, "sauceId");
  const path = `/settings/recipes/${sauceId}`;
  await attempt(path, () => discardRecipeDraft(db(), str(form, "versionId")));
  refresh();
  redirect(withOk(path, "Draft discarded. The active recipe is unchanged."));
}

// ---------------------------------------------------------------- packaging lists

export async function startPackaging(form: FormData) {
  const productId = str(form, "productId");
  const path = `/settings/packaging/${productId}`;
  await attempt(path, () => startPackagingDraft(db(), productId));
  refresh();
  redirect(`${path}#editor`);
}

export async function savePackaging(form: FormData) {
  const productId = str(form, "productId");
  const versionId = str(form, "versionId");
  const intent = str(form, "intent");
  const path = `/settings/packaging/${productId}`;
  const all = rows(form, ["item", "perJar"]);
  const remove = intent.startsWith("remove:") ? Number(intent.slice(7)) : -1;
  const lines = all.filter((_, i) => i !== remove).map((r) => ({ itemId: r.item!, perJar: r.perJar! }));
  const extra = Math.min(20, Number(str(form, "extra")) || 2);
  await attempt(`${path}?extra=${extra}`, () => savePackagingDraft(db(), { versionId, lines }));
  refresh();
  if (intent === "activate") redirect(`${path}?confirm=1#editor`);
  if (intent === "addrow") redirect(`${path}?extra=${extra + 1}#editor`);
  if (remove >= 0) redirect(withOk(`${path}?extra=${extra}`, "Line removed from the draft.") + "#editor");
  redirect(withOk(path, "Draft saved. It is not used until you activate it.") + "#editor");
}

export async function activatePackaging(form: FormData) {
  const productId = str(form, "productId");
  const path = `/settings/packaging/${productId}`;
  await attempt(path, () => activatePackagingDraft(db(), str(form, "versionId")));
  refresh();
  redirect(withOk(path, "New packaging list is active. New plans and packaging use it; jars already packed keep the list they used."));
}

export async function discardPackaging(form: FormData) {
  const productId = str(form, "productId");
  const path = `/settings/packaging/${productId}`;
  await attempt(path, () => discardPackagingDraft(db(), str(form, "versionId")));
  refresh();
  redirect(withOk(path, "Draft discarded. The active packaging list is unchanged."));
}

// ---------------------------------------------------------------- items

export async function addItemAction(form: FormData) {
  const kind = str(form, "kind") === "packaging" ? "packaging" : "ingredient";
  const item = await attempt("/settings/items", () => addItem(db(), { kind, name: str(form, "name"), stockUnit: str(form, "stockUnit") }));
  refresh();
  redirect(withOk("/settings/items", `${item.name} added. Count its stock before planning with it.`));
}

export async function renameItemAction(form: FormData) {
  await attempt("/settings/items", () => renameItem(db(), str(form, "itemId"), str(form, "name")));
  refresh();
  redirect(withOk("/settings/items", `Renamed to ${str(form, "name")}.`));
}

export async function setItemActiveAction(form: FormData) {
  const active = str(form, "active") === "1";
  await attempt("/settings/items", () => setItemActive(db(), str(form, "itemId"), active));
  refresh();
  redirect(withOk("/settings/items", active ? "Item is back in use." : "Item retired. Its stock and history are kept."));
}

// ---------------------------------------------------------------- sauces, sizes, products

export async function addSauceAction(form: FormData) {
  const s = await attempt("/settings/catalog", () => addSauce(db(), { name: str(form, "name"), batchPrefix: str(form, "batchPrefix") || null }));
  refresh();
  redirect(
    withOk("/settings/catalog", `${s.name} added (batch numbers start with ${s.batchPrefix}). Next: add its recipe, a yield estimate and its products.`),
  );
}

export async function setSauceColorAction(form: FormData) {
  await attempt("/settings/catalog", () => setSauceColor(db(), str(form, "sauceId"), str(form, "color")));
  refresh();
  redirect(withOk("/settings/catalog", "Colour changed."));
}

export async function setSauceActiveAction(form: FormData) {
  const active = str(form, "active") === "1";
  await attempt("/settings/catalog", () => setSauceActive(db(), str(form, "sauceId"), active));
  refresh();
  redirect(withOk("/settings/catalog", active ? "Sauce is back in use." : "Sauce retired. It no longer appears in plans; its history is kept."));
}

const int = (v: string) => (v === "" ? NaN : Number(v));

export async function addFormatAction(form: FormData) {
  const fill = str(form, "fillMl");
  const f = await attempt("/settings/catalog", () =>
    addFormat(db(), { name: str(form, "name"), capacityMl: int(str(form, "capacityMl")), fillMl: fill ? int(fill) : null }),
  );
  refresh();
  redirect(withOk("/settings/catalog", `Size ${f.name} added (fill ${f.fillMl} ml). Add products to sell it.`));
}

export async function setFormatFillAction(form: FormData) {
  await attempt("/settings/catalog", () => setFormatFill(db(), str(form, "formatId"), int(str(form, "fillMl"))));
  refresh();
  redirect(withOk("/settings/catalog", `Fill changed to ${str(form, "fillMl")} ml for future plans and packaging. Past packaging keeps the fill it used.`));
}

export async function setFormatActiveAction(form: FormData) {
  const active = str(form, "active") === "1";
  await attempt("/settings/catalog", () => setFormatActive(db(), str(form, "formatId"), active));
  refresh();
  redirect(withOk("/settings/catalog", active ? "Size is back in use." : "Size retired. Its products no longer appear in plans."));
}

export async function addProductAction(form: FormData) {
  const p = await attempt("/settings/catalog", async () => {
    if (!str(form, "sauceId") || !str(form, "formatId")) throw new OperationError("Choose a sauce and a size.");
    return addProduct(db(), { sauceId: str(form, "sauceId"), formatId: str(form, "formatId") });
  });
  refresh();
  redirect(withOk(`/settings/packaging/${p.id}`, `${p.name} added. Set up its packaging list before it can be planned.`));
}

export async function setProductActiveAction(form: FormData) {
  const active = str(form, "active") === "1";
  await attempt("/settings/catalog", () => setProductActive(db(), str(form, "productId"), active));
  refresh();
  redirect(withOk("/settings/catalog", active ? "Product is back in use." : "Product retired. It no longer appears in plans."));
}
