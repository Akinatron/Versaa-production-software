import { redirect } from "next/navigation";

/** Old address: batches to pack now live in Batches. */
export default function PackagingPage() {
  redirect("/batches?show=pack");
}
