import { notFound, redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { batchHref, batchStepFor } from "../../components/batch-paths";

export const dynamic = "force-dynamic";

/** Opening a batch lands on the step it is waiting on. */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [b] = await db()
    .select({
      status: t.productionBatches.status,
      pending: sql<number>`(select count(*)::int from batch_consumption c where c.batch_id = ${t.productionBatches.id} and c.confirmed_at is null)`,
      sessions: sql<number>`(select count(*)::int from packaging_sessions s where s.batch_id = ${t.productionBatches.id} and s.deleted_at is null)`,
    })
    .from(t.productionBatches)
    .where(eq(t.productionBatches.id, id))
    .catch(() => []);
  if (!b) notFound();
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  redirect(batchHref(id, batchStepFor(b)) + (qs ? `?${qs}` : ""));
}
