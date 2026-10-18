import { redirect } from "next/navigation";

/** Old address of a batch's jars: now its Pack step. */
export default async function OldPackagingBatch({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/batches/${(await params).id}/pack`);
}
