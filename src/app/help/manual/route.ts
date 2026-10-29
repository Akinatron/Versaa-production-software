import { db } from "@/db/client";
import { setupMarkdown } from "@/db/help";
import { buildManual } from "@/help/manual";
import { today as todayIso } from "@/domain/dates";

export const dynamic = "force-dynamic";

/** The AI manual as a Markdown download. ?setup=1 adds this business's recipes, products, items and prices. */
export async function GET(req: Request) {
  const withSetup = new URL(req.url).searchParams.get("setup") === "1";
  const today = todayIso();
  const body = buildManual({ generatedOn: today, setup: withSetup ? await setupMarkdown(db()) : null });
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="versaa-manual-${today}${withSetup ? "-with-setup" : ""}.md"`,
      "cache-control": "no-store",
    },
  });
}
