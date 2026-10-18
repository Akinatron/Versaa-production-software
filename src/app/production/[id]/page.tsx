import { redirect } from "next/navigation";

/** Old address of a batch's ingredients: now its Cook step. */
export default async function OldProductionBatch({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/batches/${(await params).id}/cook`);
}
