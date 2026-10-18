"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { cancelRun, confirmRun, restoreRun, updateDraftRun } from "@/db/operations";
import { ensureBatches } from "@/db/production";
import { attempt, withOk } from "../components/flash";

export async function confirm(form: FormData) {
  const id = String(form.get("runId"));
  await attempt(`/runs/${id}`, () => confirmRun(db(), id));
  revalidatePath("/runs");
  redirect(withOk(`/runs/${id}`, "Run confirmed. Its forecast is saved and the stock it needs is reserved."));
}

export async function cancel(form: FormData) {
  const id = String(form.get("runId"));
  await attempt(`/runs/${id}`, () => cancelRun(db(), id, String(form.get("reason") ?? "")));
  revalidatePath("/runs");
  redirect(withOk(`/runs/${id}`, "Run cancelled. Its reserved stock is free again."));
}

export async function restore(form: FormData) {
  const id = String(form.get("runId"));
  await attempt(`/runs/${id}`, () => restoreRun(db(), id, String(form.get("reason") ?? "")));
  revalidatePath("/runs");
  redirect(withOk(`/runs/${id}`, "Draft run restored."));
}

export async function createBatches(form: FormData) {
  const id = String(form.get("runId"));
  const r = await attempt(`/runs/${id}`, () => ensureBatches(db(), id));
  revalidatePath("/batches");
  redirect(withOk(`/runs/${id}`, r.created ? `${r.created} batch(es) created from the saved forecast.` : "This run already has its batches."));
}

/** Change a draft run: its production date and jar targets. */
export async function editDraft(form: FormData) {
  const id = String(form.get("runId"));
  const targets: Record<string, number> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("t:")) targets[k.slice(2)] = String(v).trim() === "" ? 0 : Number(v);
  }
  await attempt(`/runs/${id}?edit=1`, () => updateDraftRun(db(), id, String(form.get("plannedFor") ?? ""), targets, String(form.get("reason") ?? "")));
  revalidatePath("/runs");
  redirect(withOk(`/runs/${id}`, "Draft run saved. Batches, stock and budget below follow the new numbers."));
}
