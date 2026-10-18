"use client";

import { useActionState, useMemo, useState } from "react";
import { useUnsavedWarning } from "../../components/unsaved-guard";

export interface LotOption {
  id: string;
  label: string;
  /** What can be taken from this lot by this line: its balance plus what the line already took from it. */
  available: string;
}

export interface IngredientLine {
  itemId: string;
  name: string;
  unit: string;
  /** Recipe quantity; null for an ingredient that isn't in the recipe. */
  standard: string | null;
  recorded: boolean;
  actual: string | null;
  /** What was taken from each lot so far. */
  split: { lotId: string; qty: string }[];
  lots: LotOption[];
}

type Split = { lotId: string; qty: string }[];
interface LineState {
  qty: string;
  manual: boolean;
  split: Split;
}
export interface FormResult {
  error: string | null;
}

const big = { fontSize: "1.05rem", padding: "10px 12px" } as const;
const num = { ...big, maxWidth: 140 } as const;

const sum = (s: Split) => {
  // Decimal-safe enough for display: inputs have few decimals; the server checks exactly.
  const total = s.reduce((a, r) => a + (r.qty.trim() === "" || Number.isNaN(Number(r.qty)) ? 0 : Number(r.qty)), 0);
  return String(Math.round(total * 1e6) / 1e6);
};

function initialState(l: IngredientLine): LineState {
  return {
    qty: l.recorded ? (l.actual ?? "0") : (l.standard ?? ""),
    manual: false,
    split: l.split.length
      ? l.split
      : [
          {
            lotId: l.lots[0]?.id ?? "",
            qty: l.recorded ? (l.actual ?? "") : (l.standard ?? ""),
          },
        ],
  };
}

/**
 * Ingredients used in a batch: every quantity is edited here and saved
 * together with one Record button. Planned quantities are filled in already
 * and can be changed; 0 means none was used.
 */
