"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { createUser, setPassword, setUserActive } from "@/db/auth";
import { currentUser } from "@/lib/session";
import { OperationError } from "@/db/operations";
import { attempt, withOk } from "../components/flash";

async function signedIn() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return me;
}

export async function addMember(form: FormData) {
  await signedIn();
  const email = String(form.get("email") ?? "");
  await attempt("/team", () => createUser(db(), { email, name: String(form.get("name") ?? ""), password: String(form.get("password") ?? "") }));
  revalidatePath("/team");
  redirect(withOk("/team", `Account made for ${email.trim().toLowerCase()}. Give them the password; they can sign in now.`));
}

export async function toggleMember(form: FormData) {
  const me = await signedIn();
  const id = String(form.get("userId"));
  const active = form.get("active") === "1";
  await attempt("/team", async () => {
    if (id === me.id && !active) throw new OperationError("You can't switch off your own account.");
    await setUserActive(db(), id, active);
  });
  revalidatePath("/team");
  redirect(withOk("/team", active ? "Account switched back on." : "Account switched off and signed out everywhere."));
}

export async function resetPassword(form: FormData) {
  await signedIn();
  await attempt("/team", () => setPassword(db(), String(form.get("userId")), String(form.get("password") ?? "")));
  revalidatePath("/team");
  redirect(withOk("/team", "Password changed. They need to sign in again with the new one."));
}
