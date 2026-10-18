"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError } from "@/db/operations";
import { closeBatch, recordIncident } from "@/db/production";
import { attempt, withOk } from "../components/flash";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const pathOf = (batchId: string) => `/batches/${batchId}`;

function done(batchId: string, msg: string, anchor = ""): never {
  revalidatePath(pathOf(batchId));
  revalidatePath("/batches");
  revalidatePath("/runs");
  redirect(withOk(pathOf(batchId) + (anchor ? `?at=${anchor.slice(1)}` : ""), msg) + anchor);
}

export async function addIncident(form: FormData) {
  const batchId = str(form, "batchId");
  const type = str(form, "type") as (typeof t.incidentType.enumValues)[number];
  await attempt(pathOf(batchId), async () => {
    if (!t.incidentType.enumValues.includes(type)) throw new OperationError("Choose the kind of incident.");
    return recordIncident(db(), { idempotencyKey: str(form, "key") || undefined, batchId, type, note: str(form, "note"), occurredOn: str(form, "occurredOn") || undefined });
  });
  done(batchId, "Incident recorded.", "#incidents");
}

export async function close(form: FormData) {
  const batchId = str(form, "batchId");
  const r = await attempt(pathOf(batchId), () =>
    closeBatch(db(), { idempotencyKey: str(form, "key"), batchId }),
  );
  done(batchId, r.runClosed ? "Batch closed. It was the last open batch, so the run is closed too and its leftover reservations are released." : "Batch closed.");
}

export async function markNotMade(form: FormData) {
  const batchId = str(form, "batchId");
  const reason = str(form, "reason");
  const r = await attempt(pathOf(batchId), async () => {
    if (!reason) throw new OperationError("Say why this batch wasn't made.");
    return closeBatch(db(), { idempotencyKey: str(form, "key"), batchId, notMade: true, leftoverReason: reason });
  });
  done(batchId, r.runClosed ? "Batch marked as not made. No other batches were open, so the run is closed too." : "Batch marked as not made.");
}
