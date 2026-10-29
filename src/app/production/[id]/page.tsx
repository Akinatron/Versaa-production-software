import { redirect } from "next/navigation";
import { idOrNotFound } from "@/lib/ids";

/** Old address of a batch's ingredients: now its Cook step. */
export default async function OldProductionBatch({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/batches/${idOrNotFound((await params).id)}/cook`);
}
