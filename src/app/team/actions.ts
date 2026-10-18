"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { createUser, setPassword, setUserActive, setUserRole, type Role } from "@/db/auth";
import { currentUser } from "@/lib/session";
import { OperationError } from "@/db/operations";
import { attempt, withOk } from "../components/flash";

/** Only admins manage the team. */
const asAdmin = <T,>(fn: () => Promise<T>) => attempt("/team", fn, { role: "admin" });

export async function addMember(form: FormData) {
  const email = String(form.get("email") ?? "");
  const role = String(form.get("role") ?? "viewer") as Role;
  await asAdmin(() => createUser(db(), { email, name: String(form.get("name") ?? ""), password: String(form.get("password") ?? ""), role }));
  revalidatePath("/team");
  redirect(withOk("/team", `Account made for ${email.trim().toLowerCase()}. Give them the password; they can sign in now.`));
}

export async function toggleMember(form: FormData) {
  const me = await currentUser();
  const id = String(form.get("userId"));
  const active = form.get("active") === "1";
  await asAdmin(async () => {
    if (id === me?.id && !active) throw new OperationError("You can't switch off your own account.");
    await setUserActive(db(), id, active);
  });
  revalidatePath("/team");
  redirect(withOk("/team", active ? "Account switched back on." : "Account switched off and signed out everywhere."));
}

export async function resetPassword(form: FormData) {
  await asAdmin(() => setPassword(db(), String(form.get("userId")), String(form.get("password") ?? "")));
  revalidatePath("/team");
  redirect(withOk("/team", "Password changed. They need to sign in again with the new one."));
}

export async function changeRole(form: FormData) {
  await asAdmin(() => setUserRole(db(), String(form.get("userId")), String(form.get("role") ?? "") as Role));
  revalidatePath("/team");
  redirect(withOk("/team", "Role saved."));
}
