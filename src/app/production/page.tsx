import { redirect } from "next/navigation";

/** Old address: batches to cook now live in Batches. */
export default function ProductionPage() {
  redirect("/batches?show=cook");
}
