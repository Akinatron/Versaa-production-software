import { redirect } from "next/navigation";
import { idOrNotFound } from "@/lib/ids";

/** Old address of a batch's jars: now its Pack step. */
export default async function OldPackagingBatch({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/batches/${idOrNotFound((await params).id)}/pack`);
}
