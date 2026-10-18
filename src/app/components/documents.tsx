import { DOC_KIND, type DocumentRow } from "@/db/documents";
import { removeDocumentAction } from "../documents/actions";
import { Icon } from "./ui/icons";
import { fmtDate } from "./ui/format";
import { ConfirmButton } from "./unsaved-guard";

const SHOWN_INLINE = new Set(["image/jpeg", "image/png", "image/webp"]);

export function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Delivery notes and invoices as a list: a thumbnail for photos, the name
 * (opens the file in a new tab), what it is and when it was added.
 * With `back`, each one can be removed.
 */
export function DocList({
  docs,
  back,
  showKind = false,
  extra,
}: {
  docs: DocumentRow[];
  back?: string;
  showKind?: boolean;
  extra?: (d: DocumentRow) => React.ReactNode;
}) {
  if (docs.length === 0) return null;
  return (
    <ul className="doclist">
      {docs.map((d) => (
        <li key={d.id}>
          <a href={`/documents/${d.id}`} target="_blank" rel="noopener" className="doc-thumb" aria-hidden="true" tabIndex={-1}>
            {SHOWN_INLINE.has(d.contentType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/documents/${d.id}`} alt="" loading="lazy" />
            ) : (
              <Icon name={d.contentType === "application/pdf" ? "doc" : "photo"} className="" size={20} />
            )}
          </a>
          <div className="what">
            <a href={`/documents/${d.id}`} target="_blank" rel="noopener">
              {d.fileName}
            </a>
            <span className="sub">
              {showKind && `${DOC_KIND[d.kind]} · `}
              {extra?.(d)}
              added {fmtDate(d.createdAt.toISOString().slice(0, 10))} · {fileSize(d.sizeBytes)}
            </span>
          </div>
          {back && (
            <form action={removeDocumentAction}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="back" value={back} />
              <ConfirmButton message={`Remove "${d.fileName}"?`} className="ghost sm">
                Remove
              </ConfirmButton>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
