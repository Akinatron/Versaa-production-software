import { db } from "@/db/client";
import { documentById } from "@/db/documents";
import { getFile } from "@/lib/files";
import { isId } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** Open a delivery note or invoice. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isId(id)) return new Response("Not found", { status: 404 });
  const doc = await documentById(db(), id);
  if (!doc) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await getFile(doc.storageKey);
  } catch {
    return new Response("The file is missing from storage.", { status: 410 });
  }
  const download = new URL(req.url).searchParams.has("download");
  const ascii = doc.fileName.replace(/[^\x20-\x7e]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
