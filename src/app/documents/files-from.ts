import type { UploadFile } from "@/db/documents";

/** The files chosen in a form's file input(s) called `name`. */
export async function filesFrom(form: FormData, name: string): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const v of form.getAll(name)) {
    if (typeof v === "string" || v.size === 0) continue;
    out.push({ name: v.name, data: new Uint8Array(await v.arrayBuffer()) });
  }
  return out;
}
