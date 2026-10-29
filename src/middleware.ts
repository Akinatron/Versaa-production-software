import { NextResponse, type NextRequest } from "next/server";
import { isLocalHost } from "./lib/local-host";

/** Every request must come in as localhost or 127.0.0.1 (see src/lib/local-host.ts). */
export function middleware(request: NextRequest) {
  if (isLocalHost(request.headers.get("host"))) return NextResponse.next();
  return new NextResponse("Versaa only opens on this computer: use http://localhost.", { status: 403, headers: { "content-type": "text/plain" } });
}
