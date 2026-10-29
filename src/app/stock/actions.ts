"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { recordOpeningCount, type OpeningLine } from "@/db/operations";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { OperationError } from "@/db/base";
import { recordStockCount, recordWriteOff, setAdjustmentDeleted, type CountLine } from "@/db/adjustments";
import { attempt, keepInput, withOk } from "../components/flash";

export async function saveOpeningCount(form: FormData) {
  return keepInput(async () => {
    const lines: OpeningLine[] = [];
    for (const [k, v] of form.entries()) {
      if (k.startsWith("q:") && String(v).trim() !== "") {
        const itemId = k.slice(2);
        lines.push({ itemId, quantity: String(v), bestBefore: String(form.get(`bb:${itemId}`) ?? "") || null });
      }
    }
    const r = await recordOpeningCount(db(), { idempotencyKey: String(form.get("key")), countedOn: String(form.get("countedOn")), lines });
    revalidatePath("/stock");
    redirect(withOk("/stock", r.alreadyRecorded ? "That count was already saved." : `Saved the count for ${r.created} item(s).`));
  });
}

const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

export async function saveStockCount(form: FormData) {
  return keepInput(async () => {
    const itemId = s(form, "itemId");
    const lines: CountLine[] = [];
    for (const [k, v] of form.entries()) {
      if (k.startsWith("count:") && String(v).trim() !== "") lines.push({ lotId: k.slice(6), counted: String(v).trim() });
    }
    if (s(form, "found") !== "") lines.push({ itemId, counted: s(form, "found"), bestBefore: s(form, "foundBestBefore") || null });
    const r = await recordStockCount(db(), { idempotencyKey: s(form, "key"), countedOn: s(form, "countedOn"), reason: s(form, "reason"), lines });
    revalidatePath("/stock");
    revalidatePath("/outbound");
    redirect(
      withOk(
        `/items/${itemId}?tab=stock`,
        r.alreadyRecorded
          ? "That count was already saved."
          : r.changed === 0
            ? "Count saved: everything matched, nothing changed."
            : `Count saved: ${r.changed} lot(s) corrected. The history below shows each correction.`,
      ),
    );
  });
}

export async function saveWriteOff(form: FormData) {
  return keepInput(async () => {
    const itemId = s(form, "itemId");
    const type = s(form, "type");
    const r = await (async () => {
      if (type !== "waste" && type !== "internal_use" && type !== "sample") throw new OperationError("Choose what happened: waste, internal use or sample.");
      return recordWriteOff(db(), {
        idempotencyKey: s(form, "key"),
        type,
        reason: s(form, "reason"),
        occurredOn: s(form, "occurredOn"),
        lines: [{ lotId: s(form, "lotId"), quantity: s(form, "quantity") }],
      });
    })();
    revalidatePath("/stock");
    const [lot] = await db()
      .select({ itemId: t.lots.itemId })
      .from(t.lots)
      .where(eq(t.lots.id, s(form, "lotId")));
    redirect(
      withOk(
        lot ? `/items/${lot.itemId}?tab=stock` : "/stock",
        r.alreadyRecorded ? "That was already recorded." : "Written off. The stock and history are updated.",
      ),
    );
  });
}

export async function toggleAdjustment(form: FormData) {
  const id = String(form.get("adjustmentId") ?? "");
  const deleted = form.get("deleted") === "1";
  const path = `/stock/adjustments/${id}`;
  await attempt(path, () =>
    setAdjustmentDeleted(db(), { idempotencyKey: String(form.get("key")), adjustmentId: id, deleted, reason: String(form.get("reason") ?? "") }),
  );
  revalidatePath("/stock", "layout");
  redirect(withOk(path, deleted ? "Deleted. Stock is back as it was before; the record is kept." : "Restored. The correction counts again."));
}
