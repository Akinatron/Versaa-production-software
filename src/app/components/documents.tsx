import { DOC_KIND, type DocumentRow } from "@/db/documents";
import { removeDocumentAction, restoreDocumentAction } from "../documents/actions";
import { Icon } from "./ui/icons";
import { fmtDate } from "./ui/format";
import { fmtWhen } from "./history-format";
import { dayOf } from "@/domain/dates";

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
              added {fmtDate(dayOf(d.createdAt))} · {fileSize(d.sizeBytes)}
            </span>
          </div>
          {back && (
            <details className="doc-remove">
              <summary className="btn ghost sm">Remove</summary>
              <form action={removeDocumentAction} className="row" style={{ alignItems: "center", marginTop: 6 }}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="back" value={back} />
                <input name="reason" required placeholder="Why remove it?" aria-label={`Why remove ${d.fileName}?`} style={{ maxWidth: 220 }} />
                <button type="submit" className="danger sm">
                  Remove
                </button>
              </form>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Files taken off, with the way to put one back. */
export function RemovedDocs({ docs, back }: { docs: { doc: DocumentRow }[]; back: string }) {
  if (docs.length === 0) return null;
  return (
    <details className="small" style={{ marginTop: 12 }}>
      <summary>Removed files · {docs.length}</summary>
      <ul className="doclist">
        {docs.map(({ doc: d }) => (
          <li key={d.id}>
            <div className="what">
              <span className="is-deleted">{d.fileName}</span>
              <span className="sub">
                {DOC_KIND[d.kind]} · removed {d.removedAt ? fmtWhen(d.removedAt) : ""}
              </span>
            </div>
            <form action={restoreDocumentAction} className="row" style={{ alignItems: "center" }}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="back" value={back} />
              <input name="reason" required placeholder="Why put it back?" aria-label={`Why put back ${d.fileName}?`} style={{ maxWidth: 200 }} />
              <button type="submit" className="secondary sm">
                Put back
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
