"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { recordOpeningCount, type OpeningLine } from "@/db/operations";
import { attempt, withOk } from "../components/flash";

export async function saveOpeningCount(form: FormData) {
  const lines: OpeningLine[] = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("q:") && String(v).trim() !== "") {
      const itemId = k.slice(2);
      lines.push({ itemId, quantity: String(v), bestBefore: String(form.get(`bb:${itemId}`) ?? "") || null });
    }
  }
  const r = await attempt("/stock/count", () =>
    recordOpeningCount(db(), { idempotencyKey: String(form.get("key")), countedOn: String(form.get("countedOn")), lines }),
  );
  revalidatePath("/stock");
  redirect(withOk("/stock", r.alreadyRecorded ? "That count was already saved." : `Saved the count for ${r.created} item(s).`));
}
