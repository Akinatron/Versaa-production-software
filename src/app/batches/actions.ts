"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { OperationError } from "@/db/operations";
import { closeBatch, recordBatchOutput, recordConsumption, recordIncident, recordPackaging, undoConsumption } from "@/db/production";
import { attempt, withOk } from "../components/flash";
import { rows } from "../components/item-select";

const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const pathOf = (batchId: string) => `/batches/${batchId}`;

function done(batchId: string, msg: string, anchor = ""): never {
  revalidatePath(pathOf(batchId));
  revalidatePath("/batches");
  revalidatePath("/runs");
  redirect(withOk(pathOf(batchId) + (anchor ? `?at=${anchor.slice(1)}` : ""), msg) + anchor);
}

/** Record one ingredient line (or an extra ingredient) as actually used. */
export async function recordLine(form: FormData) {
  const batchId = str(form, "batchId");
  const itemId = str(form, "itemId");
  const qty = str(form, "quantity");
  const lotId = str(form, "lotId");
  let name = str(form, "name");
  if (!name && itemId) {
    const [item] = await db().select({ name: t.items.name }).from(t.items).where(eq(t.items.id, itemId));
    name = item?.name ?? "";
  }
  name ||= "Ingredient";
  await attempt(pathOf(batchId), async () => {
    if (!itemId) throw new OperationError("Choose an ingredient.");
    if (qty === "") throw new OperationError(`${name}: enter the quantity used (0 if none was used).`);
    return recordConsumption(db(), {
      idempotencyKey: str(form, "key"),
      batchId,
      itemId,
      quantity: qty,
      lots: lotId ? [{ lotId, quantity: qty }] : undefined,
    });
  });
  done(batchId, `${name}: recorded as used and taken from stock.`, "#ingredients");
}

/** Record a confirmed zero: none of this ingredient was used. */
export async function recordZero(form: FormData) {
  const batchId = str(form, "batchId");
  const name = str(form, "name") || "Ingredient";
  await attempt(pathOf(batchId), () =>
    recordConsumption(db(), { idempotencyKey: str(form, "key"), batchId, itemId: str(form, "itemId"), quantity: "0" }),
  );
  done(batchId, `${name}: recorded as none used (0).`, "#ingredients");
}

export async function undoLine(form: FormData) {
  const batchId = str(form, "batchId");
  const name = str(form, "name") || "Ingredient";
  await attempt(pathOf(batchId), () =>
    undoConsumption(db(), { idempotencyKey: str(form, "key"), batchId, itemId: str(form, "itemId"), reason: str(form, "reason") }),
  );
  done(batchId, `${name}: undone. The stock is back and the line is pending again.`, "#ingredients");
}

/** Record every pending recipe line at its standard quantity, earliest best-before lots first. */
export async function useStandardForPending(form: FormData) {
  const batchId = str(form, "batchId");
  const key = str(form, "key");
  const pending = await db()
    .select({ itemId: t.batchConsumption.itemId, std: t.batchConsumption.standardQty, name: t.items.name })
    .from(t.batchConsumption)
    .innerJoin(t.items, eq(t.batchConsumption.itemId, t.items.id))
    .where(and(eq(t.batchConsumption.batchId, batchId), isNull(t.batchConsumption.confirmedAt), eq(t.batchConsumption.extra, false)));
  let recorded = 0;
  const failed: string[] = [];
  for (const p of pending) {
    try {
      const r = await recordConsumption(db(), { idempotencyKey: `${key}:${p.itemId}`, batchId, itemId: p.itemId, quantity: p.std });
      if (!r.alreadyRecorded) recorded++;
    } catch (e) {
      if (e instanceof OperationError) failed.push(e.message);
      else throw e;
    }
  }
  revalidatePath(pathOf(batchId));
  revalidatePath("/batches");
  if (failed.length) {
    redirect(
      `${pathOf(batchId)}?error=${encodeURIComponent(`${recorded} line(s) recorded at standard quantity. Not recorded: ${failed.join(" ")}`)}#ingredients`,
    );
  }
  done(batchId, `${recorded} ingredient line(s) recorded as used at the standard recipe quantity.`, "#ingredients");
}

export async function recordOutput(form: FormData) {
  const batchId = str(form, "batchId");
  await attempt(pathOf(batchId), () =>
    recordBatchOutput(db(), {
      idempotencyKey: str(form, "key"),
      batchId,
      producedOn: str(form, "producedOn"),
      litres: str(form, "litres") || null,
      kg: str(form, "kg") || null,
      note: str(form, "note") || null,
    }),
  );
  done(batchId, "Measured output saved.", "#output");
}

export async function recordPack(form: FormData) {
  const batchId = str(form, "batchId");
  const lines = rows(form, ["product", "filled", "rejected"]);
  await attempt(pathOf(batchId), async () => {
    const parsed = lines.map((l) => {
      const filled = l.filled === "" ? 0 : Number(l.filled);
      const rejected = l.rejected === "" ? 0 : Number(l.rejected);
      if (Number.isNaN(filled) || Number.isNaN(rejected)) throw new OperationError("Jars must be whole numbers, 0 or more.");
      return { productId: l.product!, filled, rejected };
    });
    return recordPackaging(db(), {
      idempotencyKey: str(form, "key"),
      batchId,
      packedOn: str(form, "packedOn"),
      bestBefore: str(form, "bestBefore") || null,
      note: str(form, "note") || null,
      lines: parsed,
    });
  });
  done(batchId, "Packaging session recorded. Accepted jars are in stock; materials were used for every filled jar.", "#packaging");
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
    closeBatch(db(), { idempotencyKey: str(form, "key"), batchId, leftoverReason: str(form, "leftoverReason") || null }),
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
