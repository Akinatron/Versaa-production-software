import { cookies } from "next/headers";
import { db } from "@/db/client";
import { SESSION_COOKIE, userForToken } from "@/db/auth";

/** The signed-in team member for this request, or null. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForToken(db(), token);
}
