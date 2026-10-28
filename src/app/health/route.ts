/** A plain "the server is up" answer, used by the Mac app while it starts. */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
