"use client";

/*
 * The two full-screen confirmations of developer mode: turning it on, and
 * deleting the database. They are the only pop-up windows in the app, on
 * purpose: both are rare and both need a clear stop before going on.
 */
import { useMemo, useRef, useState } from "react";
import { deleteDatabaseAction, enterDeveloperModeAction } from "./developer-actions";
import { WIPE_INFO, WIPE_PARTS, withDependencies, type WipeCounts, type WipePart } from "@/db/wipe-info";

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  return { ref, open: () => ref.current?.showModal(), close: () => ref.current?.close() };
}

export function EnterDeveloperMode() {
  const d = useDialog();
  return (
    <>
      <button type="button" className="secondary" onClick={d.open}>
        Developer mode
      </button>
      <dialog ref={d.ref} className="takeover" aria-labelledby="dev-title">
        <div className="takeover-box">
          <h2 id="dev-title">Turn on developer mode?</h2>
          <p>Developer mode is for testing the app, not for daily work. It adds three tools to Settings:</p>
          <ul>
            <li>
              <strong>Check for updates</strong>: install a new version of the Mac app.
            </li>
            <li>
              <strong>Mock data</strong>: look at the app with test data. Your real data stays as it is.
            </li>
            <li>
              <strong>Delete database</strong>: remove data for good.
            </li>
          </ul>
          <p className="muted">It stays on, also after closing the app, until you press &quot;Back to normal mode&quot;.</p>
          <div className="takeover-actions">
            <form action={enterDeveloperModeAction}>
              <button type="submit" className="btn-danger-solid">
                Enter developer mode
              </button>
            </form>
            <button type="button" className="secondary" onClick={d.close} autoFocus>
              Stay in normal mode
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What deleting these parts removes, in words. */
function summary(parts: Set<WipePart>, c: WipeCounts): string[] {
  const out: string[] = [];
  if (parts.has("activity"))
    out.push(
      plural(c.runs, "run"),
      plural(c.batches, "batch", "batches"),
      plural(c.orders, "purchase order"),
      plural(c.deliveries, "delivery", "deliveries"),
      plural(c.lots, "lot"),
      plural(c.salesOrders, "sales order"),
      plural(c.documents, "uploaded file"),
      plural(c.history, "history entry", "history entries"),
    );
  if (parts.has("suppliers")) out.push(plural(c.suppliers, "supplier"));
  if (parts.has("recipes")) out.push(plural(c.recipes, "recipe version"), plural(c.packagingLists, "packaging list"));
  if (parts.has("items")) out.push(plural(c.items, "item"));
  if (parts.has("catalog")) out.push(plural(c.sauces, "sauce"), plural(c.products, "product"));
  return out;
}

export function DeleteDatabase({ counts, mock }: { counts: WipeCounts; mock: boolean }) {
  const d = useDialog();
  const [chosen, setChosen] = useState<Set<WipePart>>(new Set());
  const [typed, setTyped] = useState("");
  const parts = useMemo(() => withDependencies(chosen), [chosen]);
  // Why a part is ticked without being chosen: the first chosen part that needs it.
  const forcedBy = (p: WipePart) => [...chosen].find((c) => c !== p && withDependencies([c]).has(p));
  const toggle = (p: WipePart) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const all = WIPE_PARTS.every((p) => parts.has(p));
  const lines = summary(parts, counts);
  const where = mock ? "mock" : "real";

  return (
    <>
      <button type="button" className="danger" onClick={d.open}>
        Delete database…
      </button>
      <dialog ref={d.ref} className="takeover" aria-labelledby="del-title" onClose={() => (setTyped(""), setChosen(new Set()))}>
        <form action={deleteDatabaseAction} className="takeover-box">
          <h2 id="del-title">Delete from the {where} database</h2>
          <p className={mock ? "muted" : "text-bad"}>
            {mock
              ? "You are looking at mock data: only the mock database is changed. Your real data is not touched."
              : "This deletes your real data. It can't be undone in the app."}
          </p>
          <fieldset className="wipe-parts">
            <legend>What to delete</legend>
            <label className="wipe-all">
              <input type="checkbox" checked={all} onChange={() => setChosen(all ? new Set() : new Set(WIPE_PARTS))} /> Select all
            </label>
            {WIPE_PARTS.map((p) => {
              const by = forcedBy(p);
              const forced = !chosen.has(p) && parts.has(p);
              return (
                <label key={p} className={`wipe-part${forced ? " forced" : ""}`}>
                  <input type="checkbox" checked={parts.has(p)} disabled={forced} onChange={() => toggle(p)} />
                  {parts.has(p) && <input type="hidden" name="part" value={p} />}
                  <span>
                    <strong>{WIPE_INFO[p].label}</strong>
                    <span className="small muted"> {WIPE_INFO[p].text}</span>
                    {forced && by && <span className="small text-warn"> Also deleted, because of {WIPE_INFO[by].label}.</span>}
                    {chosen.has(p) && WIPE_INFO[p].why && WIPE_INFO[p].needs.some((n) => !chosen.has(n)) && (
                      <span className="small text-warn"> The parts in grey go with it: {WIPE_INFO[p].why}.</span>
                    )}
                  </span>
                </label>
              );
            })}
            <p className="small muted">Team logins are never deleted.</p>
          </fieldset>
          {lines.length > 0 && (
            <p className="wipe-summary">
              <strong>Will delete:</strong> {lines.join(", ")}.
            </p>
          )}
          {!mock && <p className="small muted">In the Mac app a copy of the database and its files is saved to the backups folder first.</p>}
          <label htmlFor="wipe-confirm">Type DELETE to confirm</label>
          <input
            id="wipe-confirm"
            name="confirm"
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <div className="takeover-actions">
            <button type="submit" className="btn-danger-solid" disabled={parts.size === 0 || typed !== "DELETE"}>
              Delete for good
            </button>
            <button type="button" className="secondary" onClick={d.close}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
