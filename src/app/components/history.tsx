import Link from "next/link";
import { db } from "@/db/client";
import { changesFor, editedInfo, type EntityType } from "@/db/changes";
import { ENTITY_LABEL, fmtWhen, toRow } from "./history-format";
import { HistoryList } from "./history-list";

/**
 * "History" at the bottom of a record's page, folded. Lists what changed,
 * when and why, for the record and everything linked to it.
 */
export async function History({ of, open }: { of: { type: EntityType; id: string }; open?: boolean }) {
  const all = await changesFor(db(), of);
  const own = all.filter((c) => c.entityType === of.type && c.entityId === of.id);
  const kind = ENTITY_LABEL[of.type].toLowerCase();
  const last = all[0];
  return (
    <details className="card" id="history" open={open}>
      <summary>
        <strong>History</strong>{" "}
        <span className="muted small">
          {all.length === 0 ? "· nothing recorded yet" : `· ${all.length} change${all.length === 1 ? "" : "s"} · last ${fmtWhen(last!.at)}`}
        </span>
      </summary>
      {all.length === 0 ? (
        <p className="muted small">Every change, delete and restore made from now on shows here, with when and why.</p>
      ) : (
        <HistoryList rows={all.map(toRow)} ownIds={own.map((c) => c.id)} label={`this ${kind}`} kind={kind} />
      )}
      <p className="small" style={{ marginTop: 12 }}>
        <Link href="/history">All changes in the app</Link>
      </p>
    </details>
  );
}

/** "Edited 2 times, last on 18 Oct", next to a record's title. Nothing when it was never changed. */
export async function EditedMark({ of }: { of: { type: EntityType; id: string } }) {
  const info = (await editedInfo(db(), of.type, [of.id])).get(of.id);
  if (!info) return null;
  return (
    <a href="#history" className="edited-mark" title="See the history">
      Edited{info.count > 1 ? ` ${info.count} times` : ""} · last {fmtWhen(info.last.at)}
    </a>
  );
}

/** A record that was deleted: when and why, with the way back. */
export function DeletedNote({ what, at, reason, children }: { what: string; at: Date; reason?: string | null; children?: React.ReactNode }) {
  return (
    <div className="card deleted-note">
      <strong>
        This {what} was deleted on {fmtWhen(at)}.
      </strong>
      {reason && <p className="small" style={{ margin: "4px 0 0" }}>Reason: &ldquo;{reason}&rdquo;</p>}
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        It is kept on record and no longer counts in stock or reports.
      </p>
      {children}
    </div>
  );
}

/** The "why" every change, delete and restore asks for. */
export function ReasonField({ id, label = "Why?", placeholder = "Goes in the history", optional }: { id: string; label?: string; placeholder?: string; optional?: boolean }) {
  return (
    <div className="field" style={{ flex: "1 1 260px" }}>
      <label htmlFor={id}>
        {label}
        {optional ? " (optional)" : ""}
      </label>
      <input id={id} name="reason" required={!optional} placeholder={placeholder} />
    </div>
  );
}
