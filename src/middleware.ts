import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { SESSION_COOKIE, userForToken } from "@/db/auth";

/*
 * Every page and every form submission needs a signed-in team member,
 * except the sign-in and first-account pages. Runs on the Node runtime so
 * it can check the session in the database.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname === "/setup" || pathname === "/health") return NextResponse.next();
  const user = await userForToken(db(), req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();
  if (req.method !== "GET") return new NextResponse("Sign in first.", { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
