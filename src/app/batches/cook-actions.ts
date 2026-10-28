"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as t from "@/db/schema";
import { db } from "@/db/client";
import { OperationError } from "@/db/operations";
import { recordIngredients } from "@/db/production";
import { withOk } from "../components/flash";
import type { FormResult } from "./[id]/cook/ingredients-form";

const Payload = z.array(
  z.object({
    itemId: z.string().uuid(),
    quantity: z.string(),
    lots: z.array(z.object({ lotId: z.string(), qty: z.string() })).optional(),
  }),
);

/** The single Record button of a batch's ingredients page. */
export async function recordIngredientsAction(_prev: FormResult, form: FormData): Promise<FormResult> {
  const batchId = String(form.get("batchId") ?? "");
  let result: Awaited<ReturnType<typeof recordIngredients>>;
  try {
    const parsed = Payload.safeParse(JSON.parse(String(form.get("payload") ?? "[]")));
    if (!parsed.success) throw new OperationError("Something in the form couldn't be read. Reload the page and try again.");
    const data = parsed.data;
    result = await recordIngredients(db(), {
      idempotencyKey: String(form.get("key") ?? ""),
      batchId,
      producedOn: String(form.get("producedOn") ?? "").trim() || null,
      reason: String(form.get("reason") ?? "").trim() || null,
      lines: data.map((l) => ({ itemId: l.itemId, quantity: l.quantity, lots: l.lots?.map((x) => ({ lotId: x.lotId, quantity: x.qty })) })),
    });
  } catch (e) {
    if (e instanceof OperationError) return { error: e.message };
    throw e;
  }
  for (const p of [`/batches/${batchId}/cook`, `/batches/${batchId}/pack`, `/batches/${batchId}/close`, "/batches", "/runs", "/"]) revalidatePath(p);
  // First time every ingredient is in: the batch is cooked, so go straight on to packing.
  if (!result.alreadyRecorded && result.pending === 0) {
    const [{ n } = { n: 0 }] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(t.packagingSessions)
      .where(and(eq(t.packagingSessions.batchId, batchId), isNull(t.packagingSessions.deletedAt)));
    if (n === 0) redirect(withOk(`/batches/${batchId}/pack`, "Ingredients recorded and stock updated. Next: record the jars."));
  }
  const msg = result.alreadyRecorded
    ? "Already recorded."
    : result.changed === 0
      ? "Recorded. Nothing had changed, so stock stays as it was."
      : `Recorded ${result.changed} ingredient line(s). Stock is updated.`;
  redirect(withOk(`/batches/${batchId}/cook`, msg));
}
