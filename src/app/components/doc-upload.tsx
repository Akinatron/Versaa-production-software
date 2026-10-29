"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { uploadDocumentsAction } from "../documents/actions";
import { uploadProblem } from "@/domain/uploads";

/** Photos (also straight from the phone camera) and PDFs. */
export const DOC_ACCEPT = "image/*,application/pdf,.heic,.heif";

/** Say before sending when a file is too big, instead of a server error after a long upload. */
export function sizeProblem(files: FileList | null) {
  if (!files) return "";
  return uploadProblem(Array.from(files));
}

/** A file input for a bigger form (e.g. Record a delivery): checks sizes and lists what was chosen. */
export function DocFileInput({ name, id }: { name: string; id?: string }) {
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <>
      <input
        id={id}
        name={name}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        onChange={(e) => {
          const el = e.currentTarget;
          el.setCustomValidity(sizeProblem(el.files));
          el.reportValidity();
          setChosen(Array.from(el.files ?? []).map((f) => f.name));
        }}
      />
      {chosen.length > 1 && <div className="small muted">{chosen.length} files chosen</div>}
    </>
  );
}

function Picker({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <span className={`btn secondary sm${pending ? " busy" : ""}`} aria-disabled={pending || undefined}>
      {pending ? "Uploading…" : label}
    </span>
  );
}

/**
 * One button: pick a photo or PDF (or take a photo on a phone) and it is
 * uploaded straight away to the delivery or order.
 */
export function DocUpload({
  kind,
  receiptId,
  poId,
  back,
  label,
}: {
  kind: "delivery_note" | "invoice";
  receiptId?: string;
  poId?: string;
  back: string;
  label: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [problem, setProblem] = useState("");
  return (
    <form ref={form} action={uploadDocumentsAction} className="doc-upload">
      <input type="hidden" name="kind" value={kind} />
      {receiptId && <input type="hidden" name="receiptId" value={receiptId} />}
      {poId && <input type="hidden" name="poId" value={poId} />}
      <input type="hidden" name="back" value={back} />
      <label>
        <input
          type="file"
          name="files"
          multiple
          accept={DOC_ACCEPT}
          className="visually-hidden"
          onChange={(e) => {
            const p = sizeProblem(e.currentTarget.files);
            setProblem(p);
            if (!p && e.currentTarget.files?.length) form.current?.requestSubmit();
          }}
        />
        <Picker label={label} />
      </label>
      {problem && <span className="small bad-text">{problem}</span>}
    </form>
  );
}
