import { cookies } from "next/headers";
import { realDb } from "@/db/client";
import { SESSION_COOKIE, userForToken } from "@/db/auth";
import type { Actor } from "@/db/changes";

/** The signed-in team member for this request, or null. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForToken(realDb(), token);
}

export type Role = Actor["role"];
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** Whether this role may do what `need` allows. */
export const can = (role: Role | null | undefined, need: Role) => RANK[role ?? "viewer"] >= RANK[need];
