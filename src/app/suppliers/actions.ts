"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { addSupplier } from "@/db/operations";
import { linkSupplierItem, moveSupplierRank, setOffer, setSupplierActive, unlinkSupplierItem, updateSupplier } from "@/db/suppliers";
import { attempt, withOk } from "../components/flash";

const str = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
/** Go back to the card the form was on (supplier or item card). */
const back = (form: FormData, fallback: string) => {
  const b = str(form, "back");
  return b.startsWith("/suppliers") || b.startsWith("/items") ? b : fallback;
};

function refresh() {
  revalidatePath("/suppliers", "layout");
  revalidatePath("/items", "layout");
  revalidatePath("/orders", "layout");
  revalidatePath("/runs", "layout");
}

export async function addSupplierAction(form: FormData) {
  const s = await attempt("/suppliers", () => addSupplier(db(), { name: str(form, "name"), contact: str(form, "contact") }));
  refresh();
  redirect(withOk(`/suppliers/${s.id}`, `${s.name} added. Add the items it sells below.`));
}

export async function updateSupplierAction(form: FormData) {
  const id = str(form, "supplierId");
  await attempt(`/suppliers/${id}`, () => updateSupplier(db(), id, { name: str(form, "name"), contact: str(form, "contact"), notes: str(form, "notes") }));
  refresh();
  redirect(withOk(`/suppliers/${id}`, "Supplier details saved."));
}

export async function setSupplierActiveAction(form: FormData) {
  const id = str(form, "supplierId");
  const active = str(form, "active") === "1";
  await setSupplierActive(db(), id, active);
  refresh();
  redirect(withOk(`/suppliers/${id}`, active ? "Supplier is back in use." : "Supplier marked as not in use. Its history is kept."));
}

export async function linkAction(form: FormData) {
  const path = back(form, "/suppliers");
  await attempt(path, () =>
    linkSupplierItem(db(), {
      supplierId: str(form, "supplierId"),
      itemId: str(form, "itemId"),
      packQty: str(form, "packQty"),
      packName: str(form, "packName"),
      price: str(form, "price"),
      supplierCode: str(form, "supplierCode"),
    }),
  );
  refresh();
  redirect(withOk(path, "Linked. It now shows on both the supplier and the item."));
}

export async function setOfferAction(form: FormData) {
  const path = back(form, "/suppliers");
  const changed = await attempt(path, () =>
    setOffer(db(), str(form, "supplierItemId"), {
      packQty: str(form, "packQty"),
      packName: str(form, "packName"),
      price: str(form, "price"),
      supplierCode: str(form, "supplierCode"),
    }),
  );
  refresh();
  redirect(withOk(path, changed ? "Price saved. The previous one is kept in the history." : "Saved."));
}

export async function unlinkAction(form: FormData) {
  const path = back(form, "/suppliers");
  await attempt(path, () => unlinkSupplierItem(db(), str(form, "supplierItemId")));
  refresh();
  redirect(withOk(path, "Removed. Its past prices stay on record."));
}

export async function moveRankAction(form: FormData) {
  const path = back(form, "/suppliers");
  const to = str(form, "to");
  await attempt(path, () => moveSupplierRank(db(), str(form, "supplierItemId"), to === "up" || to === "down" ? to : "first"));
  refresh();
  redirect(path);
}
