"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { updateLot } from "@/db/purchasing";
import { attempt, withOk } from "../components/flash";

export async function editLot(form: FormData) {
  const id = String(form.get("lotId") ?? "");
  const path = `/trace/lot/${id}`;
  await attempt(path, () =>
    updateLot(db(), {
      lotId: id,
      reason: String(form.get("reason") ?? ""),
      supplierBatch: form.has("supplierBatch") ? String(form.get("supplierBatch") ?? "") : undefined,
      bestBefore: String(form.get("bestBefore") ?? ""),
      storage: form.has("storage") ? String(form.get("storage") ?? "") : undefined,
    }),
  );
  revalidatePath("/trace", "layout");
  revalidatePath("/stock", "layout");
  redirect(withOk(path, "Lot corrected."));
}
