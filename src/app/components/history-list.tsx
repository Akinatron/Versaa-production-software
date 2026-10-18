"use client";

import Link from "next/link";
import { useState } from "react";
import type { ChangeRow } from "./history-format";

/** One change: when, who, what, from what to what, and why. */
export function ChangeItem({ c, showEntity = true, children }: { c: ChangeRow; showEntity?: boolean; children?: React.ReactNode }) {
  return (
    <li className="change">
      <div className="change-head">
        <span className={`badge ${c.action.cls}`}>{c.action.label}</span>
        {showEntity && (
          <Link href={c.entity.href} className="change-code">
            {c.entity.label}
          </Link>
        )}
        <span className="change-summary">{c.summary}</span>
      </div>
      {c.changes.length > 0 && (
        <ul className="change-fields">
          {c.changes.map((f, i) => (
            <li key={i}>
              <span className="muted">{f.label}:</span> {f.before !== null && <s className="was">{f.before}</s>} {f.before !== null && f.after !== null && "→"}{" "}
              {f.after !== null ? <span>{f.after}</span> : <em className="muted">removed</em>}
            </li>
          ))}
        </ul>
      )}
      <div className="change-meta small muted">
        {c.when} · {c.who}
        {c.reason && <> · &ldquo;{c.reason}&rdquo;</>}
      </div>
      {children}
    </li>
  );
}

/**
 * The History section of a record's page: its own changes and those of what
 * hangs from it (a run's batches, a batch's packaging…), with a switch to
 * see only its own.
 */
export function HistoryList({ rows, ownIds, label, kind }: { rows: ChangeRow[]; ownIds: string[]; label: string; kind: string }) {
  const [onlyOwn, setOnlyOwn] = useState(false);
  const own = new Set(ownIds);
  const hasLinked = rows.some((r) => !own.has(r.id));
  const shown = onlyOwn ? rows.filter((r) => own.has(r.id)) : rows;
  return (
    <>
      {hasLinked && (
        <div className="tabs" role="tablist" aria-label="Which changes">
          <button type="button" role="tab" aria-selected={!onlyOwn} className={!onlyOwn ? "on" : ""} onClick={() => setOnlyOwn(false)}>
            Everything linked
          </button>
          <button type="button" role="tab" aria-selected={onlyOwn} className={onlyOwn ? "on" : ""} onClick={() => setOnlyOwn(true)}>
            Only this {kind}
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted small">No changes to {label} itself yet.</p>
      ) : (
        <ul className="changes">
          {shown.map((c) => (
            <ChangeItem key={c.id} c={c} showEntity={!own.has(c.id)} />
          ))}
        </ul>
      )}
    </>
  );
}
