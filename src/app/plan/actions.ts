"use server";

import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { createRun } from "@/db/operations";
import { attempt } from "../components/flash";
import { wholeNumber } from "@/domain/typed-number";

export async function saveRun(form: FormData) {
  const targets: Record<string, number> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("t:") && String(v).trim() !== "") targets[k.slice(2)] = wholeNumber(String(v));
  }
  const given = String(form.get("back") ?? "");
  const back = given.startsWith("/plan?") ? given : `/plan?${[...form.entries()].filter(([k]) => k.startsWith("t:")).map(([k, v]) => `${k.slice(2)}=${v}`).join("&")}`;
  const run = await attempt(back, () =>
    createRun(db(), { idempotencyKey: String(form.get("key")), plannedFor: String(form.get("plannedFor")), targets }),
  );
  redirect(`/runs/${run.id}`);
}
