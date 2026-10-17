"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import * as t from "@/db/schema";

const yieldForm = z.object({
  sauceId: z.uuid(),
  litresPerBatch: z.coerce.number().positive("Litres per batch must be more than 0").max(1000),
  note: z.string().trim().max(500).optional(),
});

/** Adds a new estimate. Older figures are kept, so past plans stay explainable. */
export async function addYieldEstimate(form: FormData) {
  const data = yieldForm.parse(Object.fromEntries(form));
  await db().insert(t.yieldFigures).values({
    sauceId: data.sauceId,
    litresPerBatch: String(data.litresPerBatch),
    source: "estimate",
    note: data.note || null,
  });
  revalidatePath("/settings");
  revalidatePath("/plan");
}

const rejectForm = z.object({
  productId: z.uuid(),
  percent: z.coerce.number().min(0).max(99),
});

export async function addRejectEstimate(form: FormData) {
  const data = rejectForm.parse(Object.fromEntries(form));
  await db().insert(t.rejectFigures).values({
    productId: data.productId,
    rate: String(data.percent / 100),
    source: "estimate",
  });
  revalidatePath("/settings");
  revalidatePath("/plan");
}
