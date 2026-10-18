"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { attachDocuments, removeDocument, type DocumentKind } from "@/db/documents";
import { filesFrom } from "./files-from";
import { currentUser } from "@/lib/session";
import { attempt, withOk } from "../components/flash";

/** Only go back to a page of this app. */
function safeBack(v: FormDataEntryValue | null) {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/deliveries";
}

function revalidatePaperwork() {
  revalidatePath("/deliveries");
  revalidatePath("/orders", "layout");
  revalidatePath("/suppliers", "layout");
  revalidatePath("/trace", "layout");
}

export async function uploadDocumentsAction(form: FormData) {
  const back = safeBack(form.get("back"));
  const kind: DocumentKind = form.get("kind") === "invoice" ? "invoice" : "delivery_note";
  const files = await filesFrom(form, "files");
  const me = await currentUser();
  const saved = await attempt(back, () =>
    attachDocuments(db(), {
      kind,
      receiptId: String(form.get("receiptId") ?? "") || null,
      purchaseOrderId: String(form.get("poId") ?? "") || null,
      files,
      userId: me?.id,
    }),
  );
  revalidatePaperwork();
  const what = kind === "invoice" ? "Invoice" : "Delivery note";
  redirect(withOk(back, saved.length > 1 ? `${saved.length} files saved.` : `${what} saved.`));
}

export async function removeDocumentAction(form: FormData) {
  const back = safeBack(form.get("back"));
  const me = await currentUser();
  await removeDocument(db(), String(form.get("id") ?? ""), me?.id);
  revalidatePaperwork();
  redirect(withOk(back, "File removed."));
}
