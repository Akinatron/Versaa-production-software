"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { OperationError } from "@/db/operations";
import { changePackaging, recordPackaging, type PackagingLineInput } from "@/db/production";
import { attempt, withOk } from "../components/flash";
import { keepInput } from "../components/keep-input";
import { rows } from "../components/item-select";
import { str } from "../components/form-values";


function jarLines(form: FormData): PackagingLineInput[] {
  return rows(form, ["product", "filled", "rejected"]).map((l) => {
    const filled = l.filled === "" ? 0 : Number(l.filled);
    const rejected = l.rejected === "" ? 0 : Number(l.rejected);
    if (Number.isNaN(filled) || Number.isNaN(rejected)) throw new OperationError("Jars must be whole numbers, 0 or more.");
    return { productId: l.product!, filled, rejected };
  });
}

/** Best-before per size from the edit form, only for the sizes whose date was changed. */
function changedDates(form: FormData): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const l of rows(form, ["bbProduct", "bb", "bbWas"])) {
    if (l.bbProduct && l.bb !== l.bbWas) out[l.bbProduct] = l.bb || null;
  }
  return out;
}

function done(batchId: string, msg: string): never {
  for (const p of [`/batches/${batchId}/pack`, `/batches/${batchId}/close`, "/batches", "/runs", "/stock", "/"]) revalidatePath(p);
  redirect(withOk(`/batches/${batchId}/pack`, msg));
}

/** Jars taken back out that were promised to sales orders. */
const shortNote = (short: string[]) => (short.length ? ` Check your sales orders: ${short.join(" ")}` : "");

export async function recordPack(form: FormData) {
  return keepInput(async () => {
    const batchId = str(form, "batchId");
    await recordPackaging(db(), {
      idempotencyKey: str(form, "key"),
      batchId,
      packedOn: str(form, "packedOn"),
      bestBefore: str(form, "bestBefore") || null,
      note: str(form, "note") || null,
      lines: jarLines(form),
    });
    done(
      batchId,
      "Packaging session recorded. Accepted jars are in stock; materials were used for every filled jar. Print the jar labels from the buttons under Jars packed.",
    );
  });
}

export async function editPack(form: FormData) {
  return keepInput(async () => {
    const batchId = str(form, "batchId");
    const sessionId = str(form, "sessionId");
    const r = await changePackaging(db(), {
      idempotencyKey: str(form, "key"),
      sessionId,
      packedOn: str(form, "packedOn"),
      bestBeforeBy: changedDates(form),
      note: str(form, "note") || null,
      reason: str(form, "reason"),
      lines: jarLines(form),
    });
    done(batchId, `Packaging session updated. Stock was corrected by the difference.${shortNote(r.short)}`);
  });
}

export async function deletePack(form: FormData) {
  const batchId = str(form, "batchId");
  const sessionId = str(form, "sessionId");
  const r = await attempt(`/batches/${batchId}/pack?edit=${sessionId}`, async () =>
    changePackaging(db(), { idempotencyKey: str(form, "key"), sessionId, delete: true, reason: str(form, "reason") || null }),
  );
  done(
    batchId,
    `Packaging session deleted. Its jars were taken out of stock and its materials put back; the record is kept for traceability.${shortNote(r.short)}`,
  );
}

export async function restorePack(form: FormData) {
  const batchId = str(form, "batchId");
  const sessionId = str(form, "sessionId");
  await attempt(`/batches/${batchId}/pack`, async () =>
    changePackaging(db(), { idempotencyKey: str(form, "key"), sessionId, restore: true, reason: str(form, "reason") }),
  );
  done(batchId, "Packaging session restored. Its jars are back in stock and its materials were used again.");
}
