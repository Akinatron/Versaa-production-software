"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { realDb } from "@/db/client";
import { SESSION_COOKIE, createUser, signIn, signOut } from "@/db/auth";
import { attempt } from "../components/flash";

async function startSession(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    expires: expiresAt,
  });
}

const safeNext = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

export async function login(form: FormData) {
  const next = safeNext(form.get("next"));
  const { token, expiresAt } = await attempt(
    `/login?next=${encodeURIComponent(next)}`,
    () => signIn(realDb(), String(form.get("email") ?? ""), String(form.get("password") ?? "")),
    // Anyone may sign in, also over a viewer's session.
    { role: "viewer" },
  );
  await startSession(token, expiresAt);
  redirect(next);
}

export async function setupFirstAccount(form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  await attempt("/setup", () => createUser(realDb(), { email, name: String(form.get("name") ?? ""), password }, { firstOnly: true }));
  const { token, expiresAt } = await signIn(realDb(), email, password);
  await startSession(token, expiresAt);
  redirect("/");
}

export async function logout() {
  const jar = await cookies();
  await signOut(realDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
