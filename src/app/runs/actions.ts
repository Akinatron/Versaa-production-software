"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { cancelRun, confirmRun } from "@/db/operations";
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
  await attempt(`/runs/${id}`, () => cancelRun(db(), id));
  revalidatePath("/runs");
  redirect(withOk(`/runs/${id}`, "Run cancelled. Its reserved stock is free again."));
}

export async function createBatches(form: FormData) {
  const id = String(form.get("runId"));
  const r = await attempt(`/runs/${id}`, () => ensureBatches(db(), id));
  revalidatePath("/batches");
  redirect(withOk(`/runs/${id}`, r.created ? `${r.created} batch(es) created from the saved forecast.` : "This run already has its batches."));
}