export function IngredientsForm({
  action,
  batchId,
  idemKey,
  producedOn,
  lines,
  extras,
}: {
  action: (prev: FormResult, form: FormData) => Promise<FormResult>;
  batchId: string;
  idemKey: string;
  producedOn: string;
  lines: IngredientLine[];
  extras: IngredientLine[];
}) {
  const [result, formAction, saving] = useActionState(action, { error: null });
  const [date, setDate] = useState(producedOn);
  const [added, setAdded] = useState<IngredientLine[]>([]);
  const all = useMemo(() => [...lines, ...added], [lines, added]);
  const [state, setState] = useState<Record<string, LineState>>(() => Object.fromEntries(lines.map((l) => [l.itemId, initialState(l)])));
  const initial = useMemo(
    () =>
      JSON.stringify({
        date: producedOn,
        s: Object.fromEntries(lines.map((l) => [l.itemId, initialState(l)])),
      }),
    [lines, producedOn],
  );
  const dirty = JSON.stringify({ date, s: state }) !== initial;
  useUnsavedWarning(dirty && !saving);

  const set = (itemId: string, patch: Partial<LineState>) => setState((s) => ({ ...s, [itemId]: { ...s[itemId]!, ...patch } }));
  const payload = JSON.stringify(
    all.map((l) => {
      const s = state[l.itemId]!;
      return s.manual
        ? {
            itemId: l.itemId,
            quantity: sum(s.split),
            lots: s.split.filter((r) => r.lotId || r.qty.trim()),
          }
        : { itemId: l.itemId, quantity: s.qty };
    }),
  );
  const notYet = extras.filter((e) => !all.some((l) => l.itemId === e.itemId));

  return (
    <form action={formAction}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="key" value={idemKey} />
      <input type="hidden" name="payload" value={payload} />
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <label htmlFor="producedOn">Cooked on</label>
          <input id="producedOn" name="producedOn" type="date" required value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 200 }} />
        </div>
      </div>
      <div className="card">
        <table className="bl">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Planned</th>
              <th>Used</th>
              <th>From which lots</th>
            </tr>
          </thead>
          <tbody>
            {all.map((l) => {
              const s = state[l.itemId]!;
              const isAdded = added.some((a) => a.itemId === l.itemId);
              return (
                <tr key={l.itemId} className="line">
                  <td>
                    <strong>{l.name}</strong>
                    {l.standard === null ? <span className="small muted"> (not in recipe)</span> : null}
                    <div className="small muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={`dot ${l.recorded ? "ok" : "warn"}`} />
                      {l.recorded ? `Recorded ${l.actual} ${l.unit}` : "Not recorded yet"}
                    </div>
                    {isAdded && (
                      <button
                        type="button"
                        className="link small"
                        onClick={() => {
                          setAdded((a) => a.filter((x) => x.itemId !== l.itemId));
                          setState((st) => Object.fromEntries(Object.entries(st).filter(([k]) => k !== l.itemId)));
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                  <td className="num" data-label="Planned">
                    {l.standard === null ? "—" : `${l.standard} ${l.unit}`}
                  </td>
                  <td data-label={`Used (${l.unit})`}>
                    {s.manual ? (
                      <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                        {sum(s.split)} {l.unit}
                        <div className="small muted" style={{ fontWeight: 400 }}>
                          sum of the lots
                        </div>
                      </div>
                    ) : (
                      <div
                        className="row"
                        style={{
                          gap: 6,
                          alignItems: "center",
                          flexWrap: "nowrap",
                        }}
                      >
                        <input
                          aria-label={`${l.name} used, in ${l.unit}`}
                          inputMode="decimal"
                          value={s.qty}
                          onChange={(e) => set(l.itemId, { qty: e.target.value })}
                          style={num}
                        />
                        <span className="muted">{l.unit}</span>
                      </div>
                    )}
                  </td>
                  <td data-label="From which lots">
                    {!s.manual ? (
                      <>
                        <div className="small">
                          {l.split.length > 0 ? (
                            l.split.map((r) => (
                              <div key={r.lotId}>
                                {l.lots.find((x) => x.id === r.lotId)?.label.split(" · ")[0] ?? "lot"}: {r.qty} {l.unit}
                              </div>
                            ))
                          ) : (
                            <span className="muted">Earliest best-before first</span>
                          )}
                        </div>
                        {l.recorded && l.split.length > 0 && <div className="small muted">A change is taken from or given back to these lots.</div>}
                        {l.lots.length === 0 && <div className="small text-bad">No stock of {l.name} in any lot.</div>}
                        {l.lots.length > 0 && (
                          <button type="button" className="ghost sm" style={{ marginLeft: -8, marginTop: 2 }} onClick={() => set(l.itemId, { manual: true })}>
                            Split between lots
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {s.split.map((r, i) => (
                          <div
                            key={i}
                            className="row"
                            style={{
                              gap: 6,
                              marginBottom: 6,
                              flexWrap: "nowrap",
                            }}
                          >
                            <select
                              aria-label="Lot"
                              value={r.lotId}
                              onChange={(e) =>
                                set(l.itemId, {
                                  split: s.split.map((x, j) => (j === i ? { ...x, lotId: e.target.value } : x)),
                                })
                              }
                              style={{ minWidth: 0 }}
                            >
                              <option value="">Choose a lot…</option>
                              {l.lots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                  {lot.label} · {lot.available} {l.unit} available
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label={`Quantity from this lot, in ${l.unit}`}
                              inputMode="decimal"
                              value={r.qty}
                              onChange={(e) =>
                                set(l.itemId, {
                                  split: s.split.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                                })
                              }
                              style={{ maxWidth: 110 }}
                            />
                            {s.split.length > 1 && (
                              <button
                                type="button"
                                className="link small"
                                onClick={() =>
                                  set(l.itemId, {
                                    split: s.split.filter((_, j) => j !== i),
                                  })
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="row" style={{ gap: 8 }}>
                          <button
                            type="button"
                            className="secondary sm"
                            onClick={() =>
                              set(l.itemId, {
                                split: [...s.split, { lotId: "", qty: "" }],
                              })
                            }
                          >
                            + Another lot
                          </button>
                          <button
                            type="button"
                            className="link small"
                            onClick={() =>
                              set(l.itemId, {
                                manual: false,
                                qty: sum(s.split),
                              })
                            }
                          >
                            Back to automatic
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {notYet.length > 0 && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: "1px solid var(--border)",
            }}
          >
            <label htmlFor="add-extra">Add an ingredient that isn&apos;t in the recipe</label>
            <select
              id="add-extra"
              value=""
              onChange={(e) => {
                const x = extras.find((i) => i.itemId === e.target.value);
                if (!x) return;
                setAdded((a) => [...a, x]);
                setState((st) => ({
                  ...st,
                  [x.itemId]: { ...initialState(x), qty: "" },
                }));
              }}
              style={{ maxWidth: 360 }}
            >
              <option value="">Choose…</option>
              {notYet.map((i) => (
                <option key={i.itemId} value={i.itemId}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {result.error && (
        <ul className="issues">
          <li className="bad">{result.error}</li>
        </ul>
      )}
      <div className="savebar">
        <button type="submit" disabled={saving}>
          {saving ? "Recording…" : "Record"}
        </button>
        <span className="small muted">
          {dirty ? <strong className="text-warn">Changes not recorded yet. </strong> : null}
          Saves every line at once and updates stock. Recording again later corrects it by the difference.
        </span>
      </div>
    </form>
  );
}
